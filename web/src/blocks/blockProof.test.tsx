import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from '../evidence/evidenceInspectorContext.ts'
import type { ChatMessage } from '../chat/messageTypes.ts'
import { MessageItem } from '../chat/MessageItem.tsx'
import { blockPropsAreEqual } from './blockMemoization.ts'
import { proofLabels, proofRows, type BlockProof } from './blockProof.ts'
import { disclosureFixture, financialAnswerFixture, metricsComparisonFixture, newsClusterFixture, richTextFixture } from './fixtures.ts'
import { BlockRegistryProvider, BlockView, createDefaultBlockRegistry } from './index.ts'
import type { Block } from './types.ts'

const LINKED: BlockProof = { evidence: 'linked', calculation: 'not_verified', public_by_cutoff: 'unknown' }
const CERTIFIED: BlockProof = { evidence: 'linked', calculation: 'verified', public_by_cutoff: 'proven' }
const UNPROVEN: BlockProof = { evidence: 'unknown', calculation: 'not_verified', public_by_cutoff: 'unknown' }

const inspector: EvidenceInspectorContextValue = {
  openInspection() {},
  openBlockInspection() {},
  openFinancialResult() {},
  closeInspection() {},
}

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
      <EvidenceInspectorContext.Provider value={inspector}>{node}</EvidenceInspectorContext.Provider>
    </BlockRegistryProvider>,
  )
}

const count = (html: string, text: string) => html.split(text).length - 1

test('an ordinary source-linked table is labelled source-linked, never a verified calculation (#193)', () => {
  const html = render(<BlockView block={metricsComparisonFixture as Block} proof={LINKED} />)
  assert.ok(html.includes('Source-linked'))
  assert.ok(!html.includes('Verified calculation') && !html.includes('Legacy output'))
})

test('a certified financial answer shows verified arithmetic and public-by-cutoff proof', () => {
  const html = render(<BlockView block={financialAnswerFixture as Block} proof={CERTIFIED} />)
  assert.equal(count(html, 'Verified calculation'), 1)
  assert.equal(count(html, 'Public by cutoff'), 1)
})

test('in a mixed message, only the certified result carries its claims', () => {
  const message: ChatMessage = {
    message_id: 'm1',
    thread_id: 't1',
    role: 'assistant',
    snapshot_id: financialAnswerFixture.snapshot_id,
    blocks: [richTextFixture as Block, financialAnswerFixture as Block, metricsComparisonFixture as Block],
    content_hash: 'h',
    created_at: '2026-06-02T00:00:00.000Z',
    block_proofs: {
      [richTextFixture.id]: UNPROVEN,
      [financialAnswerFixture.id]: CERTIFIED,
      [metricsComparisonFixture.id]: LINKED,
    },
  }
  const html = render(<MessageItem message={message} onMeasure={() => {}} />)
  assert.equal(count(html, 'Verified calculation'), 1)
  assert.equal(count(html, 'Public by cutoff'), 1)
  assert.equal(count(html, 'Source-linked<'), 1, 'the table, labelled exactly source-linked')
  const narrative = html.slice(0, html.indexOf('block-financial-answer'))
  assert.ok(!narrative.includes('data-verification='), 'commentary citing nothing claims nothing')
})

test('a forged status cannot upgrade what the server established', () => {
  // A certified-looking answer the server did not certify.
  const forged = render(<BlockView block={financialAnswerFixture as Block} proof={UNPROVEN} />)
  assert.ok(forged.includes('Not verified') && !forged.includes('Verified calculation'))
  assert.ok(forged.includes('data-certified="false"'))
  // A status written into the block's own JSON is ignored: the label is the server's.
  const claimed = { ...metricsComparisonFixture, proof: CERTIFIED } as unknown as Block
  const html = render(<BlockView block={claimed} proof={UNPROVEN} />)
  assert.ok(html.includes('Not verified') && !html.includes('Verified calculation'))
})

test('a view without server proof keeps its conservative default label', () => {
  const html = render(<BlockView block={metricsComparisonFixture as Block} />)
  assert.ok(html.includes('Legacy output') && !html.includes('Verified calculation'))
})

test('the inspector explains each claim on its own, conservatively when unknown', () => {
  assert.deepEqual(proofRows(undefined).map((row) => row.value.split(':')[0]), ['Unknown', 'Not verified', 'Unknown'])
  assert.deepEqual(proofRows(LINKED).map((row) => row.value.split(':')[0]), ['Source-linked', 'Not verified', 'Unknown'])
  assert.deepEqual(proofRows(CERTIFIED).map((row) => row.value.split(':')[0]), ['Source-linked', 'Verified', 'Proven'])
  assert.match(proofRows(LINKED)[2].value, /stored by the cutoff does not prove/)
  assert.deepEqual(proofLabels(UNPROVEN, 'rich_text'), [])
})

test('a reloaded proof re-renders a memoized block', () => {
  const block = metricsComparisonFixture as Block
  assert.equal(blockPropsAreEqual({ block, proof: LINKED }, { block, proof: LINKED }), true)
  assert.equal(blockPropsAreEqual({ block }, { block, proof: LINKED }), false)
})

test('evidence-bearing kinds without a default label still show their proof; notices do not', () => {
  assert.ok(render(<BlockView block={newsClusterFixture as Block} proof={LINKED} />).includes('Source-linked'))
  assert.ok(!render(<BlockView block={disclosureFixture as Block} proof={UNPROVEN} />).includes('data-verification='))
})

test('a newer financial format still shows the server claims, without calling unverified values verified', () => {
  const newer = { ...financialAnswerFixture, financial: { presentation_version: 'financial-presentation.v99' } } as unknown as Block
  const certified = render(<BlockView block={newer} proof={CERTIFIED} />)
  assert.ok(certified.includes('Verified calculation') && certified.includes('Public by cutoff'))
  assert.ok(!certified.includes('data-inspect-result='), 'no values are shown')
  const uncertified = render(<BlockView block={newer} proof={UNPROVEN} />)
  assert.ok(uncertified.includes('Not verified') && !uncertified.includes('Verified calculation'))
  assert.ok(!uncertified.includes('verified financial answer'))
})

test("a nested block never reads its parent's proof", () => {
  const section = {
    ...richTextFixture,
    id: 'section',
    kind: 'section',
    title: 'Results',
    children: [financialAnswerFixture],
  } as unknown as Block
  const html = render(<BlockView block={section} proof={UNPROVEN} />)
  assert.ok(html.includes('data-certified="true"'), 'the unassessed child keeps its own default')
  assert.ok(!html.includes('Not verified'))
})

test('a block the server sent no proof for, in an assessed message, is unproven', () => {
  const message: ChatMessage = {
    message_id: 'm2',
    thread_id: 't1',
    role: 'assistant',
    snapshot_id: financialAnswerFixture.snapshot_id,
    blocks: [financialAnswerFixture as Block],
    content_hash: 'h2',
    created_at: '2026-06-02T00:00:00.000Z',
    block_proofs: {},
  }
  const html = render(<MessageItem message={message} onMeasure={() => {}} />)
  assert.ok(html.includes('Not verified') && !html.includes('Verified calculation'))
})
