import json
import logging
import os
from difflib import SequenceMatcher
from datetime import datetime, time, timedelta
from typing import Dict, List

import pymysql

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']
WEB_SCRAPE_AUTO_APPROVAL_THRESHOLD = .5
WEB_AI_SEARCH_AUTO_APPROVAL_THRESHOLD = .8
IGNORE_MANUAL_SPECIALS_ON_PUBLISH = 'Y'


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
            INSERT INTO bar (name, google_place_id, address, neighborhood, latitude, longitude, website_url, description, image_file, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                bar['name'],
                bar['google_place_id'],
                bar['address'],
                bar['neighborhood'],
                bar.get('latitude'),
                bar.get('longitude'),
                bar.get('website_url'),
                bar.get('description'),
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
                latitude = %s,
                longitude = %s,
                description = %s,
                update_date = NOW()
            WHERE bar_id = %s
            """,
            (
                'Y' if is_bar_operational(bar) else 'N',
                bar.get('latitude'),
                bar.get('longitude'),
                bar.get('description'),
                bar_id,
            ),
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
        ORDER BY last_special_candidate_run ASC, bar_id ASC
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


def _normalize_description(value: str) -> str:
    return ' '.join(str(value or '').lower().split())


def _descriptions_match(candidate_description: str, special_description: str) -> bool:
    candidate_normalized = _normalize_description(candidate_description)
    special_normalized = _normalize_description(special_description)
    if not candidate_normalized or not special_normalized:
        return False

    if candidate_normalized == special_normalized:
        return True

    return SequenceMatcher(None, candidate_normalized, special_normalized).ratio() >= 0.78


def _parse_days_of_week(raw_days) -> List[str]:
    if isinstance(raw_days, str):
        try:
            raw_days = json.loads(raw_days)
        except json.JSONDecodeError:
            raw_days = []

    if not isinstance(raw_days, list):
        return []

    return [day for day in raw_days if isinstance(day, str) and day.strip()]


def _normalize_day_of_week(value) -> str:
    if value is None:
        return ''
    return str(value).strip().upper()


def _normalize_yn_flag(value) -> str:
    if value in {'Y', 'N'}:
        return value

    normalized = str(value or '').strip().upper()
    if normalized in {'Y', 'YES', 'TRUE', 'T', '1'}:
        return 'Y'
    if normalized in {'N', 'NO', 'FALSE', 'F', '0'}:
        return 'N'
    return normalized


def _normalize_time_value(value) -> str:
    if value is None:
        return ''

    if isinstance(value, timedelta):
        total_seconds = int(value.total_seconds()) % (24 * 60 * 60)
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        return f'{hours:02d}:{minutes:02d}:{seconds:02d}'

    if isinstance(value, time):
        return value.strftime('%H:%M:%S')

    normalized = str(value).strip()
    if not normalized:
        return ''

    if len(normalized) == 5 and normalized.count(':') == 1:
        return f'{normalized}:00'

    return normalized


def _is_candidate_same_as_special(candidate_row: Dict, special_row: Dict) -> bool:
    return (
        _normalize_day_of_week(candidate_row.get('day_of_week')) == _normalize_day_of_week(special_row.get('day_of_week'))
        and _normalize_yn_flag(candidate_row.get('all_day')) == _normalize_yn_flag(special_row.get('all_day'))
        and _normalize_time_value(candidate_row.get('start_time')) == _normalize_time_value(special_row.get('start_time'))
        and _normalize_time_value(candidate_row.get('end_time')) == _normalize_time_value(special_row.get('end_time'))
        and _descriptions_match(candidate_row.get('description'), special_row.get('description'))
    )


def insert_special_candidate_run(cursor, run: Dict) -> int:
    cursor.execute(
        """
        INSERT INTO special_candidate_run
        (
            bar_id,
            total_candidates,
            auto_approved_candidates,
            web_crawl_candidates,
            web_ai_search_candidates,
            web_crawl_candidate_links,
            web_crawl_keyword_matches,
            web_crawl_prompt_char_count,
            web_ai_search_prompt_char_count,
            web_crawl_ai_parse_attempted,
            web_ai_search_attempted,
            auto_publish,
            is_published,
            started_at,
            completed_at,
            published_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            run['bar_id'],
            run.get('total_candidates', 0),
            0,
            run.get('web_crawl_candidates', 0),
            run.get('web_ai_search_candidates', 0),
            run.get('web_crawl_candidate_links', 0),
            run.get('web_crawl_keyword_matches', 0),
            run.get('web_crawl_prompt_char_count', 0),
            run.get('web_ai_search_prompt_char_count', 0),
            'Y' if run.get('web_crawl_ai_parse_attempted') == 'Y' else 'N',
            'Y' if run.get('web_ai_search_attempted') == 'Y' else 'N',
            'N',
            'N',
            run.get('started_at') or datetime.utcnow(),
            run.get('completed_at') or datetime.utcnow(),
            None,
        ),
    )
    return cursor.lastrowid


def insert_special_candidates(cursor, run: Dict, candidates: List[Dict]) -> Dict[str, int]:
    run_id = insert_special_candidate_run(cursor, run)
    inserted_count = 0
    auto_approved_count = 0
    for candidate in candidates:
        approval_status = 'NOT_APPROVED'
        approval_date = None
        approved_special_id = None
        confidence = _parse_confidence(candidate.get('confidence'))

        fetch_method = (candidate.get('fetch_method') or '').strip()
        if fetch_method == 'web_ai_search':
            auto_approval_threshold = WEB_AI_SEARCH_AUTO_APPROVAL_THRESHOLD
        else:
            auto_approval_threshold = WEB_SCRAPE_AUTO_APPROVAL_THRESHOLD

        if confidence >= auto_approval_threshold:
            approval_status = 'AUTO_APPROVED'
            approval_date = datetime.utcnow()
            auto_approved_count += 1

        cursor.execute(
            """
            INSERT INTO special_candidate
            (run_id, bar_id, bar_name, neighborhood, description, type, days_of_week, start_time, end_time, all_day, is_recurring, date, fetch_method, source, confidence, notes, approval_status, approval_date, approved_special_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                run_id,
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

    cursor.execute(
        """
        UPDATE special_candidate_run
        SET total_candidates = %s,
            auto_approved_candidates = %s,
            is_published = 'N',
            completed_at = COALESCE(%s, NOW())
        WHERE run_id = %s
        """,
        (inserted_count, auto_approved_count, run.get('completed_at'), run_id),
    )

    return {
        'run_id': run_id,
        'inserted_count': inserted_count,
        'auto_approved_count': auto_approved_count,
        'all_auto_approved': inserted_count > 0 and inserted_count == auto_approved_count,
    }


def publish_candidate_specials(cursor, bar_id: int, run_id: int, auto_publish: str = 'N') -> Dict[str, int]:
    cursor.execute(
        """
        SELECT special_candidate_id, description, type, days_of_week, start_time, end_time, all_day
        FROM special_candidate
        WHERE bar_id = %s
            AND run_id = %s
            AND approval_status IN ('AUTO_APPROVED', 'APPROVED')
        """,
        (bar_id, run_id),
    )
    approved_candidates = cursor.fetchall()

    candidate_rows = []
    for candidate in approved_candidates:
        for day in _parse_days_of_week(candidate.get('days_of_week')):
            candidate_rows.append(
                {
                    'candidate_id': candidate['special_candidate_id'],
                    'description': candidate.get('description'),
                    'type': candidate.get('type'),
                    'day_of_week': day,
                    'start_time': candidate.get('start_time'),
                    'end_time': candidate.get('end_time'),
                    'all_day': candidate.get('all_day'),
                }
            )

    manual_filter_clause = "AND insert_method <> 'MANUAL'" if IGNORE_MANUAL_SPECIALS_ON_PUBLISH == 'Y' else ''
    cursor.execute(
        f"""
        SELECT special_id, day_of_week, all_day, start_time, end_time, description
        FROM special
        WHERE bar_id = %s
            AND is_active = 'Y'
            {manual_filter_clause}
        """,
        (bar_id,),
    )
    existing_specials = cursor.fetchall()

    approved_candidate_ids = [
        candidate['special_candidate_id']
        for candidate in approved_candidates
        if candidate.get('special_candidate_id')
    ]
    for candidate_id in approved_candidate_ids:
        cursor.execute(
            """
            UPDATE special_candidate
            SET approved_special_id = NULL
            WHERE special_candidate_id = %s
            """,
            (candidate_id,),
        )

    matched_special_ids = set()
    candidate_to_special_ids = {}
    unmatched_candidates = []
    for candidate in candidate_rows:
        matched_id = None
        for special in existing_specials:
            if special['special_id'] in matched_special_ids:
                continue
            if _is_candidate_same_as_special(candidate, special):
                matched_id = special['special_id']
                break

        if matched_id is not None:
            matched_special_ids.add(matched_id)
            candidate_to_special_ids.setdefault(candidate['candidate_id'], set()).add(matched_id)
        else:
            unmatched_candidates.append(candidate)

    for special in existing_specials:
        if special['special_id'] not in matched_special_ids:
            cursor.execute(
                """
                UPDATE special
                SET is_active = 'N',
                    update_date = NOW()
                WHERE special_id = %s
                """,
                (special['special_id'],),
            )

    inserted_special_count = 0
    for candidate in unmatched_candidates:
        cursor.execute(
            """
            INSERT INTO special
            (bar_id, day_of_week, all_day, start_time, end_time, description, type, insert_method, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Y')
            """,
            (
                bar_id,
                candidate['day_of_week'],
                candidate.get('all_day'),
                candidate.get('start_time'),
                candidate.get('end_time'),
                candidate.get('description'),
                candidate.get('type'),
                'AUTO',
            ),
        )
        inserted_special_count += 1
        candidate_to_special_ids.setdefault(candidate['candidate_id'], set()).add(cursor.lastrowid)

    for candidate_id, special_ids in candidate_to_special_ids.items():
        approved_special_id = min(special_ids) if special_ids else None
        cursor.execute(
            """
            UPDATE special_candidate
            SET approved_special_id = %s
            WHERE special_candidate_id = %s
            """,
            (approved_special_id, candidate_id),
        )

    deactivated_special_count = len(existing_specials) - len(matched_special_ids)
    cursor.execute(
        """
        UPDATE special_candidate_run
        SET auto_publish = %s,
            is_published = 'Y',
            published_at = NOW()
        WHERE run_id = %s
        """,
        ('Y' if auto_publish == 'Y' else 'N', run_id),
    )

    return {
        'run_id': run_id,
        'published_candidate_count': len(candidate_rows),
        'matched_existing_count': len(matched_special_ids),
        'inserted_special_count': inserted_special_count,
        'deactivated_special_count': deactivated_special_count,
    }


def lambda_handler(event, context):
    event = event or {}
    mode = event.get('mode')
    if mode not in {'determine_if_bar_existing', 'apply_bar_upsert', 'get_bars_by_neighborhood'}:
        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': 'mode must be one of determine_if_bar_existing, apply_bar_upsert, get_bars_by_neighborhood'
            }),
        }

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if mode == 'determine_if_bar_existing':
                result = categorize_bars(cursor, event.get('bars', []))
                conn.commit()
            elif mode == 'apply_bar_upsert':
                result = apply_changes(cursor, event.get('new_bars', []), event.get('existing_bars', []))
                conn.commit()
            elif mode == 'get_bars_by_neighborhood':
                neighborhood = event.get('neighborhood')
                if not neighborhood:
                    raise ValueError('neighborhood is required for get_bars_by_neighborhood')
                result = get_bars_by_neighborhood(cursor, neighborhood)
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
