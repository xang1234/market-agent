import test from "node:test";
import assert from "node:assert/strict";
import {
  freezeInsiderHoldersEnvelope,
  freezeInstitutionalHoldersEnvelope,
  type InsiderHoldersEnvelopeInput,
  type InsiderTransaction,
  type InstitutionalHolder,
  type InstitutionalHoldersEnvelopeInput,
} from "../src/holders.ts";
import type { IssuerSubjectRef } from "../src/subject-ref.ts";

const APPLE: IssuerSubjectRef = {
  kind: "issuer",
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1",
};
const SOURCE_ID = "00000000-0000-4000-a000-000000000008";
const AS_OF = "2024-11-01T20:30:00.000Z";

function institutionalInput(
  overrides: Partial<InstitutionalHoldersEnvelopeInput> = {},
): InstitutionalHoldersEnvelopeInput {
  return {
    subject: APPLE,
    currency: "USD",
    as_of: AS_OF,
    source_id: SOURCE_ID,
    holders: [validInstitutional()],
    ...overrides,
  };
}

function validInstitutional(overrides: Partial<InstitutionalHolder> = {}): InstitutionalHolder {
  return {
    holder_name: "Vanguard Group Inc",
    shares_held: 1_350_000_000,
    market_value: 305_100_000_000,
    percent_of_shares_outstanding: 8.94,
    shares_change: 12_000_000,
    filing_date: "2024-09-30",
    ...overrides,
  };
}

function insiderInput(
  overrides: Partial<InsiderHoldersEnvelopeInput> = {},
): InsiderHoldersEnvelopeInput {
  return {
    subject: APPLE,
    currency: "USD",
    as_of: AS_OF,
    source_id: SOURCE_ID,
    holders: [validInsider()],
    ...overrides,
  };
}

function validInsider(overrides: Partial<InsiderTransaction> = {}): InsiderTransaction {
  return {
    insider_name: "COOK TIMOTHY D",
    insider_role: "Chief Executive Officer",
    transaction_date: "2024-10-04",
    transaction_type: "sell",
    shares: 223_986,
    price: 226.04,
    value: 50_628_113,
    ...overrides,
  };
}

test("freezeInstitutionalHoldersEnvelope returns a frozen envelope tagged 'holders' / 'institutional'", () => {
  const env = freezeInstitutionalHoldersEnvelope(institutionalInput());
  assert.equal(env.family, "holders");
  assert.equal(env.kind, "institutional");
  assert.equal(env.subject.id, APPLE.id);
  assert.equal(env.holders.length, 1);
  assert.equal(Object.isFrozen(env), true);
  assert.equal(Object.isFrozen(env.holders), true);
  assert.equal(Object.isFrozen(env.holders[0]), true);
  assert.equal(Object.isFrozen(env.subject), true);
});

test("freezeInstitutionalHoldersEnvelope sorts by filing_date desc, then shares_held desc", () => {
  const env = freezeInstitutionalHoldersEnvelope(
    institutionalInput({
      holders: [
        validInstitutional({ holder_name: "A", filing_date: "2024-06-30", shares_held: 100 }),
        validInstitutional({ holder_name: "B", filing_date: "2024-09-30", shares_held: 50 }),
        validInstitutional({ holder_name: "C", filing_date: "2024-09-30", shares_held: 200 }),
      ],
    }),
  );
  assert.deepEqual(
    env.holders.map((h) => h.holder_name),
    ["C", "B", "A"],
  );
});

test("freezeInstitutionalHoldersEnvelope rejects duplicate (holder_name, filing_date)", () => {
  assert.throws(
    () =>
      freezeInstitutionalHoldersEnvelope(
        institutionalInput({
          holders: [validInstitutional(), validInstitutional()],
        }),
      ),
    /duplicate/,
  );
});

test("freezeInstitutionalHoldersEnvelope rejects percent outside [0, 100]", () => {
  assert.throws(
    () =>
      freezeInstitutionalHoldersEnvelope(
        institutionalInput({
          holders: [validInstitutional({ percent_of_shares_outstanding: 105 })],
        }),
      ),
    /percent_of_shares_outstanding/,
  );
  assert.throws(
    () =>
      freezeInstitutionalHoldersEnvelope(
        institutionalInput({
          holders: [validInstitutional({ percent_of_shares_outstanding: -1 })],
        }),
      ),
    /percent_of_shares_outstanding/,
  );
});

test("freezeInstitutionalHoldersEnvelope rejects a malformed UUID source_id", () => {
  assert.throws(
    () => freezeInstitutionalHoldersEnvelope(institutionalInput({ source_id: "not-a-uuid" })),
    /source_id/,
  );
});

test("freezeInstitutionalHoldersEnvelope rejects a non-issuer subject", () => {
  assert.throws(
    () =>
      freezeInstitutionalHoldersEnvelope(
        institutionalInput({
          subject: { kind: "listing", id: APPLE.id } as unknown as IssuerSubjectRef,
        }),
      ),
    /issuer SubjectRef/,
  );
});

test("freezeInstitutionalHoldersEnvelope accepts an empty holder list", () => {
  const env = freezeInstitutionalHoldersEnvelope(institutionalInput({ holders: [] }));
  assert.equal(env.holders.length, 0);
});

test("freezeInstitutionalHoldersEnvelope rejects fractional shares_held (must be integer)", () => {
  assert.throws(
    () =>
      freezeInstitutionalHoldersEnvelope(
        institutionalInput({ holders: [validInstitutional({ shares_held: 100.5 })] }),
      ),
    /shares_held/,
  );
});

test("freezeInsiderHoldersEnvelope returns a frozen envelope tagged 'holders' / 'insider'", () => {
  const env = freezeInsiderHoldersEnvelope(insiderInput());
  assert.equal(env.family, "holders");
  assert.equal(env.kind, "insider");
  assert.equal(env.subject.id, APPLE.id);
  assert.equal(env.holders.length, 1);
  assert.equal(Object.isFrozen(env), true);
  assert.equal(Object.isFrozen(env.holders), true);
  assert.equal(Object.isFrozen(env.holders[0]), true);
});

test("freezeInsiderHoldersEnvelope sorts insider transactions newest-first", () => {
  const env = freezeInsiderHoldersEnvelope(
    insiderInput({
      holders: [
        validInsider({ insider_name: "OLDEST", transaction_date: "2024-01-15" }),
        validInsider({ insider_name: "NEWEST", transaction_date: "2024-10-04" }),
        validInsider({ insider_name: "MIDDLE", transaction_date: "2024-06-22" }),
      ],
    }),
  );
  assert.deepEqual(
    env.holders.map((h) => h.insider_name),
    ["NEWEST", "MIDDLE", "OLDEST"],
  );
});

test("freezeInsiderHoldersEnvelope accepts a gift transaction with null price/value", () => {
  const env = freezeInsiderHoldersEnvelope(
    insiderInput({
      holders: [
        validInsider({
          transaction_type: "gift",
          shares: 1000,
          price: null,
          value: null,
        }),
      ],
    }),
  );
  assert.equal(env.holders[0].price, null);
  assert.equal(env.holders[0].value, null);
});

test("freezeInsiderHoldersEnvelope rejects mismatched price/value nullness", () => {
  assert.throws(
    () =>
      freezeInsiderHoldersEnvelope(
        insiderInput({
          holders: [validInsider({ price: 226.04, value: null })],
        }),
      ),
    /price and value/,
  );
  assert.throws(
    () =>
      freezeInsiderHoldersEnvelope(
        insiderInput({
          holders: [validInsider({ price: null, value: 50_000 })],
        }),
      ),
    /price and value/,
  );
});

test("freezeInsiderHoldersEnvelope rejects a transaction_type not in the enum", () => {
  assert.throws(
    () =>
      freezeInsiderHoldersEnvelope(
        insiderInput({
          holders: [
            validInsider({
              transaction_type: "convert" as unknown as InsiderTransaction["transaction_type"],
            }),
          ],
        }),
      ),
    /transaction_type/,
  );
});

test("freezeInsiderHoldersEnvelope rejects a negative price", () => {
  assert.throws(
    () =>
      freezeInsiderHoldersEnvelope(
        insiderInput({
          holders: [validInsider({ price: -5, value: -1_000 })],
        }),
      ),
    /price/,
  );
});

test("freezeInsiderHoldersEnvelope rejects a malformed transaction_date", () => {
  assert.throws(
    () =>
      freezeInsiderHoldersEnvelope(
        insiderInput({
          holders: [validInsider({ transaction_date: "10-04-2024" })],
        }),
      ),
    /transaction_date/,
  );
});

test("envelope inputs are cloned: mutating the source array doesn't bleed into the frozen envelope", () => {
  const holders: InstitutionalHolder[] = [validInstitutional({ holder_name: "A" })];
  const env = freezeInstitutionalHoldersEnvelope(
    institutionalInput({ holders }),
  );
  holders.push(validInstitutional({ holder_name: "B", filing_date: "2024-06-30" }));
  assert.equal(env.holders.length, 1);
});
