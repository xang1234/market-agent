/**
 * SEC Form 4 XML extractor — dependency-free, regex/string-slice approach.
 * The Form 4 `ownershipDocument` schema is stable and flat; targeted tag
 * extraction is sufficient and avoids adding an XML-parser dependency.
 */

export type Form4Transaction = {
  transactionDate: string;          // YYYY-MM-DD
  code: string;                     // P, S, A, M, G, F, …
  acquiredDisposed: "A" | "D";
  shares: number;                   // >= 0
  pricePerShare: number | null;     // null when absent (grants, gifts, …)
  value: number | null;             // shares * pricePerShare, or null
};

export type Form4ReportingOwner = {
  name: string;
  cik: string | null;
  isOfficer: boolean;
  officerTitle: string | null;
  isDirector: boolean;
  isTenPercentOwner: boolean;
};

export type Form4Filing = {
  issuerCik: number;
  reportingOwner: Form4ReportingOwner;
  transactions: Form4Transaction[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseForm4(submissionTxt: string): Form4Filing {
  const xml = extractXmlBlock(submissionTxt);

  const issuerCik = Number(requireTagText(xml, "issuerCik").replace(/^0+/, "") || "0");

  const ownerBlock = extractBlock(xml, "reportingOwner");
  const ownerIdBlock = extractBlock(ownerBlock ?? xml, "reportingOwnerId");
  const ownerRelBlock = extractBlock(ownerBlock ?? xml, "reportingOwnerRelationship");

  const ownerName = requireTagText(ownerIdBlock ?? xml, "rptOwnerName");
  const ownerCik = optionalTagText(ownerIdBlock ?? xml, "rptOwnerCik");

  const isOfficer = parseBool(requireTagText(ownerRelBlock ?? xml, "isOfficer"));
  const isDirector = parseBool(requireTagText(ownerRelBlock ?? xml, "isDirector"));
  const isTenPercentOwner = parseBool(requireTagText(ownerRelBlock ?? xml, "isTenPercentOwner"));
  const officerTitle = isOfficer ? (optionalTagText(ownerRelBlock ?? xml, "officerTitle") ?? null) : null;

  const transactions = parseNonDerivativeTransactions(xml);

  return {
    issuerCik,
    reportingOwner: {
      name: ownerName,
      cik: ownerCik,
      isOfficer,
      officerTitle,
      isDirector,
      isTenPercentOwner,
    },
    transactions,
  };
}

// ---------------------------------------------------------------------------
// XML block extraction
// ---------------------------------------------------------------------------

/**
 * Extract the content between `<XML>` and `</XML>` (case-insensitive).
 * If no such block is found, throw a clear error.
 */
function extractXmlBlock(input: string): string {
  const openRe = /<XML>/i;
  const closeRe = /<\/XML>/i;

  const openMatch = openRe.exec(input);
  const closeMatch = closeRe.exec(input);

  if (!openMatch || !closeMatch) {
    throw new Error(
      "parseForm4: no <XML>…</XML> block found in submission text. " +
      "Expected an SEC EDGAR full-submission .txt wrapping an ownershipDocument.",
    );
  }

  return input.slice(openMatch.index + openMatch[0].length, closeMatch.index);
}

/**
 * Extract the inner text of the first `<tag>…</tag>` match (case-sensitive,
 * as XML tags in Form 4 are camelCase). Strips leading/trailing whitespace.
 * Returns null if not found.
 */
function optionalTagText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "");
  const m = re.exec(xml);
  if (!m) return null;
  // Strip the open and close tags. An empty/whitespace-only element (a real SEC
  // quirk, e.g. <transactionPricePerShare><value></value>) is treated as absent
  // (null) — so "no price" stays null rather than collapsing to Number("") === 0,
  // and an empty REQUIRED tag makes requireTagText throw (malformed filing).
  const inner = m[0].slice(tag.length + 2, -(tag.length + 3)).trim();
  return inner === "" ? null : inner;
}

function requireTagText(xml: string, tag: string): string {
  const value = optionalTagText(xml, tag);
  if (value === null) {
    throw new Error(`parseForm4: required tag <${tag}> not found in XML segment.`);
  }
  return value;
}

/**
 * Extract the full content between `<tag>` and `</tag>` as a substring.
 * Returns null if the tag is absent.
 */
function extractBlock(xml: string, tag: string): string | null {
  const openIdx = xml.indexOf(`<${tag}>`);
  if (openIdx === -1) return null;
  const contentStart = openIdx + tag.length + 2;
  const closeIdx = xml.indexOf(`</${tag}>`, contentStart);
  if (closeIdx === -1) return null;
  return xml.slice(contentStart, closeIdx);
}

// ---------------------------------------------------------------------------
// Non-derivative transactions
// ---------------------------------------------------------------------------

function parseNonDerivativeTransactions(xml: string): Form4Transaction[] {
  const tableBlock = extractBlock(xml, "nonDerivativeTable");
  if (!tableBlock) return [];

  const transactions: Form4Transaction[] = [];
  let remaining = tableBlock;

  while (true) {
    const block = extractBlock(remaining, "nonDerivativeTransaction");
    if (!block) break;

    transactions.push(parseTransaction(block));

    // Advance past the consumed transaction block
    const closeTag = "</nonDerivativeTransaction>";
    const idx = remaining.indexOf(closeTag);
    remaining = remaining.slice(idx + closeTag.length);
  }

  return transactions;
}

function parseTransaction(block: string): Form4Transaction {
  // transactionDate holds a nested <value> element
  const dateBlock = extractBlock(block, "transactionDate") ?? block;
  const transactionDate = requireTagText(dateBlock, "value");

  const code = requireTagText(block, "transactionCode");

  // transactionAmounts block
  const amountsBlock = extractBlock(block, "transactionAmounts") ?? block;

  const sharesBlock = extractBlock(amountsBlock, "transactionShares") ?? amountsBlock;
  const shares = Number(requireTagText(sharesBlock, "value"));

  const adBlock = extractBlock(amountsBlock, "transactionAcquiredDisposedCode") ?? amountsBlock;
  const adRaw = requireTagText(adBlock, "value") as "A" | "D";

  // Price is optional — grants/gifts omit it
  const priceBlock = extractBlock(amountsBlock, "transactionPricePerShare");
  let pricePerShare: number | null = null;
  if (priceBlock !== null) {
    const priceText = optionalTagText(priceBlock, "value");
    if (priceText !== null) {
      pricePerShare = Number(priceText);
    }
  }

  const value = pricePerShare === null ? null : shares * pricePerShare;

  return {
    transactionDate,
    code,
    acquiredDisposed: adRaw,
    shares,
    pricePerShare,
    value,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBool(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return s === "1" || s === "true";
}
