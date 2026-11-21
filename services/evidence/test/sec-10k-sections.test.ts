import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { tenKSections, type TenKSection } from "../src/sec-10k-sections.ts";

const fixture = (ticker: string) => readFileSync(new URL(`./fixtures/sec-10k/${ticker}.htm`, import.meta.url), "utf8");

for (const [ticker, business, risks] of [
  ["nvda", "Item 1. Business Our Company NVIDIA pioneered", "Item 1A. Risk Factors The following risk factors"],
  ["mu", "ITEM 1. BUSINESS Overview We are a global leader", "ITEM 1A. RISK FACTORS In addition to the factors"],
  ["aapl", "Item 1. Business Company Background The Company", "Item 1A. Risk Factors The following summarizes"],
] as const) {
  test(`${ticker}.htm: Item 1 and Item 1A open with their headings, past the table of contents`, () => {
    const sections = tenKSections(fixture(ticker));
    const item1 = sections["1"] as TenKSection;
    const item1a = sections["1A"] as TenKSection;
    assert.equal(item1.text.slice(0, business.length), business);
    assert.equal(item1a.text.slice(0, risks.length), risks);
    assert.ok(!item1.text.includes(risks), "Item 1 ends where Item 1A starts");
    assert.ok(!/Item 1B\. Unresolved Staff Comments None/i.test(item1a.text), "Item 1A ends where Item 1B starts");
  });
}

test("a 10-K with Item 1A removed returns section_not_found for 1A, and Item 1 still", () => {
  const html = fixture("mu");
  const cut = (heading: string) => html.lastIndexOf("<div", html.indexOf(heading));
  const without1a = html.slice(0, cut("ITEM 1A. RISK FACTORS")) + html.slice(cut("ITEM 1B. UNRESOLVED"));
  const sections = tenKSections(without1a);
  assert.deepEqual(sections["1A"], { type: "1A", error: "section_not_found" });
  assert.equal((sections["1"] as TenKSection).text.slice(0, 16), "ITEM 1. BUSINESS");
});

test("a heading reads through a word markup split, and Item 1 may be the Description of Business", () => {
  const body = "<div>We make things that people use every day in many places.</div>".repeat(30);
  const html = [
    "<div>Item 1. Business 1</div><div>Item 1A. Risk Factors 9</div><div>Item 2. Properties 20</div>",
    `<div>Item 1. <span>Description of B</span><span>usiness</span>.</div>${body}`,
    `<div>ITEM 1A. R<span>ISK FACTORS</span></div>${body}`,
    `<div>Item 2. Properties</div>${body}`,
  ].join("");
  const sections = tenKSections(html);
  assert.equal((sections["1"] as TenKSection).text.slice(0, 34), "Item 1. Description of B usiness .");
  assert.equal((sections["1A"] as TenKSection).text.slice(0, 22), "ITEM 1A. R ISK FACTORS");
  assert.ok(!(sections["1A"] as TenKSection).text.includes("Properties"));
});

test("an item ends at the next heading however its title is cased, and at Item 2 when Item 1B is absent", () => {
  const body = "<div>We make things that people use every day in many places.</div>".repeat(30);
  for (const next of ["Item 1B. unresolved staff comments", "ITEM 1B: UNRESOLVED STAFF COMMENTS", "Item 1B.unresolved staff comments", "Item 2. properties", "ITEM 2 - PROPERTIES", "Item 6. [Reserved]"]) {
    const sections = tenKSections(`<div>Item 1. Business</div>${body}<div>Item 1a. risk factors</div>${body}<div>${next}</div>${body}`);
    const item1 = sections["1"] as TenKSection;
    const item1a = sections["1A"] as TenKSection;
    assert.ok(!item1.text.includes("risk factors"), `Item 1 ends at a lower-case 1A heading, before ${next}`);
    assert.equal(item1a.text.slice(0, 22), "Item 1a. risk factors ", next);
    assert.ok(!item1a.text.includes(next), `Item 1A ends at ${next}`);
  }
});

test("an ltem typo, as 1-800-Flowers' 10-K writes Item 1A, still heads an item", () => {
  const body = "<div>We make things that people use every day in many places.</div>".repeat(30);
  const sections = tenKSections(`<div>Item 1. Business</div>${body}<div>ltem 1A. Risk Factors</div>${body}<div>Item 1B. Unresolved Staff Comments</div>`);
  assert.equal((sections["1A"] as TenKSection).text.slice(0, 21), "ltem 1A. Risk Factors");
  assert.ok(!(sections["1"] as TenKSection).text.includes("Risk Factors"));
});

test("a paragraph that opens by citing an item is no heading", () => {
  const body = "<div>We make things that people use every day in many places.</div>".repeat(30);
  const sections = tenKSections(`<div>Item 1A. Risk Factors</div>${body}<div>Item 7 of this report discusses these risks further.</div>${body}<div>Item 1B. Unresolved Staff Comments</div>`);
  assert.ok((sections["1A"] as TenKSection).text.includes("Item 7 of this report"));
});

test("a combined Items 1 and 2 heading opens Item 1", () => {
  const body = "<div>We make things that people use every day in many places.</div>".repeat(30);
  for (const heading of ["Items 1 and 2. Business and Properties", "ITEMS 1 AND 2. BUSINESS AND PROPERTIES", "Items 1 & 2. Business", "Items 1 And 2. Business And Properties"]) {
    const sections = tenKSections(`<div>${heading}</div>${body}<div>Item 1A. Risk Factors</div>${body}`);
    assert.equal((sections["1"] as TenKSection).text.slice(0, heading.length), heading, heading);
  }
});

test("an HTML list item, whose bullet the browser draws, reads as a bulleted block", () => {
  const body = "<div>We make things that people use every day in many places.</div>".repeat(30);
  const sections = tenKSections(`<div>Item 1. Business</div><p>Our competitors include:<ul><li>suppliers of GPUs, such as AMD;</li></ul></p>${body}<div>Item 1A. Risk Factors</div>${body}`);
  const item1 = sections["1"] as TenKSection;
  const at = item1.text.indexOf("• suppliers of GPUs, such as AMD;");
  assert.ok(at > 0 && item1.edges.has(at), "the item starts its own block, after a paragraph it sits inside");
});

const paragraphs = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => `<p>${tag} paragraph ${i}: we make things that people use every day in many places.</p>`).join("");

test("a smaller reporting company's omitted Item 1A is not found, though Item 7 opens by citing it", () => {
  for (const cite of ["Item 1A. Risk Factors and forward-looking statements are described above.", "Item 1A. Risk Factors, above, describes forward-looking risks."]) {
    const html = [
      `<div>Item 1. Business</div>${paragraphs("business", 30)}`,
      "<div>Item 1A. Risk Factors</div><p>Not required for smaller reporting companies.</p>",
      "<div>Item 1B. Unresolved Staff Comments</div><p>None.</p>",
      `<div>Item 7. Management's Discussion and Analysis</div><p>${cite}</p>${paragraphs("liquidity", 30)}`,
      "<div>Item 8. Financial Statements</div>",
    ].join("");
    assert.deepEqual(tenKSections(html)["1A"], { type: "1A", error: "section_not_found" }, cite);
  }
});

test("a page header that repeats the item's heading stays inside the item", () => {
  for (const header of ["Item 1A. Risk Factors (continued)", "Item 1A. Risk Factors"]) {
    const pages = [1, 2, 3].map((page) => `<div>${header}</div>${paragraphs(`page ${page}`, 25)}`).join("");
    const html = `<div>Item 1. Business</div>${paragraphs("business", 30)}<div>Item 1A. Risk Factors</div>${paragraphs("page 0", 25)}${pages}<div>Item 1B. Unresolved Staff Comments</div>`;
    const item1a = tenKSections(html)["1A"] as TenKSection;
    assert.ok(item1a.text.startsWith("Item 1A. Risk Factors page 0 paragraph 0"), header);
    assert.ok(item1a.text.endsWith("page 3 paragraph 24: we make things that people use every day in many places."), header);
  }
});

test("a paragraph that opens with an item's title and runs on cites the item, so the section continues", () => {
  const html = [
    `<div>Item 1. Business</div>${paragraphs("early", 15)}<p>Item 1A. Risk Factors describes the risks we face in more detail.</p>${paragraphs("competition", 15)}`,
    `<div>Item 1A. Risk Factors</div>${paragraphs("supply", 15)}<p>Item 7. Management's Discussion and Analysis describes our liquidity in more detail.</p>${paragraphs("demand", 15)}`,
    "<div>Item 1B. Unresolved Staff Comments</div>",
  ].join("");
  const sections = tenKSections(html);
  assert.ok((sections["1"] as TenKSection).text.endsWith("competition paragraph 14: we make things that people use every day in many places."));
  assert.ok((sections["1A"] as TenKSection).text.endsWith("demand paragraph 14: we make things that people use every day in many places."));
});

test("a heading that shares its block with PART I opens the item at its label", () => {
  const html = `<div>Item 1. Business 3</div><div>Item 1A. Risk Factors 9</div><p><b>PART I</b> <b>ITEM 1. BUSINESS</b></p>${paragraphs("business", 30)}<p><b>ITEM 1A. RISK FACTORS</b></p>${paragraphs("risk", 30)}`;
  assert.equal((tenKSections(html)["1"] as TenKSection).text.slice(0, 36), "ITEM 1. BUSINESS business paragraph ");
});

test("a table of contents in one block is no Item 1 when the real heading follows it", () => {
  const html = `<p>Item 1. Business 3 Item 1A. Risk Factors 9 Item 2. Properties 21</p><div>PART I</div><div>Item 1. Business</div>${paragraphs("business", 30)}<div>Item 1A. Risk Factors</div>${paragraphs("risk", 30)}`;
  assert.equal((tenKSections(html)["1"] as TenKSection).text.slice(0, 26), "Item 1. Business business ");
});

test("a title split by markup still heads the next item, so the one before it ends", () => {
  const html = `<div>Item 1A. Risk Factors</div>${paragraphs("risk", 30)}<div>Item 7A. Quantitative and Qualitat<span>ive</span> Disclosures About Market Risk.</div>${paragraphs("rates", 30)}`;
  assert.ok(!(tenKSections(html)["1A"] as TenKSection).text.includes("rates paragraph"));
});

test("a paragraph that cites a lettered item by number is no heading", () => {
  for (const cite of ["Item 1A of this report discusses the risks of our business.", "Item 1A, Risk Factors, of this report describes the risks we face."]) {
    const html = `<div>Item 1. Business</div>${paragraphs("early", 15)}<p>${cite}</p>${paragraphs("late", 15)}<div>Item 1A. Risk Factors</div>${paragraphs("risk", 20)}`;
    const sections = tenKSections(html);
    assert.ok((sections["1"] as TenKSection).text.endsWith("late paragraph 14: we make things that people use every day in many places."), cite);
    assert.equal((sections["1A"] as TenKSection).text.slice(0, 26), "Item 1A. Risk Factors risk", cite);
  }
});

test("a short lower-case title heads the next item, so the one before it ends", () => {
  for (const next of ["Item 1B. unresolved staff comments", "Item 2. properties"]) {
    const sections = tenKSections(`<div>Item 1A. Risk Factors</div>${paragraphs("risk", 30)}<div>${next}</div>${paragraphs("after", 5)}`);
    assert.ok(!(sections["1A"] as TenKSection).text.includes("after paragraph"), next);
  }
});

const tenK = (heading1a: string, heading1b: string, heading1c = "<div>Item 1C. Cybersecurity</div>") =>
  `<div>Item 1. Business</div>${paragraphs("business", 25)}${heading1a}${paragraphs("risk", 25)}${heading1b}${paragraphs("unresolved", 3)}` +
  `${heading1c}${paragraphs("cyber", 25)}<div>Item 2. Properties</div>${paragraphs("property", 25)}`;

test("a title in sentence case heads its item", () => {
  const cybersecurity = "<div>Item 1C. Cybersecurity risk management and strategy</div>";
  for (const [heading1b, lastParagraph] of [["<div>Item 1B. Unresolved staff comments</div>", "risk paragraph 24"], ["", "unresolved paragraph 2"]]) {
    const item1a = tenKSections(tenK("<div>Item 1A. Risk factors</div>", heading1b, cybersecurity))["1A"] as TenKSection;
    assert.ok(item1a.text.startsWith("Item 1A. Risk factors risk paragraph 0"));
    assert.ok(item1a.text.endsWith(`${lastParagraph}: we make things that people use every day in many places.`), `Item 1A ends at ${heading1b || cybersecurity}`);
  }
});

test("a heading whose label and title sit in two table cells heads its item", () => {
  const sections = tenKSections(tenK("<table><tr><td>Item 1A.</td><td>Risk Factors</td></tr></table>", "<div>Item 1B. Unresolved Staff Comments</div>"));
  assert.ok(!(sections["1"] as TenKSection).text.includes("risk paragraph"));
  assert.equal((sections["1A"] as TenKSection).text.slice(0, 26), "Item 1A. Risk Factors risk");
});

test("a heading that a sentence follows in its own block heads the item", () => {
  for (const heading1b of ["<p>Item 1B. Unresolved Staff Comments We have no unresolved comments.</p>", "<p>Item 1B. Unresolved Staff Comments None.</p>", "<p>ITEM 1B — UNRESOLVED STAFF COMMENTS</p>"]) {
    const item1a = tenKSections(tenK("<p>Item 1A. Risk Factors Investing in our stock involves risk.</p>", heading1b))["1A"] as TenKSection;
    assert.ok(item1a.text.startsWith("Item 1A. Risk Factors Investing in our stock"), heading1b);
    assert.ok(!item1a.text.includes("unresolved paragraph"), `Item 1A ends at ${heading1b}`);
  }
});

test("a sentence that cites an item's title and goes on past it is no heading", () => {
  for (const cite of [
    "Item 1A. Risk Factors, of this report, describes the risks we face.",
    "Item 1A. Risk Factors (below) describes the risks we face.",
    "Item 1A. Risk Factors; see the risks we face.",
    "Item 1A. Risk Factors — discusses the risks we face.",
  ]) {
    const html = `<div>Item 1. Business</div>${paragraphs("early", 15)}<p>${cite}</p>${paragraphs("late", 15)}<div>Item 1A. Risk Factors</div>${paragraphs("risk", 25)}<div>Item 1B. Unresolved Staff Comments</div>`;
    const sections = tenKSections(html);
    assert.ok((sections["1"] as TenKSection).text.endsWith("late paragraph 14: we make things that people use every day in many places."), cite);
    assert.equal((sections["1A"] as TenKSection).text.slice(0, 26), "Item 1A. Risk Factors risk", cite);
  }
});

test("a sentence that names an item but not its title is no heading", () => {
  for (const cite of ["Item 7 for details", "Item 8 and the notes", "Item 1A of this report"]) {
    const html = `<div>Item 1. Business</div>${paragraphs("early", 15)}<p>${cite}</p>${paragraphs("late", 15)}<div>Item 1A. Risk Factors</div>${paragraphs("risk", 25)}`;
    assert.ok((tenKSections(html)["1"] as TenKSection).text.endsWith("late paragraph 14: we make things that people use every day in many places."), cite);
  }
});

test("a label split by markup still heads its item", () => {
  for (const [heading, opening] of [["Item 1<span>A</span>. Risk Factors", "Item 1 A . Risk Factors risk"], ["It<span>em</span> 1A. Risk Factors", "It em 1A. Risk Factors risk"]]) {
    const sections = tenKSections(tenK(`<div>${heading}</div>`, "<div>Item 1B. Unresolved Staff Comments</div>"));
    assert.ok(!(sections["1"] as TenKSection).text.includes("risk paragraph"), `Item 1 ends at ${heading}`);
    assert.equal((sections["1A"] as TenKSection).text.slice(0, opening.length), opening);
  }
});

test("mcd.htm: a 10-K in its annual report's order heads Risk Factors by title, and labels it only in the cross-reference index", () => {
  const sections = tenKSections(fixture("mcd"));
  const item1a = sections["1A"] as TenKSection;
  assert.equal(item1a.text.slice(0, 70), "RISK FACTORS Cautionary Statement Regarding Forward-Looking Statements");
  assert.ok(item1a.text.endsWith("McDonald's Corporation 2025 Annual Report 33"), "Item 1A ends where Cybersecurity starts");
  assert.deepEqual(sections["1"], { type: "1", error: "section_not_found" });
});

const annualReportOrder = (risks: string, afterRisks: string) => [
  "<div>Table of Contents</div><table><tr><td>Business</td><td>3</td></tr><tr><td>Risk Factors</td><td>9</td></tr><tr><td>Legal Proceedings</td><td>21</td></tr></table>",
  `<div>BUSINESS</div>${paragraphs("business", 30)}`,
  `${risks}${paragraphs("risk", 30)}`,
  `${afterRisks}${paragraphs("legal", 30)}`,
  "<div>Form 10-K Cross-Reference Index</div><table><tr><td>Item 1</td><td>Business</td><td>Page 3</td></tr><tr><td>Item 1A</td><td>Risk Factors</td><td>Page 9</td></tr></table>",
].join("");

test("a 10-K that labels its items only in a cross-reference index is read by their titles", () => {
  const sections = tenKSections(annualReportOrder("<div>Risk Factors</div>", "<div>LEGAL PROCEEDINGS</div>"));
  const item1 = sections["1"] as TenKSection;
  const item1a = sections["1A"] as TenKSection;
  assert.ok(item1.text.startsWith("BUSINESS business paragraph 0"));
  assert.ok(item1.text.endsWith("business paragraph 29: we make things that people use every day in many places."));
  assert.ok(item1a.text.startsWith("Risk Factors risk paragraph 0"));
  assert.ok(item1a.text.endsWith("risk paragraph 29: we make things that people use every day in many places."));
});

test("a title in capitals heads its item when a sentence follows it in its block, and a run-in subheading does not", () => {
  const risks = "<p>RISK FACTORS. The following are certain risk factors that could affect the Company.</p>";
  const subheadings = "<p>Properties. The Company owns or leases its plants.</p><p>Cybersecurity - Increased cybersecurity requirements could hurt us.</p>";
  const html = annualReportOrder(risks, "<p>LEGAL PROCEEDINGS. The Company is a party to several lawsuits.</p>")
    .replace(paragraphs("business", 30), `${paragraphs("business", 3)}${subheadings}${paragraphs("business", 30)}`);
  const sections = tenKSections(html);
  assert.ok((sections["1"] as TenKSection).text.includes("Properties. The Company owns"), "Item 1 runs on past its Properties subheading");
  assert.ok((sections["1"] as TenKSection).text.includes("Cybersecurity - Increased"), "Item 1 runs on past a subheading that runs on");
  assert.ok((sections["1A"] as TenKSection).text.startsWith("RISK FACTORS. The following are certain risk factors"));
  assert.ok(!(sections["1A"] as TenKSection).text.includes("legal paragraph"), "Item 1A ends at LEGAL PROCEEDINGS.");
});

test("a 10-K that labels its items reads no unlabeled title as a heading", () => {
  const html = `<div>Item 1. Business</div>${paragraphs("business", 30)}<div>Item 1A. Risk Factors</div>${paragraphs("risk", 10)}<div>Legal Proceedings</div>${paragraphs("lawsuit risk", 10)}<div>Item 1B. Unresolved Staff Comments</div>`;
  assert.ok((tenKSections(html)["1A"] as TenKSection).text.includes("lawsuit risk paragraph 9"));
});

test("an unlabeled item that runs on through sections no Form 10-K title names is not found", () => {
  const html = annualReportOrder("<div>RISK FACTORS</div>", `<div>SUSTAINABILITY</div>${paragraphs("sustainability", 3_700)}<div>Legal Proceedings</div>`);
  assert.deepEqual(tenKSections(html)["1A"], { type: "1A", error: "section_not_found" });
});

test("a labeled heading may set its label apart from its title, and close with a note", () => {
  for (const [heading, opening] of [
    ["<span>ITEM 1A.  </span><span>I  </span><span>Risk Factors</span>", "ITEM 1A. I Risk Factors risk"],
    ["Item No. 1A - Risk Factors", "Item No. 1A - Risk Factors risk"],
    ["Item 1A. Risk Factors 2025", "Item 1A. Risk Factors 2025 risk"],
    ["ITEM 1A. RISK FACTORS (dollars in millions, except per share amounts)", "ITEM 1A. RISK FACTORS (dollars in millions, except per share amounts) risk"],
  ]) {
    const sections = tenKSections(tenK(`<div>${heading}</div>`, "<div>Item 1B. Unresolved Staff Comments</div>"));
    assert.ok(!(sections["1"] as TenKSection).text.includes("risk paragraph"), `Item 1 ends at ${heading}`);
    assert.equal((sections["1A"] as TenKSection).text.slice(0, opening.length), opening);
  }
});

test("a contents entry that closes with its page number heads nothing, though a long preface follows it", () => {
  for (const page of ["(9)", "(page 9)", "(Pages 9-21)", "(p. 9)", "(pp. 9-21)", "9", "9-21", "........ 9", "Page 9"]) {
    const html = [
      `<div>Item 1. Business (3)</div><div>Item 1A. Risk Factors ${page}</div>${paragraphs("preface", 50)}`,
      `<div>Item 1. Business</div>${paragraphs("business", 30)}<div>Item 1A. Risk Factors</div>${paragraphs("risk", 30)}`,
      "<div>Item 1B. Unresolved Staff Comments</div>",
    ].join("");
    assert.ok((tenKSections(html)["1A"] as TenKSection).text.startsWith("Item 1A. Risk Factors risk paragraph 0"), page);
  }
});
