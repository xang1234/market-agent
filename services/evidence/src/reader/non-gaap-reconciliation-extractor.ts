export type NonGaapValue = {
  label: string;
  value_num: number;
};

export type NonGaapAdjustment = NonGaapValue;

export type NonGaapReconciliationItem = {
  item_type: "non_gaap_reconciliation";
  measure_key: string;
  period_label: string | null;
  gaap: NonGaapValue;
  non_gaap: NonGaapValue;
  adjustments: ReadonlyArray<NonGaapAdjustment>;
  unit: "currency" | "number";
  currency?: string;
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

type TableRow = {
  cells: ReadonlyArray<string>;
};

type ParsedValue = {
  value_num: number;
  unit: "currency" | "number";
  currency?: string;
};

type GaapAnchor = {
  label: string;
  value: ParsedValue;
  measure_key: string;
  adjustments: NonGaapAdjustment[];
};

const NON_GAAP_PATTERN = /\bnon(?:[\s\u00a0]|[-\u2010-\u2015])*gaap\b/i;
const GAAP_PATTERN = /\bgaap\b/i;

export function extractNonGaapReconciliations(
  input: ExtractNonGaapReconciliationsInput,
): ExtractNonGaapReconciliationsResult {
  if (typeof input.html !== "string" || input.html.length === 0) {
    throw new Error("extractNonGaapReconciliations.html: must be a non-empty string");
  }

  const items: NonGaapReconciliationItem[] = [];
  for (const table of parseTables(input.html)) {
    const tableText = table.flatMap((row) => row.cells).join(" ");
    if (!NON_GAAP_PATTERN.test(tableText) || !GAAP_PATTERN.test(tableText)) continue;

    const periodLabels = readPeriodLabels(table);
    const anchors = new Map<number, GaapAnchor>();
    for (const row of table) {
      if (row.cells.length < 2) continue;
      const label = row.cells[0]!;

      if (isGaapLabel(label)) {
        for (const [column, value] of valuesByColumn(row)) {
          anchors.set(column, {
            label,
            value,
            measure_key: measureKeyFromLabel(label),
            adjustments: [],
          });
        }
        continue;
      }

      if (isNonGaapLabel(label)) {
        const measure_key = measureKeyFromLabel(label);
        for (const [column, value] of valuesByColumn(row)) {
          const anchor = anchors.get(column);
          if (!anchor || measure_key !== anchor.measure_key) continue;
          const item: NonGaapReconciliationItem = {
            item_type: "non_gaap_reconciliation",
            measure_key,
            period_label: periodLabels.get(column) ?? null,
            gaap: Object.freeze({
              label: anchor.label,
              value_num: anchor.value.value_num,
            }),
            non_gaap: Object.freeze({
              label,
              value_num: value.value_num,
            }),
            adjustments: Object.freeze(anchor.adjustments.map((adjustment) => Object.freeze({ ...adjustment }))),
            unit: value.unit === "currency" || anchor.value.unit === "currency" ? "currency" : "number",
            source_id: input.source_id,
            as_of: input.as_of,
          };
          const currency = value.currency ?? anchor.value.currency;
          if (currency !== undefined) item.currency = currency;
          items.push(Object.freeze(item));
          anchors.delete(column);
        }
        continue;
      }

      for (const [column, value] of valuesByColumn(row)) {
        const anchor = anchors.get(column);
        if (anchor) {
          anchor.adjustments.push(Object.freeze({ label, value_num: value.value_num }));
        }
      }
    }
  }

  return Object.freeze({ items: Object.freeze(items) });
}

function parseTables(html: string): ReadonlyArray<ReadonlyArray<TableRow>> {
  const tables: TableRow[][] = [];
  const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  for (const tableMatch of html.matchAll(tablePattern)) {
    const rows: TableRow[] = [];
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    for (const rowMatch of (tableMatch[1] ?? "").matchAll(rowPattern)) {
      const cells: string[] = [];
      const cellPattern = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      for (const cellMatch of (rowMatch[1] ?? "").matchAll(cellPattern)) {
        cells.push(textContent(cellMatch[1] ?? ""));
      }
      if (cells.length > 0) rows.push(Object.freeze({ cells: Object.freeze(cells) }));
    }
    if (rows.length > 0) tables.push(rows);
  }
  return Object.freeze(tables.map((table) => Object.freeze(table)));
}

function readPeriodLabels(table: ReadonlyArray<TableRow>): Map<number, string> {
  const labels = new Map<number, string>();
  for (const row of table) {
    for (let column = 1; column < row.cells.length; column++) {
      const cell = row.cells[column]!;
      if (/fiscal|quarter|year|month|ended|\d{4}/i.test(cell)) {
        labels.set(column, cell);
      }
    }
  }
  return labels;
}

function valuesByColumn(row: TableRow): ReadonlyArray<readonly [number, ParsedValue]> {
  const values: Array<readonly [number, ParsedValue]> = [];
  for (let column = 1; column < row.cells.length; column++) {
    const value = parseValue(row.cells[column]!);
    if (value) values.push([column, value]);
  }
  return values;
}

function isGaapLabel(label: string): boolean {
  return GAAP_PATTERN.test(label) && !NON_GAAP_PATTERN.test(label);
}

function isNonGaapLabel(label: string): boolean {
  return NON_GAAP_PATTERN.test(label);
}

function measureKeyFromLabel(label: string): string {
  const normalized = label
    .replace(NON_GAAP_PATTERN, "")
    .replace(GAAP_PATTERN, "")
    .replace(/\badjusted\b/gi, "")
    .replace(/\([^)]*\)/g, "")
    .trim()
    .toLowerCase();

  if (/operating\s+(income|loss)/.test(normalized)) return "operating_income";
  if (/net\s+(income|loss)/.test(normalized)) return "net_income";
  if (/gross\s+profit|gross\s+margin/.test(normalized)) return "gross_profit";
  if (/earnings per share|eps/.test(normalized)) return "eps_diluted";
  if (/ebitda/.test(normalized)) return "ebitda";
  return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseValue(raw: string): ParsedValue | null {
  const text = raw.trim();
  const negative = /^\(.*\)$/.test(text);
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
  return decodeHtml(raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function decodeHtml(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}
