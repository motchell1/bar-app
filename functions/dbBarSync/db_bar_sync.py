import json
import logging
import os
from datetime import datetime
from typing import Dict, List

import pymysql

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']
WEB_SCRAPE_AUTO_APPROVAL_THRESHOLD = float(os.environ.get('WEB_SCRAPE_AUTO_APPROVAL_THRESHOLD', '1.0'))


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


def categorize_bars(cursor, bars: List[Dict]) -> Dict[str, List[Dict]]:
    if not bars:
        return {'new_bars': [], 'existing_bars': []}

    place_ids = [bar['google_place_id'] for bar in bars if bar.get('google_place_id')]
    if not place_ids:
        return {'new_bars': [], 'existing_bars': []}

    placeholders = ', '.join(['%s'] * len(place_ids))
    cursor.execute(
        f"SELECT bar_id, google_place_id FROM bar WHERE google_place_id IN ({placeholders})",
        tuple(place_ids),
    )
    existing_rows = {row['google_place_id']: row for row in cursor.fetchall()}

    new_bars = []
    existing_bars = []
    for bar in bars:
        existing_row = existing_rows.get(bar['google_place_id'])
        if existing_row:
            existing_bars.append({**bar, 'bar_id': existing_row['bar_id']})
        else:
            new_bars.append(bar)

    return {'new_bars': new_bars, 'existing_bars': existing_bars}


def is_bar_operational(bar: Dict) -> bool:
    return bar.get('business_status') == 'OPERATIONAL'


def insert_new_bars(cursor, new_bars: List[Dict]) -> Dict[str, int]:
    inserted_count = 0
    for bar in new_bars:
        cursor.execute(
            """
            INSERT INTO bar (name, google_place_id, address, neighborhood, website_url, image_file, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                bar['name'],
                bar['google_place_id'],
                bar['address'],
                bar['neighborhood'],
                bar.get('website_url'),
                bar.get('image_file'),
                'Y' if is_bar_operational(bar) else 'N',
            ),
        )
        bar['bar_id'] = cursor.lastrowid
        inserted_count += 1
    return {'inserted_bars': inserted_count}


def upsert_open_hours(cursor, bars: List[Dict]) -> int:
    updated_rows = 0
    for bar in bars:
        bar_id = bar.get('bar_id')
        if not bar_id:
            raise ValueError(f"Missing bar_id for {bar.get('google_place_id')}")

        cursor.execute(
            """
            UPDATE bar
            SET is_active = %s,
                update_date = NOW()
            WHERE bar_id = %s
            """,
            ('Y' if is_bar_operational(bar) else 'N', bar_id),
        )

        hours = bar.get('hours', {})
        for day_of_week, value in hours.items():
            if value == 'CLOSED':
                open_time = None
                close_time = None
                is_closed = 'Y'
            else:
                open_time, close_time = value
                is_closed = 'N'

            cursor.execute(
                """
                INSERT INTO open_hours (bar_id, day_of_week, open_time, close_time, is_closed)
                VALUES (%s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    open_time = VALUES(open_time),
                    close_time = VALUES(close_time),
                    is_closed = VALUES(is_closed),
                    update_date = NOW()
                """,
                (bar_id, day_of_week, open_time, close_time, is_closed),
            )
            updated_rows += 1
    return updated_rows


def apply_changes(cursor, new_bars: List[Dict], existing_bars: List[Dict]) -> Dict[str, int]:
    result = insert_new_bars(cursor, new_bars)
    all_bars = new_bars + existing_bars
    result['updated_open_hours_rows'] = upsert_open_hours(cursor, all_bars)
    result['processed_bar_count'] = len(all_bars)
    return result


def get_bars_by_neighborhood(cursor, neighborhood: str) -> Dict[str, List[Dict]]:
    cursor.execute(
        """
        SELECT bar_id, name AS bar_name, neighborhood, website_url
        FROM bar
        WHERE neighborhood = %s
        """,
        (neighborhood,),
    )
    return {'bars': cursor.fetchall()}


def _parse_confidence(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return 0.0
    return 0.0


def _insert_auto_approved_specials(cursor, candidate: Dict) -> List[int]:
    raw_days = candidate.get('days_of_week', [])
    if not isinstance(raw_days, list):
        raw_days = []
    day_values = [
        day
        for day in raw_days
        if isinstance(day, str) and day.strip()
    ]
    created_special_ids = []
    for day_of_week in day_values:
        cursor.execute(
            """
            INSERT INTO special
            (bar_id, day_of_week, all_day, start_time, end_time, description, type, insert_method)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                candidate['bar_id'],
                day_of_week,
                candidate.get('all_day'),
                candidate.get('start_time'),
                candidate.get('end_time'),
                candidate.get('description'),
                candidate.get('type'),
                'AUTO',
            ),
        )
        special_id = cursor.lastrowid
        if special_id is not None:
            created_special_ids.append(special_id)

    return created_special_ids


def insert_special_candidates(cursor, candidates: List[Dict]) -> Dict[str, int]:
    inserted_count = 0
    auto_approved_count = 0
    for candidate in candidates:
        approval_status = 'NOT_APPROVED'
        approval_date = None
        approved_special_id = None
        confidence = _parse_confidence(candidate.get('confidence'))

        if confidence >= WEB_SCRAPE_AUTO_APPROVAL_THRESHOLD:
            created_special_ids = _insert_auto_approved_specials(cursor, candidate)
            if created_special_ids:
                approval_status = 'AUTO_APPROVED'
                approval_date = datetime.utcnow()
                approved_special_id = created_special_ids[0]
                auto_approved_count += 1

        cursor.execute(
            """
            INSERT INTO special_candidate
            (bar_id, bar_name, neighborhood, description, type, days_of_week, start_time, end_time, all_day, is_recurring, date, fetch_method, source, confidence, notes, approval_status, approval_date, approved_special_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                candidate['bar_id'],
                candidate['bar_name'],
                candidate['neighborhood'],
                candidate['description'],
                candidate['type'],
                json.dumps(candidate.get('days_of_week', [])),
                candidate.get('start_time'),
                candidate.get('end_time'),
                candidate.get('all_day'),
                candidate.get('is_recurring'),
                candidate.get('date'),
                candidate.get('fetch_method'),
                candidate.get('source') or candidate.get('source_url'),
                candidate.get('confidence'),
                candidate.get('notes'),
                approval_status,
                approval_date,
                approved_special_id,
            ),
        )
        inserted_count += 1

    return {'inserted_count': inserted_count, 'auto_approved_count': auto_approved_count}


def lambda_handler(event, context):
    event = event or {}
    mode = event.get('mode')
    if mode not in {'categorize', 'apply', 'get_bars_by_neighborhood', 'insert_special_candidates'}:
        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': 'mode must be one of categorize, apply, get_bars_by_neighborhood, insert_special_candidates'
            }),
        }

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if mode == 'categorize':
                result = categorize_bars(cursor, event.get('bars', []))
                conn.commit()
            elif mode == 'apply':
                result = apply_changes(cursor, event.get('new_bars', []), event.get('existing_bars', []))
                conn.commit()
            elif mode == 'get_bars_by_neighborhood':
                neighborhood = event.get('neighborhood')
                if not neighborhood:
                    raise ValueError('neighborhood is required for get_bars_by_neighborhood')
                result = get_bars_by_neighborhood(cursor, neighborhood)
                conn.commit()
            else:
                result = insert_special_candidates(cursor, event.get('candidates', []))
                conn.commit()

        LOGGER.info('dbBarSync %s result=%s', mode, result)
        return {
            'statusCode': 200,
            'body': json.dumps(result),
        }
    except Exception as exc:
        conn.rollback()
        LOGGER.exception('dbBarSync failed during %s', mode)
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(exc), 'mode': mode}),
        }
    finally:
        conn.close()
