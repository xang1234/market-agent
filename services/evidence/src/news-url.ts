const TRACKING_PARAM_NAMES: ReadonlyArray<string> = Object.freeze([
  // utm_* covers all utm_source/utm_medium/utm_campaign/utm_term/utm_content variants.
  // Handled via prefix match below — the rest of the list is exact-match.
  "fbclid",
  "gclid",
  "mc_eid",
  "mc_cid",
  "_hsenc",
  "_hsmi",
  "yclid",
  "msclkid",
]);

export function canonicalizeNewsUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`canonicalizeNewsUrl: invalid URL "${rawUrl}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `canonicalizeNewsUrl: scheme must be http(s); received "${parsed.protocol}"`,
    );
  }

  // Lowercase host (per RFC 3986 case-insensitive); preserve path/query case.
  parsed.host = parsed.host.toLowerCase();

  // Strip tracking params: utm_* prefix + the exact-match list above.
  // URLSearchParams.delete is in-place; iterate over a snapshot of names.
  const namesToCheck = Array.from(parsed.searchParams.keys());
  for (const name of namesToCheck) {
    const normalizedName = name.toLowerCase();
    if (normalizedName.startsWith("utm_") || TRACKING_PARAM_NAMES.includes(normalizedName)) {
      parsed.searchParams.delete(name);
    }
  }

  // Drop trailing slash from path — but only if there IS a path beyond "/".
  // "https://example.com/" stays as "/" (root-vs-no-path semantics differ).
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  parsed.hash = "";

  return parsed.toString();
}
