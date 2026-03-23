import json
import logging
import os
import time
from typing import Dict, List, Optional, Tuple

import boto3
import requests

GOOGLE_API_KEY = os.environ['GOOGLE_API_KEY']
S3_BUCKET_NAME = os.environ['S3_BUCKET_NAME']
BAR_IMAGE_FOLDER = os.environ['BAR_IMAGE_FOLDER'].strip('/')
DB_BAR_SYNC_FUNCTION_NAME = os.environ['DB_BAR_SYNC_FUNCTION_NAME']

GOOGLE_NEARBY_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
GOOGLE_PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json'
GOOGLE_PLACE_PHOTO_URL = 'https://maps.googleapis.com/maps/api/place/photo'
ALLOWED_ACTIONS = {'search_neighborhood_bars', 'enrich_new_bars', 'sync_neighborhood_bars'}
DAY_MAP = {0: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT'}
ALL_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
CONTENT_TYPE_EXTENSION_MAP = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
}

# Keep this neighborhood config in code, matching the older neighborhood-driven flow.
NEIGHBORHOOD_CONFIGS = {
    "downtown": {
        "neighborhood_name": "Downtown",
        "search_center_lat": 40.4418,
        "search_center_lng": -79.9959,
        "search_radius": 1800,
        "keyword": "bar",
        "polygon": [
            {"lat": 40.442357, "lng": -80.015060},
            {"lat": 40.447582, "lng": -79.994819},
            {"lat": 40.443094, "lng": -79.991779},
            {"lat": 40.434590, "lng": -79.996123},
            {"lat": 40.442357, "lng": -80.015060},
        ],
    },
}

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
lambda_client = boto3.client('lambda')


class ValidationError(Exception):
    pass


class GooglePlacesError(Exception):
    pass


def build_response(status_code: int, body: Dict) -> Dict:
    return {'statusCode': status_code, 'body': json.dumps(body)}


def parse_lambda_body(response: Dict) -> Dict:
    body = response.get('body', '{}')
    if isinstance(body, str):
        return json.loads(body)
    return body if isinstance(body, dict) else {}


def require_neighborhood_name(event: Dict) -> str:
    neighborhood_name = (event.get('neighborhood_name') or event.get('neighborhood') or '').strip()
    if not neighborhood_name:
        raise ValidationError('Event field "neighborhood_name" is required.')
    return neighborhood_name


def get_neighborhood_config(neighborhood_name: str) -> Dict:
    config = NEIGHBORHOOD_CONFIGS.get(neighborhood_name.strip().lower())
    if not config:
        supported = sorted(NEIGHBORHOOD_CONFIGS.keys())
        raise ValidationError(
            f'Unsupported neighborhood "{neighborhood_name}". Supported neighborhoods: {supported}'
        )
    return config


def point_in_polygon(lat: float, lng: float, polygon: List[Dict[str, float]]) -> bool:
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


def filter_places_by_polygon(places: List[Dict], polygon: List[Dict[str, float]]) -> List[Dict]:
    filtered = []
    for place in places:
        location = place.get('geometry', {}).get('location', {})
        lat = location.get('lat')
        lng = location.get('lng')
        if lat is None or lng is None:
            continue
        if point_in_polygon(float(lat), float(lng), polygon):
            filtered.append(place)
    return filtered


def fetch_nearby_places(search_center_lat: float, search_center_lng: float, search_radius: int, keyword: str) -> List[Dict]:
    places = []
    next_page_token = None

    while True:
        params = {
            'location': f'{search_center_lat},{search_center_lng}',
            'radius': int(search_radius),
            'keyword': keyword,
            'type': 'bar',
            'key': GOOGLE_API_KEY,
        }
        if next_page_token:
            params = {'pagetoken': next_page_token, 'key': GOOGLE_API_KEY}

        response = requests.get(GOOGLE_NEARBY_SEARCH_URL, params=params, timeout=15)
        response.raise_for_status()
        payload = response.json()
        status = payload.get('status')

        if status == 'INVALID_REQUEST' and next_page_token:
            time.sleep(2)
            continue
        if status not in ('OK', 'ZERO_RESULTS'):
            raise GooglePlacesError(payload.get('error_message') or status or 'Unknown nearby search error')

        places.extend(payload.get('results', []))
        next_page_token = payload.get('next_page_token')
        if not next_page_token:
            break
        time.sleep(2)

    deduped = {}
    for place in places:
        place_id = place.get('place_id')
        if place_id:
            deduped[place_id] = place
    return list(deduped.values())


def fetch_place_details(place_id: str, fields: str) -> Dict:
    response = requests.get(
        GOOGLE_PLACE_DETAILS_URL,
        params={'place_id': place_id, 'fields': fields, 'key': GOOGLE_API_KEY},
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    status = payload.get('status')

    if status not in ('OK', 'ZERO_RESULTS'):
        raise GooglePlacesError(payload.get('error_message') or status or f'Failed to fetch details for {place_id}')

    return payload.get('result', {})


def parse_google_time(raw_time: Optional[str]) -> Optional[str]:
    if not raw_time or len(raw_time) != 4:
        return None
    return f'{raw_time[:2]}:{raw_time[2:]}:00'


# Match the older fetchGoogleApiHours shape as closely as possible: each day is either
# "CLOSED" or a two-item [open_time, close_time] list.
def format_open_hours(periods: List[Dict]) -> Dict[str, object]:
    hours_map = {day: 'CLOSED' for day in ALL_DAYS}

    for period in periods or []:
        open_info = period.get('open') or {}
        close_info = period.get('close') or {}
        open_day = DAY_MAP.get(open_info.get('day'))
        if not open_day:
            continue

        open_time = parse_google_time(open_info.get('time'))
        close_time = parse_google_time(close_info.get('time')) if close_info else None
        hours_map[open_day] = [open_time, close_time]

    return hours_map


def build_bar_record(place: Dict, place_details: Dict) -> Optional[Dict]:
    place_id = place.get('place_id')
    bar_name = (place.get('name') or '').strip()
    address = (place.get('vicinity') or place.get('formatted_address') or '').strip()

    if not place_id or not bar_name or not address:
        return None

    return {
        'google_place_id': place_id,
        'bar_name': bar_name,
        'address': address,
        'open_hours': format_open_hours(place_details.get('opening_hours', {}).get('periods', [])),
    }


def search_neighborhood_bars(event: Dict) -> Dict:
    neighborhood_name = require_neighborhood_name(event)
    config = get_neighborhood_config(neighborhood_name)

    keyword = (event.get('keyword') or config.get('keyword') or 'bar').strip()
    candidate_places = fetch_nearby_places(
        config['search_center_lat'],
        config['search_center_lng'],
        config['search_radius'],
        keyword,
    )
    matched_places = filter_places_by_polygon(candidate_places, config['polygon'])

    bars = []
    for place in matched_places:
        place_id = place.get('place_id')
        if not place_id:
            continue
        details = fetch_place_details(place_id, 'opening_hours')
        bar_record = build_bar_record(place, details)
        if bar_record:
            bars.append(bar_record)

    return {
        'status': 'success',
        'action': 'search_neighborhood_bars',
        'neighborhood_name': config['neighborhood_name'],
        'candidate_count': len(candidate_places),
        'matched_count': len(bars),
        'bars': bars,
    }


def get_photo_media(place_id: str) -> Tuple[Optional[bytes], Optional[str]]:
    details = fetch_place_details(place_id, 'photos')
    photos = details.get('photos', [])
    if not photos:
        return None, None

    photo_reference = photos[0].get('photo_reference')
    if not photo_reference:
        return None, None

    response = requests.get(
        GOOGLE_PLACE_PHOTO_URL,
        params={
            'photoreference': photo_reference,
            'maxwidth': 1200,
            'key': GOOGLE_API_KEY,
        },
        timeout=30,
        allow_redirects=True,
    )
    response.raise_for_status()
    content_type = response.headers.get('Content-Type', '').split(';')[0].strip().lower()
    return response.content, content_type


def content_type_to_extension(content_type: Optional[str]) -> str:
    return CONTENT_TYPE_EXTENSION_MAP.get(content_type or '', '.jpg')


def build_s3_key(folder: str, place_id: str, extension: str) -> str:
    return f'{folder}/{place_id}{extension}' if folder else f'{place_id}{extension}'


def upload_image_to_s3(image_bytes: bytes, content_type: str, s3_key: str) -> None:
    s3_client.put_object(
        Bucket=S3_BUCKET_NAME,
        Key=s3_key,
        Body=image_bytes,
        ContentType=content_type or 'image/jpeg',
    )


def enrich_new_bars(event: Dict) -> Dict:
    new_bars = event.get('new_bars')
    if not isinstance(new_bars, list):
        raise ValidationError('"new_bars" must be a list.')

    enriched_bars = []
    for bar in new_bars:
        enriched_bar = {
            'google_place_id': bar.get('google_place_id'),
            'bar_name': bar.get('bar_name'),
            'address': bar.get('address'),
            'open_hours': bar.get('open_hours'),
            'image_path': None,
        }
        place_id = enriched_bar['google_place_id']

        if not place_id:
            logger.warning('Skipping image enrichment for bar without google_place_id: %s', bar)
            enriched_bars.append(enriched_bar)
            continue

        try:
            image_bytes, content_type = get_photo_media(place_id)
            if image_bytes:
                extension = content_type_to_extension(content_type)
                s3_key = build_s3_key(BAR_IMAGE_FOLDER, place_id, extension)
                upload_image_to_s3(image_bytes, content_type or 'image/jpeg', s3_key)
                enriched_bar['image_path'] = s3_key
        except Exception as exc:
            logger.warning('Image enrichment failed for %s: %s', place_id, exc)

        enriched_bars.append(enriched_bar)

    return {
        'status': 'success',
        'action': 'enrich_new_bars',
        'new_bars': enriched_bars,
    }


def invoke_db_bar_sync(payload: Dict) -> Dict:
    response = lambda_client.invoke(
        FunctionName=DB_BAR_SYNC_FUNCTION_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps(payload).encode('utf-8'),
    )
    payload_bytes = response['Payload'].read()
    lambda_payload = json.loads(payload_bytes or '{}')
    status_code = int(lambda_payload.get('statusCode', 500))
    body = parse_lambda_body(lambda_payload)

    if status_code >= 400:
        raise RuntimeError(f'DB lambda action {payload.get("action")} failed: {body}')

    return body


def sync_neighborhood_bars(event: Dict) -> Dict:
    neighborhood_name = require_neighborhood_name(event)
    search_payload = search_neighborhood_bars({'neighborhood_name': neighborhood_name, 'keyword': event.get('keyword')})

    categorized = invoke_db_bar_sync(
        {
            'action': 'categorize_bars',
            'neighborhood_name': search_payload['neighborhood_name'],
            'bars': search_payload['bars'],
        }
    )

    new_bars = categorized.get('new_bars', [])
    existing_bars = categorized.get('existing_bars', [])
    if new_bars:
        enrich_result = enrich_new_bars({'new_bars': new_bars})
        new_bars = enrich_result['new_bars']

    applied = invoke_db_bar_sync(
        {
            'action': 'apply_bar_updates',
            'new_bars': new_bars,
            'existing_bars': existing_bars,
        }
    )

    return {
        'status': 'success',
        'action': 'sync_neighborhood_bars',
        'neighborhood_name': search_payload['neighborhood_name'],
        'search_summary': {
            'candidate_count': search_payload['candidate_count'],
            'matched_count': search_payload['matched_count'],
        },
        'categorize_summary': {
            'new_bar_count': len(new_bars),
            'existing_bar_count': len(existing_bars),
        },
        'apply_summary': {
            'new_bars_inserted': applied.get('new_bars_inserted', 0),
            'existing_bars_updated': applied.get('existing_bars_updated', 0),
            'open_hours_rows_inserted': applied.get('open_hours_rows_inserted', 0),
            'open_hours_rows_updated': applied.get('open_hours_rows_updated', 0),
        },
        'new_bars': new_bars,
        'existing_bars': existing_bars,
    }


def lambda_handler(event, context):
    event = event or {}
    action = event.get('action')

    try:
        if action not in ALLOWED_ACTIONS:
            raise ValidationError(f'Unsupported action "{action}". Allowed actions: {sorted(ALLOWED_ACTIONS)}')

        if action == 'search_neighborhood_bars':
            return build_response(200, search_neighborhood_bars(event))
        if action == 'enrich_new_bars':
            return build_response(200, enrich_new_bars(event))
        if action == 'sync_neighborhood_bars':
            return build_response(200, sync_neighborhood_bars(event))

        raise ValidationError(f'Unhandled action "{action}"')
    except ValidationError as exc:
        logger.warning('Validation error: %s', exc)
        return build_response(400, {'status': 'error', 'message': str(exc), 'action': action})
    except requests.RequestException as exc:
        logger.exception('Google API request failed')
        return build_response(502, {'status': 'error', 'message': str(exc), 'action': action})
    except GooglePlacesError as exc:
        logger.warning('Google Places returned an error: %s', exc)
        return build_response(502, {'status': 'error', 'message': str(exc), 'action': action})
    except Exception as exc:
        logger.exception('Unhandled exception in googleBarSync')
        return build_response(500, {'status': 'error', 'message': str(exc), 'action': action})
