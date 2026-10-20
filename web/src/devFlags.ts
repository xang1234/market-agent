export type WebDevFlags = {
  llmSettingsEnabled: boolean;
  placeholderApiEnabled: boolean;
  showDevBanner: boolean;
  // The static demo (`vite build --mode demo`): the page answers /v1 itself (src/demo).
  demo: boolean;
  // Start signed in with the dev mock session (#122). Only under the Vite dev server,
  // or in the demo.
  devAutoLogin: boolean;
};

// Vite's import.meta.env: string VITE_* vars plus boolean DEV/PROD/SSR.
type ViteEnv = Record<string, string | boolean | undefined>;

export function readWebDevFlags(env: ViteEnv): WebDevFlags {
  const demo = env.MODE === "demo";
  return {
    llmSettingsEnabled: parseBoolean(env.VITE_MA_FLAG_LLM_SETTINGS, false),
    placeholderApiEnabled: parseBoolean(env.VITE_MA_FLAG_PLACEHOLDER_API, true),
    showDevBanner: parseBoolean(env.VITE_MA_FLAG_SHOW_DEV_BANNER, false),
    demo,
    // DEV is true only under `vite` (dev server). Any `vite build`, including a custom
    // --mode like staging, has DEV=false. The demo build is the exception: main.tsx
    // installs its in-page replay on the same MODE, and the replay answers every /v1
    // request. So no build with a backend can skip sign-in.
    devAutoLogin: (env.DEV === true && parseBoolean(env.VITE_MA_FLAG_DEV_AUTO_LOGIN, false)) || demo,
  };
}

const importMetaEnv = (import.meta as ImportMeta & { env?: ViteEnv }).env ?? {};

export const webDevFlags = readWebDevFlags(importMetaEnv);

function parseBoolean(raw: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
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
