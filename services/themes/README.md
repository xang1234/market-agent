# Themes

The themes package owns theme definitions and theme membership rows.

## Membership Rationale

`ThemeMembership.rationale_claim_ids` is the product-facing explanation anchor.
It is currently meaningful for `membership_mode = 'inferred'`, where
`applyInferredThemeMembership` computes candidate subjects from claim clusters
and persists the distinct supporting claim ids beside the membership score.

Mode support:

- `inferred`: supports claim-level rationale through `rationale_claim_ids`.
- `rule_based`: may expose a score and membership spec, but does not currently
  produce claim-level rationale unless a caller explicitly writes claim ids.
- `manual`: has no inferred claim rationale; product surfaces must say so
  rather than fabricating provenance.

Use `listThemeMembershipRationalesBySubject(db, subjectRef)` when hydrating a
symbol, theme, or chat surface. It joins `theme_memberships` to `themes` and
returns `membership_mode`, `membership_spec`, `score`, `rationale_claim_ids`,
and `rationale_supported` in one read so UI and Block[] renderers can explain
why a subject belongs to a theme.

## Tests

```bash
npm test
```
