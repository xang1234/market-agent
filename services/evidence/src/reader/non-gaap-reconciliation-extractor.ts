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
  // Digits printed after the point, as "0.40" has two.
  decimals: number;
};

// A figure and the columns it covers with the "$" cell before it.
type Figure = { first: number; last: number; value: ParsedValue; year: boolean };

export type TableRow = {
  // The first text left of the table's figures, past any blank cells that indent it.
  label: string;
  // Each figure by its slot.
  values: ReadonlyArray<readonly [slot: number, ParsedValue]>;
};

// A slot's header: the text of every header cell over it, top to bottom.
export type Period = ReadonlyArray<string>;

// A slot is one column of figures: the grid columns the figures cover, those
// that overlap being one, so "$" | "1,270" lines up with a "419" printed across both.
export type ParsedTable = {
  rows: ReadonlyArray<TableRow>;
  periods: ReadonlyArray<Period>;
  scale?: TableScale;
  text: string;
};

type GaapAnchor = {
  label: string;
  value: ParsedValue;
  measure_key: string;
  adjustments: NonGaapAdjustment[];
  // The digits after the point each of its lines prints, in order.
  decimals: number[];
  // The section in force at the GAAP row, which a bare "Non-GAAP" row closing it names.
  section: string;
  // Each measure still open when this GAAP row took its slot, as NVIDIA's cost
  // of revenue under gross profit, whose non-GAAP row is then no line.
  displaced: Set<string>;
};

const NON_GAAP_PATTERN = /\bnon(?:[\s\u00a0]|[-\u2010-\u2015])*gaap\b/i;
const GAAP_PATTERN = /\bgaap\b/i;
const BARE_YEAR = /^(?:19|20)\d{2}$/;
const YEAR = /\b(?:19|20)\d{2}\b/;
const DASH = /^[\u2012-\u2015-]+$/;
// A margin is a ratio of the reconciled figures, unless printed in dollars.
const MARGIN_PATTERN = /\bmargins?\b/i;
const MEASURES = new Set(["eps_basic", "eps_diluted", "operating_income", "net_income", "gross_profit", "ebitda"]);
const ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
// Inline XBRL closes an empty cell in its tag: <td colspan="3"/>.
const CELL = /<t[dh]\b([^>]*?)(?:\/>|>([\s\S]*?)<\/t[dh]>)/gi;
const SCALE = /\bin\s+(thousands|millions|billions)\b/i;
// A note that its amounts are whole dollars, which no earlier table's scale overrides;
// "per share amounts in dollars" says so of per-share figures only.
const UNSCALED = /(?<!\bper\s+share\s+(?:amounts?|data)\s+)\bin\s+(?:u\.?s\.?\s+)?dollars\b|\(\s*(?:u\.?s\.?\s+)?dollars\s*\)/i;
// A note in parentheses can open with its scale, as AMD's "(Millions)"; a sentence cannot, and
// "(billions of devices)" or "(thousands of employees)" counts something else.
const NOTE_SCALE = /\bin\s+(thousands|millions|billions)\b|^\s*(thousands|millions|billions)\b(?!\s+of\b(?!\s+(?:u\.?s\.?\s+)?dollars\b))/i;

export function extractNonGaapReconciliations(
  input: ExtractNonGaapReconciliationsInput,
): ExtractNonGaapReconciliationsResult {
  if (typeof input.html !== "string" || input.html.length === 0) {
    throw new Error("extractNonGaapReconciliations.html: must be a non-empty string");
  }

  const items: NonGaapReconciliationItem[] = [];
  for (const table of readTables(input.html)) {
    if (!NON_GAAP_PATTERN.test(table.text) || !GAAP_PATTERN.test(table.text)) continue;

    const periods = table.periods.map((period) => period.join(" "));
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
      const margin = MARGIN_PATTERN.test(label);
      const amounts = values.filter(([, value]) => (margin ? value.unit === "currency" : value.unit !== "percent"));
      const measureAt = (slot: number, under: string) => measureOf(periods, amounts, slot, label, under);

      if (isGaapLabel(label)) {
        for (const [slot, value] of amounts) {
          const measure_key = measureAt(slot, section);
          if (measure_key === null) continue;
          const open = anchors.get(slot);
          const displaced = new Set(open ? [...open.displaced, open.measure_key] : []);
          anchors.set(slot, { label, value, measure_key, adjustments: [], decimals: [], section, displaced });
        }
        continue;
      }

      for (const [slot, value] of amounts) {
        const anchor = anchors.get(slot);
        if (!anchor) continue;
        const measure = measureAt(slot, anchor.section);
        if (!NON_GAAP_PATTERN.test(label) || measure !== anchor.measure_key) {
          // A total that restates lines above it is no line. A non-GAAP row
          // that closes nothing, such as the tax impact of the adjustments, is one.
          if (NON_GAAP_PATTERN.test(label) && measure !== null && anchor.displaced.delete(measure)) continue;
          if (!(/^total\b/i.test(label) && restates(value, anchor))) {
            anchor.adjustments.push(Object.freeze({ label, value_num: value.value_num }));
            anchor.decimals.push(value.decimals);
          }
          continue;
        }
        const item: NonGaapReconciliationItem = {
          item_type: "non_gaap_reconciliation",
          measure_key: anchor.measure_key,
          period_label: periods[slot] || null,
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
  let scale: TableScale | undefined;
  for (const match of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    // A statement's "(In millions ...)" can sit above its table, and a table
    // straight after another continues its statement.
    const above = textContent(html.slice(after, match.index));
    after = match.index! + match[0].length;
    const table = tableOf(gridOf(match[1] ?? ""), above, above === "" ? scale : undefined);
    if (table) tables.push(table);
    scale = table?.scale;
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

// The header is the rows above the first with text before a figure. A bare
// year is a figure there only under a header cell that already names a year
// over its column alone, as "GAAP net income | 2000" under "Q3 2025", not a
// banner "Years Ended December 31, 2025 and 2024" over "2025 | 2024".
// ponytail: a header partway down a table is not read; the periods above apply.
function tableOf(grid: ReadonlyArray<ReadonlyArray<GridCell>>, above: string, continued: TableScale | undefined): ParsedTable | null {
  const cells = grid.filter((row) => row.length > 0);
  if (cells.length === 0) return null;
  const figures = cells.map(figuresOf);
  const isText = (cell: GridCell) => cell.text !== "" && parseValue(cell.text) === null;
  const over = (cell: GridCell, figure: Figure) => cell.column <= figure.last && cell.column + cell.span > figure.first;
  const dated = (index: number, figure: Figure, label: GridCell) => cells.slice(0, index).some((row) => row.some((cell) =>
    YEAR.test(cell.text) && cell.column >= label.column + label.span && over(cell, figure)
    && figures[index]!.every((other) => other === figure || !over(cell, other))));
  const found = cells.findIndex((row, index) => figures[index]!.some((figure) => {
    const label = row.find((cell) => cell.column < figure.first && isText(cell));
    return label !== undefined && (!figure.year || dated(index, figure, label));
  }));
  const start = found === -1 ? cells.length : found;

  const { slots, slotOf } = slotsOf(figures.slice(start));
  const firstSlot = slots[0]?.[0] ?? Number.POSITIVE_INFINITY;
  const labels = cells.map((row) => row.find((cell) => cell.column < firstSlot && isText(cell)));
  // A column's header cells start right of the labels, over an empty "$" column too.
  const headed = Math.min(firstSlot, ...labels.slice(start).flatMap((cell, index) =>
    (cell && figures[start + index]!.length > 0 ? [cell.column + cell.span] : [])));
  const periods = slots.map(([first, last]) => Object.freeze([...new Set(cells.slice(0, start).flatMap((row) =>
    row.filter((cell) => cell.text !== "" && cell.column >= headed && cell.column <= last && cell.column + cell.span > first)))]
    .map((cell) => cell.text)));
  // A row of dashes alone ("Restructuring | — | —") states no figure and heads nothing.
  const dashes = (row: ReadonlyArray<GridCell>, label: GridCell | undefined) => {
    const rest = row.filter((cell) => cell !== label && cell.text !== "" && cell.text !== "$");
    return rest.length > 0 && rest.every((cell) => DASH.test(cell.text));
  };
  const rows = cells.flatMap((row, index) => index >= start && figures[index]!.length === 0 && dashes(row, labels[index]) ? [] : [Object.freeze({
    label: labels[index]?.text ?? "",
    values: index < start ? [] : figures[index]!.flatMap((figure) => {
      const slot = slotOf.get(figure);
      return slot === undefined ? [] : [[slot, figure.value] as const];
    }),
  })]);
  const text = cells.flat().map((cell) => cell.text).join(" ");
  const scale = scalesIn(text)[0] ?? scalesIn(above).at(-1) ?? (UNSCALED.test(text) ? undefined : continued);
  return Object.freeze({ rows: Object.freeze(rows), periods: Object.freeze(periods), text, ...(scale ? { scale } : {}) });
}

// Each slot: the columns of figures that overlap, unless one row tells them
// apart, so two figures of one row never share a slot. Narrow figures go
// first, and one over the columns of two a row tells apart, as a year cell
// over both, joins neither and is no value.
function slotsOf(rows: ReadonlyArray<ReadonlyArray<Figure>>): { slots: Array<[first: number, last: number]>; slotOf: Map<Figure, number> } {
  type Slot = { first: number; last: number; rows: number[]; figures: Figure[] };
  let slots: Slot[] = [];
  const width = (figure: Figure) => figure.last - figure.first;
  const placed = rows.flatMap((row, index) => row.map((figure) => ({ figure, index })))
    .sort((a, b) => width(a.figure) - width(b.figure) || a.figure.first - b.figure.first);
  for (const { figure, index } of placed) {
    const over = slots.filter((slot) => figure.first <= slot.last && figure.last >= slot.first);
    const held = [index, ...over.flatMap((slot) => slot.rows)];
    if (new Set(held).size < held.length) continue;
    slots = [...slots.filter((slot) => !over.includes(slot)), {
      first: Math.min(figure.first, ...over.map((slot) => slot.first)),
      last: Math.max(figure.last, ...over.map((slot) => slot.last)),
      rows: held,
      figures: [figure, ...over.flatMap((slot) => slot.figures)],
    }];
  }
  slots.sort((a, b) => a.first - b.first);
  return {
    slots: slots.map((slot) => [slot.first, slot.last]),
    slotOf: new Map(slots.flatMap((slot, n) => slot.figures.map((figure) => [figure, n] as const))),
  };
}

// The scale each note names, past its exceptions, as "(In millions, except
// number of shares, which are reflected in thousands)" and "Amounts in
// millions, except shares (in thousands)" are in millions.
function scalesIn(text: string): TableScale[] {
  return [...text.replace(/\bexcept\b(?:[^().]|\([^()]*\))*/gi, "").matchAll(/\(([^()]*)\)|[^()]+/g)].flatMap(([prose, note]) => {
    const notes = note === undefined ? prose.split(/\.\s/).map((sentence) => SCALE.exec(sentence)) : [NOTE_SCALE.exec(note)];
    return notes.flatMap((match) => (match ? [(match[1] ?? match[2])!.toLowerCase() as TableScale] : []));
  });
}

// A row's figures: a "$" in the cell before one is its currency, and a "%" in
// the next cell with text makes it a percent, past a ")" split from "(2.5".
function figuresOf(row: ReadonlyArray<GridCell>): Figure[] {
  const isWords = (cell: GridCell) => cell.text !== "" && cell.text !== "$" && !/^\)?%?$/.test(cell.text) && parseValue(cell.text) === null;
  return row.flatMap((cell, index) => {
    const parsed = parseValue(cell.text);
    if (!parsed) return [];
    // A number leading a row of words, as "(1) | Excludes …", marks a footnote and is no figure.
    if (!row.slice(0, index).some(isWords) && row.slice(index + 1).some(isWords)) return [];
    const dollar = row[index - 1]?.text === "$" ? row[index - 1]! : undefined;
    const percent = /^\)?%$/.test(row.slice(index + 1).find((next) => next.text !== "" && next.text !== ")")?.text ?? "");
    const value: ParsedValue = percent
      ? { value_num: parsed.value_num, unit: "percent", decimals: parsed.decimals }
      : dollar && parsed.currency === undefined ? { ...parsed, unit: "currency", currency: "USD" } : parsed;
    return [{ first: dollar?.column ?? cell.column, last: cell.column + cell.span - 1, value, year: BARE_YEAR.test(cell.text) }];
  });
}

// Whether a total sums a run of the lines just above it, to the rounding of
// its printed figures: half a unit of the last decimal each one prints, the
// total's included ("0.24 + 0.30" is "0.5"). A total of one line prints that
// line's figure.
function restates(total: ParsedValue, anchor: GaapAnchor): boolean {
  const half = (decimals: number) => 10 ** -decimals / 2;
  let sum = 0;
  let slack = half(total.decimals);
  return anchor.adjustments.map((line, index) => [line.value_num, anchor.decimals[index]!] as const).reverse().some(([value, decimals], index) => {
    sum += value;
    slack += half(decimals);
    return Math.abs(sum - total.value_num) <= (index === 0 ? 0 : slack);
  });
}

function isGaapLabel(label: string): boolean {
  return GAAP_PATTERN.test(label) && !NON_GAAP_PATTERN.test(label);
}

// The measure a GAAP or non-GAAP row names at a slot. A row naming several,
// as "net income / earnings per share", names one per figure of the slot's
// period in order, and none when the counts differ. A row naming none, as
// "GAAP" alone, takes its section's.
function measureOf(
  periods: ReadonlyArray<string>,
  amounts: ReadonlyArray<readonly [number, ParsedValue]>,
  slot: number,
  label: string,
  section: string,
): string | null {
  const own = measuresIn(label, true);
  const measures = own.length > 0 ? own : measuresIn(section, false);
  if (measures.length < 2) return measures[0] ?? "";
  const together = periods[slot] ? amounts.map(([other]) => other).filter((other) => periods[other] === periods[slot]) : [slot];
  return measures.length === together.length ? measures[together.indexOf(slot)]! : null;
}

// Several measures where "/" joins two, but "income/(loss) per share" is one.
function measuresIn(text: string, head: boolean): string[] {
  const joined = text.split("/")
    .filter((part) => !/^\s*per\b/i.test(part.replace(/\([^)]*\)/g, "")))
    .map((part) => measureKeyFromLabel(part, head))
    .filter((key) => MEASURES.has(key));
  if (joined.length > 1) return joined;
  const key = measureKeyFromLabel(text, head);
  return key === "" ? [] : [key];
}

// A row label names the measure its head names, so "Impact of non-GAAP
// adjustments to operating income" is an impact and "Non-GAAP operating
// income adjustments" adjustments; a section header names any.
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
  const key = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  // "Operating income adjustments" names no measure; "operating income before adjustments" does.
  if (head && /\badjustments?\b/.test(named.split(/\s(?:before|after|excluding|without|including|less)\s/)[0]!)) return key;

  if (/\bper\s+(?:diluted\s+|basic\s+)?(?:common\s+)?share\b|earnings per share|\beps\b/.test(named)) {
    return basic ? "eps_basic" : "eps_diluted";
  }
  if (/operating\s+(income|loss)/.test(named)) return "operating_income";
  if (/net\s+(income|loss)/.test(named)) return "net_income";
  if (/gross\s+(?:profit|margin)/.test(named)) return "gross_profit";
  if (/ebitda/.test(named)) return "ebitda";
  return key;
}

// A figure as a release prints it: "$1,234", "(56)", "(56" with its ")" in
// the next cell, "−56" with a Unicode minus, or "21.5%".
function parseValue(raw: string): ParsedValue | null {
  const text = raw.trim().replace(/\u2212/g, "-");
  const negative = /^\$?\s*\(/.test(text);
  const currency = text.includes("$") ? "USD" : undefined;
  const normalized = text.replace(/[,$\s()%]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const decimals = normalized.split(".")[1]?.length ?? 0;
  if (/%\)?$/.test(text)) return { value_num: negative ? -value : value, unit: "percent", decimals };
  const parsed: ParsedValue = {
    value_num: negative ? -value : value,
    unit: currency ? "currency" : "number",
    decimals,
  };
  if (currency !== undefined) parsed.currency = currency;
  return parsed;
}

function textContent(raw: string): string {
  return decodeHtml(raw.replace(/<br\b[^>]*>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", minus: "\u2212", mdash: "\u2014", ndash: "\u2013" };

function decodeHtml(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== "#") return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
