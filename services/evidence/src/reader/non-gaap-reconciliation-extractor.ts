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

// A cell on the table's grid: the column it starts in, once the cells before
// it in its row and those spanning down from rows above are counted, and how
// many columns it spans. A cell spanning rows sits in each row it covers.
type GridCell = { text: string; column: number; span: number };

type ParsedValue = {
  value_num: number;
  unit: "currency" | "number" | "percent";
  currency?: string;
};

// A figure and the columns it covers with the "$" cell before it.
type Figure = { first: number; last: number; value: ParsedValue; year: boolean };

export type TableRow = {
  // The first text left of the table's figures, past any blank cells that indent it.
  label: string;
  // Each figure by its slot.
  values: ReadonlyArray<readonly [slot: number, ParsedValue]>;
};

// A slot is one column of figures: the grid columns the figures cover, those
// that overlap being one, so "$" | "1,270" lines up with a "419" printed across both.
export type ParsedTable = {
  rows: ReadonlyArray<TableRow>;
  // Each slot's header: the text of every header cell over it, top to bottom.
  periods: ReadonlyArray<string>;
  scale?: TableScale;
  text: string;
};

type GaapAnchor = {
  label: string;
  value: ParsedValue;
  measure_key: string;
  adjustments: NonGaapAdjustment[];
};

const NON_GAAP_PATTERN = /\bnon(?:[\s\u00a0]|[-\u2010-\u2015])*gaap\b/i;
const GAAP_PATTERN = /\bgaap\b/i;
const BARE_YEAR = /^(?:19|20)\d{2}$/;
// A margin is a ratio of the reconciled figures, never one of them.
const MARGIN_PATTERN = /\bmargins?\b/i;
const MEASURES = new Set(["eps_basic", "eps_diluted", "operating_income", "net_income", "gross_profit", "ebitda"]);
const ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
// Inline XBRL closes an empty cell in its tag: <td colspan="3"/>.
const CELL = /<t[dh]\b([^>]*?)(?:\/>|>([\s\S]*?)<\/t[dh]>)/gi;
const SCALE = /\bin\s+(thousands|millions|billions)\b/gi;

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
      const amounts = MARGIN_PATTERN.test(label) ? [] : values.filter(([, value]) => value.unit !== "percent");
      const measureAt = (slot: number) => measureOf(table.periods, amounts, slot, label, section);

      if (isGaapLabel(label)) {
        for (const [slot, value] of amounts) {
          const measure_key = measureAt(slot);
          if (measure_key !== null) anchors.set(slot, { label, value, measure_key, adjustments: [] });
        }
        continue;
      }

      for (const [slot, value] of amounts) {
        const anchor = anchors.get(slot);
        if (!anchor) continue;
        if (!NON_GAAP_PATTERN.test(label) || measureAt(slot) !== anchor.measure_key) {
          // A total restates the lines above it. A non-GAAP row that closes
          // nothing, such as the tax impact of the adjustments, is a line.
          if (!/^total\b/i.test(label)) anchor.adjustments.push(Object.freeze({ label, value_num: value.value_num }));
          continue;
        }
        const item: NonGaapReconciliationItem = {
          item_type: "non_gaap_reconciliation",
          measure_key: anchor.measure_key,
          period_label: table.periods[slot] || null,
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
        anchors.delete(slot);
      }
    }
  }

  return Object.freeze({ items: Object.freeze(items) });
}

// Every table in the markup, its rows read as a label and figures by slot.
export function readTables(html: string): ReadonlyArray<ParsedTable> {
  const tables: ParsedTable[] = [];
  let after = 0;
  for (const match of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    // A statement's "(In millions ...)" can sit above its table.
    const above = textContent(html.slice(after, match.index));
    after = match.index! + match[0].length;
    const table = tableOf(gridOf(match[1] ?? ""), above);
    if (table) tables.push(table);
  }
  return Object.freeze(tables);
}

function gridOf(markup: string): GridCell[][] {
  const rows: GridCell[][] = [];
  // Each column a cell from a row above still covers, to the last row it reaches.
  const down = new Map<number, { cell: GridCell; last: number }>();
  for (const [index, rowMatch] of [...markup.matchAll(ROW)].entries()) {
    const above = (column: number) => {
      const held = down.get(column);
      return held && held.last >= index ? held.cell : undefined;
    };
    const row: GridCell[] = [];
    let column = 0;
    for (const [, attributes = "", inner = ""] of (rowMatch[1] ?? "").matchAll(CELL)) {
      for (let cell = above(column); cell; cell = above(column)) column = cell.column + cell.span;
      const cell = { text: textContent(inner), column, span: spanOf(attributes, "colspan") };
      row.push(cell);
      const rowspan = spanOf(attributes, "rowspan");
      if (rowspan > 1) {
        const held = { cell, last: index + rowspan - 1 };
        for (let covered = column; covered < column + cell.span; covered++) down.set(covered, held);
      }
      column += cell.span;
    }
    for (const held of new Set(down.values())) {
      if (held.last >= index && !row.includes(held.cell)) row.push(held.cell);
    }
    rows.push(row.sort((a, b) => a.column - b.column));
  }
  return rows;
}

function spanOf(attributes: string, name: "colspan" | "rowspan"): number {
  return Math.max(1, Number(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attributes)?.[1] ?? 1));
}

// The header is the rows above the first with text before a figure that is
// no bare year. ponytail: a header partway down a table is not read; the periods above apply.
function tableOf(grid: ReadonlyArray<ReadonlyArray<GridCell>>, above: string): ParsedTable | null {
  const cells = grid.filter((row) => row.length > 0);
  if (cells.length === 0) return null;
  const figures = cells.map(figuresOf);
  const isText = (cell: GridCell) => cell.text !== "" && parseValue(cell.text) === null;
  const found = cells.findIndex((row, index) =>
    figures[index]!.some((figure) => !figure.year && row.some((cell) => cell.column < figure.first && isText(cell))));
  const start = found === -1 ? cells.length : found;

  const slots: Array<[first: number, last: number]> = [];
  for (const { first, last } of figures.slice(start).flat().sort((a, b) => a.first - b.first)) {
    const top = slots.at(-1);
    if (top && first <= top[1]) top[1] = Math.max(top[1], last);
    else slots.push([first, last]);
  }
  const firstSlot = slots[0]?.[0] ?? Number.POSITIVE_INFINITY;
  const labels = cells.map((row) => row.find((cell) => cell.column < firstSlot && isText(cell)));
  // A column's header cells start right of the labels, over an empty "$" column too.
  const headed = Math.min(firstSlot, ...labels.slice(start).flatMap((cell, index) =>
    (cell && figures[start + index]!.length > 0 ? [cell.column + cell.span] : [])));
  const periods = slots.map(([first, last]) => [...new Set(cells.slice(0, start).flatMap((row) =>
    row.filter((cell) => cell.text !== "" && cell.column >= headed && cell.column <= last && cell.column + cell.span > first)))]
    .map((cell) => cell.text).join(" "));
  const rows = cells.map((row, index) => Object.freeze({
    label: labels[index]?.text ?? "",
    values: index < start ? [] : figures[index]!.map((figure) =>
      [slots.findIndex(([first, last]) => figure.first <= last && figure.last >= first), figure.value] as const),
  }));
  const text = cells.flat().map((cell) => cell.text).join(" ");
  const scale = ([...text.matchAll(SCALE)][0] ?? [...above.matchAll(SCALE)].at(-1))?.[1]?.toLowerCase() as TableScale | undefined;
  return Object.freeze({ rows: Object.freeze(rows), periods: Object.freeze(periods), text, ...(scale ? { scale } : {}) });
}

// A row's figures: a "$" in the cell before one is its currency, and a "%" in
// the next cell with text makes it a percent.
function figuresOf(row: ReadonlyArray<GridCell>): Figure[] {
  return row.flatMap((cell, index) => {
    const parsed = parseValue(cell.text);
    if (!parsed) return [];
    const dollar = row[index - 1]?.text === "$" ? row[index - 1]! : undefined;
    const percent = row.slice(index + 1).find((next) => next.text !== "")?.text === "%";
    const value: ParsedValue = percent
      ? { value_num: parsed.value_num, unit: "percent" }
      : dollar && parsed.currency === undefined ? { ...parsed, unit: "currency", currency: "USD" } : parsed;
    return [{ first: dollar?.column ?? cell.column, last: cell.column + cell.span - 1, value, year: BARE_YEAR.test(cell.text) }];
  });
}

function isGaapLabel(label: string): boolean {
  return GAAP_PATTERN.test(label) && !NON_GAAP_PATTERN.test(label);
}

// The measure a GAAP or non-GAAP row names at a slot. A row with several
// figures in one period, as "net income / earnings per share" prints its two,
// names one measure per figure in order, and none when the counts differ. A
// row naming none, as "GAAP" alone, takes its section's.
function measureOf(
  periods: ReadonlyArray<string>,
  amounts: ReadonlyArray<readonly [number, ParsedValue]>,
  slot: number,
  label: string,
  section: string,
): string | null {
  const together = periods[slot] ? amounts.map(([other]) => other).filter((other) => periods[other] === periods[slot]) : [slot];
  if (together.length === 1) return measureKeyFromLabel(label, true) || measureKeyFromLabel(section, false);
  const named = (text: string) => text.split("/").map((part) => measureKeyFromLabel(part, true)).filter((key) => MEASURES.has(key));
  const measures = named(label).length > 0 ? named(label) : named(section);
  return measures.length === together.length ? measures[together.indexOf(slot)]! : null;
}

// A row label names the measure its head names, so "Impact of non-GAAP
// adjustments to operating income" is an impact; a section header names any.
function measureKeyFromLabel(label: string, head: boolean): string {
  // Read before the parentheses go, as "per share (basic)" prints it.
  const basic = /\bbasic\b/i.test(label) && !/\bdiluted\b/i.test(label);
  const normalized = label
    .replace(NON_GAAP_PATTERN, "")
    .replace(GAAP_PATTERN, "")
    .replace(/\badjusted\b/gi, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/^\s*total\b/i, "")
    .trim()
    .toLowerCase();
  const named = head ? normalized.split(/\s(?:of|to|on|in|from|for)\s/)[0]! : normalized;

  if (/\bper\s+(?:diluted\s+|basic\s+)?(?:common\s+)?share\b|earnings per share|\beps\b/.test(named)) {
    return basic ? "eps_basic" : "eps_diluted";
  }
  if (/operating\s+(income|loss)/.test(named)) return "operating_income";
  if (/net\s+(income|loss)/.test(named)) return "net_income";
  if (/gross\s+profit/.test(named)) return "gross_profit";
  if (/ebitda/.test(named)) return "ebitda";
  return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// A figure as a release prints it: "$1,234", "(56)", "(56" with its ")" in
// the next cell, or "21.5%".
function parseValue(raw: string): ParsedValue | null {
  const text = raw.trim();
  const negative = /^\$?\s*\(/.test(text);
  const currency = text.includes("$") ? "USD" : undefined;
  const normalized = text.replace(/[,$\s()%]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  if (/%\)?$/.test(text)) return { value_num: negative ? -value : value, unit: "percent" };
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

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0" };

function decodeHtml(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== "#") return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
