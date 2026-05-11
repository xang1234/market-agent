# Domain Context

## Subject Identity

**SubjectKind** is the closed set of finance subject categories the app can reference:
`issuer`, `instrument`, `listing`, `theme`, `macro_topic`, `portfolio`, and `screen`.

**SubjectRef** is the canonical reference to one finance subject. A canonical `SubjectRef`
has a `kind` from `SubjectKind` and a UUID `id`; raw tickers, route strings, labels,
and unresolved search text are not `SubjectRef`s.

**ResolvedSubject** is a user/search-facing envelope around a `SubjectRef`. It may carry
display labels, confidence, alternatives, and hydration context such as issuer,
instrument, listing, or active-listing details.

**Route subject input** is non-canonical URL or search input that may resolve to a
`SubjectRef`. Legacy `/symbol/AAPL`-style inputs stay route subject input until parsing
or resolver hydration produces canonical UUID identity.
