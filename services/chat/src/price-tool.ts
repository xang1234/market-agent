// The analyst agent's price read (#678): the named companies' prices are
// fetched first, then their return over a period to date is read from the
// stored daily closes as the sealed chart the answer shows. Each line's return
// and last close are the evidence packet's figures, shown as series chips the
// seal checks against the chart.

import type { PricePeriod } from "../../market/src/ytd-window.ts";
import type { JsonObject } from "../../shared/src/json.ts";
import { isUnavailableRead } from "./analyst-tools.ts";
import { labelList, type ChatTurnEmit } from "./coordinator.ts";
import type { PacketFigure } from "./evidence-packet.ts";
import type { ChatFinancialRuntimeDeps } from "./financial-runtime.ts";
import { companyListings, listingsForComparison, loadPricePerformance, priceFigures } from "./perf-block.ts";

export const PRICE_TOOL = "get_price_performance";

// Told only to a chat turn's model, the only one offered the tool.
export const PRICE_RULES = [
  "get_price_performance reads a stock's price return over the week, month or year to date and its last close, from stored daily prices:",
  "ask it for any question about how a stock or its price did, moved or performed, with every company compared in one call over one period,",
  "and never answer such a question from certified_financials or analyst consensus.",
];

export type PriceAsk = Readonly<{ issuers: ReadonlyArray<string>; period: PricePeriod }>;

// A read's chart and the figures it shows.
export type Priced = Readonly<{ chart: Record<string, unknown>; figures: ReadonlyArray<Omit<PacketFigure, "id">> }>;

// What the model reads of it, the answer's notes, and the chart when one was drawn.
export type PriceRead = Readonly<{ output: JsonObject; failed?: true; notes: ReadonlyArray<string>; priced?: Priced }>;

export async function readPrices(
  deps: Pick<ChatFinancialRuntimeDeps, "pool" | "hydrate">,
  ask: PriceAsk,
  turn: Readonly<{
    // The listing each company was named by, by issuer.
    named: ReadonlyMap<string, { listing_id: string; label: string }>;
    frozen: boolean;
    asOf: string;
    // The chart's cutoff, read after the fetch, so what it stored is in it.
    clock: () => string;
    snapshotId: string;
    // Tells apart the ids of two charts in one answer.
    scope: string;
    emit: ChatTurnEmit;
    turnId: string;
    labelOf: (issuer: string) => string;
  }>,
): Promise<PriceRead> {
  const output = (status: string, fields: JsonObject = {}): JsonObject => ({ tool: PRICE_TOOL, status, ...fields });
  const notes: string[] = [];
  const noPrices = (reason: string): PriceRead => ({ output: output("no_prices", { reason }), notes: [...notes, reason] });
  try {
    const companies = listingsForComparison(ask.issuers, turn.named, await companyListings(deps.pool, ask.issuers, turn.asOf));
    const listings = ask.issuers.flatMap((issuer) => {
      const listing = companies.get(issuer);
      return listing?.listing_id ? [{ issuer, id: listing.listing_id, label: listing.label }] : [];
    });
    const unlisted = ask.issuers.filter((issuer) => !listings.some((listing) => listing.issuer === issuer));
    if (unlisted.length > 0) notes.push(`${labelList(unlisted.map(turn.labelOf))}: no listing is on file, so no price return is shown.`);
    if (listings.length === 0) return { output: output("no_prices", { reason: "no company asked about has a listing on file" }), notes };
    const loading = await (deps.hydrate?.(
      listings.map((listing) => ({ issuer_id: listing.issuer, label: listing.label, listing_id: listing.id })),
      { emit: turn.emit, turnId: turn.turnId, ytdCutoff: turn.asOf, pricesOnly: true },
    ).catch((reason: unknown) => {
      console.warn("[chat] fetching the companies' prices failed; the analyst agent reads the prices on file", reason);
      return undefined;
    })) ?? new Set<string>();
    const chart = await loadPricePerformance(deps.pool, { listings, snapshotId: turn.snapshotId, asOf: turn.clock(), period: ask.period, scope: turn.scope, frozenPrices: turn.frozen });
    if (chart.kind !== "perf_comparison") {
      // A fetch that failed or is still running leaves the gap unexplained by what is on file.
      const unloaded = listings.filter((listing) => loading.has(listing.issuer));
      return noPrices(unloaded.length > 0 ? `${labelList(unloaded.map((listing) => listing.label))}: prices could not be loaded just now; ask again in a minute.` : noteText(chart));
    }
    const figures = priceFigures(chart, ask.period);
    return {
      output: output("ok", { figures: figures.map(({ company, metric, period, value }) => ({ company: company!, metric, period: period!, value })) }),
      notes,
      priced: { chart, figures },
    };
  } catch (reason) {
    if (!isUnavailableRead(reason)) throw reason;
    console.warn("[chat] the stored prices could not be read; the analyst agent answers without them", reason);
    return {
      output: output("unavailable", { reason: "the read failed" }),
      failed: true,
      notes: [`${labelList(ask.issuers.map(turn.labelOf))}: the stored prices could not be read just now, so this says nothing about what is on file.`],
    };
  }
}

function noteText(block: Record<string, unknown>): string {
  const segments = Array.isArray(block.segments) ? block.segments as ReadonlyArray<{ text?: unknown }> : [];
  return segments.map((segment) => (typeof segment.text === "string" ? segment.text : "")).join("") || "No price return could be drawn from the stored prices.";
}
