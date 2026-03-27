import json
import os
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests

OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4.1-mini')
OPENAI_TIMEOUT_SECONDS = int(os.environ.get('OPENAI_TIMEOUT_SECONDS', '20'))

KEYWORDS = ('special', 'happy', 'menu', 'event')
VALID_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
VALID_TYPES = {'food', 'drink', 'unknown'}
SPECIAL_SCHEMA_KEYS = {
    'description',
    'type',
    'days_of_week',
    'start_time',
    'end_time',
    'all_day',
    'confidence',
    'notes'
}

NON_SPECIAL_PATTERNS = [
    r'\b(open|opening)\s+hours\b',
    r'\bhours\s+of\s+operation\b',
    r'\bmon(day)?\s*[-–]\s*fri(day)?\b.*\b(am|pm)\b',
    r'\bclosed\b',
    r'\bfull\s+menu\b',
    r'\bappetizers?\b.*\$\d',
]

DAY_ALIASES = {
    'MONDAY': 'MON',
    'TUESDAY': 'TUE',
    'WEDNESDAY': 'WED',
    'THURSDAY': 'THU',
    'FRIDAY': 'FRI',
    'SATURDAY': 'SAT',
    'SUNDAY': 'SUN',
    'MON': 'MON',
    'TUE': 'TUE',
    'TUES': 'TUE',
    'WED': 'WED',
    'THU': 'THU',
    'THUR': 'THU',
    'FRI': 'FRI',
    'SAT': 'SAT',
    'SUN': 'SUN',
}


class LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links: List[Dict[str, str]] = []
        self._current_href: Optional[str] = None
        self._text_parts: List[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != 'a':
            return
        href = ''
        for key, value in attrs:
            if key.lower() == 'href':
                href = value or ''
                break
        self._current_href = href.strip()
        self._text_parts = []

    def handle_data(self, data):
        if self._current_href is not None and data:
            self._text_parts.append(data)

    def handle_endtag(self, tag):
        if tag.lower() != 'a' or self._current_href is None:
            return
        self.links.append({
            'href': self._current_href,
            'text': ' '.join(''.join(self._text_parts).split())
        })
        self._current_href = None
        self._text_parts = []


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self.parts: List[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in {'script', 'style', 'noscript'}:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag.lower() in {'script', 'style', 'noscript'} and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth > 0:
            return
        value = ' '.join(data.split())
        if value:
            self.parts.append(value)


def is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {'http', 'https'} and bool(parsed.netloc)


def fetch_html(url: str) -> str:
    response = requests.get(
        url,
        timeout=10,
        headers={
            'User-Agent': 'Mozilla/5.0 (compatible; BarAppSpecialsBot/1.0)'
        }
    )
    response.raise_for_status()
    return response.text


def extract_links(homepage_url: str) -> List[Dict[str, str]]:
    html = fetch_html(homepage_url)
    parser = LinkExtractor()
    parser.feed(html)

    seen = set()
    normalized_links: List[Dict[str, str]] = []
    for entry in parser.links:
        href = entry.get('href', '')
        if not href:
            continue
        absolute = urljoin(homepage_url, href)
        if not is_http_url(absolute):
            continue
        key = absolute.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized_links.append({'url': absolute, 'text': entry.get('text', '')})

    return normalized_links


def select_candidate_links(links: List[Dict[str, str]], max_links: int = 3) -> List[str]:
    scored: List[Tuple[int, str]] = []
    for item in links:
        url = item['url']
        text = item.get('text', '')
        haystack = f"{url} {text}".lower()
        score = sum(1 for keyword in KEYWORDS if keyword in haystack)
        if score > 0:
            scored.append((score, url))

    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    return [url for _, url in scored[:max_links]]


def extract_text(html: str) -> str:
    parser = TextExtractor()
    parser.feed(html)
    text = ' '.join(parser.parts)
    return re.sub(r'\s+', ' ', text).strip()


def collect_page_text(urls: List[str], max_chars_per_page: int = 6000) -> List[Dict[str, str]]:
    pages: List[Dict[str, str]] = []
    for url in urls:
        try:
            html = fetch_html(url)
            text = extract_text(html)
            if text:
                pages.append({'url': url, 'text': text[:max_chars_per_page]})
        except Exception as exc:
            print(f'Failed to fetch candidate page {url}: {exc}')
    return pages


def build_openai_prompt(homepage_url: str, pages: List[Dict[str, str]]) -> str:
    blocks = []
    for idx, page in enumerate(pages, start=1):
        blocks.append(f"Source {idx} URL: {page['url']}\nSource {idx} TEXT:\n{page['text']}")

    joined_sources = '\n\n'.join(blocks)
    return (
        'Extract only candidate specials from the text. Return ONLY a JSON array. '
        'Do not include regular menu items. Do not include general business hours. '
        'Do not invent data. If no specials are present, return [] .\n\n'
        f'Homepage URL: {homepage_url}\n\n'
        f'{joined_sources}\n\n'
        'Each object must contain exactly these keys: description, type, days_of_week, start_time, end_time, all_day, confidence, notes. '
        'type must be food/drink/unknown. all_day must be Y/N. '
        'Normalize time ranges like 5-7pm to 17:00 and 19:00. '
        '"Late night" without explicit time means null times. '
        '"Daily" means MON..SUN. "Weekdays" means MON..FRI. '
        'If no time is explicitly given, set start_time/end_time null and all_day=Y.'
    )


def _extract_json_array(content: str) -> List[Dict[str, Any]]:
    text = (content or '').strip()

    # Handle markdown-wrapped JSON.
    fence_match = re.search(r'```(?:json)?\s*(\[.*\])\s*```', text, flags=re.DOTALL | re.IGNORECASE)
    if fence_match:
        text = fence_match.group(1)

    if not text.startswith('['):
        start = text.find('[')
        end = text.rfind(']')
        if start != -1 and end != -1 and end > start:
            text = text[start:end + 1]

    parsed = json.loads(text)
    if not isinstance(parsed, list):
        raise ValueError('OpenAI response must be a JSON array')
    return parsed


def call_openai_for_specials(prompt: str) -> List[Dict[str, Any]]:
    if not OPENAI_API_KEY:
        raise RuntimeError('OPENAI_API_KEY environment variable is required')

    payload = {
        'model': OPENAI_MODEL,
        'temperature': 0,
        'messages': [
            {'role': 'system', 'content': 'You are a strict extraction engine. Output JSON only.'},
            {'role': 'user', 'content': prompt}
        ],
        'response_format': {
            'type': 'json_schema',
            'json_schema': {
                'name': 'candidate_specials',
                'schema': {
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': [
                            'description',
                            'type',
                            'days_of_week',
                            'start_time',
                            'end_time',
                            'all_day',
                            'confidence',
                            'notes'
                        ],
                        'properties': {
                            'description': {'type': 'string'},
                            'type': {'type': 'string', 'enum': ['food', 'drink', 'unknown']},
                            'days_of_week': {
                                'type': 'array',
                                'items': {'type': 'string', 'enum': VALID_DAYS}
                            },
                            'start_time': {'type': ['string', 'null']},
                            'end_time': {'type': ['string', 'null']},
                            'all_day': {'type': 'string', 'enum': ['Y', 'N']},
                            'confidence': {'type': 'number'},
                            'notes': {'type': 'string'}
                        }
                    }
                }
            }
        }
    }

    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        timeout=OPENAI_TIMEOUT_SECONDS,
        headers={
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'Content-Type': 'application/json'
        },
        json=payload
    )
    response.raise_for_status()
    body = response.json()
    content = body['choices'][0]['message']['content']

    if isinstance(content, list):
        content = ''.join(part.get('text', '') for part in content if isinstance(part, dict))

    return _extract_json_array(content)


def _normalize_time(value: Any) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value:
        return None

    match = re.fullmatch(r'(\d{1,2}):(\d{2})', value)
    if not match:
        return None

    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return f'{hour:02d}:{minute:02d}'


def _to_24h(hour: int, minute: int, meridian: str) -> str:
    meridian = meridian.lower()
    if meridian == 'am':
        hour = 0 if hour == 12 else hour
    else:
        hour = hour if hour == 12 else hour + 12
    return f'{hour:02d}:{minute:02d}'


def _extract_time_range(text: str) -> Tuple[Optional[str], Optional[str]]:
    if not text:
        return None, None

    pattern = re.compile(
        r'\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b',
        flags=re.IGNORECASE,
    )
    match = pattern.search(text)
    if not match:
        return None, None

    start_hour = int(match.group(1))
    start_minute = int(match.group(2) or '00')
    start_meridian = match.group(3)
    end_hour = int(match.group(4))
    end_minute = int(match.group(5) or '00')
    end_meridian = match.group(6) or start_meridian

    if not (1 <= start_hour <= 12 and 1 <= end_hour <= 12):
        return None, None
    if start_minute > 59 or end_minute > 59:
        return None, None

    return _to_24h(start_hour, start_minute, start_meridian), _to_24h(end_hour, end_minute, end_meridian)


def _extract_days(text: str) -> List[str]:
    if not text:
        return []

    lower = text.lower()
    if 'daily' in lower or 'every day' in lower:
        return VALID_DAYS[:]
    if 'weekdays' in lower:
        return ['MON', 'TUE', 'WED', 'THU', 'FRI']

    days: List[str] = []
    for token in re.findall(r'\b[A-Za-z]{3,9}\b', text):
        day = DAY_ALIASES.get(token.upper())
        if day and day not in days:
            days.append(day)
    return days


def _looks_like_non_special(description: str, notes: str) -> bool:
    text = f'{description} {notes}'.lower()
    if 'special' in text or 'happy hour' in text:
        return False
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in NON_SPECIAL_PATTERNS)


def normalize_specials(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []

    for item in items:
        if not isinstance(item, dict):
            continue

        description = item.get('description')
        notes = item.get('notes')
        if not isinstance(description, str) or not description.strip():
            continue
        notes = notes.strip() if isinstance(notes, str) else ''

        raw_type = str(item.get('type', 'unknown')).lower()
        special_type = raw_type if raw_type in VALID_TYPES else 'unknown'

        raw_days = item.get('days_of_week') or []
        days: List[str] = []
        if isinstance(raw_days, list):
            for day in raw_days:
                if isinstance(day, str):
                    day_key = day.strip().upper()
                    if day_key in VALID_DAYS and day_key not in days:
                        days.append(day_key)

        inferred_days = _extract_days(f'{description} {notes}')
        if not days and inferred_days:
            days = inferred_days

        start_time = _normalize_time(item.get('start_time'))
        end_time = _normalize_time(item.get('end_time'))
        if start_time is None and end_time is None:
            inferred_start, inferred_end = _extract_time_range(f'{description} {notes}')
            start_time, end_time = inferred_start, inferred_end

        all_day_raw = str(item.get('all_day', 'N')).upper()
        all_day = 'Y' if all_day_raw == 'Y' else 'N'
        if start_time is None and end_time is None:
            all_day = 'Y'
        else:
            all_day = 'N'

        confidence_raw = item.get('confidence', 0.0)
        try:
            confidence = float(confidence_raw)
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))

        record = {
            'description': description.strip(),
            'type': special_type,
            'days_of_week': days,
            'start_time': start_time,
            'end_time': end_time,
            'all_day': all_day,
            'confidence': confidence,
            'notes': notes
        }

        if set(record.keys()) != SPECIAL_SCHEMA_KEYS:
            continue

        if _looks_like_non_special(record['description'], record['notes']):
            continue

        normalized.append(record)

    return normalized


def generate_candidate_specials(homepage_url: str) -> List[Dict[str, Any]]:
    links = extract_links(homepage_url)
    target_urls = select_candidate_links(links, max_links=3)
    if not target_urls:
        return []

    pages = collect_page_text(target_urls)
    if not pages:
        return []

    prompt = build_openai_prompt(homepage_url, pages)
    raw_specials = call_openai_for_specials(prompt)
    return normalize_specials(raw_specials)


def generateCandidateSpecials(homepage_url: str) -> List[Dict[str, Any]]:
    """CamelCase alias for environments expecting this exact function name."""
    return generate_candidate_specials(homepage_url)


def lambda_handler(event, context):
    payload = event or {}
    homepage_url = payload.get('homepage_url') or payload.get('url')
    if not homepage_url or not isinstance(homepage_url, str):
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'homepage_url (or url) is required and must be a string'})
        }

    try:
        results = generate_candidate_specials(homepage_url.strip())
        return {
            'statusCode': 200,
            'body': json.dumps({'candidate_specials': results})
        }
    except Exception as exc:
        print(f'generateCandidateSpecials failed: {exc}')
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Failed to generate candidate specials'})
        }
