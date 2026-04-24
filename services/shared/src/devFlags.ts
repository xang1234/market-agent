export type DevFlags = {
  placeholderApiEnabled: boolean;
  showDevBanner: boolean;
};

export function readDevFlags(env: Record<string, string | undefined>): DevFlags {
  return {
    placeholderApiEnabled: parseBoolean(env.MA_FLAG_PLACEHOLDER_API, true),
    showDevBanner: parseBoolean(env.MA_FLAG_SHOW_DEV_BANNER, false),
  };
}

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
