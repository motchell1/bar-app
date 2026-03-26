import json
import logging
import os
from typing import Dict, List

import pymysql

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']


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


def lambda_handler(event, context):
    event = event or {}
    mode = event.get('mode')
    if mode not in {'categorize', 'apply'}:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'mode must be either categorize or apply'}),
        }

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if mode == 'categorize':
                result = categorize_bars(cursor, event.get('bars', []))
                conn.commit()
            else:
                result = apply_changes(cursor, event.get('new_bars', []), event.get('existing_bars', []))
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
