import pymysql
import json
import os
from datetime import datetime, timedelta

# Environment variables
RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']

DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

# Database connection helper
def get_connection():
    return pymysql.connect(host=RDS_HOST, user=DB_USER, passwd=DB_PASSWORD, db=DB_NAME, connect_timeout=5)

# Query helpers
def query_bars(cursor):
    cursor.execute("SELECT bar_id, name, neighborhood, image_url FROM bar ORDER BY neighborhood, name")
    return cursor.fetchall()

def query_open_hours(cursor):
    cursor.execute("SELECT bar_id, day_of_week, open_time, close_time, is_closed FROM open_hours")
    return cursor.fetchall()

def query_specials(cursor):
    cursor.execute("""
        SELECT special_id, bar_id, day_of_week, all_day, start_time, end_time, description, type
        FROM special
        WHERE is_active = 'Y'
        ORDER BY day_of_week, bar_id, all_day DESC, start_time, special_id
    """)
    return cursor.fetchall()

def to_time_string(value):
    if value is None:
        return None
    return str(value)



def get_hour_minute(time_value):
    if time_value is None:
        return None, None

    if isinstance(time_value, timedelta):
        total_minutes = int(time_value.total_seconds() // 60)
        hour = (total_minutes // 60) % 24
        minute = total_minutes % 60
        return hour, minute

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

def get_special_status(special_day, all_day, start_time, end_time, current_day_key, current_minutes):
    if special_day != current_day_key:
        return 'upcoming'

    if all_day == 'Y':
        return 'active'

    start_minutes = to_minutes(start_time)
    end_minutes = to_minutes(end_time)

    if start_minutes is None or end_minutes is None:
        return 'upcoming'

    if current_minutes < start_minutes:
        return 'upcoming'
    if current_minutes > end_minutes:
        return 'past'
    return 'active'

#Payload builder
def build_startup_payload():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cursor:
            bars = query_bars(cursor)
            hours = query_open_hours(cursor)
            specials = query_specials(cursor)

        now = datetime.now()
        current_day_key = now.strftime('%a').upper()
        current_minutes = (now.hour * 60) + now.minute

        bars_lookup = {}
        for bar in bars:
            bars_lookup[str(bar['bar_id'])] = {
                'name': bar['name'],
                'neighborhood': bar['neighborhood'],
                'image_url': bar['image_url'],
                'is_open_now': False,
                'has_special_this_week': False
            }

        open_hours_lookup = {}
        for row in hours:
            bar_id = str(row['bar_id'])
            if bar_id not in open_hours_lookup:
                open_hours_lookup[bar_id] = {}

            day_key = row['day_of_week']
            open_time = row['open_time']
            close_time = row['close_time']

            open_hours_lookup[bar_id][day_key] = {
                'open_time': to_time_string(open_time),
                'close_time': to_time_string(close_time),
                'display_text': build_hours_display_text(open_time, close_time, row['is_closed'])
            }

            if day_key == current_day_key and row['is_closed'] != 'Y':
                open_minutes = to_minutes(open_time)
                close_minutes = to_minutes(close_time)
                if open_minutes is not None and close_minutes is not None and open_minutes <= current_minutes <= close_minutes:
                    bars_lookup.get(bar_id, {})['is_open_now'] = True

        specials_lookup = {}
        specials_by_day = {day: [] for day in DAY_KEYS}
        day_bar_entries = {day: {} for day in DAY_KEYS}

        for row in specials:
            bar_id = str(row['bar_id'])
            special_id = str(row['special_id'])
            day_key = row['day_of_week']
            current_status = get_special_status(day_key, row['all_day'], row['start_time'], row['end_time'], current_day_key, current_minutes)

            specials_lookup[special_id] = {
                'bar_id': row['bar_id'],
                'day': day_key,
                'special_type': row['type'],
                'description': row['description'],
                'all_day': row['all_day'] == 'Y',
                'start_time': to_time_string(row['start_time']),
                'end_time': to_time_string(row['end_time']),
                'current_status': current_status,
                'favorite': False
            }

            if bar_id in bars_lookup:
                bars_lookup[bar_id]['has_special_this_week'] = True

            if day_key not in day_bar_entries:
                day_bar_entries[day_key] = {}
                specials_by_day[day_key] = []

            if bar_id not in day_bar_entries[day_key]:
                entry = {
                    'bar_id': row['bar_id'],
                    'specials': []
                }
                day_bar_entries[day_key][bar_id] = entry
                specials_by_day[day_key].append(entry)

            day_bar_entries[day_key][bar_id]['specials'].append(row['special_id'])

        payload = {
            'startup_payload': {
                'general_data': {
                    'current_day': current_day_key,
                    'generated_at': now.isoformat()
                },
                'bars': bars_lookup,
                'open_hours': open_hours_lookup,
                'specials': specials_lookup,
                'specials_by_day': specials_by_day
            }
        }

        return payload
    finally:
        conn.close()

# lambda handler
def lambda_handler(event, context):
    payload = build_startup_payload()
    return {
        'statusCode': 200,
        'body': json.dumps(payload)
    }
