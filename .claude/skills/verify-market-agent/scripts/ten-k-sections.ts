// `verify ten-k-sections`: where each 10-K fixture's Items 1 and 1A open and
// close, as tenKSections reads them in this checkout, one line per item. The
// hash covers the item's text and its block edges, which quotes are checked at.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { tenKSections, TEN_K_ITEMS } from "../../../../services/evidence/src/sec-10k-sections.ts";

const FIXTURES = join(import.meta.dirname, "../../../../services/evidence/test/fixtures/sec-10k");

for (const file of readdirSync(FIXTURES).filter((name) => name.endsWith(".htm")).sort()) {
  const sections = tenKSections(readFileSync(join(FIXTURES, file), "utf8"));
  for (const item of TEN_K_ITEMS) {
    const section = sections[item];
    if ("error" in section) {
      console.log(`${file} ${item} ${section.error}`);
      continue;
    }
    const { text, edges } = section;
    const sha = createHash("sha256").update(text).update(JSON.stringify([...edges].sort((a, b) => a - b))).digest("hex").slice(0, 12);
    console.log(`${file} ${item} chars=${text.length} edges=${edges.size} sha=${sha} opens="${text.slice(0, 60)}" closes="${text.slice(-60)}"`);
  }
}
