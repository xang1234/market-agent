// The chat UI sends the user's message but no explicit subject, and the resolver
// only matches bare identifiers ("MU"), not sentences ("tell me about MU"). When
// no subject is attached, the coordinator grounds the turn by trying these
// candidates in order: the whole message first (covers a bare ticker or name),
// then uppercase ticker-like tokens, longest-first (covers "tell me about MU"
// -> MU). Lowercase tokens are intentionally ignored — tickers are written in
// caps, and matching common words like "is"/"a" against single-letter tickers
// would mis-ground the turn.

const TICKER_TOKEN = /^[A-Z]{1,5}$/;

export function extractSubjectCandidates(text: string | null | undefined): string[] {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) return [];

  const seen = new Set<string>();
  const candidates: string[] = [];
  const add = (value: string) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(value);
  };

  add(trimmed);

  const tickerTokens = trimmed
    .split(/[^A-Za-z]+/)
    .filter((token) => TICKER_TOKEN.test(token))
    .sort((a, b) => b.length - a.length);
  for (const token of tickerTokens) add(token);

  return candidates;
}
