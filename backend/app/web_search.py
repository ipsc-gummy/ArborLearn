from __future__ import annotations

import asyncio
import html
import ipaddress
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from typing import Any

from . import settings as _settings  # Ensures backend/.env is loaded before provider selection.


DEFAULT_MAX_RESULTS = 5
DEFAULT_FETCH_TIMEOUT = 12.0
DEFAULT_SEARCH_TIMEOUT = 15.0
DEFAULT_CONTENT_LIMIT = 12000


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str = ""
    score: float | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class WebPageContent:
    title: str
    url: str
    content: str
    provider: str

    def to_dict(self) -> dict:
        return asdict(self)


class WebSearchConfigurationError(RuntimeError):
    pass


class WebSearchProviderError(RuntimeError):
    pass


class _ReadableTextParser(HTMLParser):
    SKIP_TAGS = {"script", "style", "noscript", "svg", "canvas", "iframe"}
    SOFT_BREAK_TAGS = {"p", "div", "section", "article", "header", "footer", "li", "br", "h1", "h2", "h3", "h4"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = True
        if tag in self.SKIP_TAGS:
            self._skip_depth += 1
        if tag in self.SOFT_BREAK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        if tag in self.SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1
        if tag in self.SOFT_BREAK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if not text:
            return
        if self._in_title:
            self.title = f"{self.title} {text}".strip()
            return
        if self._skip_depth:
            return
        self._parts.append(text)
        self._parts.append(" ")

    def readable_text(self) -> str:
        return normalize_text("".join(self._parts))


def normalize_text(value: str) -> str:
    lines = [" ".join(line.split()) for line in html.unescape(value).splitlines()]
    compact_lines = [line for line in lines if line]
    return "\n".join(compact_lines).strip()


def _request_json(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, payload: dict | None = None, timeout: float) -> dict:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "ArborLearn-WebSearch/0.1",
            **(headers or {}),
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise WebSearchProviderError(f"Search provider returned HTTP {exc.code}: {detail[:500]}") from exc
    except urllib.error.URLError as exc:
        raise WebSearchProviderError(f"Search provider request failed: {exc.reason}") from exc

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise WebSearchProviderError(f"Search provider returned non-JSON response: {body[:500]}") from exc
    if not isinstance(parsed, dict):
        raise WebSearchProviderError("Search provider returned an unexpected JSON shape")
    return parsed


def _request_json_with_retry(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    payload: dict | None = None,
    timeout: float,
) -> dict:
    attempts = max(1, int(os.getenv("WEB_PROVIDER_RETRIES", "2")))
    last_error: WebSearchProviderError | None = None
    for attempt in range(attempts):
        try:
            return _request_json(url, method=method, headers=headers, payload=payload, timeout=timeout)
        except WebSearchProviderError as exc:
            last_error = exc
            if attempt < attempts - 1:
                time.sleep(0.35 * (attempt + 1))
    if last_error is not None:
        raise last_error
    raise WebSearchProviderError("Search provider request failed.")


def _selected_provider() -> str:
    configured = os.getenv("WEB_SEARCH_PROVIDER", "auto").strip().lower()
    if configured != "auto":
        return configured
    if os.getenv("TAVILY_API_KEY"):
        return "tavily"
    if os.getenv("BRAVE_SEARCH_API_KEY"):
        return "brave"
    if os.getenv("SEARXNG_BASE_URL"):
        return "searxng"
    raise WebSearchConfigurationError(
        "WEB_SEARCH_PROVIDER is not configured. Set TAVILY_API_KEY, BRAVE_SEARCH_API_KEY, or SEARXNG_BASE_URL."
    )


def get_web_search_config_status() -> dict:
    configured = os.getenv("WEB_SEARCH_PROVIDER", "auto").strip().lower()
    provider_keys = {
        "tavily": bool(os.getenv("TAVILY_API_KEY")),
        "brave": bool(os.getenv("BRAVE_SEARCH_API_KEY")),
        "searxng": bool(os.getenv("SEARXNG_BASE_URL")),
    }
    if configured == "auto":
        for provider, available in provider_keys.items():
            if available:
                return {"configured": True, "provider": provider, "mode": "auto"}
        return {"configured": False, "provider": None, "mode": "auto"}
    return {
        "configured": provider_keys.get(configured, False),
        "provider": configured,
        "mode": "explicit",
    }


def _clamp_max_results(max_results: int) -> int:
    return max(1, min(max_results, 8))


def _parse_score(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _tavily_search(query: str, max_results: int) -> list[SearchResult]:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise WebSearchConfigurationError("TAVILY_API_KEY is required for Tavily search.")
    response = _request_json_with_retry(
        "https://api.tavily.com/search",
        method="POST",
        timeout=float(os.getenv("WEB_SEARCH_TIMEOUT", str(DEFAULT_SEARCH_TIMEOUT))),
        headers={"Authorization": f"Bearer {api_key}"},
        payload={
            "query": query,
            "max_results": max_results,
            "search_depth": "basic",
            "include_answer": False,
            "include_raw_content": False,
        },
    )
    results = response.get("results", [])
    if not isinstance(results, list):
        return []
    parsed: list[SearchResult] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        parsed.append(
            SearchResult(
                title=str(item.get("title") or url).strip(),
                url=url,
                snippet=str(item.get("content") or "").strip(),
                score=_parse_score(item.get("score")),
            )
        )
    return parsed


def _brave_search(query: str, max_results: int) -> list[SearchResult]:
    api_key = os.getenv("BRAVE_SEARCH_API_KEY")
    if not api_key:
        raise WebSearchConfigurationError("BRAVE_SEARCH_API_KEY is required for Brave Search.")
    params = urllib.parse.urlencode({"q": query, "count": max_results, "text_decorations": "false"})
    response = _request_json(
        f"https://api.search.brave.com/res/v1/web/search?{params}",
        timeout=float(os.getenv("WEB_SEARCH_TIMEOUT", str(DEFAULT_SEARCH_TIMEOUT))),
        headers={"X-Subscription-Token": api_key},
    )
    web = response.get("web", {})
    results = web.get("results", []) if isinstance(web, dict) else []
    if not isinstance(results, list):
        return []
    parsed: list[SearchResult] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        parsed.append(
            SearchResult(
                title=str(item.get("title") or url).strip(),
                url=url,
                snippet=str(item.get("description") or "").strip(),
                score=_parse_score(item.get("score")),
            )
        )
    return parsed


def _searxng_search(query: str, max_results: int) -> list[SearchResult]:
    base_url = os.getenv("SEARXNG_BASE_URL", "").rstrip("/")
    if not base_url:
        raise WebSearchConfigurationError("SEARXNG_BASE_URL is required for SearXNG search.")
    params = urllib.parse.urlencode({"q": query, "format": "json", "categories": "general", "safesearch": "1"})
    response = _request_json(
        f"{base_url}/search?{params}",
        timeout=float(os.getenv("WEB_SEARCH_TIMEOUT", str(DEFAULT_SEARCH_TIMEOUT))),
    )
    results = response.get("results", [])
    if not isinstance(results, list):
        return []
    parsed: list[SearchResult] = []
    for item in results[:max_results]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        parsed.append(
            SearchResult(
                title=str(item.get("title") or url).strip(),
                url=url,
                snippet=str(item.get("content") or "").strip(),
                score=_parse_score(item.get("score")),
            )
        )
    return parsed


def _sync_search_web(query: str, max_results: int) -> list[SearchResult]:
    query = query.strip()
    if not query:
        raise WebSearchProviderError("Search query cannot be empty.")
    max_results = _clamp_max_results(max_results)
    provider = _selected_provider()
    if provider == "tavily":
        return _tavily_search(query, max_results)
    if provider == "brave":
        return _brave_search(query, max_results)
    if provider == "searxng":
        return _searxng_search(query, max_results)
    raise WebSearchConfigurationError(f"Unsupported WEB_SEARCH_PROVIDER '{provider}'.")


async def search_web(query: str, max_results: int = DEFAULT_MAX_RESULTS) -> list[SearchResult]:
    return await asyncio.to_thread(_sync_search_web, query, max_results)


def _hostname_is_public(hostname: str) -> bool:
    try:
        addresses = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise WebSearchProviderError(f"Cannot resolve URL host: {hostname}") from exc

    for address in {item[4][0] for item in addresses}:
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def validate_public_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise WebSearchProviderError("Only public http/https URLs can be fetched.")
    if not parsed.hostname:
        raise WebSearchProviderError("URL host is missing.")
    if not _hostname_is_public(parsed.hostname):
        raise WebSearchProviderError("Private, local, or link-local URLs cannot be fetched.")
    return urllib.parse.urlunparse(parsed)


def _extract_from_html(body: bytes, fallback_url: str) -> tuple[str, str]:
    text = body.decode("utf-8", errors="replace")
    parser = _ReadableTextParser()
    parser.feed(text)
    title = normalize_text(parser.title) or fallback_url
    return title, parser.readable_text()


def _fetch_direct(url: str) -> WebPageContent:
    safe_url = validate_public_url(url)
    timeout = float(os.getenv("WEB_FETCH_TIMEOUT", str(DEFAULT_FETCH_TIMEOUT)))
    request = urllib.request.Request(
        safe_url,
        headers={
            "User-Agent": "Mozilla/5.0 ArborLearn-WebSearch/0.1",
            "Accept": "text/html,text/plain,application/xhtml+xml",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            final_url = validate_public_url(response.geturl())
            content_type = response.headers.get("content-type", "")
            body = response.read(int(os.getenv("WEB_FETCH_BYTES_LIMIT", "1500000")))
    except urllib.error.HTTPError as exc:
        raise WebSearchProviderError(f"URL returned HTTP {exc.code}: {safe_url}") from exc
    except urllib.error.URLError as exc:
        raise WebSearchProviderError(f"URL fetch failed: {exc.reason}") from exc

    if "text/plain" in content_type:
        title = final_url
        content = normalize_text(body.decode("utf-8", errors="replace"))
    elif "html" in content_type or not content_type:
        title, content = _extract_from_html(body, final_url)
    else:
        raise WebSearchProviderError(f"Unsupported content type for extraction: {content_type}")

    content = content[: int(os.getenv("WEB_SOURCE_STORE_LIMIT", str(DEFAULT_CONTENT_LIMIT)))]
    if not content:
        raise WebSearchProviderError("Fetched page has no readable text.")
    return WebPageContent(title=title[:240], url=final_url, content=content, provider="direct")


def _tavily_extract(url: str) -> WebPageContent | None:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return None
    safe_url = validate_public_url(url)
    response = _request_json_with_retry(
        "https://api.tavily.com/extract",
        method="POST",
        timeout=float(os.getenv("WEB_FETCH_TIMEOUT", str(DEFAULT_FETCH_TIMEOUT))),
        headers={"Authorization": f"Bearer {api_key}"},
        payload={"urls": [safe_url], "extract_depth": "basic", "format": "text"},
    )
    results = response.get("results", [])
    if not isinstance(results, list) or not results:
        return None
    item = results[0]
    if not isinstance(item, dict):
        return None
    content = normalize_text(str(item.get("raw_content") or item.get("content") or ""))
    if not content:
        return None
    title = str(item.get("title") or safe_url).strip()[:240]
    resolved_url = str(item.get("url") or safe_url).strip()
    return WebPageContent(
        title=title,
        url=validate_public_url(resolved_url),
        content=content[: int(os.getenv("WEB_SOURCE_STORE_LIMIT", str(DEFAULT_CONTENT_LIMIT)))],
        provider="tavily",
    )


def _sync_fetch_url(url: str) -> WebPageContent:
    provider = os.getenv("WEB_SEARCH_PROVIDER", "auto").strip().lower()
    if (provider in {"auto", "tavily"}) and os.getenv("TAVILY_API_KEY"):
        try:
            extracted = _tavily_extract(url)
            if extracted:
                return extracted
        except WebSearchProviderError:
            if provider == "tavily":
                raise
    return _fetch_direct(url)


async def fetch_url(url: str) -> WebPageContent:
    return await asyncio.to_thread(_sync_fetch_url, url)
