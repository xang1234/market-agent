import {
  GDELT_ARTICLE_DISCOVERY_PROVIDER,
  GDELT_DISCOVERY_DISCLOSURE,
  GDELT_DISCOVERY_LICENSE_CLASS,
  GDELT_DISCOVERY_STORE_POLICY,
} from "./gdelt-source.ts";
import { EPHEMERAL_LICENSE_CLASSES } from "./license-policy.ts";
import { isEphemeralRawBlobId } from "./object-store.ts";

export function storagePolicyForDocument(input: {
  provider: string;
  license_class: string;
  raw_blob_id?: string | null;
}): string {
  if (
    input.provider === GDELT_ARTICLE_DISCOVERY_PROVIDER &&
    input.license_class === GDELT_DISCOVERY_LICENSE_CLASS
  ) {
    return GDELT_DISCOVERY_STORE_POLICY;
  }
  if (typeof input.raw_blob_id === "string" && isEphemeralRawBlobId(input.raw_blob_id)) {
    return "ephemeral";
  }
  if (EPHEMERAL_LICENSE_CLASSES.includes(input.license_class)) {
    return "ephemeral";
  }
  return "stored_blob";
}

export function sourceDisclosure(input: {
  provider: string;
  license_class: string;
}): string | null {
  return input.provider === GDELT_ARTICLE_DISCOVERY_PROVIDER &&
    input.license_class === GDELT_DISCOVERY_LICENSE_CLASS
    ? GDELT_DISCOVERY_DISCLOSURE
    : null;
}
