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

## SEC Filings, Insiders & Holdings

**Filing** is an SEC EDGAR submission (Form 4, 8-K, 13F-HR, 10-K, …) identified by its
accession number. Raw filing bytes stay behind the evidence boundary; consumers see only
the facts, claims, and events extracted from a filing.

**Insider** is a Section 16 reporting owner — an officer, director, or 10% owner — of an
issuer, identified by their SEC reporting-owner CIK. An insider is not a `SubjectKind`;
they are carried as attribution (`name`, `role`, `cik`) on the transactions and claims they
report, always scoped to the issuer they report against.

**Insider transaction** is a single transaction reported on a Form 4: an acquisition or
disposition with a transaction code, share count, and price. The complete reported set is
retained as the issuer's ownership record.

**Material insider transaction** is the agent-relevant subset of insider transactions:
open-market purchases or sales (Form 4 codes P and S) by officers or directors at or above
a value threshold (currently USD 100k). Routine activity — option exercises, grants, gifts,
tax withholding — is recorded but not treated as material.

**Material event** is a corporate event an issuer must disclose on an SEC Form 8-K — e.g.
an officer departure, a financial restatement, a material agreement, or bankruptcy —
identified by the 8-K Item number. Every recognized item is recorded as an event;
monitorable items also produce a claim scoped to the issuer (pure-exhibit items are
recorded but not claimed).

**Institutional holder** is an investment manager that reports its equity positions to the
SEC on a Form 13F (filed quarterly, with a statutory delay). We track a curated set of
notable filers; a holder is identified by its filer CIK.

**Institutional holding** is one position (issuer, share count, market value) reported in a
13F for a given quarter. A holding is matched to an issuer by CUSIP only when that CUSIP
already resolves to a tracked issuer; unresolved CUSIPs are logged, not dropped silently.

**Notable position change** is the agent-relevant subset of holding changes for a tracked
filer: a newly initiated position, a full exit, or a large change (roughly a quarter of the
position, or entering/leaving the filer's top holdings). Routine rebalancing is recorded
but not treated as notable.
