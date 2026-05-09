from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
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
_semaphore = asyncio.Semaphore(2)
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
        listing = await _bounded_call(lambda: _provider.reference_listing(ticker))
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
        quote = await _bounded_call(lambda: _provider.quote(ticker=ticker, mic=mic, currency=currency))
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
        profile = await _bounded_call(lambda: _finviz_provider.profile(ticker=ticker, mic=mic))
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


async def _bounded_call(fn: Callable[[], Any]) -> Any:
    async with _semaphore:
        try:
            return await asyncio.wait_for(asyncio.to_thread(fn), PROVIDER_TIMEOUT_SECONDS)
        except TimeoutError as exc:
            raise ProviderUnavailable("provider_error", True, "dev provider: timeout") from exc


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
