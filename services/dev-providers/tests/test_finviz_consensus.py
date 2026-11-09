import unittest
from decimal import Decimal

import requests
from finvizfinance.exceptions import FinvizBlockedError

from dev_providers.finviz_consensus import (
    FinvizLayoutChanged,
    consensus_cells,
    finviz_failure,
    parse_number,
    parse_percent,
)

AAPL_2026_11_09 = {
    "EPS next Q": "2.90",
    "EPS next Y": "10.46",
    "EPS this Y": "5.11%",
    "EPS next Y Percentage": "10.77%",
    "EPS next 5Y": "8.18%",
    "Target Price": "339.72",
    "Recom": "2.29",
}


def http_error(status: int) -> requests.exceptions.HTTPError:
    # finvizfinance re-raises raise_for_status's error without the response, chained to the original.
    response = requests.Response()
    response.status_code = status
    try:
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as err:
            raise requests.exceptions.HTTPError(f"HTTP error for URL x: {err}") from err
    except requests.exceptions.HTTPError as wrapped:
        return wrapped


class ParserTests(unittest.TestCase):
    def test_number_cells(self):
        self.assertEqual(parse_number("2.90"), Decimal("2.90"))
        self.assertEqual(parse_number("339.72"), Decimal("339.72"))
        self.assertEqual(parse_number("2.29"), Decimal("2.29"))
        self.assertEqual(parse_number("-0.15"), Decimal("-0.15"))
        self.assertEqual(parse_number("1,204.50"), Decimal("1204.50"))
        self.assertIsNone(parse_number("-"))
        self.assertIsNone(parse_number("NaN"))
        self.assertIsNone(parse_number("10.77%"))

    def test_percent_cells(self):
        self.assertEqual(parse_percent("10.77%"), Decimal("10.77"))
        self.assertEqual(parse_percent("-3.40%"), Decimal("-3.40"))
        self.assertIsNone(parse_percent("-"))
        self.assertIsNone(parse_percent("10.77"))


class ConsensusCellsTests(unittest.TestCase):
    def test_reads_every_field_verbatim_with_its_value_unit_and_period(self):
        self.assertEqual(
            consensus_cells({**AAPL_2026_11_09, "Target Price": "-", "Industry": None}),
            [
                {"field_key": "eps_next_q", "raw_label": "EPS next Q", "raw_value": "2.90", "value": "2.90", "unit": "usd_per_share", "period": "next_q"},
                {"field_key": "eps_next_y", "raw_label": "EPS next Y", "raw_value": "10.46", "value": "10.46", "unit": "usd_per_share", "period": "next_y"},
                {"field_key": "eps_growth_this_y", "raw_label": "EPS this Y", "raw_value": "5.11%", "value": "5.11", "unit": "percent", "period": "this_y"},
                {"field_key": "eps_growth_next_y", "raw_label": "EPS next Y Percentage", "raw_value": "10.77%", "value": "10.77", "unit": "percent", "period": "next_y"},
                {"field_key": "eps_growth_next_5y", "raw_label": "EPS next 5Y", "raw_value": "8.18%", "value": "8.18", "unit": "percent", "period": None},
                {"field_key": "target_price", "raw_label": "Target Price", "raw_value": "-", "value": None, "unit": "usd", "period": None},
                {"field_key": "recommendation_mean", "raw_label": "Recom", "raw_value": "2.29", "value": "2.29", "unit": "recommendation_1_to_5", "period": None},
            ],
        )

    def test_a_missing_cell_is_a_layout_change_not_an_empty_value(self):
        page = {key: value for key, value in AAPL_2026_11_09.items() if key != "Recom"}
        with self.assertRaisesRegex(FinvizLayoutChanged, "no 'Recom' cell"):
            consensus_cells(page)


class FailureTests(unittest.TestCase):
    def test_a_block_or_throttle_reads_as_rate_limited(self):
        self.assertEqual(finviz_failure(http_error(403)), ("rate_limited", True, "finviz: HTTP 403"))
        self.assertEqual(finviz_failure(http_error(429)), ("rate_limited", True, "finviz: HTTP 429"))
        self.assertEqual(finviz_failure(FinvizBlockedError(url="https://finviz.com/quote.ashx?t=AAPL"))[0], "rate_limited")

    def test_other_failures_do_not_stop_a_run(self):
        self.assertEqual(finviz_failure(http_error(404)), ("missing_coverage", False, "finviz: HTTP 404"))
        self.assertEqual(finviz_failure(FinvizLayoutChanged("finviz: no 'Recom' cell")), ("provider_error", False, "finviz: no 'Recom' cell"))
        self.assertEqual(finviz_failure(ValueError("missing_coverage: US only")), ("missing_coverage", False, "missing_coverage: US only"))


if __name__ == "__main__":
    unittest.main()
