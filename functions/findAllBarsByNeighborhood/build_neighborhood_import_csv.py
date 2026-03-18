import csv
import io
import json
import os
import time
from datetime import datetime

import boto3
import requests

GOOGLE_API_KEY = os.environ['GOOGLE_API_KEY']
S3_BUCKET = os.environ['S3_BUCKET']
S3_DATA_FOLDER = os.environ['S3_DATA_FOLDER']

GOOGLE_TEXT_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json'
BAR_TABLE_NAME = 'bar'
TRANSACTION_TYPE = 'II'
CSV_HEADERS = ['name', 'google_place_id', 'address', 'neighborhood', 'is_active']
BAR_KEYWORDS = {'bar', 'pub', 'tavern', 'lounge', 'saloon', 'cocktail', 'taproom', 'alehouse'}
BAR_TYPES = {'bar', 'night_club'}
RESTAURANT_TYPES = {'restaurant', 'food'}

s3_client = boto3.client('s3')

NEIGHBORHOOD_CONFIGS = {
    'downtown': {
        'neighborhood_name': 'Downtown',
        'search_label': 'Downtown Pittsburgh',
        'search_bounds': {
            'south': 40.4325,
            'west': -80.0208,
            'north': 40.4475,
            'east': -79.9870
        },
        'polygon': [
            {'lat': 40.442357, 'lng': -80.015060},
            {'lat': 40.447582, 'lng': -79.994819},
            {'lat': 40.443094, 'lng': -79.991779},
            {'lat': 40.434590, 'lng': -79.996123},
            {'lat': 40.442357, 'lng': -80.015060}
        ]
    }
}


def get_neighborhood_config(neighborhood_input):
    neighborhood_key = (neighborhood_input or '').strip().lower()
    if not neighborhood_key:
        raise ValueError('Event field "neighborhood" is required.')

    config = NEIGHBORHOOD_CONFIGS.get(neighborhood_key)
    if not config:
        supported = sorted(NEIGHBORHOOD_CONFIGS.keys())
        raise ValueError(f'Unsupported neighborhood "{neighborhood_input}". Supported: {supported}')

    return config


def build_location_bias(bounds):
    return f"rectangle:{bounds['south']},{bounds['west']}|{bounds['north']},{bounds['east']}"


def fetch_places_page(query, location_bias, page_token=None):
    params = {
        'query': query,
        'locationbias': location_bias,
        'key': GOOGLE_API_KEY
    }
    if page_token:
        params['pagetoken'] = page_token

    response = requests.get(GOOGLE_TEXT_SEARCH_URL, params=params, timeout=10)
    response.raise_for_status()
    payload = response.json()

    status = payload.get('status')
    if status not in ('OK', 'ZERO_RESULTS'):
        if status == 'INVALID_REQUEST' and page_token:
            return {'results': [], 'next_page_token': None}
        error_message = payload.get('error_message', status)
        raise ValueError(f'Google Places text search failed: {error_message}')

    return {
        'results': payload.get('results', []),
        'next_page_token': payload.get('next_page_token')
    }


def fetch_all_places(query, location_bias):
    all_results = []
    next_page_token = None

    while True:
        page = fetch_places_page(query, location_bias, next_page_token)
        all_results.extend(page['results'])
        next_page_token = page['next_page_token']

        if not next_page_token:
            break

        time.sleep(2)

    return all_results


def dedupe_by_place_id(places):
    deduped = {}
    for place in places:
        place_id = place.get('place_id')
        if place_id:
            deduped[place_id] = place
    return list(deduped.values())


def point_in_polygon(lat, lng, polygon):
    inside = False
    j = len(polygon) - 1

    for i in range(len(polygon)):
        yi = polygon[i]['lat']
        xi = polygon[i]['lng']
        yj = polygon[j]['lat']
        xj = polygon[j]['lng']

        intersects = ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i

    return inside


def filter_by_polygon(places, polygon):
    filtered = []
    for place in places:
        location = place.get('geometry', {}).get('location', {})
        lat = location.get('lat')
        lng = location.get('lng')

        if lat is None or lng is None:
            continue

        if point_in_polygon(lat, lng, polygon):
            filtered.append(place)

    return filtered


def is_obvious_bar_place(place):
    types = set(place.get('types', []))
    if types.intersection(BAR_TYPES):
        return True

    name_tokens = set(str(place.get('name', '')).lower().replace('&', ' ').split())
    return bool(name_tokens.intersection(BAR_KEYWORDS))


def restaurant_likely_has_bar(place):
    if is_obvious_bar_place(place):
        return True

    types = set(place.get('types', []))
    if not types.intersection(RESTAURANT_TYPES):
        return False

    name = str(place.get('name', '')).lower()
    keyword_hits = [keyword for keyword in BAR_KEYWORDS if keyword in name]

    return len(keyword_hits) > 0


def build_csv_records(places, neighborhood_name):
    records = []
    for place in places:
        place_id = place.get('place_id')
        name = place.get('name')
        address = place.get('formatted_address')

        if not place_id or not name or not address:
            continue

        records.append({
            'name': name.strip(),
            'google_place_id': place_id.strip(),
            'address': address.strip(),
            'neighborhood': neighborhood_name,
            'is_active': 'Y'
        })

    records.sort(key=lambda row: (row['name'].lower(), row['google_place_id']))
    return records


def build_csv_content(records):
    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([BAR_TABLE_NAME])
    writer.writerow([TRANSACTION_TYPE])
    writer.writerow(CSV_HEADERS)

    for record in records:
        writer.writerow([
            record['name'],
            record['google_place_id'],
            record['address'],
            record['neighborhood'],
            record['is_active']
        ])

    return output.getvalue()


def upload_csv_to_s3(csv_content, neighborhood_name):
    input_prefix = f"{S3_DATA_FOLDER.rstrip('/')}/input"
    slug = neighborhood_name.strip().lower().replace(' ', '_')
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    key = f"{input_prefix}/bar_import_{slug}_{timestamp}.csv"

    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=csv_content.encode('utf-8'),
        ContentType='text/csv'
    )

    return key


def lambda_handler(event, context):
    event = event or {}

    try:
        config = get_neighborhood_config(event.get('neighborhood'))
        search_label = config['search_label']
        location_bias = build_location_bias(config['search_bounds'])

        bar_query = f'bars in {search_label}'
        restaurant_query = f'restaurants in {search_label}'

        bar_results = fetch_all_places(bar_query, location_bias)
        restaurant_results = fetch_all_places(restaurant_query, location_bias)

        all_candidates = dedupe_by_place_id(bar_results + restaurant_results)
        in_polygon = filter_by_polygon(all_candidates, config['polygon'])

        selected_places = [
            place for place in in_polygon
            if is_obvious_bar_place(place) or restaurant_likely_has_bar(place)
        ]

        records = build_csv_records(selected_places, config['neighborhood_name'])
        csv_content = build_csv_content(records)
        uploaded_key = upload_csv_to_s3(csv_content, config['neighborhood_name'])

        response_body = {
            'status': 'success',
            'neighborhood': config['neighborhood_name'],
            'records_generated': len(records),
            's3_bucket': S3_BUCKET,
            's3_key': uploaded_key
        }

        return {
            'statusCode': 200,
            'body': json.dumps(response_body)
        }

    except Exception as e:
        print(f'Failed to build neighborhood bar CSV: {e}')
        return {
            'statusCode': 500,
            'body': json.dumps({
                'status': 'error',
                'message': str(e)
            })
        }
