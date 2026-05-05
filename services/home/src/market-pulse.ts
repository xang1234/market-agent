import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";
import { isUuidV4 } from "../../market/src/validators.ts";

import { HomeFindingFeedError } from "./finding-feed-repo.ts";
import { quoteRow } from "./quote-row.ts";
import {
  DEFAULT_HOME_PULSE_SUBJECTS,
  type HomeMarketPulse,
  type HomeOmittedListing,
  type HomeQuoteProvider,
  type HomeQuoteRow,
} from "./secondary-types.ts";

export type GetHomeMarketPulseRequest = {
  pulse_subjects?: ReadonlyArray<ListingSubjectRef>;
  quoteProvider: HomeQuoteProvider;
};

export async function getHomeMarketPulse(
  request: GetHomeMarketPulseRequest,
): Promise<HomeMarketPulse> {
  const subjects = freezeSubjects(request.pulse_subjects ?? DEFAULT_HOME_PULSE_SUBJECTS);

  if (subjects.length === 0) {
    return Object.freeze({
      rows: Object.freeze([] as ReadonlyArray<HomeQuoteRow>),
      omitted: Object.freeze([] as ReadonlyArray<HomeOmittedListing>),
    });
  }

  const results = await request.quoteProvider(subjects);
  const byId = new Map<string, (typeof results)[number]>();
  for (const result of results) {
    if (!result?.quote || result.quote.listing?.kind !== "listing") continue;
    byId.set(result.quote.listing.id, result);
  }

  const rows: HomeQuoteRow[] = [];
  const omitted: HomeOmittedListing[] = [];
  for (const subject of subjects) {
    const result = byId.get(subject.id);
    if (!result) {
      omitted.push(Object.freeze({ listing: subject, reason: "no_quote" }));
      continue;
    }
    rows.push(quoteRow(subject, result));
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    omitted: Object.freeze(omitted),
  });
}

function freezeSubjects(
  input: ReadonlyArray<ListingSubjectRef>,
): ReadonlyArray<ListingSubjectRef> {
  const seen = new Set<string>();
  const result: ListingSubjectRef[] = [];
  input.forEach((subject, index) => {
    if (!subject || typeof subject !== "object") {
      throw new HomeFindingFeedError(`pulse_subjects[${index}] must be an object`);
    }
    if (subject.kind !== "listing") {
      throw new HomeFindingFeedError(`pulse_subjects[${index}].kind must be listing`);
    }
    if (!isUuidV4(subject.id)) {
      throw new HomeFindingFeedError(`pulse_subjects[${index}].id must be a UUID`);
    }
    if (seen.has(subject.id)) {
      throw new HomeFindingFeedError(`pulse_subjects[${index}] is a duplicate of an earlier subject`);
    }
    seen.add(subject.id);
    result.push(Object.freeze({ kind: "listing", id: subject.id }));
  });
  return Object.freeze(result);
}
