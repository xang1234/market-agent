from __future__ import annotations

from datetime import UTC, date, datetime
from math import isfinite
from typing import Any
from zoneinfo import ZoneInfo

from .yfinance_fundamentals import (
    HOLDER_KINDS,
    frame_columns,
    frame_rows,
    normalize_earnings_events,
    normalize_holders,
)


SUPPORTED_QUOTE_TYPES = {
    "EQUITY": "common_stock",
    "COMMON_STOCK": "common_stock",
    "ETF": "etf",
}

EXCHANGE_TO_MIC = {
    "NMS": "XNAS",
    "NGM": "XNAS",
    "NCM": "XNAS",
    "NAS": "XNAS",
    "NASDAQ": "XNAS",
    "NASDAQGS": "XNAS",
    "NASDAQGM": "XNAS",
    "NASDAQCM": "XNAS",
    "NYQ": "XNYS",
    "NYS": "XNYS",
    "NYSE": "XNYS",
    "ASE": "XASE",
    "AMEX": "XASE",
    "NYSEAMERICAN": "XASE",
    "PCX": "ARCX",
    "NYSEARCA": "ARCX",
    "BTS": "BATS",
    "BATS": "BATS",
    "TOR": "XTSE",
    "TSX": "XTSE",
    "VAN": "XTSX",
    "TSXV": "XTSX",
    "LSE": "XLON",
    "LON": "XLON",
    "HKG": "XHKG",
    "JPX": "XTKS",
    "TYO": "XTKS",
    "ASX": "XASX",
}

MIC_TO_SUFFIX = {
    "ARCX": "",
    "BATS": "",
    "IEXG": "",
    "XASE": "",
    "XNAS": "",
    "XNYS": "",
    "XTSE": ".TO",
    "XTSX": ".V",
    "XLON": ".L",
    "XHKG": ".HK",
    "XTKS": ".T",
    "XASX": ".AX",
}

YAHOO_STATE_TO_SESSION = {
    "PRE": "pre_market",
    "PREPRE": "pre_market",
    "REGULAR": "regular",
    "POST": "post_market",
    "POSTPOST": "post_market",
    "CLOSED": "closed",
}

def normalize_reference_listing(requested_ticker: str, info: dict[str, Any]) -> dict[str, Any] | None:
    requested = requested_ticker.strip().upper()
    symbol = _string(info.get("symbol"))
    if not requested or symbol is None or symbol.upper() != requested:
        return None

    name = _string(info.get("longName")) or _string(info.get("shortName"))
    quote_type = _string(info.get("quoteType"))
    asset_type = SUPPORTED_QUOTE_TYPES.get(quote_type.upper()) if quote_type else None
    exchange = _string(info.get("exchange")) or _string(info.get("fullExchangeName"))
    mic = EXCHANGE_TO_MIC.get(_compact_exchange(exchange)) if exchange else None
    currency = _currency(info.get("currency"))
    timezone = _string(info.get("timeZoneFullName")) or _string(info.get("exchangeTimezoneName"))

    if not name or not asset_type or not mic or not currency or not timezone:
        return None

    listing: dict[str, Any] = {
        "ticker": requested,
        "legal_name": name,
        "mic": mic,
        "trading_currency": currency,
        "timezone": timezone,
        "asset_type": asset_type,
    }
    cik = _string(info.get("cik"))
    if cik:
        listing["cik"] = cik
    return listing


def yahoo_symbol_for_listing(ticker: str, mic: str) -> str:
    suffix = MIC_TO_SUFFIX.get(mic.strip().upper())
    if suffix is None:
        raise ValueError(f"missing_coverage: no yfinance suffix mapping for MIC {mic}")
    return ticker.strip().upper().replace(".", "-") + suffix


def normalize_quote(
    info: dict[str, Any],
    *,
    fallback_currency: str,
    now_iso: str,
) -> dict[str, Any] | None:
    price = _positive_number(
        info.get("regularMarketPrice"),
        info.get("currentPrice"),
        info.get("marketPrice"),
        info.get("lastPrice"),
    )
    prev_close = _positive_number(info.get("regularMarketPreviousClose"), info.get("previousClose"))
    if price is None or prev_close is None:
        return None

    market_time = _number(info.get("regularMarketTime"))
    as_of = _epoch_seconds_to_iso(market_time) if market_time is not None else now_iso
    currency = _currency(info.get("currency")) or fallback_currency
    market_state = _string(info.get("marketState")) or "CLOSED"

    return {
        "price": price,
        "prev_close": prev_close,
        "session_state": YAHOO_STATE_TO_SESSION.get(market_state.upper(), "closed"),
        "as_of": as_of,
        "delay_class": "delayed_15m",
        "currency": currency,
    }


def normalize_daily_bars(
    rows: list[dict[str, Any]],
    *,
    timezone: str,
    range_start: str,
    range_end: str,
) -> list[dict[str, Any]]:
    start = _parse_utc_iso(range_start)
    end = _parse_utc_iso(range_end)
    normalized: list[dict[str, Any]] = []

    for row in rows:
        bar_ts = _daily_bar_timestamp(row, timezone)
        if bar_ts is None or not (start <= bar_ts < end):
            continue

        open_ = _positive_number(row.get("Open"), row.get("open"))
        high = _positive_number(row.get("High"), row.get("high"))
        low = _positive_number(row.get("Low"), row.get("low"))
        close = _positive_number(row.get("Close"), row.get("close"))
        volume = _nonnegative_number(row.get("Volume"), row.get("volume"))
        if open_ is None or high is None or low is None or close is None or volume is None:
            continue
        if high < low or high < open_ or high < close or low > open_ or low > close:
            continue

        normalized.append(
            {
                "ts": _iso_utc_millis(bar_ts),
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            }
        )

    return sorted(normalized, key=lambda bar: bar["ts"])


class YFinanceProvider:
    def reference_listing(self, ticker: str) -> dict[str, Any] | None:
        info = self._ticker_info(ticker.strip().upper())
        return normalize_reference_listing(ticker, info)

    def quote(self, *, ticker: str, mic: str, currency: str) -> dict[str, Any] | None:
        symbol = yahoo_symbol_for_listing(ticker, mic)
        info = self._ticker_info(symbol)
        return normalize_quote(info, fallback_currency=currency, now_iso=_iso_utc_millis(datetime.now(UTC)))

    def daily_bars(
        self,
        *,
        ticker: str,
        mic: str,
        timezone: str,
        range_start: str,
        range_end: str,
    ) -> list[dict[str, Any]]:
        symbol = yahoo_symbol_for_listing(ticker, mic)
        frame = self._ticker_history(symbol, timezone, range_start, range_end)
        return normalize_daily_bars(
            frame_rows(frame),
            timezone=timezone,
            range_start=range_start,
            range_end=range_end,
        )

    def earnings(self, *, ticker: str, mic: str, currency: str, limit: int = 8) -> dict[str, Any] | None:
        symbol = yahoo_symbol_for_listing(ticker, mic)
        import yfinance as yf

        yf_ticker = yf.Ticker(symbol)
        frame = yf_ticker.get_earnings_dates(limit=max(limit + 4, 12))
        normalized = normalize_earnings_events(
            frame_rows(frame),
            frame_columns(getattr(yf_ticker, "quarterly_income_stmt", None)),
            now_iso=_iso_utc_millis(datetime.now(UTC)),
            limit=limit,
        )
        if normalized is None:
            return None
        normalized["currency"] = _currency(currency) or currency
        return normalized

    def holders(
        self,
        *,
        ticker: str,
        mic: str,
        currency: str,
        kind: str,
        limit: int = 12,
    ) -> dict[str, Any] | None:
        if kind not in HOLDER_KINDS:
            raise ValueError(f"missing_coverage: unsupported holder kind {kind}")
        symbol = yahoo_symbol_for_listing(ticker, mic)
        import yfinance as yf

        yf_ticker = yf.Ticker(symbol)
        frame = (
            yf_ticker.institutional_holders
            if kind == "institutional"
            else yf_ticker.insider_transactions
        )
        normalized = normalize_holders(
            kind,
            frame_rows(frame),
            now_iso=_iso_utc_millis(datetime.now(UTC)),
            limit=limit,
        )
        if normalized is None:
            return None
        normalized["currency"] = _currency(currency) or currency
        return normalized

    def _ticker_info(self, symbol: str) -> dict[str, Any]:
        import yfinance as yf

        ticker = yf.Ticker(symbol)
        if hasattr(ticker, "get_info"):
            info = ticker.get_info()
        else:
            info = ticker.info
        return info if isinstance(info, dict) else {}

    def _ticker_history(self, symbol: str, timezone: str, range_start: str, range_end: str) -> Any:
        import yfinance as yf

        ticker = yf.Ticker(symbol)
        return ticker.history(
            start=_local_date_for_range(range_start, timezone).isoformat(),
            end=_local_date_for_range(range_end, timezone).isoformat(),
            interval="1d",
            auto_adjust=True,
        )


def _daily_bar_timestamp(row: dict[str, Any], timezone: str) -> datetime | None:
    value = row.get("date") or row.get("Date") or row.get("Datetime")
    if value is None:
        return None
    local_date = _date_value(value)
    if local_date is None:
        return None
    try:
        zone = ZoneInfo(timezone)
    except Exception:
        return None
    return datetime(local_date.year, local_date.month, local_date.day, tzinfo=zone).astimezone(UTC)


def _local_date_for_range(value: str, timezone: str) -> date:
    return _parse_utc_iso(value).astimezone(ZoneInfo(timezone)).date()


def _date_value(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if hasattr(value, "to_pydatetime"):
        try:
            return value.to_pydatetime().date()
        except Exception:
            return None
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _parse_utc_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _epoch_seconds_to_iso(value: float) -> str:
    return _iso_utc_millis(datetime.fromtimestamp(value, UTC))


def _iso_utc_millis(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _compact_exchange(value: str | None) -> str:
    if value is None:
        return ""
    return value.upper().replace(" ", "").replace("-", "").replace("_", "")


def _string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, int):
        return str(value)
    return None


def _currency(value: Any) -> str | None:
    raw = _string(value)
    if raw and len(raw) == 3 and raw.isalpha():
        return raw.upper()
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if isfinite(number) else None
    return None


def _positive_number(*values: Any) -> float | None:
    for value in values:
        number = _number(value)
        if number is not None and number > 0:
            return number
    return None


def _nonnegative_number(*values: Any) -> float | None:
    for value in values:
        number = _number(value)
        if number is not None and number >= 0:
            return number
    return None
