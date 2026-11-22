export type NonGaapValue = {
  label: string;
  value_num: number;
};

export type NonGaapAdjustment = NonGaapValue;

// The table's own "(In millions ...)" note, which every figure in it is in.
export type TableScale = "thousands" | "millions" | "billions";

export type NonGaapReconciliationItem = {
  item_type: "non_gaap_reconciliation";
  measure_key: string;
  period_label: string | null;
  gaap: NonGaapValue;
  non_gaap: NonGaapValue;
  adjustments: ReadonlyArray<NonGaapAdjustment>;
  unit: "currency" | "number";
  currency?: string;
  scale?: TableScale;
  source_id: string;
  as_of: string;
};

export type ExtractNonGaapReconciliationsInput = {
  html: string;
  source_id: string;
  as_of: string;
};

export type ExtractNonGaapReconciliationsResult = {
  items: ReadonlyArray<NonGaapReconciliationItem>;
};

// A cell at the column it starts in, once every cell before it in the row is
// counted by its colspan, so a header spanning a period's cells labels each.
type TableCell = { text: string; column: number; span: number };

type ParsedValue = {
  value_num: number;
  unit: "currency" | "number";
  currency?: string;
};

export type TableRow = {
  // The first column's text.
  label: string;
  values: ReadonlyArray<readonly [number, ParsedValue]>;
};

export type ParsedTable = {
  rows: ReadonlyArray<TableRow>;
  // Each value column's period, from the header rows' cells that span it.
  periodLabels: ReadonlyMap<number, string>;
  scale?: TableScale;
  text: string;
};

type GaapAnchor = {
  label: string;
  value: ParsedValue;
  measure_key: string;
  adjustments: NonGaapAdjustment[];
};

const NON_GAAP_PATTERN = /\bnon(?:[\s ]|[-‐-―])*gaap\b/i;
const GAAP_PATTERN = /\bgaap\b/i;
const PERIOD_PATTERN = /fiscal|quarter|year|month|week|ended|\d{4}/i;
const BARE_YEAR = /^(?:19|20)\d{2}$/;
// A margin is a ratio of the reconciled figures, never one of them.
const MARGIN_PATTERN = /\bmargins?\b/i;

export function extractNonGaapReconciliations(
  input: ExtractNonGaapReconciliationsInput,
): ExtractNonGaapReconciliationsResult {
  if (typeof input.html !== "string" || input.html.length === 0) {
    throw new Error("extractNonGaapReconciliations.html: must be a non-empty string");
  }

  const items: NonGaapReconciliationItem[] = [];
  for (const table of readTables(input.html)) {
    if (!NON_GAAP_PATTERN.test(table.text) || !GAAP_PATTERN.test(table.text)) continue;

    const anchors = new Map<number, GaapAnchor>();
    // The last row with a label and no figures, which names the measure of a
    // row labelled "GAAP" or "Non-GAAP" alone.
    let section = "";
    for (const { label, values } of table.rows) {
      if (label === "") continue;
      if (values.length === 0) {
        section = label;
        continue;
      }
      if (MARGIN_PATTERN.test(label)) continue;

      if (isGaapLabel(label)) {
        const measure_key = measureKeyFromLabel(label) || measureKeyFromLabel(section);
        for (const [column, value] of values) {
          anchors.set(column, { label, value, measure_key, adjustments: [] });
        }
        continue;
      }

      const closing = NON_GAAP_PATTERN.test(label) ? measureKeyFromLabel(label) || measureKeyFromLabel(section) : null;
      // A total of the adjustments restates them, so it is none itself.
      if (closing !== null && /^total\b/i.test(label)) continue;
      for (const [column, value] of values) {
        const anchor = anchors.get(column);
        if (!anchor) continue;
        if (closing !== anchor.measure_key) {
          // A non-GAAP row that closes nothing, such as the tax impact of the adjustments, is one.
          anchor.adjustments.push(Object.freeze({ label, value_num: value.value_num }));
          continue;
        }
        const item: NonGaapReconciliationItem = {
          item_type: "non_gaap_reconciliation",
          measure_key: closing,
          period_label: table.periodLabels.get(column) ?? null,
          gaap: Object.freeze({ label: anchor.label, value_num: anchor.value.value_num }),
          non_gaap: Object.freeze({ label, value_num: value.value_num }),
          adjustments: Object.freeze([...anchor.adjustments]),
          unit: value.unit === "currency" || anchor.value.unit === "currency" ? "currency" : "number",
          source_id: input.source_id,
          as_of: input.as_of,
        };
        const currency = value.currency ?? anchor.value.currency;
        if (currency !== undefined) item.currency = currency;
        if (table.scale !== undefined) item.scale = table.scale;
        items.push(Object.freeze(item));
        anchors.delete(column);
      }
    }
  }

  return Object.freeze({ items: Object.freeze(items) });
}

// Every table in the markup, its rows read as a label and figures by column.
// The header rows are those above the first row with a label and a figure.
// ponytail: a header partway down a table is not read; the periods above apply.
export function readTables(html: string): ReadonlyArray<ParsedTable> {
  const tables: ParsedTable[] = [];
  for (const tableMatch of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows: TableRow[] = [];
    const periodLabels = new Map<number, string>();
    const texts: string[] = [];
    let inHeader = true;
    for (const rowMatch of (tableMatch[1] ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = rowCells(rowMatch[1] ?? "");
      if (cells.length === 0) continue;
      texts.push(...cells.map((cell) => cell.text));
      const label = cells[0]!.column === 0 ? cells[0]!.text : "";
      const figures = cells.filter((cell) => cell.column > 0);
      const values = valuesByColumn(figures);
      if (inHeader && label !== "" && figures.some((cell) => parseValue(cell.text) && !BARE_YEAR.test(cell.text))) inHeader = false;
      if (inHeader) {
        for (const cell of figures) {
          if (!PERIOD_PATTERN.test(cell.text)) continue;
          for (let column = cell.column; column < cell.column + cell.span; column++) {
            const above = periodLabels.get(column);
            periodLabels.set(column, above ? `${above} ${cell.text}` : cell.text);
          }
        }
      }
      rows.push(Object.freeze({ label, values: inHeader ? [] : values }));
    }
    if (rows.length === 0) continue;
    const text = texts.join(" ");
    const scale = /\bin\s+(thousands|millions|billions)\b/i.exec(text)?.[1]?.toLowerCase() as TableScale | undefined;
    tables.push(Object.freeze({ rows: Object.freeze(rows), periodLabels, text, ...(scale ? { scale } : {}) }));
  }
  return Object.freeze(tables);
}

function rowCells(row: string): TableCell[] {
  const cells: TableCell[] = [];
  let column = 0;
  for (const cellMatch of row.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
    const span = Math.max(1, Number(/\bcolspan\s*=\s*["']?(\d+)/i.exec(cellMatch[1] ?? "")?.[1] ?? 1));
    cells.push({ text: textContent(cellMatch[2] ?? ""), column, span });
    column += span;
  }
  return cells;
}

// A figure's currency sign may sit in the cell before it.
function valuesByColumn(cells: ReadonlyArray<TableCell>): ReadonlyArray<readonly [number, ParsedValue]> {
  const values: Array<readonly [number, ParsedValue]> = [];
  for (const [index, cell] of cells.entries()) {
    const value = parseValue(cell.text);
    if (!value) continue;
    if (value.currency === undefined && cells[index - 1]?.text === "$") {
      values.push([cell.column, { ...value, unit: "currency", currency: "USD" }]);
    } else {
      values.push([cell.column, value]);
    }
  }
  return values;
}

function isGaapLabel(label: string): boolean {
  return GAAP_PATTERN.test(label) && !NON_GAAP_PATTERN.test(label);
}

function measureKeyFromLabel(label: string): string {
  const normalized = label
    .replace(NON_GAAP_PATTERN, "")
    .replace(GAAP_PATTERN, "")
    .replace(/\badjusted\b/gi, "")
    .replace(/\([^)]*\)/g, "")
    .trim()
    .toLowerCase();

  if (/\bper\s+(?:diluted\s+|basic\s+)?(?:common\s+)?share\b|earnings per share|\beps\b/.test(normalized)) {
    return /\bbasic\b/.test(normalized) ? "eps_basic" : "eps_diluted";
  }
  if (/operating\s+(income|loss)/.test(normalized)) return "operating_income";
  if (/net\s+(income|loss)/.test(normalized)) return "net_income";
  if (/gross\s+profit/.test(normalized)) return "gross_profit";
  if (/ebitda/.test(normalized)) return "ebitda";
  return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// A figure as a release prints it: "$1,234", "(56)" or "(56" with its ")" in
// the next cell. A percent is no figure.
function parseValue(raw: string): ParsedValue | null {
  const text = raw.trim();
  const negative = /^\$?\s*\(/.test(text);
  const currency = text.includes("$") ? "USD" : undefined;
  const normalized = text.replace(/[,$\s()]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const parsed: ParsedValue = {
    value_num: negative ? -value : value,
    unit: currency ? "currency" : "number",
  };
  if (currency !== undefined) parsed.currency = currency;
  return parsed;
}

function textContent(raw: string): string {
  return decodeHtml(raw.replace(/<br\b[^>]*>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeHtml(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== "#") return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
