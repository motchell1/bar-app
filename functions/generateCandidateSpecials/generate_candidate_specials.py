import json
import logging
import os
import re
import time
from datetime import date, datetime, timedelta
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import boto3
import requests

OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4.1-mini')
OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
DB_BAR_SYNC_LAMBDA_NAME = os.environ.get('DB_BAR_SYNC_LAMBDA_NAME')
MAX_LINKS_TO_VISIT = 3
MAX_TEXT_CHARS_PER_PAGE = 20000
KEYWORD_MATCH_CHAR_WINDOW_SIZE = int(os.environ.get('KEYWORD_MATCH_CHAR_WINDOW_SIZE', '220'))
HTML_CONTENT_HINTS = ('text/html', 'application/xhtml+xml')
NON_HTML_EXTENSIONS = ('.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.zip', '.mp4', '.mp3')

KEYWORDS = ('special', 'happy', 'menu', 'event')
SPECIALS_VOCAB = (
    'happy hour', 'special', 'specials', 'deal', 'deals', 'promo', 'promotion', 'daily', 'weekdays',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'draft', 'beer', 'wine', 'cocktail', 'half off',
    'wings', 'apps', 'burger night', 'taco tuesday'
)
KEYWORD_WINDOW_TERMS = tuple(dict.fromkeys(KEYWORDS + SPECIALS_VOCAB))
DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
WEB_SCRAPE_FALLBACK_THRESHOLD = float(os.environ.get('WEB_SCRAPE_FALLBACK_THRESHOLD', '0.75'))
FOOD_DRINK_CLUES = (
    'food', 'drink', 'beer', 'wine', 'cocktail', 'draft', 'shot', 'margarita',
    'burger', 'wings', 'taco', 'pizza', 'app', 'appetizer', 'fries', 'nachos'
)

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
LAMBDA_CLIENT = boto3.client('lambda')


class LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self._in_anchor = False
        self._current_href = None
        self._anchor_text_parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != 'a':
            return

        href = None
        for key, value in attrs:
            if key.lower() == 'href':
                href = value
                break

        if href:
            self._in_anchor = True
            self._current_href = href.strip()
            self._anchor_text_parts = []

    def handle_data(self, data):
        if self._in_anchor and data:
            self._anchor_text_parts.append(data.strip())

    def handle_endtag(self, tag):
        if tag.lower() != 'a' or not self._in_anchor:
            return

        anchor_text = ' '.join(part for part in self._anchor_text_parts if part).strip()
        self.links.append({'href': self._current_href, 'text': anchor_text})
        self._in_anchor = False
        self._current_href = None
        self._anchor_text_parts = []


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text_parts = []
        self._skip_stack = []

    def handle_starttag(self, tag, attrs):
        tag_lower = tag.lower()
        if tag_lower in ('script', 'style', 'noscript'):
            self._skip_stack.append(tag_lower)
            return

        if tag_lower in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'li', 'p', 'br', 'tr'):
            self.text_parts.append('\n')

        if tag_lower == 'img':
            attrs_map = {key.lower(): (value or '').strip() for key, value in attrs}
            src = attrs_map.get('src', '')
            alt = attrs_map.get('alt', '')
            title = attrs_map.get('title', '')
            image_file = ''
            if src:
                image_file = urlparse(src).path.split('/')[-1]
            clue = f'\n[IMAGE src={src} file={image_file} alt={alt} title={title}]\n'.strip()
            self.text_parts.append(clue)

    def handle_endtag(self, tag):
        if self._skip_stack and self._skip_stack[-1] == tag.lower():
            self._skip_stack.pop()

    def handle_data(self, data):
        if self._skip_stack:
            return

        cleaned = re.sub(r'\s+', ' ', data or '').strip()
        if cleaned:
            self.text_parts.append(cleaned)


def parse_event(event):
    payload = event or {}
    if isinstance(payload, dict) and isinstance(payload.get('body'), str):
        try:
            payload = json.loads(payload['body'])
        except json.JSONDecodeError:
            pass

    if not isinstance(payload, dict):
        raise ValueError('Event payload must be a JSON object')

    bars = payload.get('bars')
    if isinstance(bars, list):
        normalized_bars = []
        for index, bar in enumerate(bars):
            if not isinstance(bar, dict):
                raise ValueError(f'bars[{index}] must be an object')

            bar_id = bar.get('bar_id')
            bar_name = (bar.get('bar_name') or '').strip()
            neighborhood = (bar.get('neighborhood') or '').strip()
            homepage_url = (bar.get('homepage_url') or bar.get('website_url') or '').strip()

            missing = []
            if bar_id in (None, ''):
                missing.append('bar_id')
            if not bar_name:
                missing.append('bar_name')
            if not neighborhood:
                missing.append('neighborhood')
            if not homepage_url:
                missing.append('homepage_url')
            if missing:
                raise ValueError(f"bars[{index}] missing required fields: {', '.join(missing)}")

            normalized_bars.append({
                'bar_id': bar_id,
                'bar_name': bar_name,
                'neighborhood': neighborhood,
                'homepage_url': homepage_url
            })

        if not normalized_bars:
            raise ValueError('bars must include at least one bar')
        return {'mode': 'bars', 'bars': normalized_bars}

    if any(key in payload for key in ('bar_id', 'bar_name', 'homepage_url', 'website_url')):
        bar_id = payload.get('bar_id')
        bar_name = (payload.get('bar_name') or '').strip()
        neighborhood = (payload.get('neighborhood') or '').strip()
        homepage_url = (payload.get('homepage_url') or payload.get('website_url') or '').strip()

        missing = []
        if bar_id in (None, ''):
            missing.append('bar_id')
        if not bar_name:
            missing.append('bar_name')
        if not neighborhood:
            missing.append('neighborhood')
        if not homepage_url:
            missing.append('homepage_url')
        if missing:
            raise ValueError(f"Missing required fields: {', '.join(missing)}")

        return {
            'mode': 'bars',
            'bars': [{
                'bar_id': bar_id,
                'bar_name': bar_name,
                'neighborhood': neighborhood,
                'homepage_url': homepage_url
            }]
        }

    neighborhood = (payload.get('neighborhood') or '').strip()
    if not neighborhood:
        raise ValueError('Missing required fields: neighborhood')

    return {'mode': 'neighborhood', 'neighborhood': neighborhood}


def invoke_db_bar_sync(payload):
    if not DB_BAR_SYNC_LAMBDA_NAME:
        raise RuntimeError('DB_BAR_SYNC_LAMBDA_NAME is required')

    response = LAMBDA_CLIENT.invoke(
        FunctionName=DB_BAR_SYNC_LAMBDA_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps(payload).encode('utf-8')
    )
    raw_payload = response['Payload'].read().decode('utf-8')
    parsed = json.loads(raw_payload) if raw_payload else {}
    status_code = parsed.get('statusCode')
    body = parsed.get('body')
    body_json = json.loads(body) if isinstance(body, str) else (body or {})

    if status_code != 200:
        raise RuntimeError(f"dbBarSync invocation failed payload={payload.get('mode')}: {body_json}")

    return body_json


def fetch_html(url):
    started_at = time.perf_counter()
    LOGGER.info('Fetching URL: %s', url)
    response = requests.get(
        url,
        timeout=10,
        stream=True,
        headers={'User-Agent': 'bar-specials-bot/1.0'}
    )
    response.raise_for_status()

    final_url = response.url or url
    parsed_final = urlparse(final_url)
    if parsed_final.path.lower().endswith(NON_HTML_EXTENSIONS):
        elapsed = time.perf_counter() - started_at
        LOGGER.info('Skipping non-HTML URL in %.2fs: %s', elapsed, final_url)
        response.close()
        return None

    content_type = (response.headers.get('Content-Type') or '').lower()
    if content_type and all(hint not in content_type for hint in HTML_CONTENT_HINTS):
        elapsed = time.perf_counter() - started_at
        LOGGER.info(
            'Skipping response with non-HTML content-type in %.2fs: %s (%s)',
            elapsed,
            final_url,
            content_type
        )
        response.close()
        return None

    response.encoding = response.encoding or response.apparent_encoding
    html = response.text
    response.close()
    elapsed = time.perf_counter() - started_at
    LOGGER.info('Fetched URL in %.2fs: %s', elapsed, url)
    return html


def _normalize_host(host):
    normalized = (host or '').lower().strip()
    if normalized.startswith('www.'):
        normalized = normalized[4:]
    return normalized


def _is_same_site(host, base_host):
    host = _normalize_host(host)
    base_host = _normalize_host(base_host)
    return host == base_host or host.endswith(f'.{base_host}')


def _is_http_url(value):
    parsed = urlparse(str(value or '').strip())
    return parsed.scheme in ('http', 'https') and bool(parsed.netloc)


def extract_links(homepage_url, html):
    parser = LinkExtractor()
    parser.feed(html)

    homepage_domain = urlparse(homepage_url).netloc
    deduped = {}

    for link in parser.links:
        href = (link.get('href') or '').strip()
        if not href or href.startswith(('mailto:', 'tel:', '#', 'javascript:')):
            continue

        absolute_url = urljoin(homepage_url, href)
        parsed = urlparse(absolute_url)
        if parsed.scheme not in ('http', 'https'):
            continue

        if not _is_same_site(parsed.netloc, homepage_domain):
            continue

        normalized = parsed._replace(fragment='').geturl()
        deduped[normalized] = {'url': normalized, 'text': unescape(link.get('text') or '')}

    return list(deduped.values())


def choose_candidate_links(links):
    scored = []
    for link in links:
        if not isinstance(link, dict):
            continue

        url_blob = f"{link.get('url', '')}".lower()
        text_blob = f"{link.get('text', '')}".lower()
        blob = f'{url_blob} {text_blob}'
        hits = sum(1 for keyword in KEYWORDS if keyword in blob)
        if hits == 0:
            continue

        keyword_in_text_boost = sum(1 for keyword in KEYWORDS if keyword in text_blob)
        scored.append((hits, keyword_in_text_boost, -len(link.get('url', '')), link))

    scored.sort(key=lambda row: (row[0], row[1], row[2]), reverse=True)
    return [item[3].get('url') for item in scored if item[3].get('url')]


def extract_text(html):
    parser = TextExtractor()
    parser.feed(html)
    text = ''.join(parser.text_parts)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text[:MAX_TEXT_CHARS_PER_PAGE]


def _extract_keyword_windows(text):
    page_text = (text or '')
    lowered = page_text.lower()
    if not lowered:
        return []

    intervals = []
    for term in KEYWORD_WINDOW_TERMS:
        start = 0
        while True:
            index = lowered.find(term, start)
            if index == -1:
                break
            interval_start = max(0, index - KEYWORD_MATCH_CHAR_WINDOW_SIZE)
            interval_end = min(len(page_text), index + len(term) + KEYWORD_MATCH_CHAR_WINDOW_SIZE)
            intervals.append((interval_start, interval_end))
            start = index + len(term)

    if not intervals:
        return []

    intervals.sort()
    merged = [intervals[0]]
    for start, end in intervals[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    snippets = [page_text[start:end].strip() for start, end in merged if page_text[start:end].strip()]
    return snippets


def _get_keyword_hit_stats(text):
    lowered = (text or '').lower()
    if not lowered:
        return {'total_hits': 0, 'terms': {}}

    terms = {}
    total_hits = 0
    for term in KEYWORD_WINDOW_TERMS:
        count = lowered.count(term)
        if count > 0:
            terms[term] = count
            total_hits += count

    return {'total_hits': total_hits, 'terms': terms}


def build_crawl_prompt(bar_name, neighborhood, homepage_url, page_payloads):
    pages_blob = []
    for page in page_payloads:
        hit_stats = _get_keyword_hit_stats(page['text'])
        keyword_windows = _extract_keyword_windows(page['text'])
        if not keyword_windows:
            LOGGER.info(
                'Link %s contributes 0 merged keyword windows (keyword_hits=%d, matched_terms=%s)',
                page['url'],
                hit_stats['total_hits'],
                list(hit_stats['terms'].keys())
            )
            continue

        window_char_counts = [len(window) for window in keyword_windows]
        LOGGER.info(
            (
                'Link %s contributes %d merged keyword windows '
                '(window_char_counts=%s, keyword_hits=%d, matched_terms=%s, char_window_size=%d)'
            ),
            page['url'],
            len(keyword_windows),
            window_char_counts,
            hit_stats['total_hits'],
            list(hit_stats['terms'].keys()),
            KEYWORD_MATCH_CHAR_WINDOW_SIZE
        )

        focused_text = '\n...\n'.join(keyword_windows)
        pages_blob.append(f"URL: {page['url']}\nTEXT:\n{focused_text}")

    if not pages_blob:
        return None

    content = '\n\n'.join(pages_blob)

    return f"""
You are extracting candidate bar specials.

Bar: {bar_name}
Neighborhood: {neighborhood}
Homepage: {homepage_url}

Use ONLY the provided page text. Do not infer beyond it.

STRICT RULES:
- Do NOT include regular menu items
- Do NOT include general business hours
- Do NOT guess or invent information
- If information is missing, leave it null
- If no specials are present, return an empty array []
- If an item does not clearly mention food or drink, exclude it.
- Confidence scoring should be determined based on inclusion of the following elements and only set as 1 if all three elements are included:
  - Price or discount type
  - Food or drink item
  - Clear determination of day/time/recurrance for each item

Extraction strategy (important):
- Prioritize sections/headings that contain words like: specials, weekly specials, happy hour, deals, promotions.
- When a section defines a shared schedule (example: "Happy Hour Monday-Friday 4pm-6pm"), apply that schedule to each offer listed under it unless an item overrides it.
- Split grouped offers into separate specials. If a line contains multiple offers separated by dashes, bullets, semicolons, or conjunctions, output one JSON object per offer.
- Keep explicit promotional items even when the same page also contains menu and general hours text.
- Do not discard a valid special just because it appears near menu content.
- Use layout clues embedded in text (section separators, heading-like boundaries, and image clues such as `[IMAGE ... file=tuesday.png alt=Tuesday ...]`) to infer when offers belong to different day/column groupings. 
- Treat weekday signals in nearby image metadata (e.g. `file=tuesday.png`, `alt=Tuesday`) as strong local day context for the nearest offers directly below/adjacent to that image.
- Do NOT force one shared day/time across all offers if image/section clues indicate separate groups (for example Tuesday-only section vs Happy Hour section).
- If day/time attribution is ambiguous after using all clues, keep fields null/empty as needed and assign lower confidence (generally 0.15-0.45).

For each special, return:
- description (string; omit labels such as "happy hour" / "HH" and keep only the actual offer details)
- type ("food", "drink", "both", or "unknown")
- days_of_week (array of MON, TUE, WED, THU, FRI, SAT, SUN)
- start_time (HH:MM 24-hour or null)
- end_time (HH:MM 24-hour or null)
- all_day ("Y" or "N")
- confidence (0.0–1.0)
- notes (short explanation of confidence score)
- source_url (required: exact page URL where this special was found; must be one of the provided crawl URLs)

Normalization rules:
- Convert times like "5–7pm" → "17:00" to "19:00"
- "Late night" without a time → leave time null
- "Daily" → all 7 days
- "Weekdays" → MON–FRI
- If no time is given → all_day = "Y"
- Classify type:
  - drinks/alcohol → "drink"
  - food/appetizers → "food"
  - food and drink → "both"
- Confidence should be determined based on inclusion of the following elements:
  - Price or discount type
  - Food or drink item
  - Clear determination of day/time/recurrance for each item

Return ONLY valid JSON (an array). No explanations.

PAGE CONTENT:
{content}
""".strip()


def build_search_prompt(bar_name, neighborhood):
    return f"""
Search for bar specials, happy hour deals, or recurring promotions for {bar_name} {neighborhood}

STRICT RULES:
- Do NOT include regular menu items
- Do NOT include general business hours
- Do NOT guess or invent information
- If information is missing, leave it null
- If no specials are present, return an empty array []

For each special, return:
- description (string; omit labels such as "happy hour" / "HH" and keep only the actual offer details)
- type ("food", "drink",  or "unknown")
- days_of_week (array of MON, TUE, WED, THU, FRI, SAT, SUN)
- start_time (HH:MM 24-hour or null)
- end_time (HH:MM 24-hour or null)
- all_day ("Y" or "N")
- confidence (0.0–1.0)
- notes (short explanation of how it was interpreted)
- source_url (required: exact source URL used by web_search for this item)

Normalization rules:
- Convert times like "5–7pm" → "17:00" to "19:00"
- "Late night" without a time → leave time null
- "Daily" → all 7 days
- "Weekdays" → MON–FRI
- If no time is given → all_day = "Y"
- Classify type:
  - drinks/alcohol → "drink"
  - food/appetizers → "food"
- Validate that each source URL actually supports the special claim; reduce confidence if source evidence is weak, indirect, or ambiguous.
- Set confidence based on evidence strength and source quality. Suggested rubric:
  - 1.00: Special has price or discount type, food or drink item, and clear determination of day/time/recurrance defined for each item corroborated by at least two independent reliable sources with recent updates.
  - 0.85-0.99: Special has price or discount type, food or drink item, and clear determination of day/time/recurrance defined for each item corroborated by only one reliable source with recent updates.
  - 0.70-0.84: Slight ambiguity of one of: (price or discount type, food or drink item, or day/time/recurrance) or source is questionable
  - 0.40-0.69: Ambiguity of two of: (price or discount type, food or drink item, or day/time/recurrance)
  - 0.10-0.39: stale or weak evidence (old posts, indirect mentions, third-party reposts without confirmation).

Only include items when a concrete source URL is available. Only include items that are an actual discount - don't just include events without a food or drink discount.
Return ONLY valid JSON. No explanations.
""".strip()


def call_openai(payload):
    if not OPENAI_API_KEY:
        raise RuntimeError('OPENAI_API_KEY is required')

    headers = {
        'Authorization': f'Bearer {OPENAI_API_KEY}',
        'Content-Type': 'application/json'
    }

    started_at = time.perf_counter()
    input_chars = len(payload.get('input', '') or '')
    LOGGER.info(
        'Calling OpenAI Responses API model=%s tools=%s prompt_chars=%d',
        payload.get('model'),
        payload.get('tools', []),
        input_chars
    )
    response = requests.post(OPENAI_RESPONSES_URL, headers=headers, json=payload, timeout=45)
    response.raise_for_status()
    elapsed = time.perf_counter() - started_at
    LOGGER.info('OpenAI Responses API call completed in %.2fs', elapsed)
    return response.json()


def extract_output_text(response_json):
    if isinstance(response_json.get('output_text'), str) and response_json['output_text'].strip():
        return response_json['output_text'].strip()

    output = response_json.get('output', [])
    text_chunks = []
    for item in output:
        for content in item.get('content', []):
            if content.get('type') == 'output_text' and content.get('text'):
                text_chunks.append(content['text'])

    return '\n'.join(text_chunks).strip()


def parse_json_array(text):
    if not text:
        return []

    raw = text.strip()
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        pass

    match = re.search(r'\[[\s\S]*\]', raw)
    if not match:
        return []

    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def _parse_date_from_text(text):
    value = (text or '').strip()
    if not value:
        return None

    today = date.today()

    if re.search(r'\btoday\b', value, flags=re.IGNORECASE):
        return today
    if re.search(r'\btomorrow\b', value, flags=re.IGNORECASE):
        return today + timedelta(days=1)

    iso_match = re.search(r'\b(20\d{2})-(\d{2})-(\d{2})\b', value)
    if iso_match:
        try:
            return date(int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3)))
        except ValueError:
            return None

    slash_match = re.search(r'\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b', value)
    if slash_match:
        month = int(slash_match.group(1))
        day_val = int(slash_match.group(2))
        year_val = slash_match.group(3)
        if not year_val:
            year = today.year
        else:
            year = int(year_val)
            if year < 100:
                year += 2000
        try:
            parsed = date(year, month, day_val)
            if not year_val and parsed < today:
                parsed = date(today.year + 1, month, day_val)
            return parsed
        except ValueError:
            return None

    month_match = re.search(
        r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?\b',
        value,
        flags=re.IGNORECASE
    )
    if month_match:
        month_name = month_match.group(1)
        day_val = int(month_match.group(2))
        year_val = month_match.group(3)
        month_num = datetime.strptime(month_name[:3], '%b').month
        year = int(year_val) if year_val else today.year
        try:
            parsed = date(year, month_num, day_val)
            if not year_val and parsed < today:
                parsed = date(today.year + 1, month_num, day_val)
            return parsed
        except ValueError:
            return None

    return None


def normalize_item(item, default_source):
    if not isinstance(item, dict):
        return None

    days = item.get('days_of_week')
    if not isinstance(days, list):
        days = []

    normalized_days = [day for day in days if day in DAY_KEYS]
    item_type = item.get('type') if item.get('type') in ('food', 'drink', 'unknown') else 'unknown'
    text_blob = f"{item.get('description') or ''} {item.get('notes') or ''}"
    parsed_date = _parse_date_from_text(text_blob)
    if parsed_date and parsed_date < date.today():
        return None
    is_recurring = 'N' if parsed_date else 'Y'

    return {
        'description': str(item.get('description') or '').strip(),
        'type': item_type,
        'days_of_week': normalized_days,
        'start_time': item.get('start_time') if item.get('start_time') else None,
        'end_time': item.get('end_time') if item.get('end_time') else None,
        'all_day': 'Y' if item.get('all_day') == 'Y' else 'N',
        'confidence': float(item.get('confidence')) if isinstance(item.get('confidence'), (int, float)) else 0.0,
        'notes': str(item.get('notes') or '').strip(),
        'source_url': str(item.get('source_url') or item.get('source') or default_source).strip(),
        'fetch_method': '',
        'is_recurring': is_recurring,
        'date': parsed_date.isoformat() if parsed_date else None
    }


def _contains_time_signal(text):
    blob = (text or '').lower()
    return bool(
        re.search(
            r'\b(\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}\s?-\s?\d{1,2}\s?(am|pm)|\d{1,2}:\d{2})\b',
            blob
        )
    )


def _contains_money_signal(text):
    blob = (text or '').lower()
    if re.search(r'\$\s*\d+(\.\d{1,2})?', blob):
        return True
    if re.search(r'\b\d+(\.\d{1,2})?\s*(usd|dollars?|bucks?)\b', blob):
        return True
    if re.search(r'\b(half off|\d+\s*[%]?\s*off|off)\b', blob):
        return True
    if re.search(r'\bfor\s+\$?\d+(\.\d{1,2})?\b', blob):
        return True
    return False


def _mentions_food_or_drink(item):
    if item.get('type') in ('food', 'drink'):
        return True
    blob = f"{item.get('description', '')} {item.get('notes', '')}".lower()
    return any(term in blob for term in FOOD_DRINK_CLUES)


def _apply_crawl_quality_rules(items):
    filtered = []
    for item in items:
        if not _mentions_food_or_drink(item):
            continue

        blob = f"{item.get('description', '')} {item.get('notes', '')}"
        has_time = _contains_time_signal(blob)
        has_money = _contains_money_signal(blob)
        if has_time and has_money:
            item['confidence'] = 1.0
        filtered.append(item)

    return filtered


def _dedupe_preserve_order(values):
    seen = set()
    result = []
    for value in values:
        normalized = (value or '').strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _group_specials_for_insert(items):
    grouped = {}
    ordered_keys = []

    for item in items:
        if not isinstance(item, dict):
            continue

        days = tuple(sorted(day for day in (item.get('days_of_week') or []) if day in DAY_KEYS))
        key = (
            days,
            item.get('start_time') or None,
            item.get('end_time') or None,
            'Y' if item.get('all_day') == 'Y' else 'N',
            item.get('type') or 'unknown',
            item.get('is_recurring') or 'Y',
            item.get('date') or None,
        )

        if key not in grouped:
            grouped[key] = {
                **item,
                'days_of_week': list(days),
                '_descriptions': _dedupe_preserve_order([item.get('description')]),
                '_notes': _dedupe_preserve_order([item.get('notes')]),
            }
            ordered_keys.append(key)
            continue

        target = grouped[key]
        target['_descriptions'] = _dedupe_preserve_order(target['_descriptions'] + [item.get('description')])
        target['_notes'] = _dedupe_preserve_order(target['_notes'] + [item.get('notes')])
        target['confidence'] = max(
            float(target.get('confidence') or 0.0),
            float(item.get('confidence') or 0.0)
        )

    merged = []
    for key in ordered_keys:
        item = grouped[key]
        item['description'] = '; '.join(item.pop('_descriptions'))
        item['notes'] = ' | '.join(item.pop('_notes'))
        merged.append(item)

    return merged


def generate_from_crawl(homepage_url, bar_name, neighborhood):
    stats = {
        'web_crawl_candidate_links': 0,
        'web_crawl_keyword_matches': 0,
        'web_crawl_prompt_char_count': 0,
        'web_crawl_ai_parse_attempted': 'N',
    }
    started_at = time.perf_counter()
    LOGGER.info(
        'Starting crawl flow bar_name=%s neighborhood=%s homepage_url=%s',
        bar_name,
        neighborhood,
        homepage_url
    )
    try:
        homepage_html = fetch_html(homepage_url)
    except requests.RequestException:
        LOGGER.exception('Failed fetching homepage for crawl; falling back to web_search: %s', homepage_url)
        return [], stats
    except Exception:
        LOGGER.exception('Unexpected homepage crawl error; falling back to web_search: %s', homepage_url)
        return [], stats
    if not homepage_html:
        LOGGER.info('Homepage was non-HTML or empty; returning empty crawl result')
        return [], stats
    links = extract_links(homepage_url, homepage_html)
    LOGGER.info('Extracted %d same-domain links from homepage', len(links))
    top_links = choose_candidate_links(links)
    stats['web_crawl_candidate_links'] = len(top_links)
    candidate_links = [homepage_url] + [url for url in top_links if url != homepage_url]
    LOGGER.info('Selected %d initial candidate links for crawl', len(candidate_links))

    page_payloads = []
    for link in candidate_links:
        if len(page_payloads) >= MAX_LINKS_TO_VISIT:
            break
        candidate_url = link if isinstance(link, str) else None
        if not candidate_url:
            LOGGER.info('Skipping malformed candidate link entry: %s', link)
            continue
        try:
            html = fetch_html(candidate_url)
            if not html:
                LOGGER.info('Skipping non-HTML candidate link: %s', candidate_url)
                continue
            text = extract_text(html)
            if text:
                page_payloads.append({'url': candidate_url, 'text': text})
                LOGGER.info('Captured %d characters from %s', len(text), candidate_url)
            else:
                LOGGER.info('No HTML text captured from %s (likely non-HTML content)', candidate_url)
        except requests.RequestException:
            LOGGER.exception('Failed fetching candidate link: %s', candidate_url)
            continue
        except Exception:
            LOGGER.exception('Unexpected parse error for candidate link: %s', candidate_url)
            continue

    if not page_payloads:
        LOGGER.info('No crawl text payloads available; returning empty list')
        return [], stats

    stats['web_crawl_keyword_matches'] = sum(
        _get_keyword_hit_stats(page.get('text')).get('total_hits', 0)
        for page in page_payloads
    )

    prompt = build_crawl_prompt(bar_name, neighborhood, homepage_url, page_payloads)
    if not prompt:
        LOGGER.info('No keyword-matching crawl page content found; skipping OpenAI crawl call')
        return [], stats
    stats['web_crawl_prompt_char_count'] = len(prompt)
    payload = {
        'model': OPENAI_MODEL,
        'input': prompt,
        'temperature': 0
    }
    stats['web_crawl_ai_parse_attempted'] = 'Y'
    raw_response = call_openai(payload)
    raw_text = extract_output_text(raw_response)
    items = parse_json_array(raw_text)

    normalized = []
    for item in items:
        normalized_item = normalize_item(item, '')
        if normalized_item and normalized_item['description']:
            if not _is_http_url(normalized_item['source_url']):
                normalized_item['source_url'] = homepage_url
            normalized_item['fetch_method'] = 'website_crawl'
            normalized.append(normalized_item)

    normalized = _apply_crawl_quality_rules(normalized)

    elapsed = time.perf_counter() - started_at
    LOGGER.info(
        'Crawl flow completed in %.2fs; produced %d normalized specials',
        elapsed,
        len(normalized)
    )
    return normalized, stats


def generate_from_search(bar_name, neighborhood):
    stats = {
        'web_ai_search_prompt_char_count': 0,
        'web_ai_search_attempted': 'N',
    }
    started_at = time.perf_counter()
    LOGGER.info('Starting direct web_search flow bar_name=%s neighborhood=%s', bar_name, neighborhood)
    prompt = build_search_prompt(bar_name, neighborhood)
    stats['web_ai_search_prompt_char_count'] = len(prompt)
    payload = {
        'model': OPENAI_MODEL,
        'tools': [{'type': 'web_search'}],
        'input': prompt,
        'temperature': 0
    }
    stats['web_ai_search_attempted'] = 'Y'
    raw_response = call_openai(payload)
    raw_text = extract_output_text(raw_response)
    items = parse_json_array(raw_text)

    normalized = []
    for item in items:
        normalized_item = normalize_item(item, 'openai_web_search')
        if normalized_item and normalized_item['description']:
            if not _is_http_url(normalized_item['source_url']):
                LOGGER.info('Skipping web_search item without concrete source URL: %s', normalized_item)
                continue
            normalized_item['fetch_method'] = 'web_ai_search'
            normalized.append(normalized_item)

    elapsed = time.perf_counter() - started_at
    LOGGER.info(
        'Direct web_search flow completed in %.2fs; produced %d normalized specials',
        elapsed,
        len(normalized)
    )
    return normalized, stats


def lambda_handler(event, context):
    started_at = time.perf_counter()
    try:
        LOGGER.info('generate_candidate_specials invocation started')
        parsed_event = parse_event(event)
        response_neighborhood = parsed_event.get('neighborhood')
        total_candidates = []
        processed_bars = 0
        crawl_specials_count = 0
        web_ai_search_specials_count = 0
        auto_approved_count = 0
        inserted_count = 0
        runs_created = 0
        auto_published_runs = 0

        if parsed_event['mode'] == 'bars':
            bars = parsed_event['bars']
            LOGGER.info('Received %d bars directly in event payload', len(bars))
        else:
            neighborhood = parsed_event['neighborhood']
            bars_result = invoke_db_bar_sync({'mode': 'get_bars_by_neighborhood', 'neighborhood': neighborhood})
            bars = bars_result.get('bars', [])
            LOGGER.info('Found %d bars in neighborhood=%s', len(bars), neighborhood)

        for bar in bars:
            run_started_at = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
            homepage_url = (bar.get('homepage_url') or bar.get('website_url') or '').strip()
            bar_name = (bar.get('bar_name') or '').strip()
            bar_neighborhood = (bar.get('neighborhood') or '').strip()
            if not homepage_url or not bar_name:
                LOGGER.info('Skipping bar_name=%s due to missing website or name', bar.get('bar_name'))
                continue

            processed_bars += 1
            try:
                specials, crawl_stats = generate_from_crawl(homepage_url, bar_name, bar_neighborhood)
            except Exception:
                LOGGER.exception(
                    'Crawl flow crashed for bar_name=%s; falling back to OpenAI web_search',
                    bar.get('bar_name')
                )
                specials = []
                crawl_stats = {
                    'web_crawl_candidate_links': 0,
                    'web_crawl_keyword_matches': 0,
                    'web_crawl_prompt_char_count': 0,
                    'web_crawl_ai_parse_attempted': 'N',
                }
            has_fallback_confidence = any(
                isinstance(special.get('confidence'), (int, float))
                and special.get('confidence', 0) >= WEB_SCRAPE_FALLBACK_THRESHOLD
                for special in specials
            )
            if not specials or not has_fallback_confidence:
                LOGGER.info(
                    'No crawl specials met fallback threshold %.2f for bar_name=%s; using OpenAI web_search fallback',
                    WEB_SCRAPE_FALLBACK_THRESHOLD,
                    bar_name
                )
                specials, search_stats = generate_from_search(bar_name, bar_neighborhood)
            else:
                search_stats = {
                    'web_ai_search_prompt_char_count': 0,
                    'web_ai_search_attempted': 'N',
                }
            specials = _group_specials_for_insert(specials)

            bar_candidates = []
            bar_crawl_specials_count = 0
            bar_web_ai_search_specials_count = 0
            for special in specials:
                if special.get('fetch_method') == 'website_crawl':
                    crawl_specials_count += 1
                    bar_crawl_specials_count += 1
                elif special.get('fetch_method') == 'web_ai_search':
                    web_ai_search_specials_count += 1
                    bar_web_ai_search_specials_count += 1
                candidate_payload = {
                    'bar_id': bar['bar_id'],
                    'bar_name': bar_name,
                    'neighborhood': bar_neighborhood,
                    **special
                }
                total_candidates.append(candidate_payload)
                bar_candidates.append(candidate_payload)

            run_payload = {
                'bar_id': bar['bar_id'],
                'total_candidates': len(bar_candidates),
                'web_crawl_candidates': bar_crawl_specials_count,
                'web_ai_search_candidates': bar_web_ai_search_specials_count,
                'web_crawl_candidate_links': crawl_stats.get('web_crawl_candidate_links', 0),
                'web_crawl_keyword_matches': crawl_stats.get('web_crawl_keyword_matches', 0),
                'web_crawl_prompt_char_count': crawl_stats.get('web_crawl_prompt_char_count', 0),
                'web_ai_search_prompt_char_count': search_stats.get('web_ai_search_prompt_char_count', 0),
                'web_crawl_ai_parse_attempted': crawl_stats.get('web_crawl_ai_parse_attempted', 'N'),
                'web_ai_search_attempted': search_stats.get('web_ai_search_attempted', 'N'),
                'started_at': run_started_at,
                'completed_at': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
            }
            insert_result = invoke_db_bar_sync({
                'mode': 'insert_special_candidates',
                'run': run_payload,
                'candidates': bar_candidates
            })
            runs_created += 1
            inserted_count += int(insert_result.get('inserted_count', 0))
            auto_approved_count += int(insert_result.get('auto_approved_count', 0))
            run_id = insert_result.get('run_id')

            if insert_result.get('all_auto_approved') and run_id:
                invoke_db_bar_sync({
                    'mode': 'publish_candidate_specials',
                    'bar_id': bar['bar_id'],
                    'run_id': run_id,
                    'auto_publish': 'Y'
                })
                auto_published_runs += 1

        elapsed = time.perf_counter() - started_at
        LOGGER.info(
            'Invocation complete in %.2fs processed_bars=%d total_candidates=%d inserted=%d',
            elapsed,
            processed_bars,
            len(total_candidates),
            inserted_count
        )
        return {
            'statusCode': 200,
            'body': json.dumps({
                'neighborhood': response_neighborhood,
                'processed_bars': processed_bars,
                'candidate_specials_found': len(total_candidates),
                'candidate_specials_inserted': inserted_count,
                'auto_approved_specials': auto_approved_count,
                'website_crawl_specials': crawl_specials_count,
                'web_ai_search_specials': web_ai_search_specials_count,
                'candidate_runs_created': runs_created,
                'candidate_runs_auto_published': auto_published_runs
            })
        }
    except ValueError as exc:
        LOGGER.exception('Validation error in generate_candidate_specials')
        return {
            'statusCode': 400,
            'body': json.dumps({'error': str(exc)})
        }
    except Exception as exc:
        LOGGER.exception('Unhandled error in generate_candidate_specials')
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(exc)})
        }
