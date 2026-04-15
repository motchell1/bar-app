import json
import logging
import os
from datetime import time, timedelta
from difflib import SequenceMatcher
from typing import Dict, List

import pymysql

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']
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


def _normalize_days_input(raw_days) -> List[str]:
    if isinstance(raw_days, list):
        candidates = raw_days
    else:
        value = str(raw_days or '').strip()
        if not value:
            return []
        if value.startswith('['):
            try:
                parsed = json.loads(value)
                candidates = parsed if isinstance(parsed, list) else []
            except json.JSONDecodeError:
                candidates = []
        else:
            candidates = [segment.strip() for segment in value.split(',')]

    normalized = []
    for day in candidates:
        parsed_day = _normalize_day_of_week(day)
        if parsed_day:
            normalized.append(parsed_day)

    return list(dict.fromkeys(normalized))


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


def publish_special_candidate_run(cursor, bar_id: int, run_id: int, auto_publish: str = 'N') -> Dict[str, int]:
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

    approved_candidate_ids = [candidate['special_candidate_id'] for candidate in approved_candidates if candidate.get('special_candidate_id')]
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


def get_unapproved_special_candidates(cursor):
    cursor.execute(
        """
        SELECT
            scr.run_id,
            b.name AS bar_name,
            b.neighborhood AS run_neighborhood,
            scr.total_candidates,
            scr.auto_approved_candidates,
            scr.web_crawl_candidates,
            scr.web_ai_search_candidates,
            scr.web_crawl_candidate_links,
            scr.web_crawl_keyword_matches,
            scr.web_crawl_prompt_char_count,
            scr.web_crawl_ai_parse_attempted,
            scr.web_ai_search_attempted,
            scr.started_at,
            scr.completed_at,
            sc.special_candidate_id,
            sc.description,
            sc.days_of_week,
            sc.type,
            sc.start_time,
            sc.end_time,
            sc.all_day,
            sc.confidence,
            sc.notes,
            sc.fetch_method,
            sc.source,
            sc.insert_date
        FROM special_candidate sc
        JOIN special_candidate_run scr ON scr.run_id = sc.run_id
        JOIN bar b ON b.bar_id = scr.bar_id
        WHERE sc.approval_status = 'NOT_APPROVED'
            AND COALESCE(sc.is_recurring, 'Y') = 'Y'
        ORDER BY scr.run_id DESC, sc.special_candidate_id ASC
        """
    )
    rows = cursor.fetchall()
    grouped_runs = {}
    for row in rows:
        run_id = row['run_id']
        run = grouped_runs.setdefault(
            run_id,
            {
                'run_id': run_id,
                'bar_name': row.get('bar_name'),
                'neighborhood': row.get('run_neighborhood'),
                'total_candidates': row.get('total_candidates'),
                'auto_approved_candidates': row.get('auto_approved_candidates'),
                'web_crawl_candidates': row.get('web_crawl_candidates'),
                'web_ai_search_candidates': row.get('web_ai_search_candidates'),
                'web_crawl_candidate_links': row.get('web_crawl_candidate_links'),
                'web_crawl_keyword_matches': row.get('web_crawl_keyword_matches'),
                'web_crawl_prompt_char_count': row.get('web_crawl_prompt_char_count'),
                'web_crawl_ai_parse_attempted': row.get('web_crawl_ai_parse_attempted'),
                'web_ai_search_attempted': row.get('web_ai_search_attempted'),
                'started_at': row.get('started_at').isoformat() if row.get('started_at') else None,
                'completed_at': row.get('completed_at').isoformat() if row.get('completed_at') else None,
                'specials': [],
            },
        )
        run['specials'].append(
            {
                'special_candidate_id': row.get('special_candidate_id'),
                'description': row.get('description'),
                'days_of_week': _parse_days_of_week(row.get('days_of_week')),
                'type': row.get('type'),
                'start_time': _normalize_time_value(row.get('start_time')) or None,
                'end_time': _normalize_time_value(row.get('end_time')) or None,
                'all_day': row.get('all_day'),
                'confidence': row.get('confidence'),
                'notes': row.get('notes'),
                'fetch_method': row.get('fetch_method'),
                'source': row.get('source'),
                'insert_date': row.get('insert_date').isoformat() if row.get('insert_date') else None,
            }
        )

    runs = list(grouped_runs.values())
    return {'runs': runs, 'run_count': len(runs), 'special_count': len(rows)}


def update_special_candidate_approval(cursor, special_candidate_id: int, approval_status: str):
    normalized_status = str(approval_status or '').strip().upper()
    if normalized_status not in {'APPROVED', 'REJECTED'}:
        raise ValueError('approval_status must be APPROVED or REJECTED')

    cursor.execute(
        """
        SELECT special_candidate_id, run_id, bar_id
        FROM special_candidate
        WHERE special_candidate_id = %s
        """,
        (special_candidate_id,),
    )
    target = cursor.fetchone()
    if not target:
        raise ValueError('special_candidate_id was not found')

    run_id = target['run_id']
    bar_id = target['bar_id']

    cursor.execute(
        """
        UPDATE special_candidate
        SET approval_status = %s,
            approval_date = NOW()
        WHERE special_candidate_id = %s
        """,
        (normalized_status, special_candidate_id),
    )

    cursor.execute(
        """
        SELECT COUNT(*) AS remaining
        FROM special_candidate
        WHERE run_id = %s
            AND approval_status = 'NOT_APPROVED'
            AND COALESCE(is_recurring, 'N') = 'N'
        """,
        (run_id,),
    )
    remaining = int((cursor.fetchone() or {}).get('remaining', 0))

    published = False
    publish_result = None
    if remaining == 0:
        publish_result = publish_special_candidate_run(cursor, bar_id, run_id, auto_publish='N')
        published = True

    return {
        'special_candidate_id': special_candidate_id,
        'run_id': run_id,
        'approval_status': normalized_status,
        'remaining_not_approved': remaining,
        'published_run': published,
        'publish_result': publish_result,
    }


def get_all_specials(cursor):
    cursor.execute(
        """
        SELECT
            s.special_id,
            b.name AS bar_name,
            b.neighborhood,
            s.day_of_week,
            s.all_day,
            s.start_time,
            s.end_time,
            s.description,
            s.type,
            s.is_active,
            s.insert_method,
            s.insert_date,
            s.update_date
        FROM special s
        JOIN bar b
            ON b.bar_id = s.bar_id
        ORDER BY b.neighborhood ASC, b.name ASC, s.description ASC, s.insert_date ASC, s.special_id ASC
        """
    )
    special_rows = cursor.fetchall()
    special_ids = [row.get('special_id') for row in special_rows if row.get('special_id')]

    candidate_rows_by_special = {}
    if special_ids:
        placeholders = ','.join(['%s'] * len(special_ids))
        cursor.execute(
            f"""
            SELECT
                sc.approved_special_id,
                sc.special_candidate_id,
                sc.confidence,
                sc.fetch_method,
                sc.notes,
                sc.source,
                sc.approval_status,
                sc.approval_date,
                sc.insert_date,
                scr.run_id,
                scr.published_at
            FROM special_candidate sc
            LEFT JOIN special_candidate_run scr
                ON scr.run_id = sc.run_id
            WHERE sc.approved_special_id IN ({placeholders})
            ORDER BY
                sc.approved_special_id ASC,
                sc.approval_date DESC,
                sc.special_candidate_id DESC
            """,
            special_ids,
        )
        for row in cursor.fetchall():
            special_id = row.get('approved_special_id')
            if not special_id:
                continue
            candidate_rows_by_special.setdefault(special_id, []).append(
                {
                    'special_candidate_id': row.get('special_candidate_id'),
                    'confidence': row.get('confidence'),
                    'fetch_method': row.get('fetch_method'),
                    'notes': row.get('notes'),
                    'source': row.get('source'),
                    'approval_status': row.get('approval_status'),
                    'approval_date': row.get('approval_date').isoformat() if row.get('approval_date') else None,
                    'insert_date': row.get('insert_date').isoformat() if row.get('insert_date') else None,
                    'run_id': row.get('run_id'),
                    'published_at': row.get('published_at').isoformat() if row.get('published_at') else None,
                }
            )

    specials = []
    for row in special_rows:
        special_id = row.get('special_id')
        candidate_rows = candidate_rows_by_special.get(special_id, [])
        primary_candidate = candidate_rows[0] if candidate_rows else {}
        specials.append(
            {
                'special_id': special_id,
                'bar_name': row.get('bar_name'),
                'neighborhood': row.get('neighborhood'),
                'day_of_week': row.get('day_of_week'),
                'all_day': row.get('all_day'),
                'start_time': _normalize_time_value(row.get('start_time')) or None,
                'end_time': _normalize_time_value(row.get('end_time')) or None,
                'description': row.get('description'),
                'type': row.get('type'),
                'is_active': row.get('is_active'),
                'insert_method': row.get('insert_method'),
                'insert_date': row.get('insert_date').isoformat() if row.get('insert_date') else None,
                'update_date': row.get('update_date').isoformat() if row.get('update_date') else None,
                'special_candidate_id': primary_candidate.get('special_candidate_id'),
                'confidence': primary_candidate.get('confidence'),
                'fetch_method': primary_candidate.get('fetch_method'),
                'notes': primary_candidate.get('notes'),
                'source': primary_candidate.get('source'),
                'approval_date': primary_candidate.get('approval_date'),
                'run_id': primary_candidate.get('run_id'),
                'published_at': primary_candidate.get('published_at'),
                'candidate_rows': candidate_rows,
                'candidate_count': len(candidate_rows),
                'special_candidate_ids': [candidate.get('special_candidate_id') for candidate in candidate_rows if candidate.get('special_candidate_id')],
                'special_candidate_ids_csv': ','.join(
                    [str(candidate.get('special_candidate_id')) for candidate in candidate_rows if candidate.get('special_candidate_id')]
                ),
            }
        )

    return {'specials': specials, 'special_count': len(specials)}


def update_special(cursor, event):
    special_id = event.get('special_id')
    if not special_id:
        raise ValueError('special_id is required for update_special')

    editable_fields = {
        'day_of_week',
        'all_day',
        'start_time',
        'end_time',
        'description',
        'type',
        'is_active',
    }
    updates = {}
    for field in editable_fields:
        if field in event:
            updates[field] = event.get(field)

    if not updates:
        raise ValueError('At least one editable field must be provided for update_special')

    if 'all_day' in updates:
        updates['all_day'] = _normalize_yn_flag(updates['all_day'])
    if 'is_active' in updates:
        updates['is_active'] = _normalize_yn_flag(updates['is_active'])

    set_clause = ', '.join([f"{key} = %s" for key in updates])
    values = list(updates.values()) + [special_id]

    cursor.execute(
        f"""
        UPDATE special
        SET {set_clause},
            update_date = NOW()
        WHERE special_id = %s
        """,
        values,
    )

    if cursor.rowcount == 0:
        raise ValueError('special_id was not found')

    cursor.execute(
        """
        SELECT special_id, update_date, is_active
        FROM special
        WHERE special_id = %s
        """,
        (special_id,),
    )
    updated = cursor.fetchone() or {}
    return {
        'special_id': updated.get('special_id'),
        'is_active': updated.get('is_active'),
        'update_date': updated.get('update_date').isoformat() if updated.get('update_date') else None,
    }


def update_special_candidate(cursor, event):
    special_candidate_id = event.get('special_candidate_id')
    if not special_candidate_id:
        raise ValueError('special_candidate_id is required for update_special_candidate')

    editable_fields = {
        'description',
        'all_day',
        'days_of_week',
        'start_time',
        'end_time',
        'type',
    }
    updates = {}
    for field in editable_fields:
        if field in event:
            updates[field] = event.get(field)

    if not updates:
        raise ValueError('At least one editable field must be provided for update_special_candidate')

    if 'all_day' in updates:
        updates['all_day'] = _normalize_yn_flag(updates.get('all_day'))
    if 'days_of_week' in updates:
        updates['days_of_week'] = json.dumps(_normalize_days_input(updates.get('days_of_week')))
    if 'start_time' in updates:
        updates['start_time'] = _normalize_time_value(updates.get('start_time')) or None
    if 'end_time' in updates:
        updates['end_time'] = _normalize_time_value(updates.get('end_time')) or None

    set_clause = ', '.join([f"{key} = %s" for key in updates])
    values = list(updates.values()) + [special_candidate_id]

    cursor.execute(
        f"""
        UPDATE special_candidate
        SET {set_clause}
        WHERE special_candidate_id = %s
        """,
        values,
    )

    if cursor.rowcount == 0:
        raise ValueError('special_candidate_id was not found')

    cursor.execute(
        """
        SELECT special_candidate_id, description, all_day, days_of_week, start_time, end_time, type
        FROM special_candidate
        WHERE special_candidate_id = %s
        """,
        (special_candidate_id,),
    )
    updated = cursor.fetchone() or {}
    return {
        'special_candidate_id': updated.get('special_candidate_id'),
        'description': updated.get('description'),
        'all_day': updated.get('all_day'),
        'days_of_week': _parse_days_of_week(updated.get('days_of_week')),
        'start_time': _normalize_time_value(updated.get('start_time')) or None,
        'end_time': _normalize_time_value(updated.get('end_time')) or None,
        'type': updated.get('type'),
    }




def _parse_event_payload(event):
    if not isinstance(event, dict):
        return {}

    payload = dict(event)
    raw_body = payload.get('body')
    if isinstance(raw_body, str):
        try:
            parsed_body = json.loads(raw_body)
            if isinstance(parsed_body, dict):
                payload.update(parsed_body)
        except json.JSONDecodeError:
            LOGGER.warning('dbAdminSync received non-JSON body')
    elif isinstance(raw_body, dict):
        payload.update(raw_body)

    return payload

def lambda_handler(event, context):
    event = _parse_event_payload(event or {})
    mode = event.get('mode')
    if mode not in {'get_unapproved_special_candidates', 'update_special_candidate_approval', 'get_all_specials', 'update_special', 'update_special_candidate'}:
        return {
            'statusCode': 400,
            'body': json.dumps(
                {
                    'error': (
                        'mode must be one of get_unapproved_special_candidates, '
                        'update_special_candidate_approval, get_all_specials, update_special, update_special_candidate'
                    )
                }
            ),
        }

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if mode == 'get_unapproved_special_candidates':
                result = get_unapproved_special_candidates(cursor)
            elif mode == 'update_special_candidate_approval':
                special_candidate_id = event.get('special_candidate_id')
                approval_status = event.get('approval_status')
                if not special_candidate_id:
                    raise ValueError('special_candidate_id is required for update_special_candidate_approval')
                result = update_special_candidate_approval(cursor, special_candidate_id, approval_status)
            elif mode == 'get_all_specials':
                result = get_all_specials(cursor)
            elif mode == 'update_special_candidate':
                result = update_special_candidate(cursor, event)
            else:
                result = update_special(cursor, event)
            conn.commit()

        LOGGER.info('dbAdminSync %s result=%s', mode, result)
        return {'statusCode': 200, 'body': json.dumps(result)}
    except Exception as exc:
        conn.rollback()
        LOGGER.exception('dbAdminSync failed during %s', mode)
        return {'statusCode': 500, 'body': json.dumps({'error': str(exc), 'mode': mode})}
    finally:
        conn.close()
