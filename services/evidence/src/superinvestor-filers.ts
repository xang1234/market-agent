// Seed registry of notable 13F filers ("superinvestors"). v1 processes only these
// filers' 13F-HR filings (Q8 = seeded-only); the daily-crawl handler gates on
// membership here. This is a curated starter set, expanded by fra-ajvd.7
// (full-universe coverage). CIKs are stored zero-padded to 10 digits to match
// EDGAR's canonical form; lookups accept the bare integer too.
export const SUPERINVESTOR_FILERS: ReadonlyMap<string, string> = new Map([
  ["0001067983", "Berkshire Hathaway Inc"],
  ["0001649339", "Scion Asset Management, LLC"],
  ["0001336528", "Pershing Square Capital Management, L.P."],
  ["0001656456", "Appaloosa LP"],
  ["0001061768", "The Baupost Group, L.L.C."],
  ["0001603466", "Himalaya Capital Management LLC"],
]);

function padCik(cik: number): string {
  return String(cik).padStart(10, "0");
}

export function isSuperinvestorFiler(cik: number): boolean {
  return SUPERINVESTOR_FILERS.has(padCik(cik));
}

export function superinvestorName(cik: number): string | null {
  return SUPERINVESTOR_FILERS.get(padCik(cik)) ?? null;
}
