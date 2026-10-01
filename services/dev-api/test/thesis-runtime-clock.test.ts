import test from 'node:test';
import assert from 'node:assert/strict';
import { createThesisAgentLoopStages } from '../src/thesis-runtime.ts';

// #143: a run's cutoff comes from the database clock, the same clock that stamps
// facts (now()) and assessments (assessed_at), so app/DB clock skew can neither
// hide a just-ingested fact nor fake a "newer assessment" conflict.
test('a thesis run takes its cutoff from the database clock, not the host clock', async () => {
  // Far from the host clock on purpose, and with microseconds: a Date would
  // round them away and move the cutoff before a fact stamped in the same ms.
  const dbNow = '2030-01-02T03:04:05.678901Z';
  const db = {
    async query(text: string) {
      assert.match(text, /now\(\)/i);
      return { rows: [{ now: dbNow }], rowCount: 1 };
    },
  };
  const stages = createThesisAgentLoopStages({
    db: db as never,
    userId: '00000000-0000-4000-8000-000000000001',
    runId: '00000000-0000-4000-8000-000000000002',
    agent: { agent_id: '00000000-0000-4000-8000-000000000003' } as never,
    thesis: { thesis_version_id: '00000000-0000-4000-8000-000000000004' } as never,
  });
  const deltas = await stages.readDeltas({ current_watermarks: null } as never);
  assert.equal(deltas.as_of, dbNow);
});
