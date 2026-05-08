# ADR 0003: Filing Extraction Boundary

## Status

Accepted.

## Context

`stock-agent-v2.md` describes a filing extraction platform adjacent to Evidence:
filing retrieval, section segmentation, XBRL extension parsing, segment
extraction, footnotes, management claims, event detection, and review queueing.

The implementation currently splits that work between existing packages:

- `services/evidence` owns raw source/document identity, object storage, filing
  bytes, Inline XBRL extension extraction, non-GAAP reconciliation extraction,
  candidate fact extraction, claim/event promotion, and review HTTP flows.
- `services/fundamentals` owns issuer-anchored SEC companyfacts ingestion,
  fiscal-period normalization, statement mapping, segment facts, and canonical
  fundamentals read models.

This integrated boundary avoids a service hop while ingestion volume and review
queues are still small. It also keeps raw document provenance and promoted facts
inside the evidence plane rather than introducing another canonical store.

## Decision

Do not create `services/filing-extraction` yet. Treat filing extraction as a
documented sub-boundary across Evidence and Fundamentals:

- Evidence is the ingestion and extraction boundary for filing documents and
  source-backed candidate facts.
- Fundamentals is the normalization boundary for issuer statements, fiscal
  periods, and fundamentals-specific read models.
- Handoffs are through source/document/fact identity and canonical
  `SubjectRef`/issuer identity, not ad hoc ticker strings or raw filing blobs.
- Review queue and low-confidence extraction handling stay in Evidence because
  they are provenance and promotion concerns.

## Split Triggers

Create `services/filing-extraction` when at least one of these becomes true:

- filing extraction needs an independently scaled worker pool or queue separate
  from Evidence ingestion;
- Inline XBRL, section segmentation, or footnote parsing becomes large enough
  to need separate release ownership;
- review queues need filing-specific SLAs or operators independent of the
  evidence review surface;
- Fundamentals callers need a stable asynchronous extraction job API rather than
  reading Evidence-promoted facts and normalized statement inputs;
- extraction throughput or failure isolation becomes a bottleneck measured in
  production.

## Tests

The chosen boundary is covered by existing service tests:

- `services/evidence/test/extract-tools.test.ts` covers filing XBRL bytes
  flowing through candidate fact extraction.
- `services/evidence/test/xbrl-segment-extractor.test.ts` covers issuer
  extension segment parsing.
- `services/evidence/test/non-gaap-reconciliation-extractor.test.ts` covers
  non-GAAP reconciliation extraction.
- `services/fundamentals/test/sec-edgar.test.ts` covers SEC companyfacts
  ingestion into normalized statement inputs.
- `services/fundamentals/test/segment-facts.test.ts` covers segment fact
  read-model behavior.

## Consequences

This ratifies the current implementation as intentional. It keeps the boundary
simple now, while preserving clear criteria for extracting a dedicated filing
service later if throughput, ownership, or operational isolation demands it.
