const SOURCE_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  filings: 'Filings',
  transcripts: 'Transcripts',
  news: 'News',
  issuer_ir: 'Investor relations',
  financials_quarterly: 'Quarterly financials',
}

// Display only: the id stays the value sent to the analyze service.
export function sourceCategoryLabel(category: string): string {
  const known = SOURCE_CATEGORY_LABELS[category]
  if (known !== undefined) return known
  const words = category.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
