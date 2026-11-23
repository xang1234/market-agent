// A full EDGAR submission (.txt) carries each binary document (GRAPHIC, PDF,
// ZIP, EXCEL) uuencoded, and no reader uses those bodies. They are most of a
// stored 8-K's bytes (#757). This removes each uuencoded body and keeps every
// other byte as SEC sent it, in order: the SEC header, every text, HTML and
// XBRL document, and each binary document's envelope (type, sequence,
// filename) with an empty <TEXT>, so the filing's inventory survives.
//
// Uuencode writes no lower-case letter, so no reader's HTML or XBRL pattern
// can match inside a body. A body is removed only when it is a document's
// whole <TEXT> and every line of it is uuencode. A text exhibit that opens
// "begin 644", or quotes a body inside its own HTML, is kept byte for byte.

// documents.raw_blob_transform for a blob stored this way (migration 0088).
export const SEC_UUENCODED_BODIES_REMOVED = "sec_uuencoded_bodies_removed.v1";

const SUBMISSION_START = Buffer.from("<SEC-DOCUMENT>");
const DOCUMENT_OPEN = Buffer.from("\n<DOCUMENT>\n");
const DOCUMENT_CLOSE = Buffer.from("\n</DOCUMENT>");
const TEXT_OPEN = Buffer.from("\n<TEXT>\n");
const TEXT_CLOSE = Buffer.from("\n</TEXT>");
const BEGIN = /^begin [0-7]{3,4} \S/;
const NEWLINE = 0x0a;

// The submission without its uuencoded bodies, or null when it has none or
// the bytes are not a submission.
export function stripUuencodedBodies(bytes: Uint8Array): Uint8Array | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!buffer.subarray(0, SUBMISSION_START.length).equals(SUBMISSION_START)) return null;
  const kept: Buffer[] = [];
  let keptFrom = 0;
  for (let open = buffer.indexOf(DOCUMENT_OPEN); open !== -1; open = buffer.indexOf(DOCUMENT_OPEN, open + 1)) {
    const close = buffer.indexOf(DOCUMENT_CLOSE, open + 1);
    if (close === -1) break;
    const body = uuencodedText(buffer, open + DOCUMENT_OPEN.length - 1, close);
    if (body !== null) {
      kept.push(buffer.subarray(keptFrom, body.start));
      keptFrom = body.end;
    }
    open = close;
  }
  if (kept.length === 0) return null;
  kept.push(buffer.subarray(keptFrom));
  return new Uint8Array(Buffer.concat(kept));
}

// The byte range of the document's <TEXT> body when it is one uuencoded file
// (inside <PDF> tags for a PDF), from its begin line through end; else null.
// `header` is the newline before the document's first tag line and `close`
// the newline before its </DOCUMENT>.
function uuencodedText(buffer: Buffer, header: number, close: number): { start: number; end: number } | null {
  const textOpen = buffer.indexOf(TEXT_OPEN, header);
  if (textOpen === -1 || textOpen > close) return null;
  // Only tag lines (<TYPE>, <SEQUENCE>, <FILENAME>, ...) precede the <TEXT>.
  if (!buffer.toString("latin1", header + 1, textOpen).split("\n").every((line) => line.startsWith("<"))) return null;
  const textClose = close - TEXT_CLOSE.length;
  if (!buffer.subarray(textClose, close).equals(TEXT_CLOSE)) return null;
  const start = textOpen + TEXT_OPEN.length;
  let at = start;
  const nextLine = (): Buffer | null => {
    const newline = buffer.indexOf(NEWLINE, at);
    if (newline === -1 || newline > textClose) return null;
    const line = buffer.subarray(at, newline);
    at = newline + 1;
    return line;
  };
  let line = nextLine();
  const pdf = line?.toString("latin1") === "<PDF>";
  if (pdf) line = nextLine();
  if (line === null || !BEGIN.test(line.toString("latin1"))) return null;
  // Full 45-byte lines, then a final line, then the zero-length line.
  let previous: Buffer | null = null;
  for (line = nextLine(); line !== null && !isZeroLengthLine(line); line = nextLine()) {
    if (previous !== null && !isFullLine(previous)) return null;
    previous = line;
  }
  if (line === null || previous === null || !isFinalLine(previous)) return null;
  if (nextLine()?.toString("latin1") !== "end") return null;
  if (pdf && nextLine()?.toString("latin1") !== "</PDF>") return null;
  return at === textClose + 1 ? { start, end: at } : null;
}

// A line that encodes no bytes, "`" or a space (or that space trimmed away).
function isZeroLengthLine(line: Buffer): boolean {
  return line.length === 0 || (line.length === 1 && (line[0] === 0x60 || line[0] === 0x20));
}

// Lines as EDGAR writes them: uuencode's alphabet (space to backtick) with
// trailing spaces (zero bits) trimmed, and an optional CR. Every line but the
// last encodes 45 bytes, "M" and 60 characters. The last encodes at most 45
// in 4 characters per 3; an encoder may add a guard character after them.
// ponytail: a final line may be 6 characters short, the most a sample lost
// (5: a ZIP's two zero closing bytes and padding); widen if a real body is kept.
function isFullLine(line: Buffer): boolean {
  const end = payloadEnd(line);
  return line[0] === 0x4d && end <= 61 && inAlphabet(line, end);
}

function isFinalLine(line: Buffer): boolean {
  const end = payloadEnd(line);
  const count = line[0]! - 0x20;
  const encoded = 1 + 4 * Math.ceil(count / 3);
  return count >= 1 && count <= 45 && end >= encoded - 6 && end <= encoded + 1 && inAlphabet(line, end);
}

function payloadEnd(line: Buffer): number {
  return line[line.length - 1] === 0x0d ? line.length - 1 : line.length;
}

function inAlphabet(line: Buffer, end: number): boolean {
  for (let i = 0; i < end; i++) if (line[i]! < 0x20 || line[i]! > 0x60) return false;
  return true;
}
