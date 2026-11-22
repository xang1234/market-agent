// A synthetic Item 2.02 8-K submission for a made-up company, its EX-99.1
// tables laid out as EDGAR's table builders write them: a label column, then
// per period a currency cell, the figure and a suffix cell (")" or "%"), a
// spacer cell between periods, and period headers spanning their columns. The
// reconciliation follows a common shape: gross profit and operating expenses
// itemise the add-backs, operating income and net income carry only a total,
// and diluted EPS sits under a section header. The numbers are invented.

export const EXAMPLE_CIK = 9999999;
export const EXAMPLE_ACCESSION = "0009999999-25-000042";
export const EXAMPLE_FILED_ON = "2025-11-19";

type Cell = string | number;

// Three quarters, then two nine-month periods.
const PERIODS = 5;

function figure(value: Cell, currency: boolean): string {
  if (value === "") return "<td></td><td></td><td></td>";
  if (typeof value === "string") return `<td></td><td>${value}</td><td></td>`;
  const text = Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 });
  const dollar = currency ? "<td>$</td>" : "<td></td>";
  return value < 0 ? `${dollar}<td>(${text}</td><td>)</td>` : `${dollar}<td>${text}</td><td></td>`;
}

function row(label: string, values: ReadonlyArray<Cell>, currency = false): string {
  if (values.length !== PERIODS) throw new Error(`${label}: ${values.length} values`);
  return `<tr><td><font>${label}</font></td>${values.map((value) => figure(value, currency)).join("<td></td>")}</tr>`;
}

function percentRow(label: string, values: ReadonlyArray<number>): string {
  return `<tr><td>${label}</td>${values.map((value) => `<td></td><td>${value.toFixed(1)}</td><td>%</td>`).join("<td></td>")}</tr>`;
}

const header = [
  `<tr><td></td><td colspan="11" style="text-align:center">Three Months Ended</td><td></td><td colspan="7" style="text-align:center">Nine Months Ended</td></tr>`,
  `<tr><td></td>${["October 26,<br>2025", "July 27,<br>2025", "October 27,<br>2024", "October 26,<br>2025", "October 27,<br>2024"]
    .map((date) => `<td colspan="3">${date}</td>`).join("<td></td>")}</tr>`,
].join("\n");

const INCOME_STATEMENT = [
  "<table>",
  `<tr><td colspan="20">EXAMPLE CORPORATION</td></tr>`,
  `<tr><td colspan="20">CONDENSED CONSOLIDATED STATEMENTS OF INCOME</td></tr>`,
  `<tr><td colspan="20">(In millions, except per share data)</td></tr>`,
  header,
  row("Revenue", [57_006, 46_743, 35_082, 147_811, 91_166], true),
  row("Cost of revenue", [15_157, 12_890, 8_926, 41_002, 23_370]),
  row("Gross profit", [41_849, 33_853, 26_156, 106_809, 67_796]),
  row("Operating income", [36_010, 28_440, 21_869, 89_455, 54_112]),
  row("Net income", [31_910, 26_422, 19_309, 76_000, 50_789], true),
  "</table>",
].join("\n");

const RECONCILIATION = [
  "<table>",
  `<tr><td colspan="20">EXAMPLE CORPORATION</td></tr>`,
  `<tr><td colspan="20">RECONCILIATION OF GAAP TO NON-GAAP FINANCIAL MEASURES</td></tr>`,
  `<tr><td colspan="20">(In millions, except per share data)</td></tr>`,
  header,
  row("GAAP gross profit", [41_849, 33_853, 26_156, 106_809, 67_796], true),
  percentRow("GAAP gross margin", [73.4, 72.4, 74.6, 72.3, 74.4]),
  row("Acquisition-related and other costs (A)", [122, 120, 118, 362, 350]),
  row("Stock-based compensation expense (B)", [178, 170, 150, 520, 430]),
  row("Other (C)", [-2, -1, 3, -4, 7]),
  row("Non-GAAP gross profit", [42_147, 34_142, 26_427, 107_687, 68_583], true),
  percentRow("Non-GAAP gross margin", [73.9, 73.0, 75.3, 72.9, 75.2]),
  row("GAAP operating expenses", [5_839, 5_413, 4_287, 17_354, 13_684], true),
  row("Stock-based compensation expense (B)", [-1_474, -1_400, -1_100, -4_200, -3_100]),
  row("Acquisition-related and other costs (A)", [-40, -38, -30, -115, -90]),
  row("Non-GAAP operating expenses", [4_325, 3_975, 3_157, 13_039, 10_494], true),
  row("GAAP operating income", [36_010, 28_440, 21_869, 89_455, 54_112], true),
  row("Total impact of non-GAAP adjustments to operating income", [1_812, 1_727, 1_401, 5_193, 3_977]),
  row("Non-GAAP operating income", [37_822, 30_167, 23_270, 94_648, 58_089], true),
  row("GAAP net income", [31_910, 26_422, 19_309, 76_000, 50_789], true),
  row("Total pre-tax impact of non-GAAP adjustments", [1_812, 1_727, 1_401, 5_193, 3_977]),
  row("Income tax impact of non-GAAP adjustments (D)", [-356, -340, -270, -1_020, -770]),
  row("Non-GAAP net income", [33_366, 27_809, 20_440, 80_173, 53_996], true),
  `<tr><td>Diluted net income per share</td></tr>`,
  row("GAAP", [1.3, 1.08, 0.78, 3.1, 2.04], true),
  row("Non-GAAP", [1.36, 1.13, 0.81, 3.27, 2.17], true),
  row("Weighted average shares used in diluted net income per share computation", [24_500, 24_532, 24_774, 24_515, 24_848]),
  "</table>",
].join("\n");

function document(type: string, body: string): string {
  return `<DOCUMENT>\n<TYPE>${type}\n<SEQUENCE>1\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>`;
}

export const EX99_RELEASE_HTML = `<html><body><p>Example Corporation Announces Financial Results for Third Quarter Fiscal 2026</p>\n${INCOME_STATEMENT}\n${RECONCILIATION}\n</body></html>`;

export const RELEASE_SUBMISSION = [
  `<SEC-DOCUMENT>${EXAMPLE_ACCESSION}.txt`,
  "<SEC-HEADER>ITEM INFORMATION: Results of Operations and Financial Condition</SEC-HEADER>",
  document("8-K", "<html><body>Item 2.02 Results of Operations and Financial Condition.</body></html>"),
  document("EX-99.1", EX99_RELEASE_HTML),
  document("EX-99.2", "<html><body><p>CFO commentary: revenue was a record.</p></body></html>"),
  document("EX-101.SCH", "<xs:schema>GAAP net income</xs:schema>"),
  "</SEC-DOCUMENT>",
].join("\n");
