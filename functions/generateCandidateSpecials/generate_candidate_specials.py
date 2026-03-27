import json
import os
import re
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from typing import List, Optional, Sequence
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


DEFAULT_KEYWORDS = ("special", "happy", "menu", "event")
DEFAULT_MODEL = "gpt-4.1-mini"


class LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self._current_href = None
        self._text_chunks = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "a":
            return

        href = None
        for key, value in attrs:
            if key.lower() == "href":
                href = value
                break

        if href:
            self._current_href = href
            self._text_chunks = []

    def handle_data(self, data):
        if self._current_href:
            self._text_chunks.append(data)

    def handle_endtag(self, tag):
        if tag.lower() != "a" or not self._current_href:
            return

        text = " ".join(chunk.strip() for chunk in self._text_chunks if chunk.strip())
        self.links.append((self._current_href, text))
        self._current_href = None
        self._text_chunks = []


@dataclass
class CandidatePage:
    url: str
    anchor_text: str
    extracted_text: str


def _fetch_url(url: str, timeout_seconds: int = 12) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (compatible; BarSpecialsBot/1.0; +https://example.com/bot)"
            )
        },
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def _extract_links(homepage_html: str, homepage_url: str) -> List[tuple[str, str]]:
    parser = LinkExtractor()
    parser.feed(homepage_html)

    normalized_links = []
    for href, anchor_text in parser.links:
        absolute_url = urljoin(homepage_url, href)
        parsed = urlparse(absolute_url)
        if parsed.scheme in {"http", "https"}:
            normalized_links.append((absolute_url, anchor_text))

    # Deduplicate while preserving order.
    seen = set()
    unique_links = []
    for url, anchor_text in normalized_links:
        normalized_key = url.rstrip("/").lower()
        if normalized_key in seen:
            continue
        seen.add(normalized_key)
        unique_links.append((url, anchor_text))

    return unique_links


def _filter_candidate_links(
    links: Sequence[tuple[str, str]],
    keywords: Sequence[str],
    max_links: int,
) -> List[tuple[str, str]]:
    keyword_set = tuple(kw.lower() for kw in keywords)
    candidates = []
    for url, anchor_text in links:
        combined = f"{url} {anchor_text}".lower()
        if any(keyword in combined for keyword in keyword_set):
            candidates.append((url, anchor_text))
        if len(candidates) >= max_links:
            break
    return candidates


def _strip_html_to_text(html: str) -> str:
    without_script = re.sub(
        r"<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>",
        " ",
        html,
        flags=re.IGNORECASE,
    )
    without_style = re.sub(
        r"<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>",
        " ",
        without_script,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"<[^>]+>", " ", without_style)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _build_openai_prompt(homepage_url: str, pages: Sequence[CandidatePage]) -> str:
    payload = {
        "homepage_url": homepage_url,
        "candidate_pages": [
            {
                "url": page.url,
                "anchor_text": page.anchor_text,
                "text_excerpt": page.extracted_text[:5000],
            }
            for page in pages
        ],
        "task": (
            "Infer likely current bar specials from these page excerpts. "
            "Return JSON only with key 'candidate_specials' as a list of strings. "
            "Do not include specials if unsupported by evidence from the excerpts."
        ),
    }
    return json.dumps(payload)


def generate_candidate_specials_from_homepage(
    homepage_url: str,
    *,
    openai_api_key: Optional[str] = None,
    model: str = DEFAULT_MODEL,
    keywords: Sequence[str] = DEFAULT_KEYWORDS,
    max_links_to_visit: int = 3,
) -> List[str]:
    """
    Crawl a bar homepage, inspect relevant links, and return candidate specials inferred by OpenAI.

    Steps performed:
    1) Download homepage HTML.
    2) Extract links.
    3) Keep links whose URL/anchor text contain one of: special, happy, menu, event.
    4) Visit up to top 1-3 matching links.
    5) Extract plain text from those pages.
    6) Ask the OpenAI API to produce candidate specials.
    """
    if not homepage_url:
        raise ValueError("homepage_url is required")

    if max_links_to_visit < 1 or max_links_to_visit > 3:
        raise ValueError("max_links_to_visit must be between 1 and 3")

    api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OpenAI API key is required (pass openai_api_key or set OPENAI_API_KEY)")

    homepage_html = _fetch_url(homepage_url)
    all_links = _extract_links(homepage_html, homepage_url)
    links_to_visit = _filter_candidate_links(all_links, keywords, max_links=max_links_to_visit)

    pages = []
    for url, anchor_text in links_to_visit:
        try:
            page_html = _fetch_url(url)
            page_text = _strip_html_to_text(page_html)
            if page_text:
                pages.append(CandidatePage(url=url, anchor_text=anchor_text, extracted_text=page_text))
        except Exception:
            # Skip individual bad pages and keep going.
            continue

    if not pages:
        return []

    try:
        from openai import OpenAI
    except ImportError as exc:
        raise ImportError("openai package is required. Install with: pip install openai") from exc

    client = OpenAI(api_key=api_key)
    prompt = _build_openai_prompt(homepage_url, pages)

    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "system",
                "content": (
                    "You extract likely current bar specials from provided website text. "
                    "Return strict JSON only."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )

    raw = (response.output_text or "").strip()
    if not raw:
        return []

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return [raw]

    specials = parsed.get("candidate_specials")
    if not isinstance(specials, list):
        return []

    return [str(item).strip() for item in specials if str(item).strip()]


if __name__ == "__main__":
    # Example usage:
    # python generate_candidate_specials.py "https://example-bar.com"
    import sys

    if len(sys.argv) < 2:
        print("Usage: python generate_candidate_specials.py <homepage_url>")
        raise SystemExit(1)

    url = sys.argv[1]
    print(generate_candidate_specials_from_homepage(url))
