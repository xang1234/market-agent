// Versioned deterministic JSON serialization and domain-separated SHA-256.
//
// Rules (canonical_json.v1): object keys sorted by UTF-16 code unit; array order
// preserved (callers only put order-meaningful data in arrays); explicit null
// only — an undefined property is an error, never silently dropped; numbers must
// be safe integers (financial amounts travel as canonical DecimalString, which
// contract validation enforces before anything is hashed); no non-finite
// numbers, bigint, Dates, Maps, or class instances.

import { createHash } from "node:crypto";
import type { FinancialPlanV1, FinancialRuntimeAuthorityV1, Sha256Hex } from "./contracts.ts";

export const CANONICAL_JSON_VERSION = "canonical_json.v1";
const MAX_CANONICAL_DEPTH = 64;

export const HASH_DOMAINS = Object.freeze({
  plan_semantic: "market-agent/financial/plan-semantic/v1",
  plan_binding: "market-agent/financial/plan-binding/v1",
  request_identity: "market-agent/financial/request-identity/v1",
  bound_input: "market-agent/financial/bound-input/v1",
  candidate_set: "market-agent/financial/candidate-set/v1",
  computation: "market-agent/financial/computation/v1",
  result: "market-agent/financial/result/v1",
  presentation: "market-agent/financial/presentation/v1",
  publication: "market-agent/financial/publication/v1",
} as const);
export type HashDomain = keyof typeof HASH_DOMAINS;

export class CanonicalJsonError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "CanonicalJsonError";
    this.path = path;
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, "$", 0);
}

export function hashCanonical(domain: HashDomain, value: unknown): Sha256Hex {
  return createHash("sha256")
    .update(HASH_DOMAINS[domain])
    .update("\u0000")
    .update(canonicalJson(value))
    .digest("hex");
}

/**
 * Semantic identity of a validated plan: what is being computed. Excludes the
 * random plan_id, provenance (origin, planner), derived interpretation text, and
 * threshold attribution references, which are storage/provenance identities.
 * Subject order, cutoff, thresholds, and definitions all participate.
 */
export function planSemanticHash(plan: FinancialPlanV1): Sha256Hex {
  const { plan_id: _planId, origin: _origin, planner: _planner, interpretation: _interpretation, ...semantic } = plan;
  return hashCanonical("plan_semantic", {
    ...semantic,
    thresholds: plan.thresholds.map(({ attribution: _attribution, ...threshold }) => threshold),
  });
}

/**
 * Record-binding identity: the full plan including persistence IDs, bound to
 * its owner and parent. Two owners with equal semantic hashes never share one.
 */
export function planBindingHash(plan: FinancialPlanV1, authority: FinancialRuntimeAuthorityV1): Sha256Hex {
  return hashCanonical("plan_binding", {
    plan,
    owner_user_id: authority.owner_user_id,
    parent: authority.parent,
  });
}

/** Owner-scoped idempotency identity: unique by owner, parent kind/id, and request key. */
export function requestIdentityHash(authority: FinancialRuntimeAuthorityV1, requestKey: string): Sha256Hex {
  if (requestKey.length === 0 || requestKey.length > 200) {
    throw new CanonicalJsonError("$.request_key", "must be 1..200 characters");
  }
  return hashCanonical("request_identity", {
    owner_user_id: authority.owner_user_id,
    parent_kind: authority.parent.kind,
    parent_id: authority.parent.id,
    request_key: requestKey,
  });
}

function serialize(value: unknown, path: string, depth: number): string {
  if (depth > MAX_CANONICAL_DEPTH) throw new CanonicalJsonError(path, "exceeds maximum nesting depth");
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalJsonError(path, "only safe integers may be JSON numbers; use a decimal string");
      }
      return Object.is(value, -0) ? "0" : String(value);
    case "object":
      break;
    default:
      throw new CanonicalJsonError(path, `unsupported ${typeof value} value`);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value) || value[index] === undefined) {
        throw new CanonicalJsonError(`${path}[${index}]`, "undefined array element");
      }
      parts.push(serialize(value[index], `${path}[${index}]`, depth + 1));
    }
    return `[${parts.join(",")}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(path, "only plain objects are canonical");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = record[key];
    if (child === undefined) throw new CanonicalJsonError(`${path}.${key}`, "undefined property; use explicit null");
    parts.push(`${JSON.stringify(key)}:${serialize(child, `${path}.${key}`, depth + 1)}`);
  }
  return `{${parts.join(",")}}`;
}
