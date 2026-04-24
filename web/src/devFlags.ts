export type WebDevFlags = {
  placeholderApiEnabled: boolean;
  showDevBanner: boolean;
};

export function readWebDevFlags(env: Record<string, string | undefined>): WebDevFlags {
  return {
    placeholderApiEnabled: parseBoolean(env.VITE_MA_FLAG_PLACEHOLDER_API, true),
    showDevBanner: parseBoolean(env.VITE_MA_FLAG_SHOW_DEV_BANNER, false),
  };
}

const importMetaEnv =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

export const webDevFlags = readWebDevFlags(importMetaEnv);

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "on":
    case "yes":
      return true;
    case "0":
    case "false":
    case "off":
    case "no":
      return false;
    default:
      return fallback;
  }
}
