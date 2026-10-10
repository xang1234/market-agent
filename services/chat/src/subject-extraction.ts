// The chat UI sends the user's message but no explicit subject, and the resolver
// only matches bare identifiers ("MU"), not sentences ("tell me about MU"). The
// coordinator tries the whole message first (a bare ticker, name, or theme),
// then every ticker-like token it mentions.
//
// TICKER_TOKEN is deliberately STRICTER than the resolver's own notion of a
// ticker (normalize.ts treats any whitespace-free token as a candidate and
// uppercases it). We require 1-5 already-uppercase ASCII letters because the
// resolver's permissiveness is the wrong default for prose: lowercase words like
// "is"/"a" would resolve to single-letter tickers and mis-ground the turn. The
// tradeoff is that this heuristic does NOT recognise lowercase tickers ("mu"),
// symbols with dots/digits or share-class suffixes ("BRK.B"), or names ("Micron")
// — those reach the resolver only via the whole-message attempt. Widening this
// (e.g. LLM-based extraction) is tracked separately.
const TICKER_TOKEN = /^[A-Z]{1,5}$/;

// Finance and calendar acronyms that are written in capitals but never name a
// company in a financial request ("EPS for AAPL in FY2023").
const NON_SUBJECT_TOKENS = new Set([
  "A", "I", "H", "Q", "AND", "OR", "VS", "FY", "TTM", "LTM", "YTD", "YOY", "QOQ",
  "EPS", "USD", "GAAP", "SEC", "CEO", "CFO", "IPO", "ETF",
]);

/**
 * Every company a multi-subject request names, in the order written. A
 * comparison must cover each one or ask about it — never silently drop one —
 * so this returns all ticker-like mentions.
 */
export function extractSubjectMentions(text: string | null | undefined): string[] {
  const mentions: string[] = [];
  // A benchmark index is not a company: "S&P" would split into "S" and "P", and
  // "DOW JONES" into Dow Inc. and "JONES" (#206).
  for (const token of (text ?? "").replace(new RegExp(BENCHMARK.source, "gi"), " ").split(/[^A-Za-z]+/)) {
    if (TICKER_TOKEN.test(token) && !NON_SUBJECT_TOKENS.has(token) && !mentions.includes(token)) mentions.push(token);
  }
  return mentions;
}

// A benchmark index a question names (#206). Dow Inc. alone ("DOW") is a
// company; only "Dow Jones" is the index.
export const BENCHMARK = /\b(?:benchmarks?|S&P(?:\s*500)?|Nasdaq(?:[- ]100| composite)?|Dow Jones|Russell \d{4}|(?:market |stock )?index(?:es)?)(?![\w&])/i;

// Words that ask to set companies side by side, so a follow-up that names a new
// company keeps the previous ones ("compare it with AMD") instead of replacing
// them ("analyze AAPL and its margins").
export const COMPARATIVE = /\b(compare|comparison|comparing|versus|vs\.?|against|relative to|peers?|stacks? up)\b/i;

// One key per company: two listings (or names) of the same issuer share it.
export function companyKey(subject: {
  subject_ref: { kind: string; id: string };
  handoff?: { context?: { issuer?: { subject_ref?: { id: string } }; listing?: { issuer_ref?: { id: string } }; instrument?: { issuer_ref?: { id: string } } } };
}): string {
  const context = subject.handoff?.context;
  const issuer = context?.issuer?.subject_ref ?? context?.listing?.issuer_ref ?? context?.instrument?.issuer_ref;
  if (issuer) return `issuer:${issuer.id}`;
  return subject.subject_ref.kind === "issuer" ? `issuer:${subject.subject_ref.id}` : `${subject.subject_ref.kind}:${subject.subject_ref.id}`;
}
