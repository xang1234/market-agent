import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalText,
  extractReleaseStatements,
  findReleaseCandidates,
  parseRebindReply,
  parseReleaseReply,
  releaseExhibits,
  releasePrompts,
  clearRebindMarks,
  findRebindCandidates,
  reportedQuarterEnd,
  runRebindDrain,
  runReleaseExtractionDrain,
  verifyStatement,
  type ExtractReleaseDeps,
} from "../src/sec-earnings-release-extraction.ts";
import { drainIncomplete } from "../src/sec-earnings-release-cli.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const NVDA_CIK = 1045810;
const ACCESSION = "0001045810-25-000115";

// NVIDIA's Q1 FY2026 8-K (Item 2.02), cut down: the markup and wording are the
// filing's own (EX-99.2, CFO commentary), with an EX-99.1 and the documents a
// submission also carries.
const FONT = `<font style="color:#000000;font-family:'NVIDIA Sans',sans-serif;font-size:11pt;font-weight:400;line-height:120%">`;
const SUBMISSION = [
  "<SEC-DOCUMENT>0001045810-25-000115.txt",
  "<SEC-HEADER>ACCESSION NUMBER: 0001045810-25-000115 ITEM INFORMATION: Results of Operations and Financial Condition</SEC-HEADER>",
  "<DOCUMENT>\n<TYPE>8-K\n<TEXT>\n<html><body>Item 2.02 Results of Operations and Financial Condition. On May 28, 2025, NVIDIA issued a press release.</body></html>\n</TEXT>\n</DOCUMENT>",
  "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<html><body><div>",
  `${FONT}NVIDIA Announces Financial Results for First Quarter Fiscal 2026</font></div>`,
  `<div>${FONT}Revenue of $44.1 billion, up 12% from the previous quarter and up 69% from a year ago</font></div>`,
  "</body></html>\n</TEXT>\n</DOCUMENT>",
  "<DOCUMENT>\n<TYPE>EX-99.2\n<TEXT>\n<html><body>",
  `<div style="margin-bottom:9pt;text-align:justify">${FONT}Our platforms address four large markets where our expertise is critical&#58; Data Center, Gaming, Professional Visualization, and Automotive.</font></div>`,
  `<div style="margin-bottom:9pt;text-align:justify">${FONT}On April 9, 2025, we were informed by the U.S. government that a license is required for exports of our H20 products into the China market. As a result of these new requirements, we incurred a $4.5 billion charge in the first quarter of fiscal 2026 associated with H20 excess inventory and purchase obligations as the demand for H20 diminished.</font></div>`,
  `${FONT}Outlook</font></div><div>${FONT}Outlook for the second quarter of fiscal 2026 is as follows&#58;</font></div>`,
  `<div style="padding-left:36pt">${FONT}&#8226;</font>${FONT}Revenue is expected to be $45.0 billion, plus or minus 2%. This outlook reflects a loss in H20 revenue of approximately $8.0 billion due to the recent export control limitations. </font></div>`,
  `<div>${FONT}NVIDIA&#8217;s gross margin was 60.5%,&nbsp;reflecting the H20 charge.</font></div>`,
  "</body></html>\n</TEXT>\n</DOCUMENT>",
  "<DOCUMENT>\n<TYPE>EX-101.SCH\n<TEXT>\n<xs:schema>gross margin</xs:schema>\n</TEXT>\n</DOCUMENT>",
  "</SEC-DOCUMENT>",
].join("\n");

const H20_EXPLANATION =
  "As a result of these new requirements, we incurred a $4.5 billion charge in the first quarter of fiscal 2026 associated with H20 excess inventory and purchase obligations as the demand for H20 diminished.";
const REVENUE_GUIDANCE = "Revenue is expected to be $45.0 billion, plus or minus 2%.";

test("an 8-K's EX-99 exhibits are read as plain text; the 8-K and XBRL documents are not", () => {
  const exhibits = releaseExhibits(SUBMISSION);
  assert.deepEqual(exhibits.map((exhibit) => exhibit.type), ["EX-99.1", "EX-99.2"]);
  const commentary = exhibits[1]!.text;
  assert.ok(commentary.includes(H20_EXPLANATION));
  // Entities decoded, typographic quotes made plain, tags gone.
  assert.ok(commentary.includes("critical: Data Center"));
  assert.ok(commentary.includes("NVIDIA's gross margin was 60.5%, reflecting the H20 charge."));
  assert.ok(!commentary.includes("<font"));
  assert.equal(canonicalText("a&nbsp;&nbsp;b &#x2014; c&rsquo;s"), "a b - c's");
});

test("a plain-text exhibit's headings and paragraphs are blocks, so the sentence under a heading verifies", () => {
  const exhibits = releaseExhibits([
    "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>",
    "NVIDIA ANNOUNCES FINANCIAL RESULTS",
    "",
    "OUTLOOK",
    REVENUE_GUIDANCE,
    "Gross margins are expected to be 71.8%",
    "and 72.0%, respectively.",
    "</TEXT>\n</DOCUMENT>",
  ].join("\n"));
  assert.ok(verifyStatement({ kind: "guidance", metric: "revenue", about: "other", quote: REVENUE_GUIDANCE }, exhibits), "under a heading");
  // A sentence wrapped across lines is still one sentence.
  const wrapped = "Gross margins are expected to be 71.8% and 72.0%, respectively.";
  assert.ok(verifyStatement({ kind: "guidance", metric: "gross_margin", about: "other", quote: wrapped }, exhibits), "wrapped");
  assert.equal(verifyStatement({ kind: "guidance", metric: "gross_margin", about: "other", quote: "Gross margins are expected to be 71.8%" }, exhibits), null, "a wrapped line alone");
  // CRLF line endings, as many plain-text filings have.
  const crlf = releaseExhibits("<DOCUMENT>\r\n<TYPE>EX-99.1\r\n<TEXT>\r\nFirst quarter results\r\n\r\nRevenue is expected to be $45.0 billion, plus or minus 2%.\r\n</TEXT>\r\n</DOCUMENT>");
  assert.ok(verifyStatement({ kind: "guidance", metric: "revenue", about: "other", quote: REVENUE_GUIDANCE }, crlf), "after a CRLF blank line");
});

test("an HTML line break with attributes is a block edge", () => {
  const exhibits = releaseExhibits(
    `<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<html><body><p>Outlook<br style="clear:both">${REVENUE_GUIDANCE}</p></body></html>\n</TEXT>\n</DOCUMENT>`,
  );
  assert.ok(verifyStatement({ kind: "guidance", metric: "revenue", about: "other", quote: REVENUE_GUIDANCE }, exhibits));
});

test("a release longer than one prompt is read whole, across prompts split between blocks", () => {
  const filler = Array.from({ length: 1_500 }, (_, n) => `Paragraph ${n} restates a figure from the quarter.`);
  const commentary = "Gross margin decreased primarily due to a charge associated with excess inventory.";
  const exhibits = releaseExhibits([
    `<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<html><body>${filler.map((sentence) => `<p>${sentence}</p>`).join("")}</body></html>\n</TEXT>\n</DOCUMENT>`,
    `<DOCUMENT>\n<TYPE>EX-99.2\n<TEXT>\n<html><body><p>${commentary}</p></body></html>\n</TEXT>\n</DOCUMENT>`,
  ].join("\n"));
  const prompts = releasePrompts(exhibits);
  assert.ok(prompts.length > 1, "more than one prompt");
  assert.ok(prompts.every((prompt) => prompt.length <= 60_000), "each within the cap");
  // Every block whole in some prompt, the commentary after the long release too.
  for (const sentence of [...filler, commentary]) {
    assert.ok(prompts.some((prompt) => prompt.includes(sentence)), sentence);
  }
  // A short release is one prompt.
  assert.equal(releasePrompts(releaseExhibits(SUBMISSION)).length, 1);
  // One block longer than a prompt is split between sentences (not after an
  // abbreviation's full stop), so each is whole in some prompt.
  const sentences = Array.from({ length: 1_500 }, (_, n) => `Sales in the U.S. Data Center market rose ${n}% on demand.`);
  const block = releaseExhibits(`<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<p>${sentences.join(" ")}</p>\n</TEXT>\n</DOCUMENT>`);
  const split = releasePrompts(block);
  assert.ok(split.length > 1 && split.every((prompt) => prompt.length <= 60_000));
  for (const sentence of sentences) assert.ok(split.some((prompt) => prompt.includes(sentence)), sentence);
});

test("the model's reply is read when well formed, with the quarter's end and what each statement is about", () => {
  const reply = parseReleaseReply(
    '```json\n{"quarter_end":"2025-04-27","statements":[' +
      `{"kind":"explanation","metric":"gross_margin","about":"quarter","quote":${JSON.stringify(H20_EXPLANATION)}},` +
      `{"kind":"guidance","metric":"revenue","about":"other","quote":${JSON.stringify(REVENUE_GUIDANCE)}}` +
      "]}\n```",
  );
  assert.deepEqual(reply, {
    quarterEnd: "2025-04-27",
    statements: [
      { kind: "explanation", metric: "gross_margin", about: "quarter", quote: H20_EXPLANATION },
      { kind: "guidance", metric: "revenue", about: "other", quote: REVENUE_GUIDANCE },
    ],
  });
  assert.deepEqual(parseReleaseReply('{"quarter_end":null,"statements":[]}'), { quarterEnd: null, statements: [] });
  const entry = (fields: Record<string, unknown>) => JSON.stringify({ kind: "guidance", metric: "revenue", about: "other", quote: "x", ...fields });
  // A quarter_end that is no date, or an about that is none of the three,
  // leaves a claim unbound, never the release unread.
  for (const [label, text] of [
    ["no quarter_end", '{"statements":[]}'],
    ["a quarter_end in words", '{"quarter_end":"June 28, 2025","statements":[]}'],
    ["a quarter_end no calendar has", '{"quarter_end":"2025-02-30","statements":[]}'],
  ]) {
    assert.deepEqual(parseReleaseReply(text!), { quarterEnd: null, statements: [] }, label);
  }
  assert.deepEqual(
    parseReleaseReply(`{"quarter_end":"2025-04-27","statements":[${entry({ about: "half" })},${entry({ about: undefined })}]}`)?.statements.map((statement) => statement.about),
    ["other", "other"],
  );
  // A malformed statement makes the reply unparseable (the filing is read
  // again), never an empty answer that would mark it done.
  for (const [label, text] of [
    ["an unknown kind", `{"quarter_end":null,"statements":[${entry({ kind: "cause" })}]}`],
    ["an unknown metric", `{"quarter_end":null,"statements":[${entry({ metric: "stock_price" })}]}`],
    ["no quote", `{"quarter_end":null,"statements":[${entry({ quote: undefined })}]}`],
    ["no statements", '{"quarter_end":null,"quotes":[]}'],
    ["prose", "I could not find any."],
  ]) {
    assert.equal(parseReleaseReply(text!), null, label);
  }
});

test("a rebind reply gives each listed statement's about by its number, and other for one it does not give", () => {
  assert.deepEqual(parseRebindReply('```json\n{"quarter_end":"2025-06-28","about":{"2":"year","1":"quarter","3":"half"}}\n```', 4), {
    quarterEnd: "2025-06-28",
    abouts: ["quarter", "year", "other", "other"],
  });
  assert.deepEqual(parseRebindReply('{"quarter_end":null,"about":{}}', 1), { quarterEnd: null, abouts: ["other"] });
});

// A rebind marks every sentence it reads, so a reply of the wrong shape must
// not read as "nothing to bind": it would mark the release read for good.
test("a rebind reply of the wrong shape is unparseable, not a reply that binds nothing", () => {
  for (const [label, text] of [
    ["a quarter end in words", '{"quarter_end":"June 28, 2025","about":{"1":"quarter"}}'],
    // Read by number, a list would shift every statement onto its neighbour's period.
    ["abouts as a list", '{"quarter_end":"2025-06-28","about":["quarter","year"]}'],
    ["a misspelled about", '{"quarter_end":"2025-06-28","abouts":{"1":"quarter"}}'],
    ["an empty object", "{}"],
    ["prose", "I could not find any."],
  ]) {
    assert.equal(parseRebindReply(text!, 1), null, label);
  }
});

test("a release reports the quarter every prompt naming one agrees on, ended before the filing and at most 92 days before it", () => {
  assert.equal(reportedQuarterEnd(["2025-06-28", null, "2025-06-28"], "2025-08-05"), "2025-06-28");
  assert.equal(reportedQuarterEnd(["2025-06-28", "2025-03-29"], "2025-08-05"), null, "prompts disagree");
  assert.equal(reportedQuarterEnd([null, null], "2025-08-05"), null, "no prompt names one");
  assert.equal(reportedQuarterEnd(["2025-08-05"], "2025-08-05"), null, "on the filing date");
  assert.equal(reportedQuarterEnd(["2025-09-27"], "2025-08-05"), null, "after it");
  assert.equal(reportedQuarterEnd(["2024-06-29"], "2025-08-05"), null, "a year-ago end");
  assert.equal(reportedQuarterEnd(["2025-05-05"], "2025-08-05"), "2025-05-05", "92 days before");
  assert.equal(reportedQuarterEnd(["2025-05-04"], "2025-08-05"), null, "93 days before");
  assert.equal(reportedQuarterEnd(["2025-06-28"], null), null, "no filing date");
});

test("a statement is kept only as a verbatim quote of an exhibit, stored in the exhibit's own words", () => {
  const exhibits = releaseExhibits(SUBMISSION);
  const verified = verifyStatement({ kind: "explanation", metric: "gross_margin", about: "other", quote: H20_EXPLANATION }, exhibits);
  assert.equal(verified?.exhibit, "EX-99.2");
  assert.equal(verified?.quote, H20_EXPLANATION);
  assert.equal(exhibits[1]!.text.slice(verified!.start, verified!.end), H20_EXPLANATION);

  // A curly apostrophe or extra spaces in the model's copy still match; the stored text is the exhibit's.
  const curly = verifyStatement({ kind: "explanation", metric: "gross_margin", about: "other", quote: "NVIDIA’s gross margin  was 60.5%, reflecting the H20 charge." }, exhibits);
  assert.equal(curly?.quote, "NVIDIA's gross margin was 60.5%, reflecting the H20 charge.");

  // A clause cut from a sentence is not a quote of it: it can drop the words
  // that change its meaning.
  const negated = releaseExhibits(
    "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<div>Gaming results were mixed. Revenue did not decline due to weaker demand in the quarter.</div>" +
      "<div>Data Center</div><div>Revenue was up 73%, driven by demand for our accelerated computing platform.</div>\n</TEXT>\n</DOCUMENT>",
  );
  assert.equal(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "decline due to weaker demand in the quarter." }, negated), null);
  assert.equal(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Revenue did not decline due to weaker demand" }, negated), null);
  assert.ok(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Revenue did not decline due to weaker demand in the quarter." }, negated));
  // A sentence after a heading block (no punctuation between) is whole.
  assert.ok(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Revenue was up 73%, driven by demand for our accelerated computing platform." }, negated));
  // An abbreviation's full stop ends no sentence: neither the clause after it
  // nor the words up to it are one.
  const abbreviated = releaseExhibits(
    "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<div>Revenue did not decline in the U.S. due to weaker demand.</div>\n</TEXT>\n</DOCUMENT>",
  );
  assert.equal(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "due to weaker demand." }, abbreviated), null);
  assert.equal(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Revenue did not decline in the U.S." }, abbreviated), null);
  assert.ok(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Revenue did not decline in the U.S. due to weaker demand." }, abbreviated));
  // A colon or semicolon ends no sentence: what follows it is part of one.
  const qualified = releaseExhibits(
    "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<div>This is not company guidance: Revenue is expected to grow 10%.</div>\n</TEXT>\n</DOCUMENT>",
  );
  assert.equal(verifyStatement({ kind: "guidance", metric: "revenue", about: "other", quote: "Revenue is expected to grow 10%." }, qualified), null);
  // A block ending in a comma (or colon, semicolon, dash) ends no sentence: its
  // qualifier is in the next.
  const qualifiedAfter = releaseExhibits(
    "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<div>Revenue increased due to stronger demand,</div><div>partially offset by lower pricing.</div>\n</TEXT>\n</DOCUMENT>",
  );
  assert.equal(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Revenue increased due to stronger demand," }, qualifiedAfter), null);
  assert.ok(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Revenue increased due to stronger demand, partially offset by lower pricing." }, qualifiedAfter));
  // Nor a block another runs on into ("but" / "revenue is..."): one that starts
  // lower-case continues the sentence before it, at both ends.
  const runOn = releaseExhibits(
    "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<div>This is not company guidance but</div><div>revenue is expected to grow 10% next year.</div>\n</TEXT>\n</DOCUMENT>",
  );
  assert.equal(verifyStatement({ kind: "guidance", metric: "revenue", about: "other", quote: "revenue is expected to grow 10% next year." }, runOn), null);
  assert.equal(verifyStatement({ kind: "guidance", metric: "revenue", about: "other", quote: "This is not company guidance but" }, runOn), null);
  assert.ok(verifyStatement({ kind: "guidance", metric: "revenue", about: "other", quote: "This is not company guidance but revenue is expected to grow 10% next year." }, runOn));
  // A block ending in a joining word ("but", "and", "of") runs on whatever the
  // next starts with.
  const runOnCapital = releaseExhibits(
    "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<div>This is not company guidance but</div><div>NVIDIA expects revenue to grow next year.</div>\n</TEXT>\n</DOCUMENT>",
  );
  assert.equal(verifyStatement({ kind: "guidance", metric: "revenue", about: "other", quote: "NVIDIA expects revenue to grow next year." }, runOnCapital), null);
  // Nor when the colon (or a dash or comma) ends the block before it.
  for (const mark of [":", " &mdash;", ","]) {
    const split = releaseExhibits(
      `<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<div>This is not company guidance${mark}</div><div>Revenue is expected to grow 10%.</div>\n</TEXT>\n</DOCUMENT>`,
    );
    assert.equal(verifyStatement({ kind: "guidance", metric: "revenue", about: "other", quote: "Revenue is expected to grow 10%." }, split), null, mark);
  }
  // Nor an abbreviated month's ("as of Dec. 31").
  const dated = releaseExhibits(
    "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<div>Cash and cash equivalents as of Dec. 31, 2025, were higher because of demand.</div>\n</TEXT>\n</DOCUMENT>",
  );
  assert.equal(verifyStatement({ kind: "explanation", metric: "other", about: "other", quote: "31, 2025, were higher because of demand." }, dated), null);
  assert.equal(verifyStatement({ kind: "explanation", metric: "other", about: "other", quote: "Cash and cash equivalents as of Dec." }, dated), null);
  // Nor before a capitalized continuation ("the U.S. Data Center market").
  const continued = releaseExhibits(
    "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<div>Revenue did not decline in the U.S. Data Center market due to weaker demand.</div>\n</TEXT>\n</DOCUMENT>",
  );
  assert.equal(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Data Center market due to weaker demand." }, continued), null);
  assert.equal(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Revenue did not decline in the U.S." }, continued), null);
  assert.ok(verifyStatement({ kind: "explanation", metric: "revenue", about: "other", quote: "Revenue did not decline in the U.S. Data Center market due to weaker demand." }, continued));

  // A paraphrase, an invented cause, or a fragment is not a quote.
  for (const quote of [
    "We incurred a $4.5 billion charge because demand for H20 fell.",
    "Gross margin fell due to a shift toward lower-margin gaming products.",
    "H20 charge.",
  ]) {
    assert.equal(verifyStatement({ kind: "explanation", metric: "gross_margin", about: "other", quote }, exhibits), null, quote);
  }
});

// --- Against Postgres -------------------------------------------------------

function fakeLlm(text: string): { llm: ExtractReleaseDeps["llm"]; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    llm: {
      complete: async (request) => {
        calls.push(request.messages.map((message) => message.content).join("\n"));
        return { text, deployment: { channel: "test", model: "test-model" } };
      },
    },
  };
}

function fakeSec(submission: string): ExtractReleaseDeps["secClient"] {
  return {
    fetchFiling: async (input: { accession_number: string }) => ({
      bytes: new TextEncoder().encode(submission),
      contentType: "text/plain",
      retrievedAt: "2025-05-29T00:00:00.000Z",
      url: `https://www.sec.gov/Archives/edgar/data/1045810/x/${input.accession_number}.txt`,
    }),
  } as unknown as ExtractReleaseDeps["secClient"];
}

// An Item 2.02 claim as persist8kFiling writes it, dated by the filing.
async function seedItem202(
  client: { query: QueryExecutor["query"] },
  filing: { name: string; cik: number; accession: string; filedOn: string } = { name: "NVIDIA Corp", cik: NVDA_CIK, accession: ACCESSION, filedOn: "2025-05-28" },
): Promise<{ claimId: string; issuerId: string; documentId: string }> {
  const issuer = await client.query<{ id: string }>(
    `insert into issuers (legal_name, cik) values ($1, $2) returning issuer_id::text as id`,
    [filing.name, String(filing.cik).padStart(10, "0")],
  );
  const issuerId = issuer.rows[0]!.id;
  const source = await client.query<{ id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text as id`,
  );
  const sourceId = source.rows[0]!.id;
  const document = await client.query<{ id: string }>(
    `insert into documents (source_id, kind, provider_doc_id, content_hash, raw_blob_id)
     values ($1, 'filing', $2, 'h-release', $2) returning document_id::text as id`,
    [sourceId, filing.accession],
  );
  const documentId = document.rows[0]!.id;
  const claim = await client.query<{ id: string }>(
    `insert into claims
       (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id,
        attributed_to_type, attributed_to_id, effective_time, confidence, status)
     values ($1, 'material_event.guidance_update', 'Material event reported via 8-K: guidance update (2.02).',
             'neutral', 'asserted', $2, 'issuer', $3, $4::timestamptz, 0.9, 'extracted')
     returning claim_id::text as id`,
    [documentId, sourceId, issuerId, `${filing.filedOn}T00:00:00Z`],
  );
  const claimId = claim.rows[0]!.id;
  await client.query(
    `insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`,
    [claimId, issuerId],
  );
  return { claimId, issuerId, documentId };
}

test("an earnings release's verified quotes become management claims, once", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-extraction");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client);
  const reply = JSON.stringify({ quarter_end: "2025-04-27", statements: [
    { kind: "explanation", metric: "gross_margin", about: "quarter", quote: H20_EXPLANATION },
    { kind: "guidance", metric: "revenue", about: "other", quote: REVENUE_GUIDANCE },
    // One sentence explaining two metrics is a claim for each.
    { kind: "explanation", metric: "operating_income", about: "quarter", quote: H20_EXPLANATION },
    // Picked twice for the same metric, it is one.
    { kind: "explanation", metric: "gross_margin", about: "quarter", quote: H20_EXPLANATION },
    // Invented: not in the filing, so never stored.
    { kind: "explanation", metric: "revenue", about: "quarter", quote: "Revenue grew because every hyperscaler doubled its orders." },
  ] });
  const { llm, calls } = fakeLlm(reply);
  const deps: ExtractReleaseDeps = { db: client, llm, secClient: fakeSec(SUBMISSION) };

  const [candidate] = await findReleaseCandidates(client);
  assert.equal(candidate?.claimId, seeded.claimId);
  assert.equal(candidate?.accession, ACCESSION);
  assert.equal(await extractReleaseStatements(deps, candidate!), "extracted");
  // The model saw both exhibits, and only them.
  assert.match(calls[0]!, /\[EX-99\.1\][\s\S]*\[EX-99\.2\]/);
  assert.doesNotMatch(calls[0]!, /xs:schema/);

  const claims = (await client.query<{ predicate: string; text_canonical: string; modality: string; period_kind: string | null; period_end: string | null; attributed_to_id: string; effective_time: Date; locator: { exhibit: string; start: number; end: number } }>(
    `select c.predicate, c.text_canonical, c.modality, c.period_kind, c.period_end::text as period_end, c.attributed_to_id, c.effective_time, e.locator
       from claims c join claim_evidence e on e.claim_id = c.claim_id
      where c.claim_id <> $1 order by c.predicate`,
    [seeded.claimId],
  )).rows;
  // The H20 charge explains Q1 FY2026, the quarter ended 2025-04-27; the
  // guidance explains no reported period.
  assert.deepEqual(claims.map((claim) => [claim.predicate, claim.text_canonical, claim.modality, claim.period_kind, claim.period_end]), [
    ["guidance.revenue", REVENUE_GUIDANCE, "quoted", null, null],
    ["management.explanation.gross_margin", H20_EXPLANATION, "quoted", "fiscal_q", "2025-04-27"],
    ["management.explanation.operating_income", H20_EXPLANATION, "quoted", "fiscal_q", "2025-04-27"],
  ]);
  assert.ok(claims.every((claim) => claim.attributed_to_id === seeded.issuerId));
  assert.equal(claims[1]!.effective_time.toISOString(), "2025-05-28T00:00:00.000Z");
  assert.equal(claims[1]!.locator.exhibit, "EX-99.2");
  // Each is about the issuer, as the chat's claim reader selects them.
  const argued = await client.query(`select 1 from claim_arguments where subject_id = $1`, [seeded.issuerId]);
  assert.equal(argued.rowCount, 4);
  const audit = await client.query(`select 1 from tool_call_logs where tool_name = 'extract_earnings_release' and status = 'ok'`);
  assert.equal(audit.rowCount, 1, "the filing's outcome is recorded for audit");
  const logged = await client.query(`select 1 from tool_call_logs where tool_name = 'extract_earnings_release.prompt' and status = 'ok'`);
  assert.equal(logged.rowCount, 1, "and each model call");

  // Processed once: no longer a candidate, and a second pass over it changes nothing.
  assert.deepEqual(await findReleaseCandidates(client), []);
  assert.equal(await extractReleaseStatements(deps, candidate!), "noop");
  assert.equal((await client.query(`select 1 from claims where predicate like 'management.%' or predicate like 'guidance.%'`)).rowCount, 3);
});

test("a release the model answers badly stays a candidate, with nothing stored", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-unparseable");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client);
  const { llm } = fakeLlm("Sorry, I can't help with that.");
  const result = await runReleaseExtractionDrain({ db: client, llm, secClient: fakeSec(SUBMISSION) });
  assert.equal(result.unparseable, 1);
  // Unread, so the next drain reads it again.
  assert.deepEqual((await findReleaseCandidates(client)).map((candidate) => candidate.claimId), [seeded.claimId]);
  assert.equal((await client.query(`select 1 from claims where claim_id <> $1`, [seeded.claimId])).rowCount, 0);
  // The model call is still recorded for audit.
  const audit = await client.query(`select 1 from tool_call_logs where tool_name = 'extract_earnings_release' and status = 'partial'`);
  assert.equal(audit.rowCount, 1);
  // And a run leaving it unread does not finish clean.
  assert.equal(drainIncomplete(result), true);
  assert.equal(drainIncomplete({ extracted: 1, empty: 0, unparseable: 0, no_exhibits: 0, noop: 0, failed: 0 }), false);
});

test("a reply whose every quote fails verification is read again, not marked empty", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-unverified");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client);
  const { llm } = fakeLlm(JSON.stringify({ quarter_end: "2025-04-27", statements: [
    { kind: "explanation", metric: "revenue", about: "quarter", quote: "Revenue grew because every hyperscaler doubled its orders." },
  ] }));
  const result = await runReleaseExtractionDrain({ db: client, llm, secClient: fakeSec(SUBMISSION) });
  assert.equal(result.unparseable, 1);
  assert.equal(result.empty, 0);
  assert.deepEqual((await findReleaseCandidates(client)).map((candidate) => candidate.claimId), [seeded.claimId]);
});

test("a prompt whose every quote fails verification leaves the filing to read again, whatever the others found", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-unverified-prompt");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client);
  // A third exhibit long enough to need prompts of its own.
  const long = Array.from({ length: 1_500 }, (_, n) => `<p>Paragraph ${n} restates a figure from the quarter.</p>`).join("");
  const submission = SUBMISSION.replace("</SEC-DOCUMENT>", "") +
    `\n<DOCUMENT>\n<TYPE>EX-99.3\n<TEXT>\n<html><body>${long}</body></html>\n</TEXT>\n</DOCUMENT>\n`;
  let calls = 0;
  const llm: ExtractReleaseDeps["llm"] = {
    complete: async () => {
      calls += 1;
      // The first prompt's quote is in the filing; the others' are invented.
      const quote = calls === 1 ? H20_EXPLANATION : "Revenue grew because every hyperscaler doubled its orders.";
      return { text: JSON.stringify({ quarter_end: "2025-04-27", statements: [{ kind: "explanation", metric: "gross_margin", about: "quarter", quote }] }), deployment: { channel: "test", model: "test-model" } };
    },
  };
  const result = await runReleaseExtractionDrain({ db: client, llm, secClient: fakeSec(submission) });
  assert.ok(calls > 1, "the release took several prompts");
  assert.equal(result.unparseable, 1);
  assert.deepEqual((await findReleaseCandidates(client)).map((candidate) => candidate.claimId), [seeded.claimId]);
});

test("a model call that fails is recorded for audit, and the filing stays a candidate", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-model-error");
  const client = await connectedClient(t, databaseUrl);
  await seedItem202(client);
  const llm: ExtractReleaseDeps["llm"] = { complete: async () => { throw new Error("upstream 503"); } };
  const result = await runReleaseExtractionDrain({ db: client, llm, secClient: fakeSec(SUBMISSION) });
  assert.equal(result.failed, 1);
  const calls = await client.query(`select 1 from tool_call_logs where tool_name = 'extract_earnings_release.prompt' and status = 'error'`);
  assert.equal(calls.rowCount, 1);
  assert.equal((await findReleaseCandidates(client)).length, 1);
});

test("a filing without EX-99 exhibits is marked processed without a model call", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-no-exhibits");
  const client = await connectedClient(t, databaseUrl);
  await seedItem202(client);
  const { llm, calls } = fakeLlm('{"quarter_end":null,"statements":[]}');
  const bare = SUBMISSION.replace(/<DOCUMENT>\n<TYPE>EX-99[\s\S]*?<\/DOCUMENT>/g, "");
  const result = await runReleaseExtractionDrain({ db: client, llm, secClient: fakeSec(bare) });
  assert.equal(result.no_exhibits, 1);
  assert.equal(calls.length, 0);
  assert.deepEqual(await findReleaseCandidates(client), []);
});

// AMD's Q2 2025 8-K (Item 2.02), filed 2025-08-05, cut down. The MI308
// sentences are its EX-99.1's own (as in the chat golden dataset); the other
// lines are written for this test.
const AMD_CIK = 2488;
const AMD_Q2 = { name: "Advanced Micro Devices Inc", cik: AMD_CIK, accession: "0000002488-25-000106", filedOn: "2025-08-05" };
const MI308_EXPLANATION =
  "As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.";
const AMD_YEAR_TO_DATE = "For the first six months of 2025, gross margin was lower primarily due to the MI308 inventory charges.";
const AMD_GUIDANCE = "For the third quarter of 2025, AMD expects revenue to be approximately $8.7 billion, plus or minus $300 million.";
const amdSubmission = (blocks: ReadonlyArray<string>) => [
  `<SEC-DOCUMENT>${AMD_Q2.accession}.txt`,
  "<DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>\n<html><body>",
  ...blocks.map((block) => `<p>${block}</p>`),
  "</body></html>\n</TEXT>\n</DOCUMENT>",
  "</SEC-DOCUMENT>",
].join("\n");
const AMD_Q2_SUBMISSION = amdSubmission([
  "AMD Reports Second Quarter 2025 Financial Results",
  "Financial results for the three months ended June 28, 2025 are in the tables below.",
  MI308_EXPLANATION,
  AMD_YEAR_TO_DATE,
  AMD_GUIDANCE,
]);
const amdQ2Reply = (quarterEnd: string | null) => JSON.stringify({ quarter_end: quarterEnd, statements: [
  { kind: "explanation", metric: "gross_margin", about: "quarter", quote: MI308_EXPLANATION },
  { kind: "explanation", metric: "gross_margin", about: "other", quote: AMD_YEAR_TO_DATE },
  // Guidance explains no reported period, whatever the model calls it.
  { kind: "guidance", metric: "revenue", about: "quarter", quote: AMD_GUIDANCE },
] });

async function releaseClaims(client: { query: QueryExecutor["query"] }, documentId: string) {
  return (await client.query<{ claim_id: string; predicate: string; text_canonical: string; period_kind: string | null; period_end: string | null; bound_after_created: boolean | null }>(
    `select claim_id::text as claim_id, predicate, text_canonical, period_kind, period_end::text as period_end,
            period_bound_at > created_at as bound_after_created
       from claims
      where document_id = $1 and predicate <> 'material_event.guidance_update'
      order by predicate, text_canonical`,
    [documentId],
  )).rows;
}

const periodsOf = (claims: Awaited<ReturnType<typeof releaseClaims>>) =>
  claims.map((claim) => [claim.predicate, claim.text_canonical, claim.period_kind, claim.period_end]);

test("AMD's Q2 2025 release binds the MI308 explanation to the quarter ended 2025-06-28, and leaves guidance and year-to-date unbound", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-amd-q2");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client, AMD_Q2);
  const result = await runReleaseExtractionDrain({ db: client, llm: fakeLlm(amdQ2Reply("2025-06-28")).llm, secClient: fakeSec(AMD_Q2_SUBMISSION) });
  assert.equal(result.extracted, 1);
  assert.deepEqual(periodsOf(await releaseClaims(client, seeded.documentId)), [
    ["guidance.revenue", AMD_GUIDANCE, null, null],
    ["management.explanation.gross_margin", MI308_EXPLANATION, "fiscal_q", "2025-06-28"],
    ["management.explanation.gross_margin", AMD_YEAR_TO_DATE, null, null],
  ]);
});

test("a fourth-quarter release binds its year's explanation to the fiscal year and its quarter's to the quarter, ending the same day", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-q4");
  const client = await connectedClient(t, databaseUrl);
  const quarter = "Fourth quarter gross margin increased year-over-year primarily driven by a higher mix of Data Center revenue.";
  const year = "For 2024, gross margin increased year-over-year primarily driven by strong growth in the Data Center segment.";
  const seeded = await seedItem202(client, { ...AMD_Q2, accession: "0000002488-25-000012", filedOn: "2025-02-04" });
  const reply = JSON.stringify({ quarter_end: "2024-12-28", statements: [
    { kind: "explanation", metric: "gross_margin", about: "quarter", quote: quarter },
    { kind: "explanation", metric: "gross_margin", about: "year", quote: year },
  ] });
  const submission = amdSubmission(["AMD Reports Fourth Quarter and Full Year 2024 Financial Results", quarter, year]);
  await runReleaseExtractionDrain({ db: client, llm: fakeLlm(reply).llm, secClient: fakeSec(submission) });
  assert.deepEqual(periodsOf(await releaseClaims(client, seeded.documentId)), [
    ["management.explanation.gross_margin", year, "fiscal_y", "2024-12-28"],
    ["management.explanation.gross_margin", quarter, "fiscal_q", "2024-12-28"],
  ]);
});

test("an extraction whose sentence matches only a superseded claim stores a current one, and leaves the superseded one as it was", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-superseded-match");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client, AMD_Q2);
  // The MI308 sentence, stored once and since superseded by a correction.
  const retired = (await client.query<{ id: string }>(
    `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id,
                         attributed_to_type, attributed_to_id, confidence, status, superseded_at)
     select document_id, 'management.explanation.gross_margin', $2, 'neutral', 'quoted', reported_by_source_id,
            'issuer', attributed_to_id, 0.8, 'extracted', now()
       from claims where claim_id = $1
     returning claim_id::text as id`,
    [seeded.claimId, MI308_EXPLANATION],
  )).rows[0]!.id;
  await runReleaseExtractionDrain({ db: client, llm: fakeLlm(amdQ2Reply("2025-06-28")).llm, secClient: fakeSec(AMD_Q2_SUBMISSION) });
  const stored = (await client.query<{ claim_id: string; period_kind: string | null; period_end: string | null; superseded: boolean }>(
    `select claim_id::text as claim_id, period_kind, period_end::text as period_end, superseded_at is not null as superseded
       from claims where text_canonical = $1 order by superseded`,
    [MI308_EXPLANATION],
  )).rows;
  assert.deepEqual(stored.map((claim) => [claim.period_kind, claim.period_end, claim.superseded]), [
    ["fiscal_q", "2025-06-28", false],
    [null, null, true],
  ]);
  assert.equal(stored[1]!.claim_id, retired);
  assert.notEqual(stored[0]!.claim_id, retired);
});

test("two Item 2.02 claims of one release, extracted at once, store each sentence once", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-concurrent");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client, AMD_Q2);
  const second = (await client.query<{ id: string }>(
    `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id,
                         attributed_to_type, attributed_to_id, effective_time, confidence, status)
     select document_id, predicate, text_canonical, polarity, modality, reported_by_source_id,
            attributed_to_type, attributed_to_id, effective_time, confidence, status
       from claims where claim_id = $1
     returning claim_id::text as id`,
    [seeded.claimId],
  )).rows[0]!.id;
  await client.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [second, seeded.issuerId]);
  const candidates = await findReleaseCandidates(client);
  assert.equal(candidates.length, 2);

  // Each extraction on its own connection waits, after its first sentence
  // lookup, for the other's (or a second), so unserialized both look before
  // either stores.
  let looked = 0;
  let bothLooked!: () => void;
  const met = new Promise<void>((resolve) => { bothLooked = resolve; });
  const racing = async (): Promise<QueryExecutor> => {
    const session = await connectedClient(t, databaseUrl);
    return {
      query: async (text, values) => {
        const result = await session.query(text, values);
        if (text.includes("text_canonical = $3")) {
          if (++looked === 2) bothLooked();
          await Promise.race([met, new Promise((resolve) => setTimeout(resolve, 1_000))]);
        }
        return result as never;
      },
    };
  };
  const { llm } = fakeLlm(amdQ2Reply("2025-06-28"));
  const sessions = [await racing(), await racing()];
  const outcomes = await Promise.all(candidates.map((candidate, n) => extractReleaseStatements({ db: sessions[n]!, llm, secClient: fakeSec(AMD_Q2_SUBMISSION) }, candidate)));
  assert.deepEqual(outcomes, ["extracted", "extracted"]);
  assert.deepEqual(periodsOf(await releaseClaims(client, seeded.documentId)), [
    ["guidance.revenue", AMD_GUIDANCE, null, null],
    ["management.explanation.gross_margin", MI308_EXPLANATION, "fiscal_q", "2025-06-28"],
    ["management.explanation.gross_margin", AMD_YEAR_TO_DATE, null, null],
  ]);
});

test("a reply whose quarter end is written in words, with a statement of no about, is stored unbound and the release marked read", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-tolerant-reply");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client, AMD_Q2);
  const reply = JSON.stringify({ quarter_end: "June 28, 2025", statements: [
    { kind: "explanation", metric: "gross_margin", about: "quarter", quote: MI308_EXPLANATION },
    { kind: "explanation", metric: "gross_margin", quote: AMD_YEAR_TO_DATE },
  ] });
  const result = await runReleaseExtractionDrain({ db: client, llm: fakeLlm(reply).llm, secClient: fakeSec(AMD_Q2_SUBMISSION) });
  assert.equal(result.extracted, 1);
  assert.deepEqual(periodsOf(await releaseClaims(client, seeded.documentId)), [
    ["management.explanation.gross_margin", MI308_EXPLANATION, null, null],
    ["management.explanation.gross_margin", AMD_YEAR_TO_DATE, null, null],
  ]);
  assert.deepEqual(await findReleaseCandidates(client), []);
});

// AMD's release with a long CFO commentary after it, so it is read in three
// prompts, and a scripted reply for each call in turn.
const AMD_Q2_MARGIN = "Second quarter gross margin was 40%, down primarily due to the MI308 inventory charges.";
const AMD_Q2_LONG_SUBMISSION = amdSubmission(["AMD Reports Second Quarter 2025 Financial Results", MI308_EXPLANATION, AMD_Q2_MARGIN])
  .replace("</SEC-DOCUMENT>", "<DOCUMENT>\n<TYPE>EX-99.2\n<TEXT>\n<html><body>" +
    Array.from({ length: 1_500 }, (_, n) => `<p>Paragraph ${n} restates a figure from the quarter.</p>`).join("") +
    "</body></html>\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>");
function scriptedLlm(replies: ReadonlyArray<object>): { llm: ExtractReleaseDeps["llm"]; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    llm: {
      complete: async (request) => {
        calls.push(request.messages.map((message) => message.content).join("\n"));
        return { text: JSON.stringify(replies[calls.length - 1]), deployment: { channel: "test", model: "test-model" } };
      },
    },
  };
}
const explains = (metric: string, about: string, quote: string) => ({ kind: "explanation", metric, about, quote });

test("a sentence two prompts say are about different periods stays unbound, for every metric it explains", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-about-disagree");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client, AMD_Q2);
  const { llm, calls } = scriptedLlm([
    { quarter_end: "2025-06-28", statements: [explains("gross_margin", "quarter", MI308_EXPLANATION), explains("gross_margin", "quarter", AMD_Q2_MARGIN)] },
    { quarter_end: "2025-06-28", statements: [explains("gross_margin", "year", MI308_EXPLANATION), explains("operating_income", "year", MI308_EXPLANATION)] },
    { quarter_end: "2025-06-28", statements: [explains("gross_margin", "quarter", MI308_EXPLANATION)] },
  ]);
  await runReleaseExtractionDrain({ db: client, llm, secClient: fakeSec(AMD_Q2_LONG_SUBMISSION) });
  assert.equal(calls.length, 3);
  assert.deepEqual(periodsOf(await releaseClaims(client, seeded.documentId)), [
    ["management.explanation.gross_margin", MI308_EXPLANATION, null, null],
    ["management.explanation.gross_margin", AMD_Q2_MARGIN, "fiscal_q", "2025-06-28"],
    ["management.explanation.operating_income", MI308_EXPLANATION, null, null],
  ]);
});

test("a release whose prompts name different quarter ends binds none of its claims", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-end-disagree");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client, AMD_Q2);
  const statements = [explains("gross_margin", "quarter", MI308_EXPLANATION), explains("gross_margin", "quarter", AMD_Q2_MARGIN)];
  const { llm, calls } = scriptedLlm([
    { quarter_end: "2025-06-28", statements },
    { quarter_end: "2025-03-29", statements },
    { quarter_end: "2025-06-28", statements },
  ]);
  const result = await runReleaseExtractionDrain({ db: client, llm, secClient: fakeSec(AMD_Q2_LONG_SUBMISSION) });
  assert.equal(calls.length, 3);
  assert.equal(result.extracted, 1);
  assert.deepEqual(periodsOf(await releaseClaims(client, seeded.documentId)), [
    ["management.explanation.gross_margin", MI308_EXPLANATION, null, null],
    ["management.explanation.gross_margin", AMD_Q2_MARGIN, null, null],
  ]);
});

// A rebind reply naming quarterEnd and, for each statement the prompt lists,
// what aboutOf says it is about; and the statements each call listed.
function rebindLlm(quarterEnd: string | null, aboutOf: (statement: string) => string): { llm: ExtractReleaseDeps["llm"]; listed: string[][] } {
  const listed: string[][] = [];
  return {
    listed,
    llm: {
      complete: async (request) => {
        const statements = [...request.messages.at(-1)!.content.matchAll(/^(\d+)\. (.+)$/gm)].map((line) => line[2]!);
        listed.push(statements);
        const about = Object.fromEntries(statements.map((statement, n) => [String(n + 1), aboutOf(statement)]));
        return { text: JSON.stringify({ quarter_end: quarterEnd, about }), deployment: { channel: "test", model: "test-model" } };
      },
    },
  };
}

const tableCounts = async (client: { query: QueryExecutor["query"] }) => (await client.query<{ claims: number; evidence: number; arguments: number }>(
  `select (select count(*) from claims)::int as claims, (select count(*) from claim_evidence)::int as evidence,
          (select count(*) from claim_arguments)::int as arguments`,
)).rows[0];

test("a rebind asks what each stored explanation is about, and binds them in place: no new rows, the same ids", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-rebind");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client, AMD_Q2);
  const submission = amdSubmission(["AMD Reports Second Quarter 2025 Financial Results", MI308_EXPLANATION, AMD_Q2_MARGIN, AMD_GUIDANCE]);
  // Read once with no quarter end, as a release read before #542 was.
  await runReleaseExtractionDrain({ db: client, secClient: fakeSec(submission), llm: scriptedLlm([{ quarter_end: null, statements: [
    explains("gross_margin", "quarter", MI308_EXPLANATION),
    explains("operating_income", "quarter", MI308_EXPLANATION),
    explains("gross_margin", "quarter", AMD_Q2_MARGIN),
    { kind: "guidance", metric: "revenue", about: "other", quote: AMD_GUIDANCE },
  ] }]).llm });
  const before = await releaseClaims(client, seeded.documentId);
  assert.deepEqual(before.map((claim) => claim.period_end), [null, null, null, null]);
  const counted = await tableCounts(client);

  const { llm, listed } = rebindLlm("2025-06-28", () => "quarter");
  const result = await runRebindDrain({ db: client, llm, secClient: fakeSec(submission) });
  assert.deepEqual(result, { bound: 1, unbound: 0, unparseable: 0, noop: 0, failed: 0 });
  // The model is shown each stored explanation once, and no guidance.
  assert.deepEqual(listed, [[MI308_EXPLANATION, AMD_Q2_MARGIN]]);
  const after = await releaseClaims(client, seeded.documentId);
  assert.deepEqual(after.map((claim) => claim.claim_id), before.map((claim) => claim.claim_id), "the same claims, so citations of them stay");
  assert.deepEqual(periodsOf(after), [
    ["guidance.revenue", AMD_GUIDANCE, null, null],
    ["management.explanation.gross_margin", MI308_EXPLANATION, "fiscal_q", "2025-06-28"],
    ["management.explanation.gross_margin", AMD_Q2_MARGIN, "fiscal_q", "2025-06-28"],
    ["management.explanation.operating_income", MI308_EXPLANATION, "fiscal_q", "2025-06-28"],
  ]);
  assert.ok(after.slice(1).every((claim) => claim.bound_after_created), "bound when rebound, not backdated to the claim's creation");
  assert.deepEqual(await tableCounts(client), counted);
  assert.deepEqual(await findRebindCandidates(client), []);
});

test("a rebind whose reply names no quarter end marks the release read, so a second selects nothing until --retry", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-rebind-unbound");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client, AMD_Q2);
  await runReleaseExtractionDrain({ db: client, llm: fakeLlm(amdQ2Reply(null)).llm, secClient: fakeSec(AMD_Q2_SUBMISSION) });
  assert.deepEqual((await findRebindCandidates(client)).map((candidate) => candidate.sentences), [[MI308_EXPLANATION, AMD_YEAR_TO_DATE]]);

  const first = rebindLlm(null, () => "quarter");
  assert.deepEqual(await runRebindDrain({ db: client, llm: first.llm, secClient: fakeSec(AMD_Q2_SUBMISSION) }), { bound: 0, unbound: 1, unparseable: 0, noop: 0, failed: 0 });
  assert.equal(first.listed.length, 1);
  assert.deepEqual((await releaseClaims(client, seeded.documentId)).map((claim) => claim.period_end), [null, null, null]);
  const second = rebindLlm("2025-06-28", () => "quarter");
  assert.deepEqual(await runRebindDrain({ db: client, llm: second.llm, secClient: fakeSec(AMD_Q2_SUBMISSION) }), { bound: 0, unbound: 0, unparseable: 0, noop: 0, failed: 0 });
  assert.equal(second.listed.length, 0, "no model call");

  assert.equal(await clearRebindMarks(client), 2);
  assert.deepEqual((await findRebindCandidates(client)).map((candidate) => candidate.documentId), [seeded.documentId]);
});

test("a rebind reply of the wrong shape leaves the release unread, and the drain incomplete", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-rebind-unparseable");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedItem202(client, AMD_Q2);
  await runReleaseExtractionDrain({ db: client, llm: fakeLlm(amdQ2Reply(null)).llm, secClient: fakeSec(AMD_Q2_SUBMISSION) });

  const result = await runRebindDrain({ db: client, llm: fakeLlm('{"quarter_end":"June 28, 2025","about":{"1":"quarter","2":"other"}}').llm, secClient: fakeSec(AMD_Q2_SUBMISSION) });
  assert.deepEqual(result, { bound: 0, unbound: 0, unparseable: 1, noop: 0, failed: 0 });
  assert.equal(drainIncomplete(result), true);
  assert.deepEqual((await findRebindCandidates(client)).map((candidate) => candidate.documentId), [seeded.documentId]);
});

test("a rebind reads at most --limit releases",{ skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-rebind-limit");
  const client = await connectedClient(t, databaseUrl);
  await seedItem202(client);
  await seedItem202(client, AMD_Q2);
  // Each read once with no quarter end.
  await runReleaseExtractionDrain({ db: client, llm: fakeLlm(amdQ2Reply(null)).llm, secClient: fakeSec(AMD_Q2_SUBMISSION) });
  assert.equal((await findRebindCandidates(client)).length, 2);

  const { llm, listed } = rebindLlm(null, () => "other");
  const limited = await runRebindDrain({ db: client, llm, secClient: fakeSec(AMD_Q2_SUBMISSION) }, { limit: 1 });
  assert.deepEqual(limited, { bound: 0, unbound: 1, unparseable: 0, noop: 0, failed: 0 });
  assert.equal(listed.length, 1);
  assert.equal((await findRebindCandidates(client)).length, 1);
});

test("a release whose only bound explanation is superseded is rebound for its current unbound one, and the superseded one is left as it was", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-rebind-superseded");
  const client = await connectedClient(t, databaseUrl);
  await seedItem202(client, AMD_Q2);
  await runReleaseExtractionDrain({ db: client, llm: fakeLlm(amdQ2Reply(null)).llm, secClient: fakeSec(AMD_Q2_SUBMISSION) });
  // The MI308 claim, bound to a calendar quarter's end and then superseded.
  await client.query(
    `update claims set period_kind = 'fiscal_q', period_end = '2025-06-30', period_bound_at = now(), superseded_at = now()
      where text_canonical = $1`,
    [MI308_EXPLANATION],
  );
  assert.deepEqual((await findRebindCandidates(client)).map((candidate) => candidate.sentences), [[AMD_YEAR_TO_DATE]]);
  const { llm, listed } = rebindLlm("2025-06-28", () => "quarter");
  assert.equal((await runRebindDrain({ db: client, llm, secClient: fakeSec(AMD_Q2_SUBMISSION) })).bound, 1);
  assert.deepEqual(listed, [[AMD_YEAR_TO_DATE]]);
  const mi308 = (await client.query<{ period_end: string }>(`select period_end::text as period_end from claims where text_canonical = $1`, [MI308_EXPLANATION])).rows;
  assert.deepEqual(mi308, [{ period_end: "2025-06-30" }]);
});
