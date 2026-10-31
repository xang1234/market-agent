export type CsvRows = ReadonlyArray<ReadonlyArray<string>>

// A cell Excel or Sheets would run as a formula gets a leading apostrophe;
// a negative number still pastes as a number.
function cellText(cell: string): string {
  const safe = /^[=+@\t\r]|^-(?![\d.])/.test(cell) ? `'${cell}` : cell
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

// RFC 4180: comma-separated, CRLF line ends.
export function toCsv(rows: CsvRows): string {
  return rows.map((row) => row.map(cellText).join(',')).join('\r\n')
}

export function provenanceRow(block: { as_of: string; snapshot_id: string }): ReadonlyArray<string> {
  return [`As of ${block.as_of}`, `Snapshot ${block.snapshot_id}`]
}
