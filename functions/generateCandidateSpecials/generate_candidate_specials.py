import json
import logging
import os
import re
import time
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import requests

OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4.1-mini')
OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
MAX_LINKS_TO_VISIT = 3
MAX_TEXT_CHARS_PER_PAGE = 12000
HTML_CONTENT_HINTS = ('text/html', 'application/xhtml+xml')
NON_HTML_EXTENSIONS = ('.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.zip', '.mp4', '.mp3')

KEYWORDS = ('special', 'happy', 'menu', 'event')
DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)


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
        if tag.lower() in ('script', 'style', 'noscript'):
            self._skip_stack.append(tag.lower())

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

    homepage_url = payload.get('homepage_url') or payload.get('url')
    bar_name = payload.get('bar_name')
    neighborhood = payload.get('neighborhood')

    if not homepage_url or not bar_name or not neighborhood:
        missing = []
        if not homepage_url:
            missing.append('homepage_url')
        if not bar_name:
            missing.append('bar_name')
        if not neighborhood:
            missing.append('neighborhood')
        raise ValueError(f'Missing required fields: {", ".join(missing)}')

    return homepage_url.strip(), bar_name.strip(), neighborhood.strip()


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
        url_blob = f"{link.get('url', '')}".lower()
        text_blob = f"{link.get('text', '')}".lower()
        blob = f'{url_blob} {text_blob}'
        hits = sum(1 for keyword in KEYWORDS if keyword in blob)
        if hits == 0:
            continue

        keyword_in_text_boost = sum(1 for keyword in KEYWORDS if keyword in text_blob)
        scored.append((hits, keyword_in_text_boost, -len(link.get('url', '')), link))

    scored.sort(reverse=True)
    return [item[2] for item in scored[:MAX_LINKS_TO_VISIT]]


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

For each special, return:
- description (string)
- type ("food", "drink", or "unknown")
- days_of_week (array of MON, TUE, WED, THU, FRI, SAT, SUN)
- start_time (HH:MM 24-hour or null)
- end_time (HH:MM 24-hour or null)
- all_day ("Y" or "N")
- confidence (0.0–1.0)
- notes (short explanation of how it was interpreted and that this came from web crawl)
- source (set to \"{homepage_url}\")

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
- notes (short explanation of how it was interpreted and that this came from direct AI web search)
- source (include source URL used for the item if available, otherwise "openai_web_search")

Normalization rules:
- Convert times like "5–7pm" → "17:00" to "19:00"
- "Late night" without a time → leave time null
- "Daily" → all 7 days
- "Weekdays" → MON–FRI
- If no time is given → all_day = "Y"
- Classify type:
  - drinks/alcohol → "drink"
  - food/appetizers → "food"

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


def normalize_item(item, default_source):
    if not isinstance(item, dict):
        return None

    days = item.get('days_of_week')
    if not isinstance(days, list):
        days = []

    normalized_days = [day for day in days if day in DAY_KEYS]
    item_type = item.get('type') if item.get('type') in ('food', 'drink', 'unknown') else 'unknown'

    return {
        'description': str(item.get('description') or '').strip(),
        'type': item_type,
        'days_of_week': normalized_days,
        'start_time': item.get('start_time') if item.get('start_time') else None,
        'end_time': item.get('end_time') if item.get('end_time') else None,
        'all_day': 'Y' if item.get('all_day') == 'Y' else 'N',
        'confidence': float(item.get('confidence')) if isinstance(item.get('confidence'), (int, float)) else 0.0,
        'notes': str(item.get('notes') or '').strip(),
        'source': str(item.get('source') or default_source).strip()
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
    LOGGER.info('Selected %d candidate links for crawl', len(top_links))

    page_payloads = []
    for link in top_links:
        try:
            html = fetch_html(link['url'])
            if not html:
                LOGGER.info('Skipping non-HTML candidate link: %s', link['url'])
                continue
            text = extract_text(html)
            if text:
                page_payloads.append({'url': link['url'], 'text': text})
                LOGGER.info('Captured %d characters from %s', len(text), link['url'])
            else:
                LOGGER.info('No HTML text captured from %s (likely non-HTML content)', link['url'])
        except requests.RequestException:
            LOGGER.exception('Failed fetching candidate link: %s', link['url'])
            continue
        except Exception:
            LOGGER.exception('Unexpected parse error for candidate link: %s', link['url'])
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
        normalized_item = normalize_item(item, homepage_url)
        if normalized_item and normalized_item['description']:
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
        homepage_url, bar_name, neighborhood = parse_event(event)

        specials = generate_from_crawl(homepage_url, bar_name, neighborhood)
        if not specials:
            LOGGER.info('No crawl specials found; falling back to OpenAI web_search')
            specials = generate_from_search(bar_name, neighborhood)

        elapsed = time.perf_counter() - started_at
        LOGGER.info('Invocation complete in %.2fs with %d specials', elapsed, len(specials))
        return {
            'statusCode': 200,
            'body': json.dumps(specials)
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
