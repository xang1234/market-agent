from __future__ import annotations

import re
from datetime import UTC, date, datetime
from math import isfinite
from typing import Any
from zoneinfo import ZoneInfo


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

HOLDER_KINDS = {"institutional", "insider"}


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


def normalize_earnings_events(
    rows: list[dict[str, Any]],
    period_ends: list[Any],
    *,
    now_iso: str,
    limit: int = 8,
) -> dict[str, Any] | None:
    reported: list[dict[str, Any]] = []
    for row in rows:
        release = _date_value(row.get("Earnings Date") or row.get("Date") or row.get("date"))
        actual = _number(row.get("Reported EPS"))
        if release is None or actual is None:
            continue
        reported.append(
            {
                "release": release,
                "eps_actual": actual,
                "eps_estimate_at_release": _number(row.get("EPS Estimate")),
            }
        )

    if not reported:
        return None

    reported.sort(key=lambda row: row["release"], reverse=True)
    periods = sorted(
        [value for value in (_date_value(period) for period in period_ends) if value is not None],
        reverse=True,
    )
    events: list[dict[str, Any]] = []
    for index, row in enumerate(reported[:limit]):
        release = row["release"]
        period_end = periods[index] if index < len(periods) else _previous_quarter_end(release)
        fiscal_year, fiscal_period = _fiscal_period_from_release(release)
        events.append(
            {
                "release_date": release.isoformat(),
                "period_end": period_end.isoformat(),
                "fiscal_year": fiscal_year,
                "fiscal_period": fiscal_period,
                "eps_actual": row["eps_actual"],
                "eps_estimate_at_release": row["eps_estimate_at_release"],
                "as_of": now_iso,
            }
        )

    return {"events": events, "as_of": now_iso}


def normalize_holders(
    kind: str,
    rows: list[dict[str, Any]],
    *,
    now_iso: str,
    limit: int = 12,
) -> dict[str, Any] | None:
    if kind == "institutional":
        holders = _normalize_institutional_holders(rows, limit=limit)
    elif kind == "insider":
        holders = _normalize_insider_holders(rows, limit=limit)
    else:
        raise ValueError(f"missing_coverage: unsupported holder kind {kind}")
    if not holders:
        return None
    return {"holders": holders, "as_of": now_iso}


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
            _history_rows(frame),
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
            _frame_rows(frame),
            _frame_columns(getattr(yf_ticker, "quarterly_income_stmt", None)),
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
            _frame_rows(frame),
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


def _history_rows(frame: Any) -> list[dict[str, Any]]:
    if frame is None:
        return []
    try:
        if frame.empty:
            return []
        reset = frame.reset_index()
        return list(reset.to_dict("records"))
    except AttributeError:
        return frame if isinstance(frame, list) else []


def _frame_rows(frame: Any) -> list[dict[str, Any]]:
    if frame is None:
        return []
    if isinstance(frame, list):
        return frame
    try:
        if frame.empty:
            return []
        return list(frame.reset_index().to_dict("records"))
    except AttributeError:
        return []


def _frame_columns(frame: Any) -> list[Any]:
    if frame is None:
        return []
    try:
        return list(frame.columns)
    except AttributeError:
        return []


def _normalize_institutional_holders(rows: list[dict[str, Any]], *, limit: int) -> list[dict[str, Any]]:
    holders: list[dict[str, Any]] = []
    for row in rows:
        name = _string(_field(row, "Holder", "holder_name"))
        shares = _nonnegative_number(_field(row, "Shares", "shares_held"))
        market_value = _nonnegative_number(_field(row, "Value", "market_value"))
        pct_held = _number(_field(row, "pctHeld", "percent_of_shares_outstanding"))
        filing_date = _date_value(_field(row, "Date Reported", "filing_date", "Date"))
        if name is None or shares is None or market_value is None or pct_held is None or filing_date is None:
            continue
        shares_int = int(round(shares))
        holders.append(
            {
                "holder_name": name,
                "shares_held": shares_int,
                "market_value": market_value,
                "percent_of_shares_outstanding": round(pct_held * 100 if pct_held <= 1 else pct_held, 4),
                "shares_change": _institutional_shares_change(shares_int, _field(row, "pctChange")),
                "filing_date": filing_date.isoformat(),
            }
        )
    holders.sort(key=lambda holder: (holder["filing_date"], holder["shares_held"]), reverse=True)
    return holders[:limit]


def _normalize_insider_holders(rows: list[dict[str, Any]], *, limit: int) -> list[dict[str, Any]]:
    holders: list[dict[str, Any]] = []
    for row in rows:
        name = _string(_field(row, "Insider", "insider_name"))
        role = _string(_field(row, "Position", "insider_role")) or "Insider"
        transaction_date = _date_value(_field(row, "Transaction Start Date", "Start Date", "transaction_date"))
        shares = _nonnegative_number(_field(row, "Shares", "shares"))
        if name is None or transaction_date is None or shares is None:
            continue

        text = _string(_field(row, "Text")) or ""
        value = _nonnegative_number(_field(row, "Value", "value"))
        shares_int = int(round(shares))
        price = _insider_price(text, shares_int, value)
        if value is None:
            price = None
        holders.append(
            {
                "insider_name": name,
                "insider_role": role,
                "transaction_date": transaction_date.isoformat(),
                "transaction_type": _insider_transaction_type(text),
                "shares": shares_int,
                "price": price,
                "value": value,
            }
        )
    holders.sort(key=lambda holder: holder["transaction_date"], reverse=True)
    return holders[:limit]


def _institutional_shares_change(shares: int, value: Any) -> int:
    pct_change = _number(value)
    if pct_change is None or pct_change <= -1:
        return 0
    previous = shares / (1 + pct_change)
    return int(round(shares - previous))


def _insider_price(text: str, shares: int, value: float | None) -> float | None:
    if value is not None and shares > 0:
        return round(value / shares, 4)
    price_match = re.search(r"price\s+([0-9]+(?:\.[0-9]+)?)", text, flags=re.IGNORECASE)
    if price_match is None:
        return None
    return float(price_match.group(1))


def _insider_transaction_type(text: str) -> str:
    normalized = text.lower()
    if "gift" in normalized:
        return "gift"
    if "sale" in normalized or "sell" in normalized:
        return "sell"
    if "purchase" in normalized or "buy" in normalized:
        return "buy"
    if "option" in normalized or "exercise" in normalized:
        return "option_exercise"
    return "other"


def _fiscal_period_from_release(release: date) -> tuple[int, str]:
    quarter = ((release.month - 1) // 3) + 1
    return release.year, f"Q{quarter}"


def _previous_quarter_end(release: date) -> date:
    quarter = ((release.month - 1) // 3) + 1
    if quarter == 1:
        return date(release.year - 1, 12, 31)
    if quarter == 2:
        return date(release.year, 3, 31)
    if quarter == 3:
        return date(release.year, 6, 30)
    return date(release.year, 9, 30)


def _field(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in row and row[name] is not None:
            return row[name]
    return None


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
