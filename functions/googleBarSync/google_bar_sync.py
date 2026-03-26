import json
import logging
import os
import re
import time
from typing import Dict, List, Optional

import boto3
import requests

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

GOOGLE_API_KEY = os.environ['GOOGLE_API_KEY']
S3_BUCKET_NAME = os.environ['S3_BUCKET_NAME']
BAR_IMAGE_FOLDER = os.environ['BAR_IMAGE_FOLDER'].strip('/')
DB_BAR_SYNC_LAMBDA_NAME = os.environ['DB_BAR_SYNC_LAMBDA_NAME']

GOOGLE_NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby'
GOOGLE_PLACE_PHOTO_URL_TEMPLATE = 'https://places.googleapis.com/v1/{photo_name}/media'
GOOGLE_FIELD_MASK = ','.join([
    'places.id',
    'places.displayName',
    'places.businessStatus',
    'places.formattedAddress',
    'places.location',
    'places.currentOpeningHours',
    'places.rating',
    'places.priceLevel',
    # Required to keep the existing new-bar image flow without any Place Details call.
    'places.photos',
])

DAY_MAP = {
    0: 'SUN',
    1: 'MON',
    2: 'TUE',
    3: 'WED',
    4: 'THU',
    5: 'FRI',
    6: 'SAT',
}
ALL_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

NEIGHBORHOOD_CONFIGS = {
    'downtown': {
        'neighborhood_name': 'Downtown',
        'center': {'lat': 40.4406, 'lng': -79.9959},
        'radius_meters': 1800,
        'polygon': [
            {'lat': 40.442357, 'lng': -80.015060},
            {'lat': 40.447582, 'lng': -79.994819},
            {'lat': 40.443094, 'lng': -79.991779},
            {'lat': 40.434590, 'lng': -79.996123},
            {'lat': 40.442357, 'lng': -80.015060},
        ],
    }
}

lambda_client = boto3.client('lambda')
s3_client = boto3.client('s3')
http_session = requests.Session()


class GoogleBarSyncError(Exception):
    pass


def get_neighborhood_config(neighborhood: Optional[str]) -> Dict:
    neighborhood_key = (neighborhood or '').strip().lower()
    if not neighborhood_key:
        raise GoogleBarSyncError('Event field "neighborhood" is required.')

    config = NEIGHBORHOOD_CONFIGS.get(neighborhood_key)
    if not config:
        raise GoogleBarSyncError(
            f'Unsupported neighborhood "{neighborhood}". Supported neighborhoods: {sorted(NEIGHBORHOOD_CONFIGS)}'
        )
    return config


def point_in_polygon(lat: float, lng: float, polygon: List[Dict[str, float]]) -> bool:
    inside = False
    previous_index = len(polygon) - 1

    for index, point in enumerate(polygon):
        yi = point['lat']
        xi = point['lng']
        yj = polygon[previous_index]['lat']
        xj = polygon[previous_index]['lng']
        intersects = ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        previous_index = index

    return inside


def search_nearby_places(center: Dict[str, float], radius_meters: int) -> List[Dict]:
    places = []
    next_page_token = None

    while True:
        body = {
            'includedTypes': ['bar'],
            'maxResultCount': 20,
            'rankPreference': 'POPULARITY',
            'locationRestriction': {
                'circle': {
                    'center': {
                        'latitude': center['lat'],
                        'longitude': center['lng'],
                    },
                    'radius': float(radius_meters),
                }
            },
        }
        if next_page_token:
            body['pageToken'] = next_page_token

        response = http_session.post(
            GOOGLE_NEARBY_SEARCH_URL,
            headers={
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': GOOGLE_API_KEY,
                'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
            },
            json=body,
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()

        places.extend(payload.get('places', []))
        next_page_token = payload.get('nextPageToken')
        if not next_page_token:
            break

        LOGGER.info('Fetching next Nearby Search page')
        time.sleep(2)

    deduped = {}
    for place in places:
        place_id = place.get('id')
        if place_id:
            deduped[place_id] = place
    return list(deduped.values())


def format_open_hours(periods: List[Dict]) -> Dict[str, object]:
    hours_map = {day: 'CLOSED' for day in ALL_DAYS}

    for period in periods or []:
        open_info = period.get('open') or {}
        close_info = period.get('close') or {}
        if 'day' not in open_info or 'hour' not in open_info or 'minute' not in open_info:
            continue

        open_day = DAY_MAP.get(open_info['day'])
        if not open_day:
            continue

        formatted_open = f"{int(open_info['hour']):02d}:{int(open_info.get('minute', 0)):02d}:00"

        if close_info and 'hour' in close_info and 'minute' in close_info:
            formatted_close = f"{int(close_info['hour']):02d}:{int(close_info.get('minute', 0)):02d}:00"
        else:
            formatted_close = None

        hours_map[open_day] = [formatted_open, formatted_close]

    return hours_map


def build_candidate_bar(place: Dict, neighborhood_name: str) -> Optional[Dict]:
    place_id = place.get('id')
    name = (place.get('displayName') or {}).get('text', '').strip()
    address = (place.get('formattedAddress') or '').strip()
    location = place.get('location') or {}
    lat = location.get('latitude')
    lng = location.get('longitude')

    if not place_id or not name or not address or lat is None or lng is None:
        return None

    opening_hours = place.get('currentOpeningHours') or {}
    photos = place.get('photos') or []
    photo_name = (photos[0] or {}).get('name') if photos else None

    return {
        'google_place_id': place_id,
        'name': name,
        'address': address,
        'neighborhood': neighborhood_name,
        'business_status': place.get('businessStatus'),
        'hours': format_open_hours(opening_hours.get('periods', [])),
        'photo_name': photo_name,
        'rating': place.get('rating'),
        'price_level': place.get('priceLevel'),
    }


def invoke_db_lambda(payload: Dict) -> Dict:
    response = lambda_client.invoke(
        FunctionName=DB_BAR_SYNC_LAMBDA_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps(payload).encode('utf-8'),
    )
    if response.get('FunctionError'):
        raise GoogleBarSyncError(f"DB lambda invocation failed: {response['FunctionError']}")

    response_payload = json.loads(response['Payload'].read())
    status_code = response_payload.get('statusCode', 500)
    body = response_payload.get('body')
    parsed_body = json.loads(body) if isinstance(body, str) else body
    if status_code >= 400:
        raise GoogleBarSyncError(f'DB lambda returned {status_code}: {parsed_body}')
    return parsed_body


def infer_extension(content_type: str) -> str:
    normalized = (content_type or '').split(';', 1)[0].strip().lower()
    mapping = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
    }
    return mapping.get(normalized, '.jpg')


def slugify_bar_name(name: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
    return slug or 'bar'


def fetch_and_store_bar_image(bar: Dict) -> Optional[str]:
    photo_name = bar.get('photo_name')
    if not photo_name:
        LOGGER.info('No Google photo available for %s (%s)', bar['name'], bar['google_place_id'])
        return None

    response = http_session.get(
        GOOGLE_PLACE_PHOTO_URL_TEMPLATE.format(photo_name=photo_name),
        headers={
            'X-Goog-Api-Key': GOOGLE_API_KEY,
        },
        params={
            'maxWidthPx': 1200,
        },
        timeout=20,
        allow_redirects=True,
    )
    response.raise_for_status()

    extension = infer_extension(response.headers.get('Content-Type', ''))
    image_file = f"{slugify_bar_name(bar['name'])}_{bar['google_place_id']}{extension}"
    s3_key = f'{BAR_IMAGE_FOLDER}/{image_file}' if BAR_IMAGE_FOLDER else image_file

    s3_client.put_object(
        Bucket=S3_BUCKET_NAME,
        Key=s3_key,
        Body=response.content,
        ContentType=response.headers.get('Content-Type', 'application/octet-stream'),
    )
    return image_file


def lambda_handler(event, context):
    event = event or {}
    try:
        config = get_neighborhood_config(event.get('neighborhood'))
        neighborhood_name = config['neighborhood_name']
        LOGGER.info('Starting Google bar sync for neighborhood=%s', neighborhood_name)

        places = search_nearby_places(config['center'], config['radius_meters'])
        LOGGER.info('Fetched %s raw places from Places API (New)', len(places))

        candidate_bars = []
        for place in places:
            location = place.get('location') or {}
            lat = location.get('latitude')
            lng = location.get('longitude')
            if lat is None or lng is None or not point_in_polygon(lat, lng, config['polygon']):
                continue

            candidate_bar = build_candidate_bar(place, neighborhood_name)
            if candidate_bar:
                candidate_bars.append(candidate_bar)

        LOGGER.info('Built %s polygon-filtered candidate bars', len(candidate_bars))

        categorized = invoke_db_lambda({'mode': 'categorize', 'bars': candidate_bars})
        new_bars = categorized.get('new_bars', [])
        existing_bars = categorized.get('existing_bars', [])
        LOGGER.info('Categorized bars: %s new, %s existing', len(new_bars), len(existing_bars))

        for bar in new_bars:
            bar['image_file'] = fetch_and_store_bar_image(bar)

        apply_result = invoke_db_lambda({
            'mode': 'apply',
            'new_bars': new_bars,
            'existing_bars': existing_bars,
        })

        return {
            'statusCode': 200,
            'body': json.dumps({
                'neighborhood': event.get('neighborhood'),
                'candidate_count': len(candidate_bars),
                'new_bar_count': len(new_bars),
                'existing_bar_count': len(existing_bars),
                'db_result': apply_result,
            }),
        }
    except Exception as exc:
        LOGGER.exception('googleBarSync failed')
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(exc)}),
        }
