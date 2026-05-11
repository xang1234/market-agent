import unittest

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


if __name__ == "__main__":
    unittest.main()
