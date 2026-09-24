alter table discovery_candidates
  add column research_packet jsonb check (research_packet is null or jsonb_typeof(research_packet) = 'object'),
  add column research_packet_hash text check (research_packet_hash is null or research_packet_hash ~ '^sha256:[0-9a-f]{64}$'),
  add constraint discovery_research_packet_pair check ((research_packet is null) = (research_packet_hash is null));
