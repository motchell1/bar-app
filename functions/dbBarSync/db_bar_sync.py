import json
import logging
import os
from typing import Dict, Iterable, List, Sequence, Tuple

import pymysql

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']

ALLOWED_ACTIONS = {'categorize_bars', 'apply_bar_updates'}
BAR_TABLE = 'bar'
OPEN_HOURS_TABLE = 'open_hours'
DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

logger = logging.getLogger()
logger.setLevel(logging.INFO)


class ValidationError(Exception):
    pass


def build_response(status_code: int, body: Dict) -> Dict:
    return {'statusCode': status_code, 'body': json.dumps(body)}


def get_connection():
    return pymysql.connect(
        host=RDS_HOST,
        user=DB_USER,
        passwd=DB_PASSWORD,
        db=DB_NAME,
        connect_timeout=5,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )


def require_bars_list(payload: Dict, field_name: str) -> List[Dict]:
    bars = payload.get(field_name)
    if not isinstance(bars, list):
        raise ValidationError(f'"{field_name}" must be a list.')
    return bars


# Support the repo's existing fetchGoogleApiHours shape:
#   {"MON": "CLOSED"}
#   {"TUE": ["17:00:00", "23:00:00"]}
def normalize_open_hours(open_hours) -> Dict[str, Dict]:
    if not isinstance(open_hours, dict):
        return {}

    normalized = {}
    for day_key in DAY_KEYS:
        value = open_hours.get(day_key)
        if value == 'CLOSED':
            normalized[day_key] = {'open_time': None, 'close_time': None, 'is_closed': 'Y'}
        elif isinstance(value, list) and len(value) == 2:
            normalized[day_key] = {
                'open_time': value[0],
                'close_time': value[1],
                'is_closed': 'N',
            }
    return normalized


def fetch_existing_bars(cursor, google_place_ids: Sequence[str]) -> Dict[str, Dict]:
    if not google_place_ids:
        return {}

    placeholders = ', '.join(['%s'] * len(google_place_ids))
    cursor.execute(
        f"""
        SELECT bar_id, google_place_id, image_path
        FROM {BAR_TABLE}
        WHERE google_place_id IN ({placeholders})
        """,
        tuple(google_place_ids),
    )
    return {row['google_place_id']: row for row in cursor.fetchall()}


def categorize_bars(event: Dict) -> Dict:
    bars = require_bars_list(event, 'bars')
    google_place_ids = [bar.get('google_place_id') for bar in bars if bar.get('google_place_id')]

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            existing_by_place_id = fetch_existing_bars(cursor, google_place_ids)
    finally:
        conn.close()

    new_bars = []
    existing_bars = []
    for bar in bars:
        google_place_id = bar.get('google_place_id')
        if not google_place_id:
            logger.warning('Skipping bar without google_place_id during categorization: %s', bar)
            continue

        normalized_bar = {
            'google_place_id': google_place_id,
            'bar_name': bar.get('bar_name'),
            'address': bar.get('address'),
            'open_hours': normalize_open_hours(bar.get('open_hours')),
        }
        existing_bar = existing_by_place_id.get(google_place_id)
        if existing_bar:
            normalized_bar['bar_id'] = existing_bar['bar_id']
            existing_bars.append(normalized_bar)
        else:
            new_bars.append(normalized_bar)

    return {
        'status': 'success',
        'action': 'categorize_bars',
        'neighborhood_name': event.get('neighborhood_name'),
        'new_bars': new_bars,
        'existing_bars': existing_bars,
    }


def build_open_hours_rows(bar_id: int, open_hours: Dict[str, Dict]) -> List[Tuple]:
    rows = []
    for day_key in DAY_KEYS:
        hours = open_hours.get(day_key)
        if not hours:
            continue
        rows.append((
            bar_id,
            day_key,
            hours.get('open_time'),
            hours.get('close_time'),
            hours.get('is_closed', 'N'),
        ))
    return rows


def insert_new_bars(cursor, new_bars: List[Dict]) -> Dict[str, int]:
    inserted_bar_ids = {}
    if not new_bars:
        return inserted_bar_ids

    sql = f"""
        INSERT INTO {BAR_TABLE} (name, address, google_place_id, image_path)
        VALUES (%s, %s, %s, %s)
    """

    for bar in new_bars:
        cursor.execute(
            sql,
            (
                bar.get('bar_name'),
                bar.get('address'),
                bar.get('google_place_id'),
                bar.get('image_path'),
            ),
        )
        inserted_bar_ids[bar['google_place_id']] = cursor.lastrowid

    return inserted_bar_ids


def upsert_open_hours(cursor, rows: Iterable[Tuple]) -> int:
    rows = list(rows)
    if not rows:
        return 0

    sql = f"""
        INSERT INTO {OPEN_HOURS_TABLE} (bar_id, day_of_week, open_time, close_time, is_closed)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            open_time = VALUES(open_time),
            close_time = VALUES(close_time),
            is_closed = VALUES(is_closed)
    """
    return cursor.executemany(sql, rows)


def apply_bar_updates(event: Dict) -> Dict:
    new_bars = require_bars_list(event, 'new_bars')
    existing_bars = require_bars_list(event, 'existing_bars')

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            inserted_bar_ids = insert_new_bars(cursor, new_bars)

            new_hours_rows = []
            for bar in new_bars:
                bar_id = inserted_bar_ids.get(bar.get('google_place_id'))
                if bar_id:
                    new_hours_rows.extend(build_open_hours_rows(bar_id, normalize_open_hours(bar.get('open_hours'))))

            existing_hours_rows = []
            for bar in existing_bars:
                bar_id = bar.get('bar_id')
                if bar_id:
                    existing_hours_rows.extend(build_open_hours_rows(bar_id, normalize_open_hours(bar.get('open_hours'))))

            upsert_open_hours(cursor, new_hours_rows)
            upsert_open_hours(cursor, existing_hours_rows)
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {
        'status': 'success',
        'action': 'apply_bar_updates',
        'new_bars_inserted': len(inserted_bar_ids),
        'existing_bars_updated': len([bar for bar in existing_bars if bar.get('bar_id')]),
        'open_hours_rows_inserted': len(new_hours_rows),
        'open_hours_rows_updated': len(existing_hours_rows),
    }


def lambda_handler(event, context):
    event = event or {}
    action = event.get('action')

    try:
        if action not in ALLOWED_ACTIONS:
            raise ValidationError(f'Unsupported action "{action}". Allowed actions: {sorted(ALLOWED_ACTIONS)}')

        if action == 'categorize_bars':
            return build_response(200, categorize_bars(event))
        if action == 'apply_bar_updates':
            return build_response(200, apply_bar_updates(event))

        raise ValidationError(f'Unhandled action "{action}"')
    except ValidationError as exc:
        logger.warning('Validation error: %s', exc)
        return build_response(400, {'status': 'error', 'message': str(exc), 'action': action})
    except Exception as exc:
        logger.exception('Unhandled exception in dbBarSync')
        return build_response(500, {'status': 'error', 'message': str(exc), 'action': action})
