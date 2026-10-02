// Data mode's warm-up for the golden conversation (#152). Chat reads persisted facts
// only, so on a fresh database NVDA and AMD have no identity and no SEC facts. This
// ingests them through the running stack, as a company page would:
//   1. resolve the ticker (the resolver discovers it through Polygon on a miss);
//   2. read key stats live, which persists the latest two fiscal years (turn 2's
//      metrics_comparison);
//   3. read quarterly income statements newest first until 8 are available
//      (turn 1's revenue_bars and metric_row).
// It needs no credentials of its own: the services hold POLYGON_API_KEY and
// SEC_EDGAR_USER_AGENT. Idempotent: a persisted identity or statement is read back,
// not refetched. It refuses a stack serving the frozen golden dataset, so live facts
// never land on frozen identities.
import { GOLDEN_COMPANIES } from "../test/golden/dataset.ts";

export const GOLDEN_LIVE_TICKERS: ReadonlyArray<string> = ["NVDA", "AMD"];
const QUARTERS_NEEDED = 8;
const QUARTERS = ["Q4", "Q3", "Q2", "Q1"] as const;
const FROZEN_ISSUER_IDS = new Set(GOLDEN_COMPANIES.map((company) => company.issuer_id));

type Fetch = typeof fetch;
type WarmupOptions = { fetchImpl?: Fetch; requestTimeoutMs?: number; log?: (line: string) => void };
type ResolveResponse = { subjects?: Array<{ context?: { issuer?: { subject_ref?: { kind?: string; id?: string } } } }> };
type StatementsResponse = { results?: Array<{ outcome?: { outcome?: string } }> };

// Returns one failure line per ticker that could not be warmed; empty when all are ready.
export async function warmGoldenLiveData(
  base: string,
  { fetchImpl = fetch, requestTimeoutMs = 120_000, log = console.log }: WarmupOptions = {},
): Promise<string[]> {
  const request = async (method: string, path: string, body?: unknown) => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return { status: response.status, body: await response.json().catch(() => null) as unknown };
  };

  const failures: string[] = [];
  for (const ticker of GOLDEN_LIVE_TICKERS) {
    const resolved = await request("POST", "/v1/subjects/resolve", { text: ticker });
    const issuerId = (resolved.body as ResolveResponse | null)?.subjects
      ?.map((subject) => subject.context?.issuer?.subject_ref)
      .find((ref) => ref?.kind === "issuer")?.id;
    if (!issuerId) {
      failures.push(`${ticker}: the resolver found no issuer (is POLYGON_API_KEY set for the stack?)`);
      continue;
    }
    if (FROZEN_ISSUER_IDS.has(issuerId)) {
      // A data-mode check must not pass on, or write onto, the frozen dataset.
      throw new Error(
        `${ticker} resolves to the frozen golden dataset; golden:live needs DEV_MODE=data on a fresh database`,
      );
    }

    const stats = await request("GET", `/v1/fundamentals/stats?subject_kind=issuer&subject_id=${issuerId}`);
    const latestYear = (stats.body as { stats?: { fiscal_year?: number } } | null)?.stats?.fiscal_year;
    if (stats.status !== 200 || typeof latestYear !== "number") {
      failures.push(`${ticker}: no annual SEC statements (HTTP ${stats.status}; is SEC_EDGAR_USER_AGENT set for the stack?)`);
      continue;
    }

    // One period per request: each live lookup downloads the issuer's full SEC
    // company facts, so sequential requests keep within SEC's fair-access rate.
    // ponytail: no company-facts cache in fundamentals; add one if warm-ups get slow.
    let available = 0;
    for (const period of candidateQuarters(latestYear)) {
      const statements = await request("POST", "/v1/fundamentals/statements", {
        subject_ref: { kind: "issuer", id: issuerId },
        statement: "income",
        basis: "as_reported",
        periods: [period],
      });
      const outcome = (statements.body as StatementsResponse | null)?.results?.[0]?.outcome?.outcome;
      if (statements.status === 200 && outcome === "available") available += 1;
      if (available === QUARTERS_NEEDED) break;
    }
    if (available < QUARTERS_NEEDED) {
      failures.push(`${ticker}: only ${available} of ${QUARTERS_NEEDED} quarterly income statements available`);
      continue;
    }
    log(`warm  ${ticker}  FY${latestYear} stats and ${available} quarters ready`);
  }
  return failures;
}

// Newest first: the fiscal year after the latest annual report (quarters filed since),
// then the latest year and the one before it — at least 8 reported quarters.
export function candidateQuarters(latestFiscalYear: number): string[] {
  return [latestFiscalYear + 1, latestFiscalYear, latestFiscalYear - 1].flatMap((year) =>
    QUARTERS.map((quarter) => `${year}-${quarter}`),
  );
}
