import json
import os
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

import requests

OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4.1-mini')
OPENAI_TIMEOUT_SECONDS = int(os.environ.get('OPENAI_TIMEOUT_SECONDS', '20'))

KEYWORDS = ('special', 'happy', 'menu', 'event')
VALID_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
VALID_TYPES = {'food', 'drink', 'unknown'}


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
    scored: List[tuple] = []
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
    text = re.sub(r'\s+', ' ', text).strip()
    return text


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
    page_blocks = []
    for idx, page in enumerate(pages, start=1):
        page_blocks.append(f"Source {idx} URL: {page['url']}\nSource {idx} TEXT:\n{page['text']}")

    joined_sources = '\n\n'.join(page_blocks)

    return (
        'You extract bar specials from website text. Return only JSON (array). '\
        'Never include regular menu items, full menu listings, or general business hours. '\
        'Never invent missing data. If no specials are present, return [] .\n\n'
        f'Homepage URL: {homepage_url}\n\n'
        f'{joined_sources}\n\n'
        'Output each item with keys: '\
        'description (string), '\
        'type ("food"|"drink"|"unknown"), '\
        'days_of_week (array of MON,TUE,WED,THU,FRI,SAT,SUN), '\
        'start_time (HH:MM 24-hour or null), '\
        'end_time (HH:MM 24-hour or null), '\
        'all_day ("Y"|"N"), '\
        'confidence (0.0-1.0), '\
        'notes (short explanation).\n\n'
        'Normalization rules: '\
        'times like "5-7pm" must be normalized to 24-hour HH:MM; '\
        '"late night" without explicit time => start_time/end_time null; '\
        '"daily" => all 7 days; "weekdays" => MON-FRI; '\
        'if no time is given => all_day="Y" and times null.'
    )


def call_openai_for_specials(prompt: str) -> List[Dict[str, Any]]:
    if not OPENAI_API_KEY:
        raise RuntimeError('OPENAI_API_KEY environment variable is required')

    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        timeout=OPENAI_TIMEOUT_SECONDS,
        headers={
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'Content-Type': 'application/json'
        },
        json={
            'model': OPENAI_MODEL,
            'temperature': 0,
            'messages': [
                {'role': 'system', 'content': 'You are a strict data extraction engine that outputs JSON only.'},
                {'role': 'user', 'content': prompt}
            ]
        }
    )
    response.raise_for_status()
    payload = response.json()

    content = payload['choices'][0]['message']['content']
    if isinstance(content, list):
        content = ''.join(part.get('text', '') for part in content if isinstance(part, dict))

    specials = json.loads(content)
    if not isinstance(specials, list):
        raise ValueError('OpenAI response must be a JSON array')

    return specials


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


def normalize_specials(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        description = item.get('description')
        if not isinstance(description, str) or not description.strip():
            continue

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

        start_time = _normalize_time(item.get('start_time'))
        end_time = _normalize_time(item.get('end_time'))

        all_day_raw = str(item.get('all_day', 'N')).upper()
        all_day = 'Y' if all_day_raw == 'Y' else 'N'
        if start_time is None and end_time is None:
            all_day = 'Y'

        confidence_raw = item.get('confidence', 0.0)
        try:
            confidence = float(confidence_raw)
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))

        notes = item.get('notes')
        notes = notes.strip() if isinstance(notes, str) else ''

        normalized.append({
            'description': description.strip(),
            'type': special_type,
            'days_of_week': days,
            'start_time': start_time,
            'end_time': end_time,
            'all_day': all_day,
            'confidence': confidence,
            'notes': notes
        })

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


def lambda_handler(event, context):
    homepage_url = (event or {}).get('homepage_url')
    if not homepage_url or not isinstance(homepage_url, str):
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'homepage_url is required and must be a string'})
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
