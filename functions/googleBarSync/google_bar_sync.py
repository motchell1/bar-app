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
ALL_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
# Keep this neighborhood config in code, matching the older neighborhood-driven flow.
NEIGHBORHOOD_CONFIGS = {
    'downtown': {
        'neighborhood_name': 'Downtown',
        'search_center_lat': 40.4418,
        'search_center_lng': -79.9959,
        'search_radius': 1800,
        'keyword': 'bar',
        'polygon': [
            {'lat': 40.442357, 'lng': -80.015060},
            {'lat': 40.447582, 'lng': -79.994819},
            {'lat': 40.443094, 'lng': -79.991779},
            {'lat': 40.434590, 'lng': -79.996123},
            {'lat': 40.442357, 'lng': -80.015060},
        ],
    }
}

    return {'statusCode': status_code, 'body': json.dumps(body)}
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
        time.sleep(2)

    deduped = {}
            deduped[place_id] = place
    return list(deduped.values())
        params={'place_id': place_id, 'fields': fields, 'key': GOOGLE_API_KEY},
# Match the older fetchGoogleApiHours shape as closely as possible: each day is either
# "CLOSED" or a two-item [open_time, close_time] list.
def format_open_hours(periods: List[Dict]) -> Dict[str, object]:
    hours_map = {day: 'CLOSED' for day in ALL_DAYS}

        close_time = parse_google_time(close_info.get('time')) if close_info else None
        hours_map[open_day] = [open_time, close_time]
        'open_hours': format_open_hours(place_details.get('opening_hours', {}).get('periods', [])),
def search_neighborhood_bars(event: Dict) -> Dict:
    neighborhood_name = require_neighborhood_name(event)
    config = get_neighborhood_config(neighborhood_name)

    keyword = (event.get('keyword') or config.get('keyword') or 'bar').strip()
    candidate_places = fetch_nearby_places(
        config['search_center_lat'],
        config['search_center_lng'],
        config['search_radius'],
        keyword,
    matched_places = filter_places_by_polygon(candidate_places, config['polygon'])
    for place in matched_places:
        details = fetch_place_details(place_id, 'opening_hours')
        bar_record = build_bar_record(place, details)
        if bar_record:
            bars.append(bar_record)
        'neighborhood_name': config['neighborhood_name'],
def get_photo_media(place_id: str) -> Tuple[Optional[bytes], Optional[str]]:
    photos = details.get('photos', [])
def filter_places_by_polygon(
    places: List[Dict],
    polygon: List[Dict[str, float]],
) -> List[Dict]:

def fetch_nearby_places(
    search_center_lat: float,
    search_center_lng: float,
    search_radius: int,
    keyword: str,
) -> List[Dict]:
            raise GooglePlacesError(
                payload.get('error_message') or status or 'Unknown nearby search error'
            )
        raise GooglePlacesError(
            payload.get('error_message')
            or status
            or f'Failed to fetch details for {place_id}'
        )
            'maxwidth': 1200,
        allow_redirects=True,
    content_type = response.headers.get('Content-Type', '').split(';')[0].strip().lower()
    return response.content, content_type


def content_type_to_extension(content_type: Optional[str]) -> str:
    return CONTENT_TYPE_EXTENSION_MAP.get(content_type or '', '.jpg')

def build_s3_key(folder: str, place_id: str, extension: str) -> str:
    return f'{folder}/{place_id}{extension}' if folder else f'{place_id}{extension}'


def upload_image_to_s3(image_bytes: bytes, content_type: str, s3_key: str) -> None:
        Key=s3_key,
        ContentType=content_type or 'image/jpeg',
def enrich_new_bars(event: Dict) -> Dict:
    new_bars = event.get('new_bars')
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

            image_bytes, content_type = get_photo_media(place_id)
                extension = content_type_to_extension(content_type)
                s3_key = build_s3_key(BAR_IMAGE_FOLDER, place_id, extension)
                upload_image_to_s3(image_bytes, content_type or 'image/jpeg', s3_key)
                enriched_bar['image_path'] = s3_key
            logger.warning('Image enrichment failed for %s: %s', place_id, exc)
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
            'action': 'categorize_bars',
            'neighborhood_name': search_payload['neighborhood_name'],
            'bars': search_payload['bars'],
        }
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

            return build_response(200, search_neighborhood_bars(event))
            return build_response(200, enrich_new_bars(event))
            return build_response(200, sync_neighborhood_bars(event))
        logger.exception('Google API request failed')
        return build_response(502, {'status': 'error', 'message': str(exc), 'action': action})
    except GooglePlacesError as exc:
        logger.warning('Google Places returned an error: %s', exc)
        logger.exception('Unhandled exception in googleBarSync')
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
        params={'photo_reference': photo_reference, 'maxwidth': 1200, 'key': GOOGLE_API_KEY},
            logger.warning(
                'Skipping image enrichment for bar without google_place_id: %s',
                bar,
            )
        'status': 'success',
    search_payload = search_neighborhood_bars(
        {'neighborhood_name': neighborhood_name, 'keyword': event.get('keyword')}
    )
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
            raise ValidationError(
                f'Unsupported action "{action}". Allowed actions: {sorted(ALLOWED_ACTIONS)}'
            )
