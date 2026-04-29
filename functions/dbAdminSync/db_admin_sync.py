import json
import logging
import os
from decimal import Decimal
from datetime import time, timedelta
from difflib import SequenceMatcher
from typing import Dict, List
from urllib.parse import urlparse

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


def _append_missing_hours_note(note_suffixes: Dict[int, List[str]], candidate_id: int, day_of_week: str, missing_field: str) -> None:
    note_suffixes.setdefault(candidate_id, []).append(
        f" - missing {missing_field} for {day_of_week}, special not published for {day_of_week}"
    )


def _to_json_safe_number(value):
    if isinstance(value, Decimal):
        return float(value)
    return value


def _normalize_date_value(value) -> str:
    if value is None:
        return ''
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return str(value).strip()


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
            sc.neighborhood,
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
            sc.approval_status,
            sc.insert_date
        FROM special_candidate sc
        JOIN special_candidate_run scr ON scr.run_id = sc.run_id
        JOIN bar b ON b.bar_id = scr.bar_id
        WHERE sc.approval_status IN ('NOT_APPROVED', 'AUTO_APPROVED')
            AND COALESCE(sc.is_recurring, 'Y') = 'Y'
            AND sc.run_id IN (
                SELECT DISTINCT sc2.run_id
                FROM special_candidate sc2
                WHERE sc2.approval_status = 'NOT_APPROVED'
                    AND COALESCE(sc2.is_recurring, 'Y') = 'Y'
            )
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
                'neighborhood': row.get('neighborhood'),
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
                'neighborhood': row.get('neighborhood'),
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
                'approval_status': row.get('approval_status'),
                'insert_date': row.get('insert_date').isoformat() if row.get('insert_date') else None,
            }
        )

    runs = list(grouped_runs.values())
    return {'runs': runs, 'run_count': len(runs), 'special_count': len(rows)}


def get_not_approved_special_candidate_summary(cursor) -> Dict[str, object]:
    cursor.execute(
        """
        SELECT
            COALESCE(NULLIF(TRIM(b.neighborhood), ''), 'Unknown') AS neighborhood,
            COUNT(*) AS not_approved_count
        FROM special_candidate sc
        LEFT JOIN bar b ON b.bar_id = sc.bar_id
        WHERE sc.approval_status = 'NOT_APPROVED'
        GROUP BY COALESCE(NULLIF(TRIM(b.neighborhood), ''), 'Unknown')
        ORDER BY neighborhood ASC
        """
    )
    neighborhood_rows = cursor.fetchall()
    total_count = sum(int(row.get('not_approved_count', 0) or 0) for row in neighborhood_rows)

    return {
        'approval_status': 'NOT_APPROVED',
        'not_approved_count': total_count,
        'by_neighborhood': [
            {
                'neighborhood': row.get('neighborhood'),
                'count': int(row.get('not_approved_count', 0) or 0),
            }
            for row in neighborhood_rows
        ],
    }


def detect_duplicate_active_websites(cursor) -> Dict[str, List[Dict]]:
    cursor.execute(
        """
        SELECT
            bar_id,
            name AS bar_name,
            neighborhood,
            website_url
        FROM bar
        WHERE is_active = 'Y'
          AND website_url IS NOT NULL
          AND TRIM(website_url) <> ''
          AND EXISTS (
              SELECT 1
              FROM special
              WHERE special.bar_id = bar.bar_id
                AND special.is_active = 'Y'
          )
        """
    )
    rows = cursor.fetchall()

    domain_groups: Dict[str, Dict[str, List[Dict]]] = {}
    for row in rows:
        value = (row.get('website_url') or '').strip().lower()
        if not value:
            continue
        if '://' not in value:
            value = f'https://{value}'
        parsed = urlparse(value)
        domain = (parsed.netloc or '').split('@')[-1].split(':')[0].strip('.')
        if domain.startswith('www.'):
            domain = domain[4:]

        neighborhood = (row.get('neighborhood') or '').strip()
        if not domain or not neighborhood:
            continue

        domain_groups.setdefault(domain, {}).setdefault(neighborhood, []).append(
            {
                'bar_id': int(row.get('bar_id')),
                'bar_name': (row.get('bar_name') or '').strip(),
                'website_url': (row.get('website_url') or '').strip(),
            }
        )

    duplicate_groups = []
    for domain, neighborhood_map in sorted(domain_groups.items(), key=lambda item: item[0]):
        for neighborhood, bars in sorted(neighborhood_map.items(), key=lambda item: item[0]):
            if len(bars) < 2:
                continue
            sorted_bars = sorted(bars, key=lambda bar: (bar.get('bar_name', '').lower(), bar.get('bar_id', 0)))
            duplicate_groups.append(
                {
                    'domain': domain,
                    'neighborhood': neighborhood,
                    'active_bar_count': len(sorted_bars),
                    'bar_ids': [bar['bar_id'] for bar in sorted_bars],
                    'bars': sorted_bars,
                }
            )

    return {'duplicate_group_count': len(duplicate_groups), 'duplicate_groups': duplicate_groups}


def detect_duplicate_specials(cursor, bar_id: int = None) -> Dict[str, object]:
    params: List[object] = []
    where_clause = "s.is_active = 'Y' AND b.is_active = 'Y'"
    if bar_id is not None:
        where_clause += ' AND s.bar_id = %s'
        params.append(bar_id)

    cursor.execute(
        f"""
        SELECT
            s.special_id,
            s.bar_id,
            b.name AS bar_name,
            b.neighborhood,
            s.day_of_week,
            s.type,
            s.description,
            s.insert_method,
            s.insert_date,
            s.all_day,
            s.start_time,
            s.end_time,
            sc.special_candidate_id,
            sc.fetch_method,
            sc.source
        FROM special s
        JOIN bar b ON b.bar_id = s.bar_id
        LEFT JOIN special_candidate sc
            ON sc.special_candidate_id = (
                SELECT MAX(sc2.special_candidate_id)
                FROM special_candidate sc2
                WHERE sc2.approved_special_id = s.special_id
            )
        WHERE {where_clause}
        ORDER BY s.bar_id, s.day_of_week, s.type, s.special_id
        """,
        tuple(params),
    )
    active_special_rows = cursor.fetchall()

    for row in active_special_rows:
        row['day_of_week'] = _normalize_day_of_week(row.get('day_of_week'))
        row['all_day'] = _normalize_yn_flag(row.get('all_day'))
        row['start_time'] = _normalize_time_value(row.get('start_time'))
        row['end_time'] = _normalize_time_value(row.get('end_time'))
        row['insert_date'] = _normalize_date_value(row.get('insert_date'))

    same_description_map = {}
    for row in active_special_rows:
        key = (
            row.get('bar_id'),
            row.get('bar_name'),
            row.get('neighborhood'),
            row.get('day_of_week'),
            row.get('type'),
            row.get('description'),
        )
        group = same_description_map.setdefault(
            key,
            {
                'bar_id': row.get('bar_id'),
                'bar_name': row.get('bar_name'),
                'neighborhood': row.get('neighborhood'),
                'day_of_week': row.get('day_of_week'),
                'type': row.get('type'),
                'description': row.get('description'),
                'specials': [],
                '_time_windows': set(),
            },
        )
        group['specials'].append(
            {
                'special_id': row.get('special_id'),
                'all_day': row.get('all_day'),
                'start_time': row.get('start_time'),
                'end_time': row.get('end_time'),
                'insert_method': row.get('insert_method'),
                'insert_date': row.get('insert_date'),
                'special_candidate_id': row.get('special_candidate_id'),
                'fetch_method': row.get('fetch_method'),
                'source': row.get('source'),
            }
        )
        group['_time_windows'].add((row.get('all_day'), row.get('start_time'), row.get('end_time')))

    same_description_groups = []
    for group in same_description_map.values():
        if len(group['_time_windows']) <= 1:
            continue
        group['special_count'] = len(group['specials'])
        group['distinct_time_windows'] = len(group['_time_windows'])
        del group['_time_windows']
        same_description_groups.append(group)

    same_description_groups.sort(key=lambda row: (row.get('bar_id'), row.get('day_of_week'), row.get('type'), row.get('description') or ''))

    return {
        'bar_id_filter': bar_id,
        'same_description_different_times': same_description_groups,
        'same_time_different_descriptions': [],
        'same_description_different_times_count': len(same_description_groups),
        'same_time_different_descriptions_count': 0,
    }


def get_rejected_special_candidates(cursor):
    cursor.execute(
        """
        SELECT
            scr.reject_id,
            scr.bar_id,
            b.name AS bar_name,
            b.neighborhood AS neighborhood,
            scr.description,
            scr.days_of_week,
            COALESCE(MAX(linked_sc.type), '') AS type,
            scr.start_time,
            scr.end_time,
            scr.all_day,
            scr.is_recurring,
            scr.date,
            scr.fetch_method,
            scr.source,
            COUNT(scrj.special_candidate_id) AS candidate_matches,
            MAX(scrj.special_candidate_id) AS latest_special_candidate_id,
            MAX(linked_sc.insert_date) AS last_seen_candidate_insert_date,
            COUNT(DISTINCT scrj.special_candidate_id) AS linked_candidate_count
        FROM special_candidate_reject scr
        JOIN bar b ON b.bar_id = scr.bar_id
        LEFT JOIN special_candidate_reject_join scrj ON scrj.reject_id = scr.reject_id
        LEFT JOIN special_candidate linked_sc ON linked_sc.special_candidate_id = scrj.special_candidate_id
        GROUP BY
            scr.reject_id,
            scr.bar_id,
            b.name,
            b.neighborhood,
            scr.description,
            scr.days_of_week,
            scr.start_time,
            scr.end_time,
            scr.all_day,
            scr.is_recurring,
            scr.date,
            scr.fetch_method,
            scr.source
        ORDER BY
            neighborhood ASC,
            b.name ASC,
            scr.reject_id DESC
        """
    )
    rows = cursor.fetchall()

    cursor.execute(
        """
        SELECT
            scrj.reject_id,
            sc.special_candidate_id,
            sc.description,
            sc.days_of_week,
            sc.type,
            sc.start_time,
            sc.end_time,
            sc.all_day,
            sc.is_recurring,
            sc.date,
            sc.fetch_method,
            sc.source,
            sc.approval_status,
            sc.insert_date
        FROM special_candidate_reject_join scrj
        JOIN special_candidate sc ON sc.special_candidate_id = scrj.special_candidate_id
        ORDER BY sc.insert_date DESC, sc.special_candidate_id DESC
        """
    )
    linked_rows = cursor.fetchall()
    linked_by_reject_id = {}
    for linked_row in linked_rows:
        reject_id = linked_row.get('reject_id')
        if not reject_id:
            continue
        linked_by_reject_id.setdefault(reject_id, []).append(
            {
                'special_candidate_id': linked_row.get('special_candidate_id'),
                'description': linked_row.get('description'),
                'days_of_week': _parse_days_of_week(linked_row.get('days_of_week')),
                'type': linked_row.get('type'),
                'start_time': _normalize_time_value(linked_row.get('start_time')) or None,
                'end_time': _normalize_time_value(linked_row.get('end_time')) or None,
                'all_day': linked_row.get('all_day'),
                'is_recurring': linked_row.get('is_recurring'),
                'date': linked_row.get('date').isoformat() if hasattr(linked_row.get('date'), 'isoformat') and linked_row.get('date') else linked_row.get('date'),
                'fetch_method': linked_row.get('fetch_method'),
                'source': linked_row.get('source'),
                'approval_status': linked_row.get('approval_status'),
                'insert_date': linked_row.get('insert_date').isoformat() if linked_row.get('insert_date') else None,
            }
        )

    specials = []
    for row in rows:
        reject_id = row.get('reject_id')
        specials.append(
            {
                'reject_id': reject_id,
                'special_candidate_id': row.get('latest_special_candidate_id'),
                'bar_id': row.get('bar_id'),
                'bar_name': row.get('bar_name'),
                'neighborhood': row.get('neighborhood'),
                'description': row.get('description'),
                'days_of_week': _parse_days_of_week(row.get('days_of_week')),
                'type': row.get('type'),
                'start_time': _normalize_time_value(row.get('start_time')) or None,
                'end_time': _normalize_time_value(row.get('end_time')) or None,
                'all_day': row.get('all_day'),
                'is_recurring': row.get('is_recurring'),
                'date': row.get('date').isoformat() if hasattr(row.get('date'), 'isoformat') and row.get('date') else row.get('date'),
                'fetch_method': row.get('fetch_method'),
                'source': row.get('source'),
                'insert_date': row.get('last_seen_candidate_insert_date').isoformat() if row.get('last_seen_candidate_insert_date') else None,
                'candidate_matches': int(row.get('candidate_matches') or 0),
                'linked_candidate_count': int(row.get('linked_candidate_count') or 0),
                'linked_candidates': linked_by_reject_id.get(reject_id, []),
            }
        )
    return {'specials': specials, 'special_count': len(specials)}


def remove_rejected_special_candidate(cursor, special_candidate_id: int):
    cursor.execute(
        """
        SELECT reject_id
        FROM special_candidate_reject_join
        WHERE special_candidate_id = %s
        """,
        (special_candidate_id,),
    )
    reject_ids = [row.get('reject_id') for row in cursor.fetchall() if row.get('reject_id')]

    cursor.execute(
        """
        DELETE FROM special_candidate_reject_join
        WHERE special_candidate_id = %s
        """,
        (special_candidate_id,),
    )
    deleted_join_rows = cursor.rowcount

    deleted_reject_rows = 0
    if reject_ids:
        placeholders = ', '.join(['%s'] * len(reject_ids))
        cursor.execute(
            f"""
            DELETE FROM special_candidate_reject
            WHERE reject_id IN ({placeholders})
              AND reject_id NOT IN (
                    SELECT reject_id
                    FROM special_candidate_reject_join
                )
            """,
            tuple(reject_ids),
        )
        deleted_reject_rows = cursor.rowcount

    return {
        'special_candidate_id': special_candidate_id,
        'deleted_join_rows': deleted_join_rows,
        'deleted_reject_rows': deleted_reject_rows,
    }


def delete_special_candidate_run(cursor, run_id: int):
    cursor.execute(
        """
        DELETE FROM special_candidate
        WHERE run_id = %s
        """,
        (run_id,),
    )
    deleted_special_candidates = cursor.rowcount

    cursor.execute(
        """
        DELETE FROM special_candidate_run
        WHERE run_id = %s
        """,
        (run_id,),
    )
    deleted_runs = cursor.rowcount

    return {
        'run_id': run_id,
        'deleted_special_candidates': deleted_special_candidates,
        'deleted_runs': deleted_runs,
    }


def update_special_candidate_approval(cursor, special_candidate_id: int, approval_status: str):
    normalized_status = str(approval_status or '').strip().upper()
    if normalized_status not in {'APPROVED', 'REJECTED'}:
        raise ValueError('approval_status must be APPROVED or REJECTED')

    cursor.execute(
        """
        SELECT
            special_candidate_id,
            run_id,
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

    if normalized_status == 'REJECTED':
        cursor.execute(
            """
            INSERT INTO special_candidate_reject
            (
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
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                bar_id,
                target.get('description'),
                target.get('days_of_week'),
                target.get('start_time'),
                target.get('end_time'),
                target.get('all_day'),
                target.get('is_recurring'),
                target.get('date'),
                target.get('fetch_method'),
                target.get('source'),
            ),
        )
        reject_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO special_candidate_reject_join (reject_id, special_candidate_id)
            VALUES (%s, %s)
            """,
            (reject_id, special_candidate_id),
        )

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
            s.bar_id,
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
                'bar_id': row.get('bar_id'),
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


def get_all_bars(cursor):
    cursor.execute(
        """
        SELECT
            bar_id,
            name,
            neighborhood,
            website_url,
            is_active,
            last_special_candidate_run,
            insert_date,
            update_date
        FROM bar
        ORDER BY neighborhood ASC, name ASC, bar_id ASC
        """
    )
    rows = cursor.fetchall()
    bars = []
    for row in rows:
        bars.append(
            {
                'bar_id': row.get('bar_id'),
                'name': row.get('name'),
                'neighborhood': row.get('neighborhood'),
                'website_url': (row.get('website_url') or '').strip() or None,
                'is_active': row.get('is_active'),
                'last_special_candidate_run': row.get('last_special_candidate_run').isoformat() if row.get('last_special_candidate_run') else None,
                'insert_date': row.get('insert_date').isoformat() if row.get('insert_date') else None,
                'update_date': row.get('update_date').isoformat() if row.get('update_date') else None,
            }
        )
    return {'bars': bars, 'bar_count': len(bars)}


def get_bar_details(cursor, bar_id: int):
    cursor.execute(
        """
        SELECT
            bar_id,
            name,
            neighborhood,
            address,
            website_url AS website,
            google_place_id,
            latitude,
            longitude,
            is_active,
            last_special_candidate_run,
            insert_date,
            update_date
        FROM bar
        WHERE bar_id = %s
        """,
        (bar_id,),
    )
    bar_row = cursor.fetchone()
    if not bar_row:
        raise ValueError('bar_id was not found')

    cursor.execute(
        """
        SELECT
            day_of_week,
            open_time,
            close_time,
            is_closed,
            insert_date,
            update_date
        FROM open_hours
        WHERE bar_id = %s
        ORDER BY FIELD(day_of_week, 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')
        """,
        (bar_id,),
    )
    open_hours_rows = cursor.fetchall()

    return {
        'bar': {
            'bar_id': bar_row.get('bar_id'),
            'name': bar_row.get('name'),
            'neighborhood': bar_row.get('neighborhood'),
            'address': bar_row.get('address'),
            'website': bar_row.get('website'),
            'google_place_id': bar_row.get('google_place_id'),
            'latitude': _to_json_safe_number(bar_row.get('latitude')),
            'longitude': _to_json_safe_number(bar_row.get('longitude')),
            'is_active': bar_row.get('is_active'),
            'last_special_candidate_run': bar_row.get('last_special_candidate_run').isoformat() if bar_row.get('last_special_candidate_run') else None,
            'insert_date': bar_row.get('insert_date').isoformat() if bar_row.get('insert_date') else None,
            'update_date': bar_row.get('update_date').isoformat() if bar_row.get('update_date') else None,
        },
        'open_hours': [
            {
                'day_of_week': row.get('day_of_week'),
                'open_time': _normalize_time_value(row.get('open_time')) or None,
                'close_time': _normalize_time_value(row.get('close_time')) or None,
                'is_closed': row.get('is_closed'),
                'insert_date': row.get('insert_date').isoformat() if row.get('insert_date') else None,
                'update_date': row.get('update_date').isoformat() if row.get('update_date') else None,
            }
            for row in open_hours_rows
        ],
    }


def update_bar(cursor, event):
    bar_id = event.get('bar_id')
    if not bar_id:
        raise ValueError('bar_id is required for update_bar')

    editable_fields = {
        'name': 'name',
        'neighborhood': 'neighborhood',
        'address': 'address',
        'website': 'website_url',
        'website_url': 'website_url',
        'google_place_id': 'google_place_id',
        'latitude': 'latitude',
        'longitude': 'longitude',
        'is_active': 'is_active',
    }
    updates = {}
    for event_field, column_name in editable_fields.items():
        if event_field in event:
            updates[column_name] = event.get(event_field)

    if not updates:
        raise ValueError('At least one editable field must be provided for update_bar')

    if 'is_active' in updates:
        updates['is_active'] = _normalize_yn_flag(updates['is_active'])

    set_clause = ', '.join([f"{key} = %s" for key in updates])
    values = list(updates.values()) + [bar_id]
    cursor.execute(
        f"""
        UPDATE bar
        SET {set_clause},
            update_date = NOW()
        WHERE bar_id = %s
        """,
        values,
    )
    if cursor.rowcount == 0:
        raise ValueError('bar_id was not found')

    return get_bar_details(cursor, bar_id)


def update_open_hours(cursor, event):
    bar_id = event.get('bar_id')
    rows = event.get('open_hours_rows')
    if not bar_id:
        raise ValueError('bar_id is required for update_open_hours')
    if not isinstance(rows, list) or not rows:
        raise ValueError('open_hours_rows must be a non-empty list for update_open_hours')

    for row in rows:
        if not isinstance(row, dict):
            continue
        day_of_week = _normalize_day_of_week(row.get('day_of_week'))
        if not day_of_week:
            continue

        open_time = _normalize_time_value(row.get('open_time')) or None
        close_time = _normalize_time_value(row.get('close_time')) or None
        is_closed = _normalize_yn_flag(row.get('is_closed'))

        cursor.execute(
            """
            UPDATE open_hours
            SET open_time = %s,
                close_time = %s,
                is_closed = %s,
                update_date = NOW()
            WHERE bar_id = %s
                AND day_of_week = %s
            """,
            (open_time, close_time, is_closed, bar_id, day_of_week),
        )

        if cursor.rowcount == 0:
            cursor.execute(
                """
                INSERT INTO open_hours (bar_id, day_of_week, open_time, close_time, is_closed)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (bar_id, day_of_week, open_time, close_time, is_closed),
            )

    return get_bar_details(cursor, bar_id)


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
    if 'start_time' in updates:
        updates['start_time'] = _normalize_time_value(updates.get('start_time')) or None
    if 'end_time' in updates:
        updates['end_time'] = _normalize_time_value(updates.get('end_time')) or None

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


def insert_special(cursor, event):
    bar_id = event.get('bar_id')
    if not bar_id:
        raise ValueError('bar_id is required for insert_special')

    description = str(event.get('description') or '').strip()
    if not description:
        raise ValueError('description is required for insert_special')

    special_type = str(event.get('type') or '').strip().lower()
    if special_type not in {'food', 'drink', 'combo'}:
        raise ValueError('type must be one of: food, drink, combo')

    days_of_week = _normalize_days_input(event.get('days_of_week'))
    if not days_of_week:
        raise ValueError('days_of_week is required for insert_special')

    all_day = _normalize_yn_flag(event.get('all_day') or 'Y')
    if all_day not in {'Y', 'N'}:
        raise ValueError('all_day must be Y or N')

    start_time = _normalize_time_value(event.get('start_time')) or None
    end_time = _normalize_time_value(event.get('end_time')) or None

    inserted_special_ids = []
    for day_of_week in days_of_week:
        cursor.execute(
            """
            INSERT INTO special
            (bar_id, day_of_week, all_day, start_time, end_time, description, type, insert_method, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'MANUAL', 'Y')
            """,
            (bar_id, day_of_week, all_day, start_time, end_time, description, special_type),
        )
        inserted_special_ids.append(cursor.lastrowid)

    return {
        'special_ids': inserted_special_ids,
        'inserted_count': len(inserted_special_ids),
        'insert_method': 'MANUAL',
    }


def delete_special(cursor, event):
    special_id = event.get('special_id')
    if not special_id:
        raise ValueError('special_id is required for delete_special')

    cursor.execute(
        """
        UPDATE special_candidate
        SET approved_special_id = NULL
        WHERE approved_special_id = %s
        """,
        (special_id,),
    )

    cursor.execute(
        """
        DELETE FROM device_special_favorite
        WHERE special_id = %s
        """,
        (special_id,),
    )

    cursor.execute(
        """
        DELETE FROM special
        WHERE special_id = %s
        """,
        (special_id,),
    )
    if cursor.rowcount == 0:
        raise ValueError('special_id was not found')

    return {'special_id': special_id, 'deleted': True}


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
    if mode not in {
        'get_unapproved_special_candidates',
        'get_not_approved_special_candidate_summary',
        'get_rejected_special_candidates',
        'detect_duplicate_websites',
        'detect_duplicate_specials',
        'remove_rejected_special_candidate',
        'delete_special_candidate_run',
        'update_special_candidate_approval',
        'get_all_specials',
        'update_special',
        'delete_special',
        'insert_special',
        'update_special_candidate',
        'get_all_bars',
        'get_bar_details',
        'update_bar',
        'update_open_hours',
    }:
        return {
            'statusCode': 400,
            'body': json.dumps(
                {
                    'error': (
                        'mode must be one of get_unapproved_special_candidates, '
                        'get_not_approved_special_candidate_summary, '
                        'get_rejected_special_candidates, '
                        'detect_duplicate_websites, detect_duplicate_specials, '
                        'remove_rejected_special_candidate, '
                        'delete_special_candidate_run, '
                        'update_special_candidate_approval, get_all_specials, update_special, delete_special, insert_special, '
                        'update_special_candidate, get_all_bars, get_bar_details, update_bar, update_open_hours'
                    )
                }
            ),
        }

    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if mode == 'get_unapproved_special_candidates':
                result = get_unapproved_special_candidates(cursor)
            elif mode == 'get_not_approved_special_candidate_summary':
                result = get_not_approved_special_candidate_summary(cursor)
            elif mode == 'get_rejected_special_candidates':
                result = get_rejected_special_candidates(cursor)
            elif mode == 'detect_duplicate_websites':
                result = detect_duplicate_active_websites(cursor)
            elif mode == 'detect_duplicate_specials':
                bar_id = event.get('bar_id')
                parsed_bar_id = int(bar_id) if bar_id not in {None, ''} else None
                result = detect_duplicate_specials(cursor, parsed_bar_id)
            elif mode == 'update_special_candidate_approval':
                special_candidate_id = event.get('special_candidate_id')
                approval_status = event.get('approval_status')
                if not special_candidate_id:
                    raise ValueError('special_candidate_id is required for update_special_candidate_approval')
                result = update_special_candidate_approval(cursor, special_candidate_id, approval_status)
            elif mode == 'remove_rejected_special_candidate':
                special_candidate_id = event.get('special_candidate_id')
                if not special_candidate_id:
                    raise ValueError('special_candidate_id is required for remove_rejected_special_candidate')
                result = remove_rejected_special_candidate(cursor, special_candidate_id)
            elif mode == 'delete_special_candidate_run':
                run_id = event.get('run_id')
                if not run_id:
                    raise ValueError('run_id is required for delete_special_candidate_run')
                result = delete_special_candidate_run(cursor, int(run_id))
            elif mode == 'get_all_specials':
                result = get_all_specials(cursor)
            elif mode == 'get_all_bars':
                result = get_all_bars(cursor)
            elif mode == 'get_bar_details':
                bar_id = event.get('bar_id')
                if not bar_id:
                    raise ValueError('bar_id is required for get_bar_details')
                result = get_bar_details(cursor, bar_id)
            elif mode == 'update_bar':
                result = update_bar(cursor, event)
            elif mode == 'update_open_hours':
                result = update_open_hours(cursor, event)
            elif mode == 'update_special_candidate':
                result = update_special_candidate(cursor, event)
            elif mode == 'delete_special':
                result = delete_special(cursor, event)
            elif mode == 'insert_special':
                result = insert_special(cursor, event)
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
