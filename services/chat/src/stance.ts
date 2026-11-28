// ADR 0005. Buy, sell and hold are stance only as a rating, so "customers buy in bulk" is not one.
const RATING = String.raw`(?:strong\s+)?(?:buy|sell|hold)\b(?!-)`;
const STANCE = new RegExp([
  String.raw`\b(?:overweight|underweight|outperform|underperform|conviction|upgrade|downgrade)\b`,
  String.raw`\b(?:raise[sd]?|raising|lift(?:s|ed)?|lower(?:s|ed|ing)?|cut(?:s|ting)?|set(?:s|ting)?|reiterate[sd]?|maintain(?:s|ed)?|boost(?:s|ed)?|trim(?:s|med)?|increase[sd]?|reduce[sd]?)\b(?:\s+\S+){0,3}?\s+price targets?\b`,
  String.raw`\bprice targets?\s+(?:raise|cut|increase|hike|reduction)s?\b`,
  String.raw`\b(?:a|an|the|our|my)\s+${RATING}`,
  String.raw`\brate[ds]?\s+(?:a\s+|an\s+)?${RATING}`,
  String.raw`\brate[ds]?\s+(?:\S+\s+){0,3}?as\s+(?:a\s+|an\s+)?${RATING}`,
  String.raw`\bstrong\s+(?:buy|sell|hold)\b(?!-)`,
  String.raw`\b(?:buy|sell|hold)\s+(?:rating|recommendation)s?\b`,
  String.raw`\b(?:rating|recommendation)s?\s+(?:of\s+)?(?:buy|sell|hold)\b(?!-)`,
  String.raw`\brecommend(?:s|ed|ing)?\s+(?:buy|sell|hold)(?:ing)?\b`,
].join("|"), "iu");

export const statesStance = (text: string) => STANCE.test(text);
