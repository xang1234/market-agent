// Canonical identifier normalization shared by services that read or write
// issuer identity fields.

export function normalizeCik(value: string): string {
  if (value.length === 0) return "";
  const stripped = value.replace(/^0+/, "");
  return stripped.length === 0 ? "0" : stripped;
}
