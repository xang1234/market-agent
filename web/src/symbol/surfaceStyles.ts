// Shared surface chrome for the redesign's panels. The app has three surface
// tiers; before this they were copy-pasted as literal class strings across
// ~25 sites, so an elevation/radius/border tweak meant a codebase-wide sweep.
// Centralizing each tier mirrors buttonStyles.ts (PRIMARY_BUTTON_CLASS): sites
// append their own padding/layout extras rather than re-declaring the core.
//
// Lives in symbol/ (not shell/) because it's the established shared-primitive
// layer — blocks/, pages/, screener/, and shell/ all already depend on it,
// whereas a shell/ home would add a new blocks -> shell edge.

// Flat nested panel: bordered surface with no elevation. For panels that sit
// inside a page or another card (Home feed tiles, Screener sub-panels).
export const PANEL_CLASS = 'rounded-lg border border-line bg-surface'

// Elevated top-level card: a panel plus a soft shadow. The default block /
// symbol card treatment.
export const CARD_CLASS = `${PANEL_CLASS} shadow-sm`

// Recessed inset tier (bg-surface-2): metric tiles and form controls that
// should read as carved into the surface rather than floating above it.
export const INSET_SURFACE_CLASS = 'rounded-lg border border-line bg-surface-2'
