-- Soft-supersession for claims (fra-28yi). A Form 4/A amendment supersedes the prior
-- filing's claims; rather than hard-deleting them — which would dangle a cited claim_id
-- in a sealed snapshot's claim_refs and make the verifier report missing_claim_ref — the
-- supersede stamps superseded_at. The row is preserved so snapshot rehydration-by-id
-- still finds it, while fresh subject->claims selection (loadLocalRuntimeEvidence, theme
-- inference) filters `superseded_at is null`. Mirrors the facts.superseded_by idiom; a
-- nullable column (ALTER TABLE ADD COLUMN) so it runs inside the migration runner's
-- transaction, unlike an ALTER TYPE ... ADD VALUE on claim_status.
alter table claims add column superseded_at timestamptz;
