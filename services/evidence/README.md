# Evidence

Tracking beads: `fra-5gb`, `fra-131`, and related P3 evidence-plane work.

This package provides small repository helpers over the evidence-plane tables in
`spec/finance_research_db_schema.sql`.

## Source Repo

`createSource` writes rows to `sources` with the provenance fields ingestion and
promotion code needs:

- `provider`
- `kind`
- `canonical_url`
- `trust_tier`
- `license_class`
- `retrieved_at`
- `content_hash`

`getSource` reads a source by `source_id`.

The helpers validate enum-shaped fields before querying so callers fail before a
database round trip for malformed `kind`, `trust_tier`, timestamp, or empty
license/provider metadata. The database still enforces referential integrity:
`documents.source_id` must point at an existing source row.

## Tests

```bash
cd services/evidence
npm test
```

Integration coverage uses the shared Docker/Postgres harness and is skipped when
Docker is unavailable.
