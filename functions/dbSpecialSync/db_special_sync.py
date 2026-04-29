import json
import logging
import os
from datetime import datetime, time, timedelta
from difflib import SequenceMatcher
from typing import Dict, List

import pymysql

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']
WEB_SCRAPE_AUTO_APPROVAL_THRESHOLD = 0.5
WEB_AI_SEARCH_AUTO_APPROVAL_THRESHOLD = 0.8
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


def _normalize_days_of_week_value(value) -> tuple:
    return tuple(sorted(_normalize_day_of_week(day) for day in _parse_days_of_week(value)))


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


def _normalize_date_value(value) -> str:
    if value is None:
        return ''
    if isinstance(value, datetime):
        return value.date().isoformat()
    return str(value).strip()


def _normalize_text_value(value) -> str:
    return str(value or '').strip()


def _build_open_hours_lookup(open_hours_rows: List[Dict]) -> Dict[str, Dict]:
    lookup = {}
    for row in open_hours_rows:
        day_key = _normalize_day_of_week(row.get('day_of_week'))
        if not day_key:
            continue
        lookup[day_key] = {
            'open_time': _normalize_time_value(row.get('open_time')),
            'close_time': _normalize_time_value(row.get('close_time')),
            'is_closed': _normalize_yn_flag(row.get('is_closed')),
        }
    return lookup


def _should_convert_to_all_day(day_of_week, all_day, start_time, end_time, open_hours_lookup: Dict[str, Dict]) -> bool:
    day_key = _normalize_day_of_week(day_of_week)
    if not day_key:
        return False
    if _normalize_yn_flag(all_day) != 'N':
        return False
    normalized_start = _normalize_time_value(start_time)
    normalized_end = _normalize_time_value(end_time)
    if not normalized_start or not normalized_end:
        return False

    hours_row = open_hours_lookup.get(day_key)
    if not hours_row or hours_row.get('is_closed') == 'Y':
        return False

    return (
        normalized_start == _normalize_time_value(hours_row.get('open_time'))
        and normalized_end == _normalize_time_value(hours_row.get('close_time'))
    )


def _append_missing_hours_note(note_suffixes: Dict[int, List[str]], candidate_id: int, day_of_week: str, missing_field: str) -> None:
    note_suffixes.setdefault(candidate_id, []).append(
        f" - missing {missing_field} for {day_of_week}, special not published for {day_of_week}"
    )


def _is_candidate_same_as_special(candidate_row: Dict, special_row: Dict) -> bool:
    return (
        _normalize_day_of_week(candidate_row.get('day_of_week')) == _normalize_day_of_week(special_row.get('day_of_week'))
        and _normalize_yn_flag(candidate_row.get('all_day')) == _normalize_yn_flag(special_row.get('all_day'))
        and _normalize_time_value(candidate_row.get('start_time')) == _normalize_time_value(special_row.get('start_time'))
        and _normalize_time_value(candidate_row.get('end_time')) == _normalize_time_value(special_row.get('end_time'))
        and _descriptions_match(candidate_row.get('description'), special_row.get('description'))
    )


def _is_candidate_same_as_reject(candidate_row: Dict, reject_row: Dict) -> bool:
    return (
        str(candidate_row.get('bar_id')) == str(reject_row.get('bar_id'))
        and _normalize_days_of_week_value(candidate_row.get('days_of_week')) == _normalize_days_of_week_value(reject_row.get('days_of_week'))
        and _normalize_time_value(candidate_row.get('start_time')) == _normalize_time_value(reject_row.get('start_time'))
        and _normalize_time_value(candidate_row.get('end_time')) == _normalize_time_value(reject_row.get('end_time'))
        and _normalize_yn_flag(candidate_row.get('all_day')) == _normalize_yn_flag(reject_row.get('all_day'))
        and _normalize_yn_flag(candidate_row.get('is_recurring')) == _normalize_yn_flag(reject_row.get('is_recurring'))
        and _normalize_date_value(candidate_row.get('date')) == _normalize_date_value(reject_row.get('date'))
        and _normalize_text_value(candidate_row.get('fetch_method')) == _normalize_text_value(reject_row.get('fetch_method'))
        and _normalize_text_value(candidate_row.get('source') or candidate_row.get('source_url')) == _normalize_text_value(reject_row.get('source'))
        and _descriptions_match(candidate_row.get('description'), reject_row.get('description'))
    )


def insert_special_candidate_run(cursor, run: Dict) -> int:
    completed_at = run.get('completed_at') or datetime.utcnow()
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
            completed_at,
            None,
        ),
    )
    run_id = cursor.lastrowid
    cursor.execute(
        """
        UPDATE bar
        SET last_special_candidate_run = %s
        WHERE bar_id = %s
        """,
        (completed_at, run['bar_id']),
    )
    if cursor.rowcount == 0:
        raise ValueError('run.bar_id was not found while updating bar.last_special_candidate_run')
    return run_id


def insert_special_candidate(cursor, run: Dict, candidates: List[Dict]) -> Dict[str, int]:
    run_id = insert_special_candidate_run(cursor, run)
    inserted_count = 0
    auto_approved_count = 0

    cursor.execute(
        """
        SELECT
            reject_id,
            bar_id,
            description,
            days_of_week,
            start_time,
            end_time,
            all_day,
            is_recurring,
            date,
            fetch_method,
            source
        FROM special_candidate_reject
        WHERE bar_id = %s
        """,
        (run['bar_id'],),
    )
    rejected_candidates = cursor.fetchall()

    for candidate in candidates:
        approval_status = 'NOT_APPROVED'
        approval_date = None
        confidence = _parse_confidence(candidate.get('confidence'))

        matched_reject_ids = [
            rejected_candidate.get('reject_id')
            for rejected_candidate in rejected_candidates
            if _is_candidate_same_as_reject(candidate, rejected_candidate)
            and rejected_candidate.get('reject_id')
        ]
        is_rejected_candidate = bool(matched_reject_ids)

        if is_rejected_candidate:
            approval_status = 'AUTO_REJECTED'
            approval_date = datetime.utcnow()
        else:
            fetch_method = (candidate.get('fetch_method') or '').strip()
            auto_approval_threshold = WEB_AI_SEARCH_AUTO_APPROVAL_THRESHOLD if fetch_method == 'web_ai_search' else WEB_SCRAPE_AUTO_APPROVAL_THRESHOLD
            if confidence >= auto_approval_threshold:
                approval_status = 'AUTO_APPROVED'
                approval_date = datetime.utcnow()
                auto_approved_count += 1

        cursor.execute(
            """
            INSERT INTO special_candidate
            (run_id, bar_id, bar_name, neighborhood, description, type, days_of_week, start_time, end_time, all_day, is_recurring, date, fetch_method, source, confidence, notes, approval_status, approval_date)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
            ),
        )
        candidate_id = cursor.lastrowid
        if is_rejected_candidate:
            for reject_id in matched_reject_ids:
                cursor.execute(
                    """
                    INSERT INTO special_candidate_reject_join (reject_id, special_candidate_id)
                    VALUES (%s, %s)
                    """,
                    (reject_id, candidate_id),
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


def publish_special_candidate_run(cursor, bar_id: int, run_id: int, auto_publish: str = 'N') -> Dict[str, int]:
    cursor.execute(
        """
        SELECT day_of_week, open_time, close_time, is_closed
        FROM open_hours
        WHERE bar_id = %s
        """,
        (bar_id,),
    )
    open_hours_lookup = _build_open_hours_lookup(cursor.fetchall())

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
    candidate_note_suffixes = {}
    for candidate in approved_candidates:
        for day in _parse_days_of_week(candidate.get('days_of_week')):
            start_time = candidate.get('start_time')
            end_time = candidate.get('end_time')
            all_day = candidate.get('all_day')
            if _should_convert_to_all_day(day, all_day, start_time, end_time, open_hours_lookup):
                all_day = 'Y'
                start_time = None
                end_time = None

            if _normalize_yn_flag(all_day) == 'N':
                day_hours = open_hours_lookup.get(_normalize_day_of_week(day), {})
                should_skip = False
                if not _normalize_time_value(start_time):
                    resolved_open_time = _normalize_time_value(day_hours.get('open_time'))
                    if resolved_open_time:
                        start_time = resolved_open_time
                    else:
                        _append_missing_hours_note(candidate_note_suffixes, candidate['special_candidate_id'], day, 'open_time')
                        should_skip = True
                if not _normalize_time_value(end_time):
                    resolved_close_time = _normalize_time_value(day_hours.get('close_time'))
                    if resolved_close_time:
                        end_time = resolved_close_time
                    else:
                        _append_missing_hours_note(candidate_note_suffixes, candidate['special_candidate_id'], day, 'close_time')
                        should_skip = True
                if should_skip:
                    continue

            candidate_rows.append(
                {
                    'candidate_id': candidate['special_candidate_id'],
                    'description': candidate.get('description'),
                    'type': candidate.get('type'),
                    'day_of_week': day,
                    'start_time': start_time,
                    'end_time': end_time,
                    'all_day': all_day,
                }
            )

    for candidate_id, note_suffixes in candidate_note_suffixes.items():
        cursor.execute(
            """
            UPDATE special_candidate
            SET notes = CONCAT(COALESCE(notes, ''), %s)
            WHERE special_candidate_id = %s
            """,
            (''.join(note_suffixes), candidate_id),
        )

    manual_filter_clause = "AND insert_method <> 'MANUAL'" if IGNORE_MANUAL_SPECIALS_ON_PUBLISH == 'Y' else ''
    cursor.execute(
        f"""
        SELECT special_id, day_of_week, all_day, start_time, end_time, description, is_active
        FROM special
        WHERE bar_id = %s
            {manual_filter_clause}
        """,
        (bar_id,),
    )
    existing_specials = cursor.fetchall()
    for special in existing_specials:
        if _should_convert_to_all_day(
            special.get('day_of_week'),
            special.get('all_day'),
            special.get('start_time'),
            special.get('end_time'),
            open_hours_lookup,
        ):
            cursor.execute(
                """
                UPDATE special
                SET all_day = 'Y',
                    start_time = NULL,
                    end_time = NULL,
                    update_date = NOW()
                WHERE special_id = %s
                """,
                (special['special_id'],),
            )
            special['all_day'] = 'Y'
            special['start_time'] = None
            special['end_time'] = None

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
            if special.get('is_active') == 'Y':
                cursor.execute(
                    """
                    UPDATE special
                    SET is_active = 'N',
                        update_date = NOW()
                    WHERE special_id = %s
                    """,
                    (special['special_id'],),
                )
        elif special.get('is_active') != 'Y':
            cursor.execute(
                """
                UPDATE special
                SET is_active = 'Y',
                    update_date = NOW()
                WHERE special_id = %s
                """,
                (special['special_id'],),
            )
        else:
            cursor.execute(
                """
                UPDATE special
                SET update_date = NOW()
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
        for special_id in special_ids:
            cursor.execute(
                """
                UPDATE special
                SET special_candidate_id = %s
                WHERE special_id = %s
                """,
                (candidate_id, special_id),
            )

    deactivated_special_count = sum(
        1
        for special in existing_specials
        if special.get('is_active') == 'Y' and special['special_id'] not in matched_special_ids
    )
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
    if mode not in {'insert_special_candidate', 'publish_special_candidate_run'}:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'mode must be one of insert_special_candidate, publish_special_candidate_run'}),
        }

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if mode == 'insert_special_candidate':
                run = event.get('run', {}) or {}
                if not run.get('bar_id'):
                    raise ValueError('run.bar_id is required for insert_special_candidate')
                result = insert_special_candidate(cursor, run, event.get('candidates', []))
            elif mode == 'publish_special_candidate_run':
                bar_id = event.get('bar_id')
                run_id = event.get('run_id')
                auto_publish = event.get('auto_publish', 'N')
                if not bar_id:
                    raise ValueError('bar_id is required for publish_special_candidate_run')
                if not run_id:
                    raise ValueError('run_id is required for publish_special_candidate_run')
                result = publish_special_candidate_run(cursor, bar_id, run_id, auto_publish)
            conn.commit()

        LOGGER.info('dbSpecialSync %s result=%s', mode, result)
        return {'statusCode': 200, 'body': json.dumps(result)}
    except Exception as exc:
        conn.rollback()
        LOGGER.exception('dbSpecialSync failed during %s', mode)
        return {'statusCode': 500, 'body': json.dumps({'error': str(exc), 'mode': mode})}
    finally:
        conn.close()
