// A full EDGAR submission (.txt) carries each binary document (GRAPHIC, PDF,
// ZIP, EXCEL) uuencoded, and no reader uses those bodies. They are most of a
// stored 8-K's bytes (#757). This removes each uuencoded body and keeps every
// other byte as SEC sent it, in order: the SEC header, every text, HTML and
// XBRL document, and each binary document's envelope (type, sequence,
// filename) with an empty <TEXT>, so the filing's inventory survives.
//
// Uuencode writes no lower-case letter, so no reader's HTML or XBRL pattern
// can match inside a body. A body is only ever removed whole.

// documents.raw_blob_transform for a blob stored this way (migration 0088).
export const SEC_UUENCODED_BODIES_REMOVED = "sec_uuencoded_bodies_removed.v1";

const SUBMISSION_START = Buffer.from("<SEC-DOCUMENT>");
const TEXT_OPEN = Buffer.from("\n<TEXT>\n");
// A whole line: a uuencoded line that opens with "<" is 38 characters long.
const TEXT_CLOSE = Buffer.from("\n</TEXT>\n");
// EDGAR wraps a PDF's uuencoded body in <PDF> tags.
const UUENCODED_BODY = /^(?:<PDF>\n)?begin [0-7]{3,4} \S/;

// The submission without its uuencoded bodies, or null when it has none, a
// body never closes, or the bytes are not a submission.
export function stripUuencodedBodies(bytes: Uint8Array): Uint8Array | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!buffer.subarray(0, SUBMISSION_START.length).equals(SUBMISSION_START)) return null;
  const kept: Buffer[] = [];
  let keptFrom = 0;
  for (let open = buffer.indexOf(TEXT_OPEN); open !== -1; open = buffer.indexOf(TEXT_OPEN, open + 1)) {
    const body = open + TEXT_OPEN.length;
    if (!UUENCODED_BODY.test(buffer.toString("latin1", body, body + 64))) continue;
    const close = buffer.indexOf(TEXT_CLOSE, body);
    if (close === -1) return null;
    kept.push(buffer.subarray(keptFrom, body));
    keptFrom = close + 1;
    open = close;
  }
  if (kept.length === 0) return null;
  kept.push(buffer.subarray(keptFrom));
  return new Uint8Array(Buffer.concat(kept));
}
