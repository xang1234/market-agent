import type { PerfNormalization } from './types.ts'

const NORMALIZATION_LABELS: Readonly<Record<PerfNormalization, string>> = {
  raw: 'Raw values',
  pct_return: 'Percent return',
  index_100: 'Indexed to 100',
}

export function perfNormalizationLabel(normalization: PerfNormalization): string {
  return NORMALIZATION_LABELS[normalization]
}
