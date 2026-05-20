from __future__ import annotations

import asyncio
import html
import ipaddress
import json
import os
import re
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
    source_type: str = "unknown"
    trust_level: str = "medium"
    domain_quality_score: float = 0.5

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


def query_terms(text: str) -> set[str]:
    return {item.lower() for item in re.findall(r"[A-Za-z0-9_\-]{2,}|[\u4e00-\u9fff]{2,}", text)}


def classify_source_url(url: str) -> tuple[str, str, float]:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    path = parsed.path.lower()

    official_markers = ("docs.", "developer.", "developers.", "api.", "learn.", "support.")
    if host == "github.com" or host.endswith(".github.io"):
        return "github", "high", 0.95
    if host == "arxiv.org" or "doi.org" in host or "acm.org" in host or "ieee.org" in host:
        return "paper", "high", 0.95
    if any(marker in host for marker in official_markers) or "/docs" in path or "/documentation" in path:
        return "official_docs", "high", 1.0
    if host.endswith(".edu") or ".edu." in host:
        return "course", "high", 0.9
    if "wikipedia.org" in host:
        return "wikipedia", "medium", 0.78
    if "stackoverflow.com" in host or "stackexchange.com" in host or "github.com" in host and "/issues/" in path:
        return "forum", "medium", 0.68
    if "medium.com" in host or "blog" in host or "dev.to" in host or "juejin.cn" in host or "cnblogs.com" in host:
        return "blog", "medium", 0.58
    if any(marker in host for marker in ("seo", "zhuanlan", "csdn", "51cto", "53ai")):
        return "blog", "low", 0.42
    return "unknown", "medium", 0.5


def enrich_search_result(result: SearchResult) -> SearchResult:
    source_type, trust_level, domain_quality_score = classify_source_url(result.url)
    result.source_type = source_type
    result.trust_level = trust_level
    result.domain_quality_score = domain_quality_score
    return result


def keyword_overlap_score(text: str, terms: set[str]) -> float:
    lowered = text.lower()
    return sum(1 for term in terms if term in lowered) / max(1, len(terms))


def rank_search_results(results: list[SearchResult], query: str) -> list[SearchResult]:
    terms = query_terms(query)
    seen_hosts: set[str] = set()
    scored: list[tuple[float, int, SearchResult]] = []
    for index, raw_result in enumerate(results):
        result = enrich_search_result(raw_result)
        host = urllib.parse.urlparse(result.url).hostname or result.url
        provider_score = result.score if result.score is not None else 0.5
        keyword_overlap = keyword_overlap_score(f"{result.title}\n{result.snippet}", terms)
        duplicate_penalty = 1.0 if host in seen_hosts else 0.0
        final_score = (
            provider_score * 0.45
            + keyword_overlap * 0.25
            + result.domain_quality_score * 0.20
            - duplicate_penalty * 0.10
        )
        scored.append((final_score, -index, result))
        seen_hosts.add(host)
    return [result for _, _, result in sorted(scored, key=lambda item: (item[0], item[1]), reverse=True)]


def split_paragraphs(text: str) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}|\r\n{2,}", text) if paragraph.strip()]
    if len(paragraphs) <= 1:
        paragraphs = [paragraph.strip() for paragraph in text.split("\n") if paragraph.strip()]
    return paragraphs


def select_relevant_evidence(text: str, query: str, *, max_paragraphs: int = 2, max_chars: int = 1800) -> str:
    terms = query_terms(query)
    candidates: list[tuple[float, int, str]] = []
    for index, paragraph in enumerate(split_paragraphs(text)):
        compact = " ".join(paragraph.split())
        if len(compact) < 40:
            continue
        if len(compact) > 900:
            for start in range(0, len(compact), 780):
                part = compact[start : start + 900].strip()
                candidates.append((keyword_overlap_score(part, terms), -index, part))
        else:
            candidates.append((keyword_overlap_score(compact, terms), -index, compact))

    if not candidates:
        return text.strip()[:max_chars]

    selected = [item[2] for item in sorted(candidates, key=lambda item: (item[0], item[1]), reverse=True)[:max_paragraphs]]
    evidence = "\n\n".join(selected).strip()
    return evidence[:max_chars]


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
            enrich_search_result(
                SearchResult(
                    title=str(item.get("title") or url).strip(),
                    url=url,
                    snippet=str(item.get("content") or "").strip(),
                    score=_parse_score(item.get("score")),
                )
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
            enrich_search_result(
                SearchResult(
                    title=str(item.get("title") or url).strip(),
                    url=url,
                    snippet=str(item.get("description") or "").strip(),
                    score=_parse_score(item.get("score")),
                )
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
            enrich_search_result(
                SearchResult(
                    title=str(item.get("title") or url).strip(),
                    url=url,
                    snippet=str(item.get("content") or "").strip(),
                    score=_parse_score(item.get("score")),
                )
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
        return rank_search_results(_tavily_search(query, max_results), query)
    if provider == "brave":
        return rank_search_results(_brave_search(query, max_results), query)
    if provider == "searxng":
        return rank_search_results(_searxng_search(query, max_results), query)
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
