// Shared accent primary-action button styling. Several surfaces (chat composer,
// analyze run, agent save, the auth prompts, screener run) render the same
// accent-gradient call-to-action; centralizing the class keeps them identical
// and themeable. Sites append their own extras (disabled state, focus ring,
// layout) rather than re-declaring the core.
export const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90'

export const SECONDARY_BUTTON_CLASS =
  'rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50'

// Small per-row actions in lists. Tone composes from the base so a danger row
// button never fights the neutral text and hover colors in stylesheet order.
const ROW_BUTTON_BASE_CLASS =
  'rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

export const ROW_BUTTON_CLASS = `${ROW_BUTTON_BASE_CLASS} text-fg hover:bg-surface-hover`

export const DANGER_ROW_BUTTON_CLASS = `${ROW_BUTTON_BASE_CLASS} text-negative hover:bg-negative-soft`
