import pymysql
import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# Environment variables
RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']
BAR_IMAGE_FOLDER_URL = os.environ['BAR_IMAGE_FOLDER_URL'].rstrip('/')
GOOGLE_API_KEY = os.environ['GOOGLE_API_KEY']
GOOGLE_MAP_ID = os.environ.get('GOOGLE_MAP_ID', 'DEMO_MAP_ID')

DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
DAY_INDEX = {day: idx for idx, day in enumerate(DAY_KEYS)}
EASTERN_TZ = ZoneInfo('America/New_York')

# Database connection helper
def get_connection():
    return pymysql.connect(host=RDS_HOST, user=DB_USER, passwd=DB_PASSWORD, db=DB_NAME, connect_timeout=5)

# Query helpers
def query_bars(cursor):
    cursor.execute("""
        SELECT b.bar_id, b.name, b.neighborhood, b.image_file, b.google_place_id, b.latitude, b.longitude, b.website_url, b.description
        FROM bar b
        WHERE b.is_active = 'Y'
          AND EXISTS (
              SELECT 1
              FROM special s
              WHERE s.bar_id = b.bar_id
                AND s.is_active = 'Y'
          )
        ORDER BY name
    """)
    return cursor.fetchall()

def query_open_hours(cursor, bar_ids=None):
    if bar_ids:
        placeholders = ', '.join(['%s'] * len(bar_ids))
        cursor.execute(
            f"SELECT bar_id, day_of_week, open_time, close_time, is_closed FROM open_hours WHERE bar_id IN ({placeholders})",
            tuple(bar_ids)
        )
    else:
        cursor.execute("SELECT bar_id, day_of_week, open_time, close_time, is_closed FROM open_hours")
    return cursor.fetchall()

def query_specials(cursor, bar_ids=None):
    base_sql = """
        SELECT special_id, bar_id, day_of_week, all_day, start_time, end_time, description, type
        FROM special
        WHERE is_active = 'Y'
    """
    params = ()
    if bar_ids:
        placeholders = ', '.join(['%s'] * len(bar_ids))
        base_sql += f" AND bar_id IN ({placeholders})"
        params = tuple(bar_ids)
    base_sql += " ORDER BY day_of_week, bar_id, all_day DESC, start_time, special_id"

    cursor.execute(base_sql, params)
    return cursor.fetchall()

def query_device_favorite_special_ids(cursor, device_id):
    if not device_id:
        return set()

    cursor.execute(
        "SELECT special_id FROM device_special_favorite WHERE device_id = %s",
        (device_id,)
    )
    return {str(row['special_id']) for row in cursor.fetchall()}


def query_device_favorite_bar_ids(cursor, device_id):
    if not device_id:
        return set()

    cursor.execute(
        "SELECT bar_id FROM device_bar_favorite WHERE device_id = %s",
        (device_id,)
    )
    return {str(row['bar_id']) for row in cursor.fetchall()}

def to_time_string(value):
    if value is None:
        return None
    return str(value)


def build_bar_image_url(image_file):
    if not image_file:
        return None
    return f"{BAR_IMAGE_FOLDER_URL}/{str(image_file).lstrip('/')}"



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

def is_open_for_day(open_time, close_time, current_minutes):
    open_minutes = to_minutes(open_time)
    close_minutes = to_minutes(close_time)

    if open_minutes is None or close_minutes is None:
        return False

    adjusted_current_minutes = current_minutes
    adjusted_close_minutes = close_minutes

    if close_minutes < open_minutes:
        adjusted_close_minutes = close_minutes + (24 * 60)
        if adjusted_current_minutes < open_minutes:
            adjusted_current_minutes += 24 * 60

    return open_minutes <= adjusted_current_minutes <= adjusted_close_minutes

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


def get_effective_now(now=None):
    now = now or datetime.now(EASTERN_TZ)
    if now.hour < 2:
        return now - timedelta(days=1)
    return now


def get_ordered_day_keys(start_day_key):
    if start_day_key not in DAY_INDEX:
        return DAY_KEYS[:]
    start_index = DAY_INDEX[start_day_key]
    return DAY_KEYS[start_index:] + DAY_KEYS[:start_index]


def classify_today_bar_order(entry, specials_lookup, bar_day_hours, current_minutes):
    special_ids = [str(sid) for sid in (entry.get('specials') or [])]
    specials = [specials_lookup.get(sid) for sid in special_ids]
    specials = [row for row in specials if row]

    timed = [s for s in specials if not s.get('all_day')]
    all_day = [s for s in specials if s.get('all_day')]

    has_active_timed = any(s.get('current_status') == 'active' for s in timed)
    has_upcoming_timed = any(s.get('current_status') == 'upcoming' for s in timed)
    has_past_timed = any(s.get('current_status') == 'past' for s in timed)

    timed_end_minutes = [to_minutes(s.get('end_time')) for s in timed if to_minutes(s.get('end_time')) is not None]
    timed_start_minutes = [to_minutes(s.get('start_time')) for s in timed if to_minutes(s.get('start_time')) is not None]
    active_timed = [s for s in timed if s.get('current_status') == 'active']
    upcoming_timed = [s for s in timed if s.get('current_status') == 'upcoming']
    active_start_minutes = [to_minutes(s.get('start_time')) for s in active_timed if to_minutes(s.get('start_time')) is not None]
    active_end_minutes = [to_minutes(s.get('end_time')) for s in active_timed if to_minutes(s.get('end_time')) is not None]
    upcoming_start_minutes = [to_minutes(s.get('start_time')) for s in upcoming_timed if to_minutes(s.get('start_time')) is not None]
    upcoming_end_minutes = [to_minutes(s.get('end_time')) for s in upcoming_timed if to_minutes(s.get('end_time')) is not None]

    open_minutes = bar_day_hours.get('open_minutes') if bar_day_hours else None
    close_minutes = bar_day_hours.get('close_minutes') if bar_day_hours else None
    is_open_now = bool(bar_day_hours.get('is_open_now')) if bar_day_hours else False
    not_yet_opened = open_minutes is not None and not is_open_now and current_minutes < open_minutes

    # 0: only inactive timed specials, sorted by end time
    if timed and not all_day and not has_active_timed and not has_upcoming_timed:
        return (0, min(timed_end_minutes) if timed_end_minutes else 10 ** 9, 10 ** 9)

    # 2: at least one active timed special, sorted by start then end
    if has_active_timed:
        return (
            2,
            min(active_start_minutes) if active_start_minutes else 10 ** 9,
            min(active_end_minutes) if active_end_minutes else 10 ** 9
        )

    # 3: at least one upcoming timed special, or only all-day and not yet opened
    if has_upcoming_timed or (all_day and not timed and not_yet_opened):
        if has_upcoming_timed:
            upcoming_sort_windows = []
            for special in upcoming_timed:
                start_minutes = to_minutes(special.get('start_time'))
                end_minutes = to_minutes(special.get('end_time'))
                if start_minutes is None and end_minutes is None:
                    continue
                normalized_start = start_minutes if start_minutes is not None else (open_minutes if open_minutes is not None else 10 ** 9)
                normalized_end = end_minutes if end_minutes is not None else (close_minutes if close_minutes is not None else 10 ** 9)
                if start_minutes is not None and end_minutes is not None and end_minutes < start_minutes:
                    normalized_end += 24 * 60
                upcoming_sort_windows.append((normalized_start, normalized_end))

            if upcoming_sort_windows:
                sort_start, sort_end = min(upcoming_sort_windows, key=lambda window: (window[0], window[1]))
            else:
                sort_start = open_minutes if open_minutes is not None else 10 ** 9
                sort_end = close_minutes if close_minutes is not None else 10 ** 9
        else:
            sort_start = open_minutes if open_minutes is not None else 10 ** 9
            sort_end = close_minutes if close_minutes is not None else 10 ** 9
        return (3, sort_start, sort_end)

    # 1: past timed + all-day (with no active/upcoming timed), or only all-day while closed, sorted by closing time
    if (has_past_timed and all_day) or (all_day and not timed and not is_open_now and not not_yet_opened):
        return (1, close_minutes if close_minutes is not None else 10 ** 9, 10 ** 9)

    # 4: only all-day while currently open, sorted by closing time
    if all_day and not timed and is_open_now:
        return (4, close_minutes if close_minutes is not None else 10 ** 9, 10 ** 9)

    return (5, 10 ** 9, 10 ** 9)

#Payload builder
def build_startup_payload(device_id=None):
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cursor:
            bars = query_bars(cursor)
            active_bar_ids = [bar['bar_id'] for bar in bars]
            hours = query_open_hours(cursor, active_bar_ids)
            specials = query_specials(cursor, active_bar_ids)
            favorite_special_ids = query_device_favorite_special_ids(cursor, device_id)
            favorite_bar_ids = query_device_favorite_bar_ids(cursor, device_id)
        active_bar_ids = set(active_bar_ids)

        now = datetime.now(EASTERN_TZ)
        effective_now = get_effective_now(now)
        current_day_key = effective_now.strftime('%a').upper()
        current_minutes = (effective_now.hour * 60) + effective_now.minute
        if now.hour < 2:
            current_minutes += 24 * 60
        ordered_day_keys = get_ordered_day_keys(current_day_key)

        specials = sorted(
            specials,
            key=lambda row: (
                (DAY_INDEX.get(row['day_of_week'], 0) - DAY_INDEX.get(current_day_key, 0)) % 7,
                row['bar_id'],
                1 if row['all_day'] == 'Y' else 0,
                to_minutes(row['start_time']) if to_minutes(row['start_time']) is not None else 10 ** 9,
                row['special_id']
            )
        )

        bars_lookup = {}
        ordered_bar_ids = []
        for bar in bars:
            bar_id = str(bar['bar_id'])
            ordered_bar_ids.append(bar_id)
            bars_lookup[bar_id] = {
                'name': bar['name'],
                'neighborhood': bar['neighborhood'],
                'image_url': build_bar_image_url(bar['image_file']),
                'google_place_id': bar.get('google_place_id'),
                'latitude': float(bar['latitude']) if bar.get('latitude') is not None else None,
                'longitude': float(bar['longitude']) if bar.get('longitude') is not None else None,
                'website_url': bar.get('website_url'),
                'description': bar.get('description'),
                'is_open_now': False,
                'has_special_this_week': False,
                'favorite': str(bar['bar_id']) in favorite_bar_ids
            }

        bars_with_specials = {row['bar_id'] for row in specials if row['bar_id'] in active_bar_ids}

        open_hours_lookup = {}
        bar_today_hours_meta = {}
        for row in hours:
            if row['bar_id'] not in bars_with_specials:
                continue
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
                if is_open_for_day(open_time, close_time, current_minutes):
                    bars_lookup.get(bar_id, {})['is_open_now'] = True
                bar_today_hours_meta[bar_id] = {
                    'open_minutes': open_minutes,
                    'close_minutes': close_minutes,
                    'is_open_now': bars_lookup.get(bar_id, {}).get('is_open_now') is True
                }

        specials_lookup = {}
        specials_by_day = {day: [] for day in ordered_day_keys}
        day_bar_entries = {day: {} for day in ordered_day_keys}
        day_bar_sort_meta = {day: {} for day in ordered_day_keys}

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
                'favorite': special_id in favorite_special_ids
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
                day_bar_sort_meta[day_key][bar_id] = {
                    'has_timed': False,
                    'earliest_timed_start': 10 ** 9
                }

            day_bar_entries[day_key][bar_id]['specials'].append(row['special_id'])
            if row['all_day'] != 'Y':
                row_start_minutes = to_minutes(row['start_time'])
                start_minutes = row_start_minutes if row_start_minutes is not None else 10 ** 9
                meta = day_bar_sort_meta[day_key][bar_id]
                meta['has_timed'] = True
                meta['earliest_timed_start'] = min(meta['earliest_timed_start'], start_minutes)

        for day_key in ordered_day_keys:
            if day_key == current_day_key:
                specials_by_day[day_key].sort(
                    key=lambda entry: (
                        *classify_today_bar_order(
                            entry,
                            specials_lookup,
                            bar_today_hours_meta.get(str(entry['bar_id']), {}),
                            current_minutes
                        ),
                        entry['bar_id']
                    )
                )
            else:
                specials_by_day[day_key].sort(
                    key=lambda entry: (
                        0 if day_bar_sort_meta.get(day_key, {}).get(str(entry['bar_id']), {}).get('has_timed') else 1,
                        day_bar_sort_meta.get(day_key, {}).get(str(entry['bar_id']), {}).get('earliest_timed_start', 10 ** 9),
                        entry['bar_id']
                    )
                )

        payload = {
            'startup_payload': {
                'general_data': {
                    'current_day': current_day_key,
                    'generated_at': now.isoformat(),
                    'google_api_key': GOOGLE_API_KEY,
                    'google_map_id': GOOGLE_MAP_ID
                },
                'bars': bars_lookup,
                'bar_order': ordered_bar_ids,
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
    query_params = (event or {}).get('queryStringParameters') or {}
    device_id = query_params.get('device_id')
    payload = build_startup_payload(device_id=device_id)
    return {
        'statusCode': 200,
        'body': json.dumps(payload)
    }
