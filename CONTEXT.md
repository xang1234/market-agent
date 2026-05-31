# Domain Context

## Subject Identity

**SubjectKind** is the closed set of commodity research subjects the app can reference:
`commodity`, `benchmark`, `contract`, `curve`, `region`, `delivery_point`,
`asset`, `producer`, `route`, `market_theme`, plus retained workspace subjects
`portfolio` and `screen`.

Legacy equity kinds (`issuer`, `instrument`, `listing`, `theme`, and `macro_topic`)
remain parseable for migration compatibility, but new V1 product surfaces should
prefer the commodity kinds above.

**SubjectRef** is the canonical reference to one subject. A canonical `SubjectRef`
has a `kind` from `SubjectKind` and a UUID `id`; raw tickers, benchmark strings,
route strings, report labels, and unresolved search text are not `SubjectRef`s.

**ResolvedSubject** is a user/search-facing envelope around a `SubjectRef`. It may
carry display labels, confidence, alternatives, and hydration context such as grade,
benchmark, location, delivery month, delivery point, route, producer, or active
contract details.

**Route subject input** is non-canonical URL or search input that may resolve to a
`SubjectRef`. Legacy `/symbol/AAPL`-style inputs stay route subject input until
parsing or resolver hydration produces canonical UUID identity.

## Decision Horizons

Commodity workflows standardize on `1d`, `1w`, `1m`, and `3m` horizons. Agents,
impact drivers, balance changes, and daily-call briefs should state which horizon
they are informing.

## Intelligence Model

The system is not a simple RAG or language-to-SQL layer. Structured price, curve,
inventory, balance, report-delta, and event services produce typed outputs. The
event-impact graph maps events and claims to commodity subjects by channel,
direction, horizon, confidence, and driver type before a composer turns them into
analyst-reviewed briefs.

Agents draft and monitor; analysts review, edit, approve, and publish. Published
briefs must remain snapshot-bound, citation-bearing, and entitlement-aware.
