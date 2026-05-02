// Fail-closed by design: an uncategorized license throws rather than
// silently falling through to either branch. Quiet misclassification of
// restricted content as storeable is the failure mode we cannot recover
// from.

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
