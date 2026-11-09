from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

import requests
from finvizfinance.exceptions import FinvizBlockedError


class FinvizLayoutChanged(Exception):
    pass


def parse_number(cell: str) -> Decimal | None:
    try:
        value = Decimal(cell.strip().replace(",", ""))
    except InvalidOperation:
        return None
    return value if value.is_finite() else None


def parse_percent(cell: str) -> Decimal | None:
    stripped = cell.strip()
    return parse_number(stripped[:-1]) if stripped.endswith("%") else None


Unit = Literal["usd_per_share", "percent", "usd", "recommendation_1_to_5"]
# Finviz's own words for the fiscal period a cell covers; it never names the year.
Period = Literal["next_q", "this_y", "next_y"]


@dataclass(frozen=True)
class ConsensusField:
    key: str
    label: str
    parse: Callable[[str], Decimal | None]
    unit: Unit
    period: Period | None


# Labels as finvizfinance 1.5.0's ticker_fundament() keys them. Finviz shows
# "EPS next Y" twice (the estimate, then its growth); finvizfinance names the
# second "EPS next Y Percentage". db/migrations/0080 checks the same keys and units.
CONSENSUS_FIELDS: tuple[ConsensusField, ...] = (
    ConsensusField("eps_next_q", "EPS next Q", parse_number, "usd_per_share", "next_q"),
    ConsensusField("eps_next_y", "EPS next Y", parse_number, "usd_per_share", "next_y"),
    ConsensusField("eps_growth_this_y", "EPS this Y", parse_percent, "percent", "this_y"),
    ConsensusField("eps_growth_next_y", "EPS next Y Percentage", parse_percent, "percent", "next_y"),
    ConsensusField("eps_growth_next_5y", "EPS next 5Y", parse_percent, "percent", None),
    ConsensusField("target_price", "Target Price", parse_number, "usd", None),
    ConsensusField("recommendation_mean", "Recom", parse_number, "recommendation_1_to_5", None),
)


def consensus_cells(fundamentals: dict[str, Any]) -> list[dict[str, Any]]:
    cells = []
    for field in CONSENSUS_FIELDS:
        raw = fundamentals.get(field.label)
        if not isinstance(raw, str):
            raise FinvizLayoutChanged(f"finviz: no '{field.label}' cell")
        value = field.parse(raw)
        cells.append(
            {
                "field_key": field.key,
                "raw_label": field.label,
                "raw_value": raw,
                "value": None if value is None else str(value),
                "unit": field.unit,
                "period": field.period,
            }
        )
    return cells


BLOCKING_STATUSES = {403, 429}


def finviz_failure(exc: Exception) -> tuple[str, bool, str]:
    """(reason, retryable, detail) for a failed consensus read. rate_limited stops a capture run."""
    if isinstance(exc, FinvizBlockedError):
        return ("rate_limited", True, f"finviz: blocked ({exc})")
    if isinstance(exc, requests.exceptions.HTTPError):
        status = _http_status(exc)
        if status in BLOCKING_STATUSES:
            return ("rate_limited", True, f"finviz: HTTP {status}")
        if status == 404:
            return ("missing_coverage", False, "finviz: HTTP 404")
        return ("provider_error", True, f"finviz: HTTP {status}")
    if isinstance(exc, FinvizLayoutChanged):
        return ("provider_error", False, str(exc))
    if isinstance(exc, ValueError):
        return ("missing_coverage", False, str(exc))
    return ("provider_error", True, f"finviz: {exc}")


def _http_status(exc: requests.exceptions.HTTPError) -> int | None:
    # finvizfinance re-raises without the response, chained to the error that had it.
    for err in (exc, exc.__cause__):
        response = getattr(err, "response", None)
        if response is not None:
            return response.status_code
    return None
