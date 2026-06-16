// services/evidence/src/sec-daily-index.ts
// Parses the EDGAR daily "master" index (pipe-delimited, one row per filing):
//   CIK|Company Name|Form Type|Date Filed|File Name
// File Name points at the full submission .txt, e.g.
//   edgar/data/320193/0000320193-26-000050.txt
// from which the accession (0000320193-26-000050) is derived.

const ACCESSION_FROM_PATH = /(\d{10}-\d{2}-\d{6})\.txt$/;

export type FilingIndexEntry = {
  cik: number;
  company: string;
  form: string;
  filedDate: string;
  fileName: string;
  accession: string;
};

export function deriveAccession(fileName: string): string {
  const match = ACCESSION_FROM_PATH.exec(fileName.trim());
  if (match === null) {
    throw new Error(`deriveAccession: no accession in fileName "${fileName}"`);
  }
  return match[1];
}

export function parseMasterIndex(text: string): FilingIndexEntry[] {
  const entries: FilingIndexEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Data rows have exactly 5 pipe fields and a numeric CIK; everything
    // else (header banner, "CIK|Company Name|...", dashed rule) is skipped.
    const fields = line.split("|");
    if (fields.length !== 5) continue;
    const cik = Number(fields[0]);
    if (!Number.isInteger(cik) || cik <= 0) continue;
    const fileName = fields[4].trim();
    if (!ACCESSION_FROM_PATH.test(fileName)) continue;
    entries.push({
      cik,
      company: fields[1].trim(),
      form: fields[2].trim(),
      filedDate: fields[3].trim(),
      fileName,
      accession: deriveAccession(fileName),
    });
  }
  return entries;
}
