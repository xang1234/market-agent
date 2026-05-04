import type { HoldingSubjectRef } from "./holdings.ts";
import type { OverlayContribution, SubjectOverlayInputs } from "./overlays.ts";

export type OverlayBaseRow = {
  subject_ref: HoldingSubjectRef;
  [key: string]: unknown;
};

export type PortfolioOverlayRow<TBase extends OverlayBaseRow = OverlayBaseRow> = {
  subject_ref: HoldingSubjectRef;
  base: TBase;
  portfolio_contributions: ReadonlyArray<OverlayContribution>;
};

export function composePortfolioOverlayRows<TBase extends OverlayBaseRow>(
  baseRows: ReadonlyArray<TBase>,
  overlayInputs: ReadonlyArray<SubjectOverlayInputs>,
): PortfolioOverlayRow<TBase>[] {
  const overlaysBySubject = new Map<string, ReadonlyArray<OverlayContribution>>();
  for (const input of overlayInputs) {
    overlaysBySubject.set(subjectKey(input.subject_ref), input.contributions);
  }

  return baseRows.map((base) => ({
    subject_ref: base.subject_ref,
    base,
    portfolio_contributions: overlaysBySubject.get(subjectKey(base.subject_ref)) ?? [],
  }));
}

function subjectKey(subjectRef: HoldingSubjectRef): string {
  return `${subjectRef.kind}:${subjectRef.id}`;
}
