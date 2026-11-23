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
  for (line = nextLine(); line !== null && !isLastPayloadLine(line); line = nextLine()) {
    if (!isPayloadLine(line)) return null;
  }
  if (line === null || nextLine()?.toString("latin1") !== "end") return null;
  if (pdf && nextLine()?.toString("latin1") !== "</PDF>") return null;
  return at === textClose + 1 ? { start, end: at } : null;
}

// A line that encodes no bytes, "`" or a space (or that space trimmed away).
function isLastPayloadLine(line: Buffer): boolean {
  return line.length === 0 || (line.length === 1 && (line[0] === 0x60 || line[0] === 0x20));
}

// A length character for 1 to 63 bytes, then four characters per three of
// them, every one in uuencode's alphabet (space to backtick). EDGAR trims a
// line's trailing spaces (zero bits), so a line may fall short; an encoder
// may end one with a guard character that keeps those spaces, or with CRLF.
function isPayloadLine(line: Buffer): boolean {
  const end = line[line.length - 1] === 0x0d ? line.length - 1 : line.length;
  const count = (line[0]! - 0x20) & 0x3f;
  if (count === 0 || end > 2 + 4 * Math.ceil(count / 3)) return false;
  for (let i = 0; i < end; i++) if (line[i]! < 0x20 || line[i]! > 0x60) return false;
  return true;
}
