import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFactBackedSealInput, toSealFactRow } from '../src/seal-input.ts';
import { verifySnapshotSeal } from '../src/snapshot-verifier.ts';

const fact = {
  fact_id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000001',
  unit: 'USD', period_kind: 'point', period_start: null, period_end: null,
  fiscal_year: null, fiscal_period: null, as_of: '2026-04-29T12:00:00.123Z',
};
function input() {
  return buildFactBackedSealInput({
    block: {
      id: 'cash', snapshot_id: '30000000-0000-4000-8000-000000000001',
      as_of: '2026-04-29T13:00:00.000Z', data_ref: { kind: 'metric_row', id: 'cash' },
      ...{ kind: 'metric_row', source_refs: [fact.source_id], items: [{ value_ref: fact.fact_id }] },
    },
    factRefs: [fact.fact_id], subjectRefs: [{ kind: 'issuer', id: '40000000-0000-4000-8000-000000000001' }], facts: [toSealFactRow(fact)],
  });
}

test('point facts without period ends seal with their precise observation time', async () => {
  const seal = input();
  assert.deepEqual(await verifySnapshotSeal(seal), { ok: true, failures: [] });
  assert.equal(seal.facts[0].as_of, fact.as_of);
});

test('point bindings reject changed or missing observation times', async () => {
  for (const asOf of ['2026-04-29T12:00:00.124Z', undefined]) {
    const seal = input();
    const { as_of: _observed, ...undated } = fact;
    const binding = asOf === undefined ? undated : { ...fact, as_of: asOf };
    const result = await verifySnapshotSeal({ ...seal, blocks: seal.blocks.map(block => ({
      ...block, data_ref: { ...block.data_ref, params: { fact_bindings: [binding] } },
    })) });
    assert.ok(result.failures.some(failure => failure.reason_code === 'fact_binding_mismatch'));
  }
});

test('point facts still require a temporal anchor and legacy period ends still bind', async () => {
  const seal = input();
  const missing = await verifySnapshotSeal({ ...seal, facts: [{ ...fact, as_of: undefined }] });
  assert.equal(missing.ok, false);
  const { as_of: _observed, ...undated } = fact;
  const dated = { ...undated, period_end: '2026-04-29' };
  const legacy = await verifySnapshotSeal({ ...seal, facts: [dated], blocks: seal.blocks.map(block => ({
    ...block, data_ref: { ...block.data_ref, params: { fact_bindings: [dated] } },
  })) });
  assert.deepEqual(legacy, { ok: true, failures: [] });
});
