import {
  SecEdgarFetchError,
  type SecEdgarFetcher,
} from "./sec-edgar.ts";

export type SecCompanyFactsHttpOptions = {
  userAgent: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export function createSecCompanyFactsHttpFetcher(
  options: SecCompanyFactsHttpOptions,
): SecEdgarFetcher {
  const baseUrl = options.baseUrl ?? "https://data.sec.gov";
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent.trim();

  if (userAgent.length === 0) {
    throw new Error("SEC_EDGAR_USER_AGENT must be non-empty when SEC EDGAR fetching is enabled");
  }

  return async (path: string): Promise<unknown> => {
    const response = await fetchImpl(new URL(path, baseUrl), {
      headers: {
        "accept": "application/json",
        "user-agent": userAgent,
      },
    });

    if (!response.ok) {
      throw new SecEdgarFetchError(response.status, `sec_edgar: HTTP ${response.status}`);
    }

    return response.json();
  };
}
