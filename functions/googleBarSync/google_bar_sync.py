import json
import logging
import os
from typing import Dict, List, Optional, Tuple

import boto3
import requests

GOOGLE_API_KEY = os.environ['GOOGLE_API_KEY']
S3_BUCKET_NAME = os.environ['S3_BUCKET_NAME']
BAR_IMAGE_FOLDER = os.environ['BAR_IMAGE_FOLDER'].strip('/')

GOOGLE_NEARBY_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
GOOGLE_PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json'
ALLOWED_ACTIONS = {'search_neighborhood_bars', 'enrich_new_bars'}
DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
DAY_MAP = {0: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT'}
CONTENT_TYPE_EXTENSION_MAP = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
}

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')


class ValidationError(Exception):
    pass


class GooglePlacesError(Exception):
    pass


def build_response(status_code: int, body: Dict) -> Dict:
    return {
        'statusCode': status_code,
        'body': json.dumps(body),
    }


def parse_lambda_body(response: Dict) -> Dict:
    body = parse_lambda_body(lambda_payload)
    if missing:
        raise ValidationError(f'Missing required field(s): {missing}')


def normalize_polygon(polygon: List[Dict]) -> List[Dict[str, float]]:
    if not isinstance(polygon, list) or len(polygon) < 3:
        raise ValidationError('"polygon" must contain at least 3 coordinate points.')

    normalized = []
    for point in polygon:
        if not isinstance(point, dict) or 'lat' not in point or 'lng' not in point:
            raise ValidationError('Each polygon point must include "lat" and "lng".')
        normalized.append({'lat': float(point['lat']), 'lng': float(point['lng'])})

    return normalized


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
    # Keep only places whose lat/lng fall inside the caller-provided neighborhood boundary.
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
            import time
            time.sleep(2)
            continue
        if status not in ('OK', 'ZERO_RESULTS'):
            raise GooglePlacesError(payload.get('error_message') or status or 'Unknown nearby search error')

        places.extend(payload.get('results', []))
        if next_page_token and payload.get('results'):
            import time
            time.sleep(2)
        next_page_token = payload.get('next_page_token')
        if not next_page_token:
            break

    deduped_by_place_id = {}
    for place in places:
        place_id = place.get('place_id')
        if place_id:
            deduped_by_place_id[place_id] = place

    return list(deduped_by_place_id.values())


def fetch_place_details(place_id: str, fields: str) -> Dict:
    response = requests.get(
        GOOGLE_PLACE_DETAILS_URL,
        params={
            'place_id': place_id,
            'fields': fields,
            'key': GOOGLE_API_KEY,
        },
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


def format_open_hours(periods: List[Dict]) -> Dict[str, Dict[str, Optional[str]]]:
    # Mirror the app's existing open-hours shape so the DB lambda can persist rows directly.
    hours_map = {}
    for day_key in DAY_KEYS:
        hours_map[day_key] = {
            'open_time': None,
            'close_time': None,
            'closed': True,
            'display_text': 'Closed',
        }

    for period in periods or []:
        open_info = period.get('open') or {}
        close_info = period.get('close') or {}
        open_day = DAY_MAP.get(open_info.get('day'))
        if not open_day:
            continue

        open_time = parse_google_time(open_info.get('time'))
        close_time = parse_google_time(close_info.get('time'))

        hours_map[open_day] = {
            'open_time': open_time,
            'close_time': close_time,
            'closed': False,
            'display_text': 'Hours unavailable' if not open_time or not close_time else f'{format_display_time(open_time)} – {format_display_time(close_time)}',
        }

    return hours_map


def format_display_time(time_value: Optional[str]) -> Optional[str]:
    if not time_value:
        return None
    hour_str, minute_str, *_ = time_value.split(':')
    hour = int(hour_str)
    minute = int(minute_str)
    ampm = 'AM' if hour < 12 else 'PM'
    hour = hour % 12
    if hour == 0:
        hour = 12
    return f'{hour}:{minute:02d} {ampm}'


def build_bar_record(place: Dict, place_details: Dict) -> Optional[Dict]:
    place_id = place.get('place_id')
    bar_name = (place.get('name') or '').strip()
    address = (place.get('vicinity') or place.get('formatted_address') or '').strip()

    if not place_id or not bar_name or not address:
        return None

    periods = place_details.get('opening_hours', {}).get('periods', [])
    return {
        'google_place_id': place_id,
        'bar_name': bar_name,
        'address': address,
        'open_hours': format_open_hours(periods),
    }


def search_neighborhood_bars(event: Dict) -> Dict:
    # This is the kickoff action for the whole sync flow.
    require_fields(
        event,
def build_search_payload(event: Dict) -> Dict:
    # Core search step used by both the standalone action and the full sync kickoff action.
    keyword = (event.get('keyword') or 'bar').strip()
    polygon = normalize_polygon(event['polygon'])
    search_center_lat = float(event['search_center_lat'])
    search_center_lng = float(event['search_center_lng'])
    search_radius = int(event['search_radius'])

    logger.info('Searching Google Places for neighborhood=%s keyword=%s radius=%s', event['neighborhood_name'], keyword, search_radius)
    candidate_places = fetch_nearby_places(search_center_lat, search_center_lng, search_radius, keyword)
    filtered_places = filter_places_by_polygon(candidate_places, polygon)

    bars = []
    # Pull only the fields the DB lambda needs for categorization and later persistence.
    for place in filtered_places:
        place_id = place.get('place_id')
        if not place_id:
            continue
        try:
            details = fetch_place_details(place_id, 'opening_hours')
            record = build_bar_record(place, details)
            if record:
                bars.append(record)
        except Exception as exc:
            logger.warning('Skipping place_id=%s because details lookup failed: %s', place_id, exc)

    bars.sort(key=lambda row: (row['bar_name'].lower(), row['google_place_id']))
    return {
        'status': 'success',
        'action': 'search_neighborhood_bars',
        'neighborhood_name': event['neighborhood_name'],
        'candidate_count': len(candidate_places),
        'matched_count': len(bars),
        'bars': bars,
    }


def search_neighborhood_bars(event: Dict) -> Dict:
    return build_response(200, build_search_payload(event))


    search_payload = build_search_payload(event)
        enriched_new_bars = build_enriched_bars(new_bars)
    if not photos:
        return None
    return photos[0].get('photo_reference')


def map_content_type_to_extension(content_type: Optional[str]) -> str:
    normalized = (content_type or '').split(';', 1)[0].strip().lower()
    return CONTENT_TYPE_EXTENSION_MAP.get(normalized, '.jpg')


def fetch_google_place_image(place_id: str) -> Tuple[Optional[bytes], Optional[str]]:
    photo_reference = get_photo_reference(place_id)
    if not photo_reference:
        return None, None

    response = requests.get(
        'https://maps.googleapis.com/maps/api/place/photo',
        params={
            'maxwidth': 1600,
            'photo_reference': photo_reference,
            'key': GOOGLE_API_KEY,
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.content, response.headers.get('Content-Type')


def upload_image_to_s3(image_bytes: bytes, google_place_id: str, content_type: Optional[str]) -> str:
    # Key format intentionally uses google_place_id so image lookup stays deterministic across runs.
    extension = map_content_type_to_extension(content_type)
    key = f'{BAR_IMAGE_FOLDER}/{google_place_id}{extension}'
    s3_client.put_object(
        Bucket=S3_BUCKET_NAME,
        Key=key,
        Body=image_bytes,
        ContentType=(content_type or 'image/jpeg'),
    )
    return key


def enrich_new_bars(event: Dict) -> Dict:
    new_bars = event.get('new_bars') or []
    if not isinstance(new_bars, list):
        raise ValidationError('"new_bars" must be a list.')

    enriched_bars = []
    # Best-effort enrichment: one failed image should not block the rest of the batch.
    for bar in new_bars:
        google_place_id = bar.get('google_place_id')
        if not google_place_id:
            logger.warning('Skipping new bar with missing google_place_id: %s', bar)
            continue

        enriched_bar = dict(bar)
        enriched_bar['image_path'] = None
        try:
            image_bytes, content_type = fetch_google_place_image(google_place_id)
            if image_bytes:
                enriched_bar['image_path'] = upload_image_to_s3(image_bytes, google_place_id, content_type)
        except Exception as exc:
            logger.warning('Image enrichment failed for place_id=%s: %s', google_place_id, exc)

        enriched_bars.append(enriched_bar)

    return build_response(
        200,
        {
            'status': 'success',
            'action': 'enrich_new_bars',
            'new_bars': enriched_bars,
        },
    )


def lambda_handler(event, context):
    event = event or {}
    action = event.get('action')

    try:
        if action not in ALLOWED_ACTIONS:
def build_enriched_bars(new_bars: List[Dict]) -> List[Dict]:
    return enriched_bars


def enrich_new_bars(event: Dict) -> Dict:
            'new_bars': build_enriched_bars(event.get('new_bars') or []),
            return search_neighborhood_bars(event)
        if action == 'enrich_new_bars':
            return enrich_new_bars(event)

        raise ValidationError(f'Unhandled action "{action}"')
    except ValidationError as exc:
        logger.warning('Validation error: %s', exc)
        return build_response(400, {'status': 'error', 'message': str(exc), 'action': action})
    except requests.RequestException as exc:
        logger.exception('Google request failed for action=%s', action)
        return build_response(502, {'status': 'error', 'message': str(exc), 'action': action})
    except Exception as exc:
        logger.exception('Unexpected error in google_bar_sync action=%s', action)
        return build_response(500, {'status': 'error', 'message': str(exc), 'action': action})
