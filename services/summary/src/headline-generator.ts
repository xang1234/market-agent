export type HeadlineModelInput = {
  kind: "finding" | "home_card";
  prompt: string;
};

export type HeadlineModel = (
  input: HeadlineModelInput,
) => Promise<string> | string;

export type FindingHeadlineSnapshot = {
  snapshot_id: string;
  as_of: string;
};

export type FindingHeadlineClaimCluster = {
  cluster_id: string;
  claim: string;
};

export type GenerateFindingHeadlineInput = {
  snapshot: FindingHeadlineSnapshot;
  claimCluster: FindingHeadlineClaimCluster;
  model: HeadlineModel;
};

export type GenerateHomeCardHeadlineInput = {
  finding: {
    headline: string;
    severity: string;
    subjectLabel?: string;
  };
  clusterContext?: string;
  model: HeadlineModel;
};

export type HomeCardHeadlineInput = Omit<GenerateHomeCardHeadlineInput, "model">;

const MAX_HEADLINE_LENGTH = 80;
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to"]);

export async function generateFindingHeadline(
  input: GenerateFindingHeadlineInput,
): Promise<string> {
  try {
    const raw = await input.model({
      kind: "finding",
      prompt: findingPrompt(input),
    });
    return rawModelHeadlineOrFallback(raw, input.claimCluster.claim);
  } catch {
    return fallbackHeadline(input.claimCluster.claim);
  }
}

export async function generateHomeCardHeadline(
  input: GenerateHomeCardHeadlineInput,
): Promise<string> {
  try {
    const raw = await input.model({
      kind: "home_card",
      prompt: homeCardPrompt(input),
    });
    return rawModelHeadlineOrFallback(raw, input.finding.headline);
  } catch {
    return fallbackHeadline(input.finding.headline);
  }
}

export function homeCardHeadlineFromFinding(input: HomeCardHeadlineInput): string {
  return normalizeHeadline(input.finding.headline);
}

export function normalizeHeadline(value: string): string {
  const firstLine = value.split(/\r?\n/u)[0] ?? "";
  const collapsed = firstLine.replace(/\s+/gu, " ").trim();
  const headline = collapsed.length > 0 ? collapsed : "Finding Update";
  if (headline.length <= MAX_HEADLINE_LENGTH) return headline;
  return `${headline.slice(0, MAX_HEADLINE_LENGTH - 1).trimEnd()}…`;
}

function fallbackHeadline(value: string): string {
  return normalizeHeadline(toTitleCase(value.replace(/[.]+$/u, "")));
}

function rawModelHeadlineOrFallback(raw: string, fallback: string): string {
  const firstLine = raw.split(/\r?\n/u)[0] ?? "";
  if (raw.trim().length === 0 || firstLine.trim().length === 0) {
    return fallbackHeadline(fallback);
  }
  return normalizeHeadline(raw);
}

function findingPrompt(input: GenerateFindingHeadlineInput): string {
  return [
    `Snapshot: ${input.snapshot.snapshot_id} as of ${input.snapshot.as_of}`,
    `Cluster: ${input.claimCluster.cluster_id}`,
    `Claim: ${input.claimCluster.claim}`,
  ].join("\n");
}

function homeCardPrompt(input: GenerateHomeCardHeadlineInput): string {
  return [
    input.finding.subjectLabel ? `Subject: ${input.finding.subjectLabel}` : "",
    `Severity: ${input.finding.severity}`,
    `Finding: ${input.finding.headline}`,
    input.clusterContext ? `Cluster context: ${input.clusterContext}` : "",
  ].filter(Boolean).join("\n");
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/u)
    .map((word, index) => {
      if (/[A-Z]/u.test(word)) return word;
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      const match = lower.match(/^([^a-z0-9]*)([a-z0-9])(.*)$/u);
      if (!match) return word;
      return `${match[1]}${match[2].toUpperCase()}${match[3]}`;
    })
    .join(" ");
}
