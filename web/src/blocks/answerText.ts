// An answer as Markdown, for pasting into notes: prose verbatim, figures as the
// answer shows them, tables as Markdown tables. A chart or other visual names
// itself rather than vanishing, so the reader knows the note leaves it out.
import { labelText, resultLabel, resultsById, supportedFinancialContent } from './financialAnswer.ts'
import { isRefSegment, refSegmentText } from './richText.ts'
import { formatTableCell } from './table.ts'
import type {
  Block,
  DisclosureBlock,
  FinancialAnswerBlock,
  FinancialPresentedResult,
  FindingCardBlock,
  RichTextBlock,
  SectionBlock,
  SourcesBlock,
  TableBlock,
} from './types.ts'

// Text the app shows literally (a ref's figure, a toned run, a table cell) keeps
// its characters when pasted into Markdown. Only marks that change inline
// meaning are escaped, so figures like $85.8B stay readable as plain text.
const literal = (text: string) => text.replace(/[\\`*_[\]<>]/g, '\\$&')

function markdownTable(header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const line = (cells: ReadonlyArray<string>) => `| ${cells.map((cell) => literal(cell).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

function shown(result: FinancialPresentedResult | undefined): string {
  return result ? literal(result.presented.text) : ''
}

function financialAnswerText(block: FinancialAnswerBlock): string {
  const content = supportedFinancialContent(block)
  if (content === null) return ''
  const results = resultsById(content)
  return content.presentations
    .map((presentation) => {
      if (presentation.kind === 'table') {
        const header = ['Company', ...presentation.columns.map((column) => {
          const measure = labelText(content, column.measure_label_id)
          return column.period_label_id === null ? measure : `${measure}, ${labelText(content, column.period_label_id)}`
        })]
        const rows = presentation.rows.map((row) => [
          labelText(content, row.subject_label_id),
          ...row.cells.map((id, index) => {
            const result = id == null ? undefined : results.get(id)
            const ownPeriod = presentation.columns[index]?.period_label_id === null && result ? ` (${labelText(content, result.period_label_id)})` : ''
            return shown(result) + ownPeriod
          }),
        ])
        return [presentation.caption, markdownTable(header, rows)].filter(Boolean).join('\n\n')
      }
      if (presentation.kind === 'series') {
        const heading = `${labelText(content, presentation.subject_label_id)}: ${labelText(content, presentation.measure_label_id)}`
        const rows = presentation.points.map((point) => [labelText(content, point.period_label_id), shown(results.get(point.result_id))])
        return `${heading}\n\n${markdownTable(['Period', 'Value'], rows)}`
      }
      const result = results.get(presentation.result_id)
      if (!result) return ''
      return result.presented.kind === 'value' || result.presented.kind === 'gap'
        ? `${resultLabel(content, result)}: ${shown(result)}`
        : shown(result)
    })
    .filter(Boolean)
    .join('\n\n')
}

type TextBlocks = {
  rich_text: RichTextBlock
  financial_answer: FinancialAnswerBlock
  table: TableBlock
  section: SectionBlock
  finding_card: FindingCardBlock
  disclosure: DisclosureBlock
  sources: SourcesBlock
}

const BLOCK_TEXT: { readonly [K in keyof TextBlocks]: (block: TextBlocks[K]) => string } = {
  rich_text: ({ segments, analyst_commentary }) => {
    // Plain runs are the answer's Markdown source; refs and toned runs render literally.
    const text = segments.map((segment) => (isRefSegment(segment) ? literal(refSegmentText(segment)) : segment.tone === undefined || segment.tone === 'neutral' ? segment.text : literal(segment.text))).join('')
    return analyst_commentary ? `Analyst commentary\n\n${text}` : text
  },
  financial_answer: financialAnswerText,
  table: ({ title, columns, rows }) => {
    const table = markdownTable(columns, rows.map((row) => row.map(formatTableCell)))
    return title ? `${title}\n\n${table}` : table
  },
  section: ({ title, children }) => [title ? `## ${title}` : '', answerText(children)].filter(Boolean).join('\n\n'),
  finding_card: ({ headline }) => headline,
  disclosure: ({ items }) => items.map((item) => `- ${item}`).join('\n'),
  sources: ({ items }) => ['Sources', ...items.map((item) => `- ${item.label}${item.url ? ` (${item.url})` : ''}`)].join('\n'),
}

const hasText = (block: Block): block is TextBlocks[keyof TextBlocks] => Object.hasOwn(BLOCK_TEXT, block.kind)

function blockText(block: Block): string {
  if (!hasText(block)) return `[In the app: ${block.title ?? block.kind.replaceAll('_', ' ')}]`
  return (BLOCK_TEXT[block.kind as keyof TextBlocks] as (block: TextBlocks[keyof TextBlocks]) => string)(block)
}

export function answerText(blocks: ReadonlyArray<Block>): string {
  return blocks
    .map(blockText)
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n')
}

// A copied answer, closed with the date of its data and the snapshot it came
// from, as a copied table is, so a pasted figure keeps its provenance.
export function answerCopy(message: { blocks: ReadonlyArray<Block>; snapshot_id: string }): string {
  const asOf = message.blocks.map((block) => block.as_of).sort().at(-1)
  const source = [asOf ? `As of ${asOf}` : '', `Snapshot ${message.snapshot_id}`].filter(Boolean).join(' · ')
  return [answerText(message.blocks), source].filter(Boolean).join('\n\n')
}
