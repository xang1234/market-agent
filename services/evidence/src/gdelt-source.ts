import type { SourceKind, TrustTier } from "./source-repo.ts";

export const GDELT_ARTICLE_DISCOVERY_SOURCE_ID = "00000000-0000-4000-a000-00000000000d";
export const GDELT_ARTICLE_DISCOVERY_PROVIDER = "gdelt_article_discovery";
export const GDELT_DISCOVERY_SOURCE_KIND: SourceKind = "article";
export const GDELT_DISCOVERY_TRUST_TIER: TrustTier = "tertiary";
export const GDELT_DISCOVERY_LICENSE_CLASS = "ephemeral";
export const GDELT_DISCOVERY_STORE_POLICY = "metadata_only";
export const GDELT_DISCOVERY_DISCLOSURE =
  "GDELT public news discovery metadata; not a canonical fact source; publisher article body is not retained.";
export const GDELT_DOC_API_CANONICAL_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

export const GDELT_DISCOVERY_ENABLED_ENV = "GDELT_DISCOVERY_ENABLED";
export const GDELT_DOC_API_BASE_URL_ENV = "GDELT_DOC_API_BASE_URL";
export const GDELT_DISCOVERY_STORE_POLICY_ENV = "GDELT_DISCOVERY_STORE_POLICY";
export const GDELT_DISCOVERY_DEFAULT_MAX_RECORDS_ENV = "GDELT_DISCOVERY_DEFAULT_MAX_RECORDS";
export const GDELT_DISCOVERY_RATE_LIMIT_PER_SECOND_ENV = "GDELT_DISCOVERY_RATE_LIMIT_PER_SECOND";
