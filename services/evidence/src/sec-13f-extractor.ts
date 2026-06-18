// SEC 13F information-table extractor — dependency-free. The full-submission .txt
// holds two XML documents: the cover (carries <periodOfReport> in MM-DD-YYYY) and
// the informationTable of <infoTable> holding rows. Values are reported in whole
// USD for filings on/after 2023-01-01 and in thousands before — normalization is
// the handler's job (it knows the filing date); this returns the raw value.
import { tagText, requireTagText, iterateBlocks } from "./sec-xml.ts";

export type Form13fHolding = {
  nameOfIssuer: string;
  cusip: string; // 9-char, uppercased
  valueRaw: number; // as reported (whole USD post-2023; thousands pre-2023)
  shares: number;
  sshPrnamtType: string; // SH (shares) | PRN (principal amount)
  // "Put" | "Call" for option positions; null for a direct holding. Option rows
  // also use SH share amounts, so consumers must exclude them from common-share
  // holdings (the handler does).
  putCall: string | null;
};

export type Form13fFiling = {
  periodOfReport: string; // YYYY-MM-DD (reporting quarter end)
  // 13F-HR/A cover <amendmentInfo><amendmentType>: "RESTATEMENT" (full portfolio
  // replacement) | "NEW HOLDINGS" (supplemental, add-only). null on an original
  // 13F-HR (no amendmentInfo). Uppercased + trimmed so the handler can branch
  // reliably; the restate-vs-supplement distinction is what stops a supplemental
  // amendment from being mis-read as the whole portfolio (false exits) — fra-kb2p.
  amendmentType: string | null;
  holdings: Form13fHolding[];
};

export function parse13fInfoTable(submissionTxt: string): Form13fFiling {
  const periodOfReport = normalizePeriod(requireTagText(submissionTxt, "periodOfReport", "13F cover"));
  const amendmentType = tagText(submissionTxt, "amendmentType")?.trim().toUpperCase() ?? null;

  const holdings: Form13fHolding[] = [];
  for (const row of iterateBlocks(submissionTxt, "infoTable")) {
    holdings.push({
      nameOfIssuer: requireTagText(row, "nameOfIssuer", "infoTable"),
      cusip: requireTagText(row, "cusip", "infoTable").toUpperCase(),
      valueRaw: parseNonNegativeNumber(requireTagText(row, "value", "infoTable"), "value"),
      shares: parseNonNegativeNumber(requireTagText(row, "sshPrnamt", "infoTable"), "sshPrnamt"),
      sshPrnamtType: tagText(row, "sshPrnamtType") ?? "SH",
      putCall: tagText(row, "putCall"),
    });
  }
  return { periodOfReport, amendmentType, holdings };
}

// EDGAR's 13F cover reports the period as MM-DD-YYYY; normalize to ISO. Tolerate
// an already-ISO value defensively.
function normalizePeriod(raw: string): string {
  const trimmed = raw.trim();
  const us = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  const iso = us ? `${us[3]}-${us[1]}-${us[2]}` : /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  // Validate the calendar date (not just the shape) so e.g. "13-99-2026" fails at
  // the parse boundary instead of surfacing as a bad date in later DB operations.
  if (iso !== null) {
    const d = new Date(`${iso}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) return iso;
  }
  throw new Error(`parse13fInfoTable: unrecognized or invalid periodOfReport "${raw}"`);
}

function parseNonNegativeNumber(raw: string, label: string): number {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`parse13fInfoTable: invalid ${label} "${raw}" (expected a non-negative number)`);
  }
  return n;
}
