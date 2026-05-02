// fra-0sa: License-class policy gates whether a document's raw bytes
// land in the object store.
//
// The spec models `Source.license_class` as a free-form string so
// providers can emit project-specific labels. This module is the single
// source of truth that turns those labels into a storage decision. It
// is intentionally fail-closed: an uncategorized license throws rather
// than falling through to either branch — silent misclassification of
// restricted content as storeable is the mistake we cannot recover from.

export const PERMISSIVE_LICENSE_CLASSES: ReadonlyArray<string> = Object.freeze([
  "public",
  "licensed",
]);

export const EPHEMERAL_LICENSE_CLASSES: ReadonlyArray<string> = Object.freeze([
  "ephemeral",
]);

export type StoragePolicy =
  | { readonly store_blob: true }
  | { readonly store_blob: false; readonly reason: "ephemeral_license" };

export class LicensePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicensePolicyError";
  }
}

export function decideStoragePolicy(license_class: string): StoragePolicy {
  if (PERMISSIVE_LICENSE_CLASSES.includes(license_class)) {
    return Object.freeze({ store_blob: true });
  }
  if (EPHEMERAL_LICENSE_CLASSES.includes(license_class)) {
    return Object.freeze({ store_blob: false, reason: "ephemeral_license" });
  }
  throw new LicensePolicyError(
    `unknown license_class "${license_class}"; ` +
      `add it to PERMISSIVE_LICENSE_CLASSES or EPHEMERAL_LICENSE_CLASSES in license-policy.ts`,
  );
}

export function isKnownLicenseClass(license_class: string): boolean {
  return (
    PERMISSIVE_LICENSE_CLASSES.includes(license_class) ||
    EPHEMERAL_LICENSE_CLASSES.includes(license_class)
  );
}
