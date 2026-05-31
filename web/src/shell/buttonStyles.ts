// Shared accent primary-action button styling. Several surfaces (chat composer,
// analyze run, agent save, the auth prompts, screener run) render the same
// accent-gradient call-to-action; centralizing the class keeps them identical
// and themeable. Sites append their own extras (disabled state, focus ring,
// layout) rather than re-declaring the core.
export const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90'
