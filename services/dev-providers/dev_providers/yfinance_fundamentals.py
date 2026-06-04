from __future__ import annotations

import re
from collections.abc import Callable
from datetime import date, datetime
from math import isfinite
from typing import Any


HOLDER_KINDS = {"institutional", "insider"}


def frame_rows(frame: Any) -> list[dict[str, Any]]:
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


def frame_columns(frame: Any) -> list[Any]:
    if frame is None:
        return []
    try:
        return list(frame.columns)
    except AttributeError:
        return []


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

    periods = sorted(
        [value for value in (_date_value(period) for period in period_ends) if value is not None],
        reverse=True,
    )
    events = select_earnings_events(reported, periods, now_iso=now_iso, limit=limit)

    if not events:
        return None

    return {"events": events, "as_of": now_iso}


PeriodMatcher = Callable[[date, list[date], set[date]], date | None]


def select_earnings_events(
    reported: list[dict[str, Any]],
    periods: list[date],
    *,
    now_iso: str,
    limit: int,
    period_matcher: PeriodMatcher | None = None,
) -> list[dict[str, Any]]:
    matcher = period_matcher or _period_end_for_release
    ordered = sorted(reported, key=lambda row: row["release"], reverse=True)
    events: list[dict[str, Any]] = []
    used_periods: set[date] = set()
    for row in ordered:
        if len(events) >= limit:
            break
        release = row["release"]
        period_end = matcher(release, periods, used_periods)
        if period_end is None:
            continue
        used_periods.add(period_end)
        events.append(
            {
                "release_date": release.isoformat(),
                "period_end": period_end.isoformat(),
                "eps_actual": row["eps_actual"],
                "eps_estimate_at_release": row["eps_estimate_at_release"],
                "as_of": now_iso,
            }
        )
    return events


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


def _period_end_for_release(
    release: date,
    periods: list[date],
    used_periods: set[date],
) -> date | None:
    candidates = [period for period in periods if period < release and period not in used_periods]
    return max(candidates) if candidates else None


def _field(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in row and row[name] is not None:
            return row[name]
    return None


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


def _string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, int):
        return str(value)
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if isfinite(number) else None
    return None


def _nonnegative_number(*values: Any) -> float | None:
    for value in values:
        number = _number(value)
        if number is not None and number >= 0:
            return number
    return None


def _nonnegative_int(value: Any) -> int | None:
    number = _nonnegative_number(value)
    if number is None:
        return None
    return int(round(number))


def normalize_analyst_consensus(
    info: dict[str, Any],
    recommendation_rows: list[dict[str, Any]],
    *,
    now_iso: str,
) -> dict[str, Any] | None:
    analyst_count = _nonnegative_int(info.get("numberOfAnalystOpinions"))
    price_target = _consensus_price_target(info)
    rating_distribution = _consensus_rating_distribution(recommendation_rows)
    if analyst_count is None and price_target is None and rating_distribution is None:
        return None
    return {
        "as_of": now_iso,
        "analyst_count": analyst_count or 0,
        "rating_distribution": rating_distribution,
        "price_target": price_target,
    }


def _consensus_price_target(info: dict[str, Any]) -> dict[str, float] | None:
    low = _number(info.get("targetLowPrice"))
    mean = _number(info.get("targetMeanPrice"))
    median = _number(info.get("targetMedianPrice"))
    high = _number(info.get("targetHighPrice"))
    if low is None or mean is None or high is None:
        return None
    return {
        "low": low,
        "mean": mean,
        "median": median if median is not None else mean,
        "high": high,
    }


def _consensus_rating_distribution(rows: list[dict[str, Any]]) -> dict[str, int] | None:
    row = _latest_recommendation_row(rows)
    if row is None:
        return None
    counts = {
        "strong_buy": _nonnegative_int(_field(row, "strongBuy", "strong_buy")) or 0,
        "buy": _nonnegative_int(_field(row, "buy")) or 0,
        "hold": _nonnegative_int(_field(row, "hold")) or 0,
        "sell": _nonnegative_int(_field(row, "sell")) or 0,
        "strong_sell": _nonnegative_int(_field(row, "strongSell", "strong_sell")) or 0,
    }
    return counts if sum(counts.values()) > 0 else None


def _latest_recommendation_row(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not rows:
        return None
    # yfinance recommendations_summary: the most recent window is period '0m'.
    for row in rows:
        if str(_field(row, "period", "Period") or "").strip() == "0m":
            return row
    return rows[0]
