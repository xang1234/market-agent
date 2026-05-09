from __future__ import annotations

from typing import Any


US_EQUITY_MICS = {"ARCX", "BATS", "IEXG", "XASE", "XNAS", "XNYS"}


def normalize_profile(fundamentals: dict[str, Any]) -> dict[str, str]:
    profile: dict[str, str] = {}
    _copy_clean(profile, "sector", fundamentals.get("Sector") or fundamentals.get("sector"))
    _copy_clean(profile, "industry", fundamentals.get("Industry") or fundamentals.get("industry"))
    _copy_clean(profile, "domicile", fundamentals.get("Country") or fundamentals.get("country"))
    return profile


def finviz_symbol_for_listing(ticker: str, mic: str) -> str:
    if mic.strip().upper() not in US_EQUITY_MICS:
        raise ValueError(f"missing_coverage: Finviz profile fallback only supports US equity MICs, got {mic}")
    return ticker.strip().upper().replace(".", "-")


class FinvizProvider:
    def profile(self, *, ticker: str, mic: str) -> dict[str, str]:
        symbol = finviz_symbol_for_listing(ticker, mic)
        fundamentals = self._ticker_fundamentals(symbol)
        return normalize_profile(fundamentals)

    def _ticker_fundamentals(self, symbol: str) -> dict[str, Any]:
        from finvizfinance.quote import finvizfinance

        stock = finvizfinance(symbol)
        fundamentals = stock.ticker_fundament()
        return fundamentals if isinstance(fundamentals, dict) else {}


def _copy_clean(out: dict[str, str], key: str, value: Any) -> None:
    if not isinstance(value, str):
        return
    cleaned = value.strip()
    if not cleaned or cleaned in {"-", "N/A", "n/a"}:
        return
    out[key] = cleaned
