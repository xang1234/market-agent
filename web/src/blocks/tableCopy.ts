export type TableRows = ReadonlyArray<ReadonlyArray<string>>

// Only a plain number may start with "-"; any other cell a spreadsheet would
// run as a formula gets a leading apostrophe.
function safeCell(cell: string): string {
  if (/^-?\d+(\.\d+)?$/.test(cell)) return cell
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
}

// Tab-separated, the form Excel and Google Sheets split into cells on paste.
export function toTsv(rows: TableRows): string {
  return rows
    .map((row) => row.map((cell) => {
      const safe = safeCell(cell)
      return /[\t"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
    }).join('\t'))
    .join('\r\n')
}

export function provenanceRow(block: { as_of: string; snapshot_id: string }): ReadonlyArray<string> {
  return [`As of ${block.as_of}`, `Snapshot ${block.snapshot_id}`]
}
