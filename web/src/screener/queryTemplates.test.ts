import assert from 'node:assert/strict'
import test from 'node:test'

import { QUERY_TEMPLATES } from './queryTemplates.ts'
import { draftToQuery, queryToDraft } from './queryDraft.ts'

// Each template must be built only from clauses the workspace form can render,
// so reopening it round-trips losslessly (queryToDraft is documented as lossy
// only for clause kinds the form drops). If a preset ever references a field
// the form can't restore, this catches it before users do.
test('every starter template round-trips through the workspace draft', () => {
  for (const template of QUERY_TEMPLATES) {
    const restored = draftToQuery(queryToDraft(template.query))
    assert.deepEqual(
      restored.universe,
      template.query.universe,
      `${template.name}: universe drifted`,
    )
    assert.deepEqual(restored.market, template.query.market, `${template.name}: market drifted`)
    assert.deepEqual(
      restored.fundamentals,
      template.query.fundamentals,
      `${template.name}: fundamentals drifted`,
    )
    assert.deepEqual(restored.sort, template.query.sort, `${template.name}: sort drifted`)
  }
})

test('templates have distinct names and a non-empty definition', () => {
  const names = new Set(QUERY_TEMPLATES.map((t) => t.name))
  assert.equal(names.size, QUERY_TEMPLATES.length, 'template names must be unique')
  for (const template of QUERY_TEMPLATES) {
    const clauseCount =
      template.query.universe.length + template.query.market.length + template.query.fundamentals.length
    assert.ok(clauseCount > 0, `${template.name}: must constrain at least one field`)
  }
})
