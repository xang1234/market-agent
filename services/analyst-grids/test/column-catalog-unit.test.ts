import test from "node:test";
import assert from "node:assert/strict";

import { getColumn, listColumns } from "../src/column-catalog.ts";
import { readerQuestionProducer } from "../src/reader-question-column.ts";

test("the catalog offers every numerical column as deterministic and the question column as the one reader", () => {
  assert.deepEqual(listColumns(), [
    { column_key: "latest_revenue", label: "Revenue (latest)", kind: "deterministic" },
    { column_key: "latest_eps_diluted", label: "EPS diluted (latest)", kind: "deterministic" },
    { column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" },
    { column_key: "latest_operating_cash_flow", label: "Operating cash flow (latest FY)", kind: "deterministic" },
    { column_key: "latest_net_income", label: "Net income (latest FY)", kind: "deterministic" },
    { column_key: "latest_total_liabilities", label: "Total liabilities (latest FY end)", kind: "deterministic" },
    { column_key: "latest_total_assets", label: "Total assets (latest FY end)", kind: "deterministic" },
    { column_key: "latest_total_equity", label: "Stockholders' equity (latest FY end)", kind: "deterministic" },
    { column_key: "latest_cash_conversion", label: "Cash conversion: OCF / net income (latest FY)", kind: "deterministic" },
    { column_key: "latest_liabilities_to_assets", label: "Liabilities / assets (latest FY end)", kind: "deterministic" },
    { column_key: "latest_liabilities_to_equity", label: "Liabilities / equity (latest FY end)", kind: "deterministic" },
    { column_key: "reader_question", label: "Question", kind: "reader" },
  ]);
});

test("getColumn resolves reader_question to the reader producer", () => {
  assert.deepEqual(getColumn("reader_question"), { column_key: "reader_question", label: "Question", kind: "reader", producer: readerQuestionProducer });
});
