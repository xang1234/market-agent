// A uuencoded body as EDGAR writes one into a submission's <TEXT>: begin line,
// lines of up to 45 bytes, a "`" line and end.
export function uuencode(name: string, bytes: Uint8Array): string {
  const char = (value: number) => String.fromCharCode(value === 0 ? 96 : value + 32);
  const lines = [`begin 644 ${name}`];
  for (let start = 0; start < bytes.length; start += 45) {
    const chunk = bytes.subarray(start, start + 45);
    let line = char(chunk.length);
    for (let i = 0; i < chunk.length; i += 3) {
      const [a = 0, b = 0, c = 0] = [chunk[i], chunk[i + 1], chunk[i + 2]];
      line += char(a >> 2) + char(((a & 3) << 4) | (b >> 4)) + char(((b & 15) << 2) | (c >> 6)) + char(c & 63);
    }
    lines.push(line);
  }
  lines.push("`", "end");
  return lines.join("\n");
}

// Bytes whose uuencoding has a line opening with "<" (28 bytes), so a body
// holds tag-like runs.
export const JPEG_BYTES = new Uint8Array(Array.from({ length: 118 }, (_, i) => (i * 37 + 255) % 256));
