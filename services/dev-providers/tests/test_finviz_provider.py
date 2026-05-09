import unittest

from dev_providers.finviz_provider import normalize_profile, finviz_symbol_for_listing


class FinvizProviderTests(unittest.TestCase):
    def test_profile_normalization_maps_clean_finviz_fundamentals(self):
        profile = normalize_profile(
            {
                "Sector": "Technology",
                "Industry": "Semiconductors",
                "Country": "USA",
            }
        )

        self.assertEqual(
            profile,
            {
                "sector": "Technology",
                "industry": "Semiconductors",
                "domicile": "USA",
            },
        )

    def test_profile_normalization_skips_empty_fields(self):
        self.assertEqual(normalize_profile({"Sector": "-", "Industry": "", "Country": "USA"}), {"domicile": "USA"})

    def test_finviz_symbol_for_listing_is_us_equity_only(self):
        self.assertEqual(finviz_symbol_for_listing("AMD", "XNAS"), "AMD")
        with self.assertRaisesRegex(ValueError, "missing_coverage"):
            finviz_symbol_for_listing("SHOP", "XTSE")


if __name__ == "__main__":
    unittest.main()
