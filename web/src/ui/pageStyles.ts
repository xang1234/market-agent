// Page chrome shared by the workspace tabs (Home, Agents, Review, Screener,
// Analyze, Grids, Discover). Same idiom as shell/buttonStyles.ts: class
// strings that sites extend with layout extras instead of re-declaring them.
import { CARD_CLASS } from '../symbol/surfaceStyles.ts'

export const PAGE_CLASS = 'flex flex-1 flex-col gap-6 overflow-auto p-6'

export const PAGE_PANEL_CLASS = `${CARD_CLASS} p-5`

export const PANEL_TITLE_CLASS = 'text-base font-semibold text-fg'

export const SECTION_LABEL_CLASS = 'text-xs font-semibold uppercase tracking-wide text-muted'

export const FIELD_LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium text-fg'

// Text inputs, selects, and textareas. The field draws its own focus state.
// No width or padding in the base: a site's w-* or py-* would lose to a built-in
// one because Tailwind orders by stylesheet, so sizes compose from the base.
export const FIELD_BASE_CLASS =
  'min-w-0 rounded-md border border-line-strong bg-surface text-sm font-normal text-fg outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60'

export const FIELD_CLASS = `${FIELD_BASE_CLASS} px-3 py-2`

export const COMPACT_FIELD_CLASS = `${FIELD_BASE_CLASS} px-3 py-1.5`

// A bordered group of related fields inside a form. min-w-0 overrides the
// fieldset default of min-inline-size: min-content, which lets wide children
// push the fieldset past its grid track.
export const FIELDSET_CLASS = 'flex min-w-0 flex-col gap-3 rounded-lg border border-line p-4'

// A checkbox drawn as a pill, for picking several values from a short list.
// The label carries the class and hides its input with sr-only; has-checked
// and has-focus-visible draw the input's state on the label, so controlled and
// uncontrolled checkboxes both work.
export const TOGGLE_CHIP_CLASS =
  'relative cursor-pointer select-none rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-fg-soft transition-colors hover:border-accent-border has-checked:border-accent-border has-checked:bg-accent-soft has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent'
