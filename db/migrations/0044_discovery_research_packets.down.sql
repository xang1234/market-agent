alter table discovery_candidates
  drop constraint if exists discovery_research_packet_pair,
  drop column if exists research_packet_hash,
  drop column if exists research_packet;
