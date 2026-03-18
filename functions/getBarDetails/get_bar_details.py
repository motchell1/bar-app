import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pymysql

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']
BAR_IMAGE_FOLDER_URL = os.environ['BAR_IMAGE_FOLDER_URL'].rstrip('/')

DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
DAY_INDEX = {day: idx for idx, day in enumerate(DAY_KEYS)}
EASTERN_TZ = ZoneInfo('America/New_York')


def get_connection():
    return pymysql.connect(host=RDS_HOST, user=DB_USER, passwd=DB_PASSWORD, db=DB_NAME, connect_timeout=5)


def query_bar(cursor, bar_id):
    cursor.execute(
        """
        SELECT bar_id, name, neighborhood, image_file
        FROM bar
        WHERE bar_id = %s AND is_active = 'Y'
        """,
        (bar_id,)
    )
    return cursor.fetchone()


def query_open_hours(cursor, bar_id):
    cursor.execute(
        "SELECT bar_id, day_of_week, open_time, close_time, is_closed FROM open_hours WHERE bar_id = %s",
        (bar_id,)
    )
    return cursor.fetchall()


def query_specials(cursor, bar_id):
    cursor.execute(
        """
        SELECT special_id, bar_id, day_of_week, all_day, start_time, end_time, description, type
        FROM special
        WHERE bar_id = %s AND is_active = 'Y'
        ORDER BY day_of_week, all_day DESC, start_time, special_id
        """,
        (bar_id,)
    )
    return cursor.fetchall()


def to_time_string(value):
    return None if value is None else str(value)


def build_bar_image_url(image_file):
    if not image_file:
        return None
    return f"{BAR_IMAGE_FOLDER_URL}/{str(image_file).lstrip('/')}"


def get_hour_minute(time_value):
    if time_value is None:
        return None, None

    if isinstance(time_value, timedelta):
        total_minutes = int(time_value.total_seconds() // 60)
        return (total_minutes // 60) % 24, total_minutes % 60

    if hasattr(time_value, 'hour') and hasattr(time_value, 'minute'):
        return time_value.hour, time_value.minute

    if isinstance(time_value, str) and ':' in time_value:
        try:
            hour_str, minute_str = time_value.split(':', 1)
            return int(hour_str), int(minute_str)
        except ValueError:
            return None, None

    return None, None


def format_display_time(time_value):
    if time_value is None:
        return None

    hour, minute = get_hour_minute(time_value)
    if hour is None or minute is None:
        return None

    ampm = 'AM' if hour < 12 else 'PM'
    hour = hour % 12
    if hour == 0:
        hour = 12
    return f"{hour}:{minute:02d} {ampm}"


def build_hours_display_text(open_time, close_time, is_closed):
    if is_closed == 'Y':
        return 'Closed'

    open_text = format_display_time(open_time)
    close_text = format_display_time(close_time)
    if not open_text or not close_text:
        return 'Hours unavailable'

    return f"{open_text} – {close_text}"


def to_minutes(time_value):
    if time_value is None:
        return None

    hour, minute = get_hour_minute(time_value)
    if hour is None or minute is None:
        return None
    if hour == 0 and minute == 0:
        return 24 * 60
    return (hour * 60) + minute


def get_effective_now(now=None):
    now = now or datetime.now(EASTERN_TZ)
    if now.hour < 2:
        return now - timedelta(days=1)
    return now


def get_special_status(special_day, all_day, start_time, end_time, current_day_key, current_minutes):
    if special_day != current_day_key:
        return 'upcoming'

    if all_day == 'Y':
        return 'active'

    start_minutes = to_minutes(start_time)
    end_minutes = to_minutes(end_time)
    if start_minutes is None or end_minutes is None:
        return 'upcoming'

    adjusted_current_minutes = current_minutes
    adjusted_end_minutes = end_minutes

    if end_minutes < start_minutes:
        adjusted_end_minutes = end_minutes + (24 * 60)
        if adjusted_current_minutes < start_minutes:
            adjusted_current_minutes += 24 * 60

    if adjusted_current_minutes < start_minutes:
        return 'upcoming'
    if adjusted_current_minutes > adjusted_end_minutes:
        return 'past'
    return 'active'


def get_ordered_day_keys(start_day_key):
    if start_day_key not in DAY_INDEX:
        return DAY_KEYS[:]
    start_index = DAY_INDEX[start_day_key]
    return DAY_KEYS[start_index:] + DAY_KEYS[:start_index]


def build_bar_details_payload(bar_id):
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cursor:
            bar = query_bar(cursor, bar_id)
            if not bar:
                return None

            open_hours_rows = query_open_hours(cursor, bar_id)
            special_rows = query_specials(cursor, bar_id)

        now = datetime.now(EASTERN_TZ)
        effective_now = get_effective_now(now)
        current_day_key = effective_now.strftime('%a').upper()
        current_minutes = (effective_now.hour * 60) + effective_now.minute
        if now.hour < 2:
            current_minutes += 24 * 60
        ordered_day_keys = get_ordered_day_keys(current_day_key)

        open_hours = {}
        for row in open_hours_rows:
            day_key = row['day_of_week']
            open_hours[day_key] = {
                'open_time': to_time_string(row['open_time']),
                'close_time': to_time_string(row['close_time']),
                'display_text': build_hours_display_text(row['open_time'], row['close_time'], row['is_closed'])
            }

        specials = {}
        specials_by_day = {day: [] for day in ordered_day_keys}

        ordered_special_rows = sorted(
            special_rows,
            key=lambda row: (
                (DAY_INDEX.get(row['day_of_week'], 0) - DAY_INDEX.get(current_day_key, 0)) % 7,
                1 if row['all_day'] == 'Y' else 0,
                to_minutes(row['start_time']) if to_minutes(row['start_time']) is not None else 10 ** 9,
                row['special_id']
            )
        )

        for row in ordered_special_rows:
            special_id = str(row['special_id'])
            day_key = row['day_of_week']
            specials[special_id] = {
                'bar_id': row['bar_id'],
                'day': day_key,
                'special_type': row['type'],
                'description': row['description'],
                'all_day': row['all_day'] == 'Y',
                'start_time': to_time_string(row['start_time']),
                'end_time': to_time_string(row['end_time']),
                'current_status': get_special_status(day_key, row['all_day'], row['start_time'], row['end_time'], current_day_key, current_minutes)
            }
            specials_by_day.setdefault(day_key, []).append(special_id)

        return {
            'bar_details_payload': {
                'bar': {
                    'bar_id': bar['bar_id'],
                    'name': bar['name'],
                    'neighborhood': bar['neighborhood'],
                    'image_url': build_bar_image_url(bar['image_file'])
                },
                'general_data': {
                    'current_day': current_day_key,
                    'generated_at': now.isoformat()
                },
                'open_hours': open_hours,
                'specials': specials,
                'specials_by_day': specials_by_day
            }
        }
    finally:
        conn.close()


def lambda_handler(event, context):
    query_params = (event or {}).get('queryStringParameters') or {}
    bar_id = query_params.get('bar_id')

    if not bar_id:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'bar_id is required'})
        }

    payload = build_bar_details_payload(bar_id=bar_id)
    if payload is None:
        return {
            'statusCode': 404,
            'body': json.dumps({'error': 'Bar not found'})
        }

    return {
        'statusCode': 200,
        'body': json.dumps(payload)
    }
