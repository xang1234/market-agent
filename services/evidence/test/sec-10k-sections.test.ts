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

test("an HTML list item, whose bullet the browser draws, reads as a bulleted block", () => {
  const body = "<div>We make things that people use every day in many places.</div>".repeat(30);
  const sections = tenKSections(`<div>Item 1. Business</div><ul><li>suppliers of GPUs, such as AMD;</li></ul>${body}<div>Item 1A. Risk Factors</div>${body}`);
  assert.ok((sections["1"] as TenKSection).text.includes("Item 1. Business • suppliers of GPUs, such as AMD; We make"));
});
