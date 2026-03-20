import json
import logging
import os
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

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
    return {
        'statusCode': status_code,
        'body': json.dumps(body),
    }


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


def normalize_open_hours(open_hours: Optional[Dict]) -> Dict[str, Dict]:
    if not isinstance(open_hours, dict):
        return {}

    normalized = {}
    for day_key, value in open_hours.items():
        if day_key not in DAY_KEYS or not isinstance(value, dict):
            continue
        normalized[day_key] = {
            'open_time': value.get('open_time'),
            'close_time': value.get('close_time'),
            'closed': bool(value.get('closed', False)),
            'display_text': value.get('display_text'),
        }
    return normalized


def normalize_bar_payload(bar: Dict, neighborhood_name: Optional[str]) -> Dict:
    return {
        'google_place_id': bar.get('google_place_id'),
        'bar_name': bar.get('bar_name'),
        'address': bar.get('address'),
        'neighborhood': bar.get('neighborhood') or neighborhood_name,
        'image_path': bar.get('image_path'),
        'open_hours': normalize_open_hours(bar.get('open_hours')),
    }


def fetch_existing_bars(cursor, google_place_ids: Sequence[str]) -> Dict[str, Dict]:
    if not google_place_ids:
        return {}

    placeholders = ', '.join(['%s'] * len(google_place_ids))
    cursor.execute(
        f"""
        SELECT bar_id, google_place_id, image_file
        FROM {BAR_TABLE}
        WHERE google_place_id IN ({placeholders})
        """,
        tuple(google_place_ids),
    )
    rows = cursor.fetchall()
    return {row['google_place_id']: row for row in rows}


def categorize_bars(event: Dict) -> Dict:
    bars = require_bars_list(event, 'bars')
    neighborhood_name = event.get('neighborhood_name')
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

        normalized_bar = normalize_bar_payload(bar, neighborhood_name)

        existing_bar = existing_by_place_id.get(google_place_id)
        if existing_bar:
            normalized_bar['bar_id'] = existing_bar['bar_id']
            existing_bars.append(normalized_bar)
        else:
            new_bars.append(normalized_bar)

    return build_response(
        200,
        {
            'status': 'success',
            'action': 'categorize_bars',
            'neighborhood_name': neighborhood_name,
            'new_bars': new_bars,
            'existing_bars': existing_bars,
        },
    )


def build_open_hours_rows(bar_id: int, open_hours: Dict[str, Dict]) -> List[Tuple]:
    rows = []
    for day_key in DAY_KEYS:
        hours = open_hours.get(day_key)
        if not hours:
            continue

        is_closed = 'Y' if hours.get('closed') else 'N'
        rows.append((
            bar_id,
            day_key,
            hours.get('open_time'),
            hours.get('close_time'),
            is_closed,
        ))
    return rows


def insert_new_bars(cursor, new_bars: List[Dict], default_neighborhood: Optional[str]) -> Dict[str, int]:
    inserted_bar_ids = {}
    if not new_bars:
        return inserted_bar_ids

    sql = f"""
        INSERT INTO {BAR_TABLE} (name, address, google_place_id, image_file, neighborhood, is_active)
        VALUES (%s, %s, %s, %s, %s, %s)
    """

    for bar in new_bars:
        neighborhood = bar.get('neighborhood') or default_neighborhood
        if not neighborhood:
            raise ValidationError(
                f'Missing neighborhood for new bar {bar.get("google_place_id")}. '
                'Pass neighborhood_name on the event or neighborhood on each bar.'
            )

        cursor.execute(
            sql,
            (
                bar.get('bar_name'),
                bar.get('address'),
                bar.get('google_place_id'),
                bar.get('image_path'),
                neighborhood,
                'Y',
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
    neighborhood_name = event.get('neighborhood_name')

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            inserted_bar_ids = insert_new_bars(new_bars=new_bars, cursor=cursor, default_neighborhood=neighborhood_name)

            new_hours_rows = []
            for bar in new_bars:
                bar_id = inserted_bar_ids.get(bar.get('google_place_id'))
                if not bar_id:
                    continue
                new_hours_rows.extend(build_open_hours_rows(bar_id, normalize_open_hours(bar.get('open_hours'))))

            existing_hours_rows = []
            for bar in existing_bars:
                bar_id = bar.get('bar_id')
                if not bar_id:
                    continue
                existing_hours_rows.extend(build_open_hours_rows(bar_id, normalize_open_hours(bar.get('open_hours'))))

            upsert_open_hours(cursor, new_hours_rows)
            upsert_open_hours(cursor, existing_hours_rows)
            inserted_hours_count = len(new_hours_rows)
            updated_hours_count = len(existing_hours_rows)
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return build_response(
        200,
        {
            'status': 'success',
            'action': 'apply_bar_updates',
            'new_bars_inserted': len(inserted_bar_ids),
            'existing_bars_updated': len([bar for bar in existing_bars if bar.get('bar_id')]),
            'open_hours_rows_inserted': inserted_hours_count,
            'open_hours_rows_updated': updated_hours_count,
        },
    )


def lambda_handler(event, context):
    event = event or {}
    action = event.get('action')

    try:
        if action not in ALLOWED_ACTIONS:
            raise ValidationError(f'Unsupported action "{action}". Allowed actions: {sorted(ALLOWED_ACTIONS)}')

        if action == 'categorize_bars':
            return categorize_bars(event)
        if action == 'apply_bar_updates':
            return apply_bar_updates(event)

        raise ValidationError(f'Unhandled action "{action}"')
    except ValidationError as exc:
        logger.warning('Validation error: %s', exc)
        return build_response(400, {'status': 'error', 'message': str(exc), 'action': action})
    except Exception as exc:
        logger.exception('Unexpected error in db_bar_sync action=%s', action)
        return build_response(500, {'status': 'error', 'message': str(exc), 'action': action})
