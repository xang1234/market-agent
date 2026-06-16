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
};

export type Form13fFiling = {
  periodOfReport: string; // YYYY-MM-DD (reporting quarter end)
  holdings: Form13fHolding[];
};

export function parse13fInfoTable(submissionTxt: string): Form13fFiling {
  const periodOfReport = normalizePeriod(requireTagText(submissionTxt, "periodOfReport", "13F cover"));

  const holdings: Form13fHolding[] = [];
  for (const row of iterateBlocks(submissionTxt, "infoTable")) {
    holdings.push({
      nameOfIssuer: requireTagText(row, "nameOfIssuer", "infoTable"),
      cusip: requireTagText(row, "cusip", "infoTable").toUpperCase(),
      valueRaw: parseNonNegativeNumber(requireTagText(row, "value", "infoTable"), "value"),
      shares: parseNonNegativeNumber(requireTagText(row, "sshPrnamt", "infoTable"), "sshPrnamt"),
      sshPrnamtType: tagText(row, "sshPrnamtType") ?? "SH",
    });
  }
  return { periodOfReport, holdings };
}

// EDGAR's 13F cover reports the period as MM-DD-YYYY; normalize to ISO. Tolerate
// an already-ISO value defensively.
function normalizePeriod(raw: string): string {
  const us = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw.trim());
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  throw new Error(`parse13fInfoTable: unrecognized periodOfReport "${raw}"`);
}

function parseNonNegativeNumber(raw: string, label: string): number {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`parse13fInfoTable: invalid ${label} "${raw}" (expected a non-negative number)`);
  }
  return n;
}
