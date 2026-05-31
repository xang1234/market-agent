import unittest

from dev_providers.yfinance_fundamentals import (
    normalize_earnings_events,
    normalize_holders,
)
from dev_providers.yfinance_provider import (
    normalize_daily_bars,
    normalize_reference_listing,
    normalize_quote,
    yahoo_symbol_for_listing,
)


class YFinanceProviderTests(unittest.TestCase):
    def test_reference_listing_maps_clean_us_equity(self):
        listing = normalize_reference_listing(
            "amd",
            {
                "symbol": "AMD",
                "longName": "Advanced Micro Devices, Inc.",
                "quoteType": "EQUITY",
                "exchange": "NMS",
                "currency": "USD",
                "timeZoneFullName": "America/New_York",
                "cik": "0000002488",
            },
        )

        self.assertEqual(
            listing,
            {
                "ticker": "AMD",
                "legal_name": "Advanced Micro Devices, Inc.",
                "mic": "XNAS",
                "trading_currency": "USD",
                "timezone": "America/New_York",
                "asset_type": "common_stock",
                "cik": "0000002488",
            },
        )

    def test_reference_listing_skips_unsupported_or_incomplete_payloads(self):
        self.assertIsNone(normalize_reference_listing("AMD", {"symbol": "AMD", "quoteType": "CRYPTOCURRENCY"}))
        self.assertIsNone(
            normalize_reference_listing(
                "AMD",
                {
                    "symbol": "AMD",
                    "longName": "Advanced Micro Devices, Inc.",
                    "quoteType": "EQUITY",
                    "exchange": "UNKNOWN",
                    "currency": "USD",
                },
            ),
        )

    def test_yahoo_symbol_for_listing_uses_explicit_mic_suffixes(self):
        self.assertEqual(yahoo_symbol_for_listing("AAPL", "XNAS"), "AAPL")
        self.assertEqual(yahoo_symbol_for_listing("SHOP", "XTSE"), "SHOP.TO")
        self.assertEqual(yahoo_symbol_for_listing("7203", "XTKS"), "7203.T")
        with self.assertRaisesRegex(ValueError, "missing_coverage"):
            yahoo_symbol_for_listing("ABC", "UNKNOWN")

    def test_quote_normalization_uses_market_fields_and_epoch_timestamp(self):
        quote = normalize_quote(
            {
                "regularMarketPrice": 189.5,
                "regularMarketPreviousClose": 187.25,
                "regularMarketTime": 1778269500,
                "marketState": "REGULAR",
                "currency": "USD",
            },
            fallback_currency="USD",
            now_iso="2026-05-08T20:00:00.000Z",
        )

        self.assertEqual(quote["price"], 189.5)
        self.assertEqual(quote["prev_close"], 187.25)
        self.assertEqual(quote["session_state"], "regular")
        self.assertEqual(quote["as_of"], "2026-05-08T19:45:00.000Z")
        self.assertEqual(quote["delay_class"], "delayed_15m")

    def test_daily_bar_normalization_converts_dates_to_listing_timezone_midnight(self):
        bars = normalize_daily_bars(
            [
                {
                    "date": "2026-05-07",
                    "Open": 187.0,
                    "High": 190.0,
                    "Low": 186.0,
                    "Close": 189.0,
                    "Volume": 10000,
                }
            ],
            timezone="America/New_York",
            range_start="2026-05-07T04:00:00.000Z",
            range_end="2026-05-08T04:00:00.000Z",
        )

        self.assertEqual(
            bars,
            [
                {
                    "ts": "2026-05-07T04:00:00.000Z",
                    "open": 187.0,
                    "high": 190.0,
                    "low": 186.0,
                    "close": 189.0,
                    "volume": 10000.0,
                }
            ],
        )

    def test_earnings_normalization_uses_latest_reported_yfinance_rows(self):
        earnings = normalize_earnings_events(
            [
                {
                    "Earnings Date": "2026-07-30 16:00:00-04:00",
                    "EPS Estimate": 1.90,
                    "Reported EPS": None,
                },
                {
                    "Earnings Date": "2026-04-30 16:00:00-04:00",
                    "EPS Estimate": 1.94,
                    "Reported EPS": 2.01,
                },
                {
                    "Earnings Date": "2026-01-29 16:00:00-05:00",
                    "EPS Estimate": 2.67,
                    "Reported EPS": 2.84,
                },
            ],
            ["2026-03-31", "2025-12-31"],
            now_iso="2026-05-31T12:00:00.000Z",
            limit=2,
        )

        self.assertEqual(earnings["as_of"], "2026-05-31T12:00:00.000Z")
        self.assertEqual(
            earnings["events"],
            [
                {
                    "release_date": "2026-04-30",
                    "period_end": "2026-03-31",
                    "eps_actual": 2.01,
                    "eps_estimate_at_release": 1.94,
                    "as_of": "2026-05-31T12:00:00.000Z",
                },
                {
                    "release_date": "2026-01-29",
                    "period_end": "2025-12-31",
                    "eps_actual": 2.84,
                    "eps_estimate_at_release": 2.67,
                    "as_of": "2026-05-31T12:00:00.000Z",
                },
            ],
        )

    def test_earnings_normalization_does_not_pair_a_release_with_a_future_period_end(self):
        earnings = normalize_earnings_events(
            [
                {
                    "Earnings Date": "2026-01-29 16:00:00-05:00",
                    "EPS Estimate": 2.67,
                    "Reported EPS": 2.84,
                },
            ],
            ["2026-03-31", "2025-12-31"],
            now_iso="2026-05-31T12:00:00.000Z",
            limit=1,
        )

        self.assertIsNotNone(earnings)
        self.assertEqual(earnings["events"][0]["period_end"], "2025-12-31")

    def test_earnings_normalization_skips_releases_without_observed_period_end(self):
        earnings = normalize_earnings_events(
            [
                {
                    "Earnings Date": "2026-01-29 16:00:00-05:00",
                    "EPS Estimate": 2.67,
                    "Reported EPS": 2.84,
                },
            ],
            ["2026-03-31"],
            now_iso="2026-05-31T12:00:00.000Z",
            limit=1,
        )

        self.assertIsNone(earnings)

    def test_holder_normalization_maps_yfinance_institutional_and_insider_rows(self):
        institutional = normalize_holders(
            "institutional",
            [
                {
                    "Date Reported": "2026-03-31",
                    "Holder": "Blackrock Inc.",
                    "Shares": 1_144_695_425,
                    "Value": 357_213_651_530,
                    "pctHeld": 0.0779,
                    "pctChange": -0.0086,
                }
            ],
            now_iso="2026-05-31T12:00:00.000Z",
            limit=5,
        )
        self.assertEqual(institutional["as_of"], "2026-05-31T12:00:00.000Z")
        self.assertEqual(institutional["holders"][0]["filing_date"], "2026-03-31")
        self.assertEqual(institutional["holders"][0]["percent_of_shares_outstanding"], 7.79)
        self.assertLess(institutional["holders"][0]["shares_change"], 0)

        insider = normalize_holders(
            "insider",
            [
                {
                    "Insider": "BORDERS BEN",
                    "Position": "Officer",
                    "Start Date": "2026-05-08",
                    "Text": "Sale at price 290.00 per share.",
                    "Shares": 1274,
                    "Value": 369460.0,
                },
                {
                    "Insider": "LEVINSON ARTHUR D",
                    "Position": "Director",
                    "Transaction Start Date": "2026-05-06",
                    "Text": "Stock Gift at price 0.00 per share.",
                    "Shares": 5000,
                    "Value": 0.0,
                },
            ],
            now_iso="2026-05-31T12:00:00.000Z",
            limit=5,
        )
        self.assertEqual(insider["holders"][0]["transaction_type"], "sell")
        self.assertEqual(insider["holders"][0]["price"], 290.0)
        self.assertEqual(insider["holders"][1]["transaction_type"], "gift")
        self.assertEqual(insider["holders"][1]["value"], 0.0)


if __name__ == "__main__":
    unittest.main()
