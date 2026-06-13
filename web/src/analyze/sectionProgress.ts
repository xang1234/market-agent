// TOC state for a playbook memo (the reference terminal's section-progress
// rail). Matching is by case-insensitive title: the template runner titles
// generated blocks after the playbook sections, so title equality is the
// contract we can check client-side without streaming.

type PlaybookSectionLike = { readonly section_id: string; readonly title: string }
type BlockTitleLike = { readonly title?: string }

export type SectionProgressPhase = 'idle' | 'generating' | 'complete'
export type SectionProgressState = 'pending' | 'running' | 'done' | 'skipped'

export type SectionProgressRow = {
  section_id: string
  title: string
  state: SectionProgressState
}

export function sectionProgress(
  sections: ReadonlyArray<PlaybookSectionLike>,
  phase: SectionProgressPhase,
  blocks: ReadonlyArray<BlockTitleLike> | null,
): ReadonlyArray<SectionProgressRow> {
  return sections.map((section) => {
    if (phase === 'idle') return row(section, 'pending')
    if (phase === 'generating') return row(section, 'running')
    const matched =
      blocks !== null &&
      blocks.some(
        // typeof guard (not just !== undefined): run payloads cross the API
        // boundary, so a null/non-string title must not throw at render time.
        (block) =>
          typeof block.title === 'string' &&
          block.title.toLowerCase() === section.title.toLowerCase(),
      )
    return row(section, matched ? 'done' : 'skipped')
  })
}

function row(section: PlaybookSectionLike, state: SectionProgressState): SectionProgressRow {
  return { section_id: section.section_id, title: section.title, state }
}
