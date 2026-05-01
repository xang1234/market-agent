import assert from "node:assert/strict";
import test from "node:test";

import {
  BundleRoutingError,
  DEFAULT_BUNDLE_ID,
  chooseBundleIdForSubjectKind,
} from "../src/bundle-routing.ts";
import { SUBJECT_KINDS } from "../../resolver/src/subject-ref.ts";
import { analystPromptTemplateBundleIds } from "../../tools/src/prompt-templates.ts";

test("chooseBundleIdForSubjectKind routes a theme chat to the theme_research bundle (fra-95e contract)", () => {
  // The contract: theme chats must end up running theme_research, not the
  // default single_subject_analysis. If this fails, theme chats silently
  // run the wrong analyst template — block render and tool selection both
  // misbehave downstream.
  assert.equal(chooseBundleIdForSubjectKind("theme"), "theme_research");
  assert.equal(chooseBundleIdForSubjectKind("macro_topic"), "theme_research");
});

test("chooseBundleIdForSubjectKind routes ticker-style chats (issuer/instrument/listing) to single_subject_analysis", () => {
  for (const kind of ["issuer", "instrument", "listing"] as const) {
    assert.equal(
      chooseBundleIdForSubjectKind(kind),
      "single_subject_analysis",
      `expected ${kind} → single_subject_analysis`,
    );
  }
});

test("chooseBundleIdForSubjectKind routes a screen subject to the screener bundle", () => {
  assert.equal(chooseBundleIdForSubjectKind("screen"), "screener");
});

test("chooseBundleIdForSubjectKind returns DEFAULT_BUNDLE_ID for null (no primary subject yet)", () => {
  // Threads can exist without a primary_subject_kind (a brand-new thread
  // before its first message). The router must produce a bundle id rather
  // than throw, so the default-template path is well-defined.
  assert.equal(chooseBundleIdForSubjectKind(null), DEFAULT_BUNDLE_ID);
});

test("chooseBundleIdForSubjectKind throws BundleRoutingError on an unknown subject_kind so wire-format breaks fail loudly", () => {
  // Defense-in-depth: the SubjectKind type would normally rule this out,
  // but pg can return strings outside the enum if the schema and TS union
  // drift. A loud throw at the boundary is preferable to silently routing
  // every thread to the default bundle.
  assert.throws(
    () => chooseBundleIdForSubjectKind("not_a_kind" as never),
    (err: Error) => err instanceof BundleRoutingError && /subject_kind: must be one of/.test(err.message),
  );
});

test("chooseBundleIdForSubjectKind has a routing decision for every SubjectKind from the spec — no kind silently throws", () => {
  // If a new SubjectKind is added to the resolver/SQL spec, the router must
  // explicitly choose a bundle for it. A missing entry would surface here as
  // a thrown BundleRoutingError, forcing the maintainer to make a conscious
  // decision rather than silently routing to the default.
  for (const kind of SUBJECT_KINDS) {
    const bundleId = chooseBundleIdForSubjectKind(kind);
    assert.equal(typeof bundleId, "string", `${kind} must route to a bundle id`);
    assert.ok(bundleId.length > 0, `${kind} must route to a non-empty bundle id`);
  }
});

test("every routed bundle_id resolves to a real analyst prompt template (drift test)", () => {
  // Drift test against services/tools/src/prompt-templates.ts. Renaming a
  // bundle_id (e.g. theme_research → theme_analysis) must break this test
  // before it can ship and silently route theme chats to nowhere.
  const bundleIds = new Set(analystPromptTemplateBundleIds());
  const dangling = SUBJECT_KINDS
    .map((kind) => [kind, chooseBundleIdForSubjectKind(kind)] as const)
    .filter(([, bundleId]) => !bundleIds.has(bundleId))
    .map(([kind, bundleId]) => `${kind} → ${bundleId}`);
  assert.deepEqual(
    dangling,
    [],
    `bundle_ids returned by the router that are not registered as analyst prompt templates: ${dangling.join(", ")}`,
  );
  assert.ok(
    bundleIds.has(DEFAULT_BUNDLE_ID),
    `DEFAULT_BUNDLE_ID ${DEFAULT_BUNDLE_ID} must be a registered template`,
  );
});
