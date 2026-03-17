import json
import os
import time

import pymysql
import requests

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']
GOOGLE_API_KEY = os.environ['GOOGLE_API_KEY']

PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
MAX_PAGES_PER_QUERY = 3
PAGE_DELAY_SECONDS = 2

NEIGHBORHOOD_CONFIGS = {
    'downtown': {
        'neighborhood_name': 'Downtown',
        'search_label': 'Downtown Pittsburgh',
        'rectangle_bounds': {
            'low': {'latitude': 40.4356, 'longitude': -80.0098},
            'high': {'latitude': 40.4466, 'longitude': -79.9899}
        },
        'polygon': [
            {'latitude': 40.4466, 'longitude': -80.0098},
            {'latitude': 40.4466, 'longitude': -79.9899},
            {'latitude': 40.4356, 'longitude': -79.9899},
            {'latitude': 40.4356, 'longitude': -80.0098}
        ]
    }
}


# DB connection helper
def get_connection():
    return pymysql.connect(
        host=RDS_HOST,
        user=DB_USER,
        passwd=DB_PASSWORD,
        db=DB_NAME,
        cursorclass=pymysql.cursors.DictCursor
    )


# Neighborhood config helper
def get_neighborhood_config(event):
    neighborhood_input = (event or {}).get('neighborhood', 'downtown')
    neighborhood_key = neighborhood_input.strip().lower().replace(' ', '_')

    config = NEIGHBORHOOD_CONFIGS.get(neighborhood_key)
    if not config:
        raise ValueError(f'Unsupported neighborhood: {neighborhood_input}')

    return config


def build_text_search_payload(query_text, bounds, page_token=None):
    payload = {
        'textQuery': query_text,
        'locationRestriction': {
            'rectangle': {
                'low': bounds['low'],
                'high': bounds['high']
            }
        }
    }

    if page_token:
        payload['pageToken'] = page_token

    return payload


def search_places_text(query_text, bounds):
    places = []
    page_token = None

    for _ in range(MAX_PAGES_PER_QUERY):
        payload = build_text_search_payload(query_text, bounds, page_token=page_token)
        headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.servesBeer,places.servesWine,places.servesCocktails,nextPageToken'
        }

        response = requests.post(PLACES_SEARCH_URL, headers=headers, json=payload, timeout=10)
        if response.status_code != 200:
            raise RuntimeError(f'Google Places text search failed ({response.status_code}): {response.text}')

        response_data = response.json()
        places.extend(response_data.get('places', []))

        next_page_token = response_data.get('nextPageToken')
        if not next_page_token:
            break

        page_token = next_page_token
        time.sleep(PAGE_DELAY_SECONDS)

    return places


def normalize_place(place, source):
    display_name = place.get('displayName', {})
    location = place.get('location') or {}

    return {
        'name': display_name.get('text'),
        'google_place_id': place.get('id'),
        'address': place.get('formattedAddress'),
        'latitude': location.get('latitude'),
        'longitude': location.get('longitude'),
        'types': place.get('types', []),
        'primary_type': place.get('primaryType'),
        'serves_beer': place.get('servesBeer', False),
        'serves_wine': place.get('servesWine', False),
        'serves_cocktails': place.get('servesCocktails', False),
        'source': source
    }


def dedupe_places_by_google_id(places):
    deduped = {}

    for place in places:
        place_id = place.get('google_place_id')
        if not place_id:
            continue

        existing = deduped.get(place_id)
        if existing and existing.get('source') == 'bar':
            continue

        deduped[place_id] = place

    return list(deduped.values())


def fetch_existing_google_place_ids_for_neighborhood(neighborhood):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                'SELECT google_place_id FROM bar WHERE neighborhood = %s AND google_place_id IS NOT NULL',
                (neighborhood,)
            )
            rows = cursor.fetchall()
            return {row['google_place_id'] for row in rows}
    finally:
        conn.close()


def is_inside_polygon(latitude, longitude, polygon):
    inside = False
    x = longitude
    y = latitude

    for index in range(len(polygon)):
        point_a = polygon[index]
        point_b = polygon[(index + 1) % len(polygon)]

        ax = point_a['longitude']
        ay = point_a['latitude']
        bx = point_b['longitude']
        by = point_b['latitude']

        intersects = ((ay > y) != (by > y)) and (x < ((bx - ax) * (y - ay) / ((by - ay) or 1e-12)) + ax)
        if intersects:
            inside = not inside

    return inside


def is_obvious_bar(place):
    primary_type = place.get('primary_type') or ''
    place_types = place.get('types', [])

    if primary_type == 'bar':
        return True

    return 'bar' in place_types or 'pub' in place_types or 'night_club' in place_types


def restaurant_likely_has_bar(place):
    if place.get('serves_beer') or place.get('serves_wine') or place.get('serves_cocktails'):
        return True

    place_types = set(place.get('types', []))
    keywords = {'bar_and_grill', 'sports_bar', 'brewpub', 'wine_bar', 'cocktail_bar'}
    if keywords.intersection(place_types):
        return True

    name = (place.get('name') or '').lower()
    if any(token in name for token in ['taproom', 'tavern', 'pub', 'bar']):
        return True

    return False


def filter_places_for_insert(places, neighborhood_config):
    filtered = []
    polygon = neighborhood_config['polygon']

    for place in places:
        latitude = place.get('latitude')
        longitude = place.get('longitude')
        if latitude is None or longitude is None:
            continue

        if not is_inside_polygon(latitude, longitude, polygon):
            continue

        if is_obvious_bar(place):
            filtered.append(place)
            continue

        if place.get('source') == 'restaurant' and restaurant_likely_has_bar(place):
            filtered.append(place)

    return filtered


def build_bar_rows(places, neighborhood):
    rows = []
    for place in places:
        name = place.get('name')
        google_place_id = place.get('google_place_id')
        address = place.get('address')

        if not name or not google_place_id:
            continue

        rows.append((name, google_place_id, address, neighborhood))

    return rows


def insert_new_bars(rows):
    if not rows:
        return 0

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.executemany(
                'INSERT INTO bar (name, google_place_id, address, neighborhood) VALUES (%s, %s, %s, %s)',
                rows
            )
        conn.commit()
    finally:
        conn.close()

    return len(rows)


# Lambda handler
def lambda_handler(event, context):
    try:
        neighborhood_config = get_neighborhood_config(event)
        neighborhood_name = neighborhood_config['neighborhood_name']
        search_label = neighborhood_config['search_label']
        bounds = neighborhood_config['rectangle_bounds']

        print(f'Starting import for neighborhood: {neighborhood_name}')

        bar_results = search_places_text(f'bars in {search_label}', bounds)
        restaurant_results = search_places_text(f'restaurants in {search_label}', bounds)

        normalized_places = [normalize_place(place, 'bar') for place in bar_results]
        normalized_places.extend([normalize_place(place, 'restaurant') for place in restaurant_results])

        deduped_places = dedupe_places_by_google_id(normalized_places)
        print(f'Candidate places after dedupe: {len(deduped_places)}')

        existing_place_ids = fetch_existing_google_place_ids_for_neighborhood(neighborhood_name)
        new_candidate_places = [
            place for place in deduped_places
            if place.get('google_place_id') not in existing_place_ids
        ]
        print(f'Candidate places after existing-id filter: {len(new_candidate_places)}')

        filtered_places = filter_places_for_insert(new_candidate_places, neighborhood_config)
        final_rows = build_bar_rows(filtered_places, neighborhood_name)

        inserted_count = insert_new_bars(final_rows)

        response_body = {
            'neighborhood': neighborhood_name,
            'searched': len(deduped_places),
            'new_candidates': len(new_candidate_places),
            'inserted': inserted_count
        }

        return {
            'statusCode': 200,
            'body': json.dumps(response_body)
        }
    except Exception as e:
        print(f'Failed to import neighborhood bars: {str(e)}')
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
