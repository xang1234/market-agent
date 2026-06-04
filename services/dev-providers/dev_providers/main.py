from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request

from .finviz_provider import FinvizProvider
from .yfinance_provider import YFinanceProvider


PROVIDER_TIMEOUT_SECONDS = 4
NEGATIVE_TTL_SECONDS = 60


app = FastAPI(title="market-agent dev providers")
_provider = YFinanceProvider()
_finviz_provider = FinvizProvider()
_provider_executors = {
    "yfinance": ThreadPoolExecutor(max_workers=2, thread_name_prefix="dev-provider-yfinance"),
    "finviz": ThreadPoolExecutor(max_workers=2, thread_name_prefix="dev-provider-finviz"),
}
_negative_cache: dict[str, tuple[float, dict[str, Any]]] = {}


@dataclass(frozen=True)
class ProviderUnavailable(Exception):
    reason: str
    retryable: bool
    detail: str


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/reference/ticker/{ticker}")
async def reference_ticker(ticker: str) -> dict[str, Any]:
    key = f"reference:{ticker.strip().upper()}"
    cached = _negative_cache_get(key)
    if cached:
        return cached

    try:
        listing = await _bounded_call("yfinance", lambda: _provider.reference_listing(ticker))
    except ProviderUnavailable as exc:
        return _cache_unavailable(key, exc)
    except Exception as exc:
        return _cache_unavailable(key, ProviderUnavailable("provider_error", True, f"yfinance: {exc}"))

    if not listing:
        return _cache_unavailable(
            key,
            ProviderUnavailable("missing_coverage", False, "yfinance: no clean listing"),
        )

    return _available({"listings": [listing]})


@app.post("/market/quote")
async def market_quote(request: Request) -> dict[str, Any]:
    body = await request.json()
    ticker = str(body.get("ticker", "")).strip().upper()
    mic = str(body.get("mic", "")).strip().upper()
    currency = str(body.get("currency", "")).strip().upper()
    key = f"quote:{ticker}:{mic}"
    cached = _negative_cache_get(key)
    if cached:
        return cached

    try:
        quote = await _bounded_call("yfinance", lambda: _provider.quote(ticker=ticker, mic=mic, currency=currency))
    except ValueError as exc:
        return _cache_unavailable(key, ProviderUnavailable("missing_coverage", False, str(exc)))
    except ProviderUnavailable as exc:
        return _cache_unavailable(key, exc)
    except Exception as exc:
        return _cache_unavailable(key, ProviderUnavailable("provider_error", True, f"yfinance: {exc}"))

    if not quote:
        return _cache_unavailable(
            key,
            ProviderUnavailable("missing_coverage", False, "yfinance: quote unavailable"),
        )

    return _available(quote)


@app.post("/market/daily-bars")
async def market_daily_bars(request: Request) -> dict[str, Any]:
    body = await request.json()
    ticker = str(body.get("ticker", "")).strip().upper()
    mic = str(body.get("mic", "")).strip().upper()
    currency = str(body.get("currency", "")).strip().upper()
    timezone = str(body.get("timezone", "")).strip()
    bar_range = body.get("range") if isinstance(body.get("range"), dict) else {}
    range_start = str(bar_range.get("start", ""))
    range_end = str(bar_range.get("end", ""))
    key = f"daily-bars:{ticker}:{mic}:{range_start}:{range_end}"
    cached = _negative_cache_get(key)
    if cached:
        return cached

    try:
        bars = await _bounded_call(
            "yfinance",
            lambda: _provider.daily_bars(
                ticker=ticker,
                mic=mic,
                timezone=timezone,
                range_start=range_start,
                range_end=range_end,
            )
        )
    except ValueError as exc:
        return _cache_unavailable(key, ProviderUnavailable("missing_coverage", False, str(exc)))
    except ProviderUnavailable as exc:
        return _cache_unavailable(key, exc)
    except Exception as exc:
        return _cache_unavailable(key, ProviderUnavailable("provider_error", True, f"yfinance: {exc}"))

    if not bars:
        return _cache_unavailable(
            key,
            ProviderUnavailable("missing_coverage", False, "yfinance: no daily bars in range"),
        )

    return _available(
        {
            "bars": bars,
            "as_of": bars[-1]["ts"],
            "delay_class": "eod",
            "currency": currency,
            "adjustment_basis": "split_and_div_adjusted",
        }
    )


@app.post("/reference/profile")
async def reference_profile(request: Request) -> dict[str, Any]:
    body = await request.json()
    ticker = str(body.get("ticker", "")).strip().upper()
    mic = str(body.get("mic", "")).strip().upper()
    key = f"profile:{ticker}:{mic}"
    cached = _negative_cache_get(key)
    if cached:
        return cached

    try:
        profile = await _bounded_call("finviz", lambda: _finviz_provider.profile(ticker=ticker, mic=mic))
    except ValueError as exc:
        return _cache_unavailable(key, ProviderUnavailable("missing_coverage", False, str(exc)))
    except ProviderUnavailable as exc:
        return _cache_unavailable(key, exc)
    except Exception as exc:
        return _cache_unavailable(key, ProviderUnavailable("provider_error", True, f"finviz: {exc}"))

    if not profile:
        return _cache_unavailable(
            key,
            ProviderUnavailable("missing_coverage", False, "finviz: profile unavailable"),
        )

    return _available(profile)


@app.post("/fundamentals/earnings")
async def fundamentals_earnings(request: Request) -> dict[str, Any]:
    body = await request.json()
    ticker = str(body.get("ticker", "")).strip().upper()
    mic = str(body.get("mic", "")).strip().upper()
    currency = str(body.get("currency", "")).strip().upper()
    key = f"fundamentals-earnings:{ticker}:{mic}"
    cached = _negative_cache_get(key)
    if cached:
        return cached

    try:
        earnings = await _bounded_call(
            "yfinance",
            lambda: _provider.earnings(ticker=ticker, mic=mic, currency=currency),
        )
    except ValueError as exc:
        return _cache_unavailable(key, ProviderUnavailable("missing_coverage", False, str(exc)))
    except ProviderUnavailable as exc:
        return _cache_unavailable(key, exc)
    except Exception as exc:
        return _cache_unavailable(key, ProviderUnavailable("provider_error", True, f"yfinance: {exc}"))

    if not earnings:
        return _cache_unavailable(
            key,
            ProviderUnavailable("missing_coverage", False, "yfinance: earnings unavailable"),
        )

    return _available(earnings)


@app.post("/fundamentals/consensus")
async def fundamentals_consensus(request: Request) -> dict[str, Any]:
    body = await request.json()
    ticker = str(body.get("ticker", "")).strip().upper()
    mic = str(body.get("mic", "")).strip().upper()
    currency = str(body.get("currency", "")).strip().upper()
    key = f"fundamentals-consensus:{ticker}:{mic}"
    cached = _negative_cache_get(key)
    if cached:
        return cached

    try:
        consensus = await _bounded_call(
            "yfinance",
            lambda: _provider.analyst_consensus(ticker=ticker, mic=mic, currency=currency),
        )
    except ValueError as exc:
        return _cache_unavailable(key, ProviderUnavailable("missing_coverage", False, str(exc)))
    except ProviderUnavailable as exc:
        return _cache_unavailable(key, exc)
    except Exception as exc:
        return _cache_unavailable(key, ProviderUnavailable("provider_error", True, f"yfinance: {exc}"))

    if not consensus:
        return _cache_unavailable(
            key,
            ProviderUnavailable("missing_coverage", False, "yfinance: consensus unavailable"),
        )

    return _available(consensus)


@app.post("/fundamentals/holders")
async def fundamentals_holders(request: Request) -> dict[str, Any]:
    body = await request.json()
    ticker = str(body.get("ticker", "")).strip().upper()
    mic = str(body.get("mic", "")).strip().upper()
    currency = str(body.get("currency", "")).strip().upper()
    kind = str(body.get("kind", "")).strip().lower()
    key = f"fundamentals-holders:{ticker}:{mic}:{kind}"
    cached = _negative_cache_get(key)
    if cached:
        return cached

    try:
        holders = await _bounded_call(
            "yfinance",
            lambda: _provider.holders(ticker=ticker, mic=mic, currency=currency, kind=kind),
        )
    except ValueError as exc:
        return _cache_unavailable(key, ProviderUnavailable("missing_coverage", False, str(exc)))
    except ProviderUnavailable as exc:
        return _cache_unavailable(key, exc)
    except Exception as exc:
        return _cache_unavailable(key, ProviderUnavailable("provider_error", True, f"yfinance: {exc}"))

    if not holders:
        return _cache_unavailable(
            key,
            ProviderUnavailable("missing_coverage", False, f"yfinance: {kind} holders unavailable"),
        )

    return _available(holders)


async def _bounded_call(provider_name: str, fn: Callable[[], Any]) -> Any:
    executor = _provider_executors[provider_name]
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(executor, fn), PROVIDER_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        raise ProviderUnavailable("provider_error", True, f"{provider_name}: timeout") from exc


def _available(data: dict[str, Any]) -> dict[str, Any]:
    return {"status": "available", "data": data}


def _unavailable(exc: ProviderUnavailable) -> dict[str, Any]:
    return {
        "status": "unavailable",
        "reason": exc.reason,
        "retryable": exc.retryable,
        "detail": exc.detail,
    }


def _negative_cache_get(key: str) -> dict[str, Any] | None:
    entry = _negative_cache.get(key)
    if not entry:
        return None
    expires_at, envelope = entry
    if expires_at <= time.monotonic():
        _negative_cache.pop(key, None)
        return None
    return envelope


def _cache_unavailable(key: str, exc: ProviderUnavailable) -> dict[str, Any]:
    envelope = _unavailable(exc)
    _negative_cache[key] = (time.monotonic() + NEGATIVE_TTL_SECONDS, envelope)
    return envelope
