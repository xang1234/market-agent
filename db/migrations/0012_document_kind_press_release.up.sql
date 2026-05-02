-- fra-bsp: 'press_release' is already a source_kind enum value (an issuer
-- press release IS a kind of source) but was missing from document_kind.
-- A press-release document needs its own kind so downstream tooling can
-- distinguish it from the catch-all 'article' kind for routing/extraction.
--
-- ALTER TYPE ADD VALUE works inside a transaction on PG 12+ as long as
-- the new value isn't referenced in the same transaction — which we don't.
alter type document_kind add value if not exists 'press_release';
