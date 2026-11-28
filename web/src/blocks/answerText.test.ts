import assert from 'node:assert/strict'
import test from 'node:test'

import { answerCopy, answerText } from './answerText.ts'
import { disclosureFixture, financialAnswerFixture, financialAnswerScenariosFixture, lineChartFixture, richTextFixture, tableFixture } from './fixtures.ts'
import type { FinancialAnswerBlock } from './types.ts'

test('an answer copies as Markdown, and a chart names itself instead of vanishing', () => {
  assert.equal(
    answerText([richTextFixture, tableFixture, lineChartFixture, disclosureFixture]),
    [
      'Apple posted Q3 revenue of $85.8B, up year over year. Management “guided cautiously” [1] on services growth.\n\nSources\n\n[1] Source',
      'Recent quarters\n\n| Quarter | Revenue | Net income |\n| --- | --- | --- |\n| Q3 FY24 | $85.8B | $21.4B |\n| Q2 FY24 | $90.8B | $23.6B |\n| Q1 FY24 | $119.6B | $33.9B |',
      '[In the app: Revenue trajectory]',
      '- Forward estimates are model-derived and may diverge from consensus.\n- Quotes are delayed by 15 minutes during regular trading hours.',
    ].join('\n\n'),
  )
})

test('a certified answer copies the figures as it shows them, with each cell\'s own period', () => {
  assert.equal(
    answerText([financialAnswerFixture]),
    [
      'Revenue, Gross margin (gross profit / revenue) by company',
      '| Company | Revenue | Gross margin (gross profit / revenue), FY2023 |\n| --- | --- | --- |\n| Apple Inc. | $391.0B (FY2023) | 46.21% |\n| Microsoft Corp. |  | A required input or calculation is unavailable. |',
      'Apple Inc. — Gross margin (gross profit / revenue), FY2023, at or above 40.00%: yes',
      'Ranked 1 of 2 companies; no overall highest can be stated for an incomplete group',
    ].join('\n\n'),
  )
})

test('P/E scenarios copy with the EPS, each multiple as the user\'s, and the disclosure', () => {
  const stated = 'Your assumption in this request (2024-01-15 15:00 UTC)'
  assert.equal(
    answerText([financialAnswerScenariosFixture]),
    [
      'Apple Inc., EPS (diluted), FY2023 (ended 2023-09-30): USD 4.00 per share',
      `| Scenario | P/E (your assumption) | Value per share |\n| --- | --- | --- |\n| Bear | 20x (${stated}) | USD 80.00 per share |\n| Base | 25x (${stated}) | USD 100.00 per share |\n| Bull | 30x (${stated}) | USD 120.00 per share |`,
      'A mechanical scenario: reported diluted EPS × a P/E you supplied. Not a price target, forecast, or recommendation.',
    ].join('\n\n'),
  )
})

test('an answer in a format this app does not know copies nothing for that block', () => {
  const newer = { ...financialAnswerFixture, financial: { presentation_version: 'financial-presentation.v99' } } as FinancialAnswerBlock
  assert.equal(answerText([newer, richTextFixture]), 'Apple posted Q3 revenue of $85.8B, up year over year. Management “guided cautiously” [1] on services growth.\n\nSources\n\n[1] Source')
})

test('a pipe in a cell cannot split a Markdown table column', () => {
  const table = { ...tableFixture, title: undefined, columns: ['A|B'], rows: [['x|y']] }
  assert.equal(answerText([table]), '| A\\|B |\n| --- |\n| x\\|y |')
})

test('text the app shows literally stays literal, while the answer\'s own Markdown passes through', () => {
  const block = {
    ...richTextFixture,
    segments: [
      { type: 'text' as const, text: '**Margins** held, with ' },
      { type: 'ref' as const, ref_kind: 'fact' as const, ref_id: 'f1', format: '*Adjusted EPS* [est]' },
      { type: 'text' as const, text: ' and a toned ', tone: undefined },
      { type: 'text' as const, text: '_+3%_', tone: 'positive' as const },
    ],
  }
  assert.equal(answerText([block]), '**Margins** held, with \\*Adjusted EPS\\* \\[est\\] and a toned \\_+3%\\_')
})

test('a table cell keeps its backslashes and pipes inside its column', () => {
  const table = { ...tableFixture, title: undefined, columns: ['Note'], rows: [['a\\|b *c*']] }
  assert.equal(answerText([table]), '| Note |\n| --- |\n| a\\\\\\|b \\*c\\* |')
})

test('a copied answer ends with the date of its newest data and its snapshot', () => {
  const older = { ...richTextFixture, as_of: '2026-05-01T00:00:00.000Z' }
  const newer = { ...disclosureFixture, as_of: '2026-06-01T00:00:00.000Z' }
  assert.equal(
    answerCopy({ blocks: [older, newer], snapshot_id: 'snap-1' }).split('\n\n').at(-1),
    'As of 2026-06-01T00:00:00.000Z · Snapshot snap-1',
  )
})

test('a clarification copies with the options it offered as buttons', () => {
  const clarification = { ...richTextFixture, segments: [{ type: 'text' as const, text: 'Which margin would you like?' }], clarification_choices: ['Gross margin', 'Operating margin'] }
  assert.equal(answerText([clarification]), 'Which margin would you like?\n\n- Gross margin\n- Operating margin')
})

test('a quoted claim copies inside quotation marks, so the filing\'s words stay apart from the analyst\'s', () => {
  const block = {
    id: 'rt-quote', kind: 'rich_text', snapshot_id: '11111111-1111-4111-8111-111111111111', data_ref: { kind: 'rich_text', id: 'rt-quote' },
    source_refs: [], as_of: '2026-06-01T00:00:00.000Z',
    segments: [{ type: 'text', text: 'MU: ' }, { type: 'ref', ref_kind: 'claim', ref_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', format: 'Our top customers make up *much* of our revenue.' }],
  } as const
  assert.equal(answerText([block as unknown as Parameters<typeof answerText>[0][number]]), 'MU: “Our top customers make up \\*much\\* of our revenue.” [1]\n\nSources\n\n[1] Source')
})

const SNAPSHOT = '11111111-1111-4111-8111-111111111111'
const commentaryBlock = (commentary: unknown, segments: unknown = []) => ({
  id: 'rt-memo', kind: 'rich_text', snapshot_id: SNAPSHOT, data_ref: { kind: 'rich_text', id: 'rt-memo' }, source_refs: [], as_of: '2026-06-01T00:00:00.000Z',
  analyst_commentary: true, segments, commentary,
}) as unknown as Parameters<typeof answerText>[0][number]

test('a copied quote keeps its citation number, and the copy ends with the source each number opens', () => {
  const block = {
    id: 'rt-quote', kind: 'rich_text', snapshot_id: SNAPSHOT, data_ref: { kind: 'rich_text', id: 'rt-quote' }, source_refs: [], as_of: '2026-06-01T00:00:00.000Z',
    segments: [
      { type: 'text', text: 'NVDA: ' },
      { type: 'ref', ref_kind: 'claim', ref_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', format: 'Demand is strong.', source_label: 'NVDA source, published 2026-02-25' },
      { type: 'text', text: '\n\nAMD: ' },
      { type: 'ref', ref_kind: 'claim', ref_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', format: 'Supply is tight.', source_label: 'AMD source, published 2026-01-30' },
    ],
  } as unknown as Parameters<typeof answerText>[0][number]
  assert.equal(answerText([block]), [
    'NVDA: “Demand is strong.” [1]\n\nAMD: “Supply is tight.” [2]',
    'Sources',
    '[1] NVDA source, published 2026-02-25\n[2] AMD source, published 2026-01-30',
  ].join('\n\n'))
})

test('commentary copies as its card shows it: shown themes with their citations, the quotes left beside them, and the sources, never a hidden theme', () => {
  const cite = (id: string, format: string, source_label: string, ref_kind = 'claim') => ({ type: 'ref', ref_kind, ref_id: id, format, source_label })
  const competition = cite('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'We compete with AMD.', 'NVDA source, published 2026-02-25')
  const peers = cite('ffffffff-ffff-4fff-8fff-ffffffffffff', "Industry peer: AMD shares NVDA's industry (Semiconductors)", 'NVDA industry source', 'source')
  const debt = cite('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Our debt could limit us.', 'NVDA source, published 2026-02-25')
  // The flat text still holds the hidden theme and the cited quotes, as a block saved before parts did.
  const hidden = '> **Analyst inference:** A hidden theme the judge did not entail.'
  const block = commentaryBlock([
    { kind: 'inference', subject: null, basis: null, text: 'Rivals: AMD competes and shares its industry.', cites: [competition, peers] },
    { kind: 'unverified', subject: null, text: 'Margins may narrow.' },
    { kind: 'figures', segments: [debt] },
    { kind: 'note', text: 'Periods: NVDA FY2026.' },
  ], [competition, { type: 'text', text: `\n\n${hidden}\n\n` }, peers])
  const copied = answerText([block])
  assert.equal(copied, [
    'Analysis',
    '- Inference: Rivals: AMD competes and shares its industry. [1] [2]\n- Unverified: Margins may narrow.',
    'Quoted sources\n\n- “Our debt could limit us.” [3]',
    'Periods: NVDA FY2026.',
    'Sources',
    '[1] NVDA source, published 2026-02-25\n[2] NVDA industry source\n[3] NVDA source, published 2026-02-25',
  ].join('\n\n'))
  assert.equal(copied.includes('hidden theme'), false)
})

test('a quote resting on several sources copies once with each citation, and each source once', () => {
  const line = "Industry peer: AMD shares NVDA's industry (Semiconductors)"
  const source = (id: string, source_label: string) => ({ type: 'ref', ref_kind: 'source', ref_id: id, format: line, source_label })
  assert.equal(answerText([commentaryBlock([{ kind: 'figures', segments: [source('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Industry source'), source('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'AMD market cap source')] }])]), [
    'Analysis',
    'Quoted sources',
    `- “${line}” [1] [2]`,
    'Sources',
    '[1] Industry source\n[2] AMD market cap source',
  ].join('\n\n'))
})

test('a linked figure copies as the answer wrote it, and a struck one struck with its reason (#800)', () => {
  const source = { ref_kind: 'result', ref_id: '91111111-1111-4111-9111-111111111111', format: '$62.1B', period: 'Q4 FY2026' } as const
  assert.equal(
    answerText([{
      ...richTextFixture,
      segments: [
        { type: 'text', text: 'Revenue was ' },
        { type: 'figure', text: 'about $62B', sources: [source], near: true },
        { type: 'text', text: ', not ' },
        { type: 'struck', text: '$72.1B', reason: 'the sources give $62.1B', sources: [source] },
        { type: 'text', text: '.' },
      ],
    }]),
    'Revenue was about $62B, not ~~$72.1B~~ (the sources give $62.1B).',
  )
})

test('a near figure copies with its "≈", unless the words already hedge it (#819)', () => {
  const source = { ref_kind: 'result', ref_id: '91111111-1111-4111-9111-111111111111', format: '$62.1B', period: 'Q4 FY2026' } as const
  assert.equal(
    answerText([{
      ...richTextFixture,
      segments: [
        { type: 'text', text: 'Revenue was ' },
        { type: 'figure', text: '$62.2B', sources: [source], near: true },
        { type: 'text', text: ', or about ' },
        { type: 'figure', text: '$62B', sources: [source], near: true },
        { type: 'text', text: '.' },
      ],
    }]),
    'Revenue was ≈$62.2B, or about $62B.',
  )
})

// Devin on #813: a struck "~$72B" copied as "~~~$72B~~", which Markdown no longer strikes whole.
test('a tilde a figure, a struck one or its reason states is escaped, so the strike still covers it', () => {
  const source = { ref_kind: 'result', ref_id: '91111111-1111-4111-9111-111111111111', format: '$62.1B', period: 'Q4 FY2026' } as const
  assert.equal(
    answerText([{
      ...richTextFixture,
      segments: [
        { type: 'figure', text: '~$62B', sources: [source], near: true },
        { type: 'text', text: ', not ' },
        { type: 'struck', text: '~$72B', reason: 'the sources give ~$62B', sources: [source] },
      ],
    }]),
    '\\~$62B, not ~~\\~$72B~~ (the sources give \\~$62B)',
  )
})
