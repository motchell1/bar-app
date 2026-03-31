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
MAX_TEXT_CHARS_PER_PAGE = 12000
HTML_CONTENT_HINTS = ('text/html', 'application/xhtml+xml')
NON_HTML_EXTENSIONS = ('.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.zip', '.mp4', '.mp3')

KEYWORDS = ('special', 'happy', 'menu', 'event')
DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

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
            self.text_parts.append(' | ')

        if tag_lower == 'img':
            attrs_map = {key.lower(): (value or '').strip() for key, value in attrs}
            src = attrs_map.get('src', '')
            alt = attrs_map.get('alt', '')
            title = attrs_map.get('title', '')
            image_file = ''
            if src:
                image_file = urlparse(src).path.split('/')[-1]
            clue = f'[IMAGE src={src} file={image_file} alt={alt} title={title}]'.strip()
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

    neighborhood = payload.get('neighborhood')

    if not neighborhood:
        missing = []
        if not neighborhood:
            missing.append('neighborhood')
        raise ValueError(f'Missing required fields: {", ".join(missing)}')

    return neighborhood.strip()


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
    return [item[3].get('url') for item in scored[:MAX_LINKS_TO_VISIT] if item[3].get('url')]


def extract_text(html):
    parser = TextExtractor()
    parser.feed(html)
    text = ' '.join(parser.text_parts)
    return text[:MAX_TEXT_CHARS_PER_PAGE]


def build_crawl_prompt(bar_name, neighborhood, homepage_url, page_payloads):
    pages_blob = []
    for page in page_payloads:
        pages_blob.append(f"URL: {page['url']}\nTEXT:\n{page['text']}")

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

Extraction strategy (important):
- Prioritize sections/headings that contain words like: specials, weekly specials, happy hour, deals, promotions.
- When a section defines a shared schedule (example: "Happy Hour Monday-Friday 4pm-6pm"), apply that schedule to each offer listed under it unless an item overrides it.
- Split grouped offers into separate specials. If a line contains multiple offers separated by dashes, bullets, semicolons, or conjunctions, output one JSON object per offer.
- Keep explicit promotional items even when the same page also contains menu and general hours text.
- Do not discard a valid special just because it appears near menu content.
- Use layout clues embedded in text (section separators, heading-like boundaries, and image clues such as `[IMAGE ... file=tuesday.png alt=Tuesday ...]`) to infer when offers belong to different day/column groupings.
- Do NOT force one shared day/time across all offers if image/section clues indicate separate groups (for example Tuesday-only section vs Happy Hour section).
- If day/time attribution is ambiguous after using all clues, keep fields null/empty as needed and assign lower confidence (generally 0.15-0.45).

For each special, return:
- description (string)
- type ("food", "drink", or "unknown")
- days_of_week (array of MON, TUE, WED, THU, FRI, SAT, SUN)
- start_time (HH:MM 24-hour or null)
- end_time (HH:MM 24-hour or null)
- all_day ("Y" or "N")
- confidence (0.0–1.0)
- notes (short explanation of how it was interpreted)
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
- description (string)
- type ("food", "drink", or "unknown")
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
- Never set confidence above 0.9 for web_search-derived specials.

Only include items when a concrete source URL is available.
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
    LOGGER.info(
        'Calling OpenAI Responses API model=%s tools=%s',
        payload.get('model'),
        payload.get('tools', [])
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


def generate_from_crawl(homepage_url, bar_name, neighborhood):
    started_at = time.perf_counter()
    LOGGER.info(
        'Starting crawl flow bar_name=%s neighborhood=%s homepage_url=%s',
        bar_name,
        neighborhood,
        homepage_url
    )
    homepage_html = fetch_html(homepage_url)
    if not homepage_html:
        LOGGER.info('Homepage was non-HTML or empty; returning empty crawl result')
        return []
    links = extract_links(homepage_url, homepage_html)
    LOGGER.info('Extracted %d same-domain links from homepage', len(links))
    top_links = choose_candidate_links(links)
    top_links = [homepage_url] + [url for url in top_links if url != homepage_url]
    top_links = top_links[:MAX_LINKS_TO_VISIT]
    LOGGER.info('Selected %d candidate links for crawl', len(top_links))

    page_payloads = []
    for link in top_links:
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
        return []

    prompt = build_crawl_prompt(bar_name, neighborhood, homepage_url, page_payloads)
    payload = {
        'model': OPENAI_MODEL,
        'input': prompt,
        'temperature': 0
    }
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

    elapsed = time.perf_counter() - started_at
    LOGGER.info(
        'Crawl flow completed in %.2fs; produced %d normalized specials',
        elapsed,
        len(normalized)
    )
    return normalized


def generate_from_search(bar_name, neighborhood):
    started_at = time.perf_counter()
    LOGGER.info('Starting direct web_search flow bar_name=%s neighborhood=%s', bar_name, neighborhood)
    prompt = build_search_prompt(bar_name, neighborhood)
    payload = {
        'model': OPENAI_MODEL,
        'tools': [{'type': 'web_search'}],
        'input': prompt,
        'temperature': 0
    }
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
            normalized_item['confidence'] = min(normalized_item['confidence'], 0.9)
            normalized_item['fetch_method'] = 'web_ai_search'
            normalized.append(normalized_item)

    elapsed = time.perf_counter() - started_at
    LOGGER.info(
        'Direct web_search flow completed in %.2fs; produced %d normalized specials',
        elapsed,
        len(normalized)
    )
    return normalized


def lambda_handler(event, context):
    started_at = time.perf_counter()
    try:
        LOGGER.info('generate_candidate_specials invocation started')
        neighborhood = parse_event(event)
        total_candidates = []
        processed_bars = 0
        bars_result = invoke_db_bar_sync({'mode': 'get_bars_by_neighborhood', 'neighborhood': neighborhood})
        bars = bars_result.get('bars', [])
        LOGGER.info('Found %d bars in neighborhood=%s', len(bars), neighborhood)

        for bar in bars:
            homepage_url = (bar.get('website_url') or '').strip()
            bar_name = (bar.get('bar_name') or '').strip()
            if not homepage_url or not bar_name:
                LOGGER.info('Skipping bar_id=%s due to missing website or name', bar.get('bar_id'))
                continue

            processed_bars += 1
            specials = generate_from_crawl(homepage_url, bar_name, neighborhood)
            if not specials:
                LOGGER.info('No crawl specials found for bar_id=%s; using OpenAI web_search', bar.get('bar_id'))
                specials = generate_from_search(bar_name, neighborhood)

            for special in specials:
                total_candidates.append({
                    'bar_id': bar['bar_id'],
                    'bar_name': bar_name,
                    'neighborhood': neighborhood,
                    **special
                })

        insert_result = invoke_db_bar_sync({'mode': 'insert_special_candidates', 'candidates': total_candidates})
        inserted_count = int(insert_result.get('inserted_count', 0))

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
                'neighborhood': neighborhood,
                'processed_bars': processed_bars,
                'candidate_specials_found': len(total_candidates),
                'candidate_specials_inserted': inserted_count
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
