// Vertical stack for a subject-detail sub-tab (Overview / Financials /
// Earnings / Holders / Signals). Every section shares the same canvas chrome —
// full width, a single column of cards, consistent gap and padding — so the
// density lives here once rather than copy-pasted across five files. Tuned
// denser than the original p-8/gap-6 to read like a data terminal (the
// charts-first redesign target) instead of a roomy web page.
export const SECTION_STACK_CLASS = 'flex w-full flex-col gap-4 p-6'
