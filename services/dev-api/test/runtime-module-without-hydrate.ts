export async function sealAnalyzeSnapshot(): Promise<never> {
  throw new Error("not used");
}

export const analyzeFinancial = { resolvePeers: async () => [], publish: async () => ({ coverage: "none", sections: [] }) };
