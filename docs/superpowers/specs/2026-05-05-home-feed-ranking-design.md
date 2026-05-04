# Home Feed Ranking Design

## Scope

This spec covers `fra-9y5` and `fra-64z`: the service-layer Home feed read model that queries findings across active agents, dedupes by claim cluster, and ranks cards by recency, severity, and user affinity. It intentionally does not implement Home UI layout, deep-link behavior, market pulse, watchlist movers, agent summaries, or pinned screens; those remain in `fra-525` and `fra-qp2`.

## Architecture

Add a new `services/home` package. Home owns the feed read model because the output combines agent findings, claim clusters, and user-specific relevance into a product surface. The agents service remains the producer of findings; evidence remains the owner of cluster aggregation.

The package has two focused units:

- `finding-feed-repo.ts`: reads enabled agents for a user, fetches recent findings, and collapses them into one Home card per dedupe key.
- `ranker.ts`: pure scoring and sorting for deduped cards using configurable weights.

## Finding Feed Query And Dedupe

`listHomeFindingCards(db, request)` returns one card per cluster-backed story. The query joins `findings` to `agents` and filters by `agents.user_id = request.user_id` and `agents.enabled = true`; disabled agents and other users' findings never enter the read model.

Each finding is assigned a dedupe key:

- If `claim_cluster_ids` is non-empty, the primary key is `claim_cluster:<first sorted cluster id>`.
- If no cluster exists, the key is `finding:<finding_id>`.

For a cluster group, the primary finding is the highest-severity, newest finding in that group. The card preserves all contributing `finding_ids`, `agent_ids`, and `claim_cluster_ids`. `support_count` is the maximum `claim_clusters.support_count` found for the group; `contributing_finding_count` is the number of grouped findings so tests can prove that three findings sharing one cluster collapse to one card even when the cluster table has its own support count.

## Ranking

`rankHomeCards(cards, options)` computes:

`score = w_recency * recency + w_severity * severity + w_affinity * affinity`

`severity` maps `low=0.25`, `medium=0.5`, `high=0.75`, `critical=1`. `recency` decays from `1` at `now` toward `0` over a configurable half-life. `affinity` is an injected numeric value on each card, clamped to `[0, 1]`; later beads can derive it from watchlists, portfolios, and thread history without changing the ranker contract.

Critical findings get a severity floor: a critical card cannot rank below a non-critical card unless the non-critical card's score beats it by a configurable margin. This prevents volume and mild affinity from burying critical findings.

Tie-breakers are deterministic: score descending, severity rank descending, `created_at` descending, `home_card_id` ascending.

## Card Shape

The read model exposes:

- `home_card_id`
- `dedupe_key`
- `primary_finding`
- `support_count`
- `contributing_finding_count`
- `severity`
- `headline`
- `subject_refs`
- `summary_blocks`
- `created_at`
- `agent_ids`
- `finding_ids`
- `claim_cluster_ids`
- `user_affinity`

The card carries existing `summary_blocks`; rendering through the BlockRegistry is left to the Home UI bead.

## Errors And Limits

Requests validate `user_id`, optional `limit`, and optional `now`. The default limit is conservative and the maximum is capped to prevent an unbounded Home query. Invalid rows fail loudly because malformed `subject_refs`, `claim_cluster_ids`, or `summary_blocks` indicate producer/schema drift.

## Testing

Tests use fake query executors and pure ranker fixtures:

- Three findings with the same cluster produce one card with three contributing findings.
- Disabled agents and other users' agents are excluded by SQL contract.
- Unclustered findings remain visible as singleton cards.
- Critical findings outrank low-severity high-affinity cards unless configured otherwise.
- Recency decays deterministically from a fixed clock.
- Weight changes alter ordering predictably.

## Self-Review

- Placeholder scan: no placeholders remain.
- Scope check: the spec is limited to `fra-9y5` and `fra-64z`; UI and secondary Home sections are explicitly excluded.
- Ambiguity check: dedupe key, support-count semantics, affinity input, and tie-breakers are defined.
