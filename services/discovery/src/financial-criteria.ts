// Approved numerical Discovery criteria.
//
// A numerical criterion is exactly a structured metric rule saved in an
// approved brief version: metric, unit, period, comparison, exact threshold,
// maximum age, and whether it is mandatory. Nothing else becomes one — not
// narrative prose that happens to mention a number, and never model output.
// Model roles cannot add or change criteria (their outputs may only name the
// brief's criterion ids, with no metric or threshold fields), and a changed
// rule is a new brief version through the existing approval workflow.
//
// Criteria share the thesis condition semantics (agents/financial-thesis-
// adapter.ts), so one saved rule means the same calculation on every surface.

import type { ThesisMetricCheck } from "../../agents/src/thesis-types.ts";
import type { Brief, Criterion, SavedBrief } from "./types.ts";

/** A criterion saved with a metric rule; its importance says whether it is mandatory. */
export type NumericalCriterion = Criterion & { metric: ThesisMetricCheck };

/** The approved brief's numerical criteria, in brief order. Narrative criteria are never included. */
export function numericalCriteria(brief: Brief): NumericalCriterion[] {
  return brief.criteria.filter((criterion): criterion is NumericalCriterion => criterion.metric !== undefined);
}

/** Numerical criteria may only be evaluated for an approved brief version. */
export function assertApprovedBrief(brief: SavedBrief): void {
  if (brief.approved_at === null) throw new Error("numerical criteria are evaluated only for an approved brief version");
}

/** The authority version for a campaign's calculations: the approved brief version and its content hash (the run fixes the brief). */
export function briefAuthorityVersion(brief: SavedBrief): string {
  return `brief-v${brief.version}:${brief.hash.replace(/^sha256:/u, "").slice(0, 40)}`;
}
