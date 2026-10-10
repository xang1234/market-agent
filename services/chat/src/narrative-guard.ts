// The model writes the narrative; it must not introduce figures. A sentence
// survives only if every number in it also appears in something the user can
// check: the fact blocks shown with the answer, or a cited claim. Everything
// else is dropped rather than shown unsupported.
//
// A figure that belongs to one company (a comparison cell) must also be
// credited to that company in the same sentence, even when a claim or title
// repeats the number. Nothing carries across sentences: "Its margin..." could
// mean any company named earlier, so it is dropped. Within the sentence:
// - a company directly attached to the figure ("AMD's 49.2%", "AMD at 49.2%",
//   "NVDA's $209.9B"), or naming it by its metric through its possessive
//   ("AMD's FY2025 net margin of 12.0%"), owns it, whatever else is named before it;
// - otherwise, the companies named between the previous such figure (or the sentence
//   start) and this one must all own it ("NVDA's 74.6%, ahead of AMD at 49.2%");
//   a company introduced as a comparison ("compared with", "unlike", "versus")
//   yields to another company or a pronoun there;
// - if none is named there, the first one named after it when for/at/in ties
//   them ("74.6% at NVDA"; not "49.2%, exceeding AMD"), which is then used up,
//   unless a pronoun is the subject ("its margin was 49.2% in AMD's filing");
// - if none, the company of the previous figure ("NVDA's revenue was $130.5B
//   and margin 74.6%").
// Anything else (two unattached companies before a figure, "respectively", no company) is
// dropped: the guard cannot parse who the figure belongs to, so it only keeps
// what is unambiguous. The cost, valid sentences dropped, is tracked in #144.
//
// ponytail: compares numbers by value ("62.1" in "$62.1B" and "62.1 billion"),
// not by magnitude or unit; a derived figure that coincidentally equals a shown
// one would pass. Tighten to unit-aware matching if that shows up in the eval.
// ponytail: companies are recognized by their displayed label (ticker) only,
// case-sensitively, and never by a one-letter ticker (the article "A"); the
// prompt asks the model to use the label. Add legal-name aliases if the eval
// shows "NVIDIA" sentences being dropped (#144).

// A leading minus is part of the figure ("-10.0%" is not "10.0%"), across any
// currency prefix the formatter writes ("-$3.1B", "-CN¥3.1B", "-CHF 3.1B",
// "-F CFA 3.1B", "-XCG 3.1B"; a test checks every supported currency), unless
// it joins two numbers or words ("2025-2026").
// A space after the minus only follows a currency prefix; a bare minus touches
// its digits, so a Markdown bullet ("- 3.1%") is not a sign.
const NUMBER =
  /(?:(?<![A-Za-z0-9.])[-−](?:(?:[A-Za-z]{1,4}\.?(?:[ \u00a0\u202f][A-Za-z]{1,4})?\p{Sc}?|\p{Sc})[ \u00a0\u202f]?)?)?\d+(?:,\d{3})*(?:\.\d+)?/gu;
// The formatter writes no dotted currency prefix (a dotted symbol becomes its
// ISO code, #150), so every period before whitespace ends a sentence; the
// all-currency test fails if one appears.
// Before a year ("FY2025", "fiscal 2025", "fiscal-year 2025") or after it
// ("2025 fiscal year", "2025 fiscal-year").
const FISCAL = /(?:\bFY ?|\bfiscal(?:[ -]year)? )$/i;
const FISCAL_AFTER = /^ fiscal\b/i;
// "vs." abbreviates, it does not end a sentence ("($44.1B vs. $39.3B)", 2026-10-08 eval).
const SENTENCE_BREAK = /(?<=[.!?])(?<!\b[Vv]s\.)\s+/;
// Markdown list markers ("- ", "* ", "1. ", "2) ") and headings ("## Margins",
// a line that is only "**Margins**"; a bold sentence ending "." is prose).
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,2}[.)])\s+/;
const HEADING = /^\s*(?:#{1,6}\s|\*\*[^*]*[^*.!?]\*\*:?\s*$)/;
const COMPARED_WITH = /(?:compared (?:with|to)|unlike|versus|vs\.?|than|relative to|against)\s+$/i;
// Between a company and a figure it owns: nothing but a possessive or
// "at"/"with", then the figure's currency prefix if any ("versus AMD's 49.2%",
// "compared with AMD at 49.2%", "NVDA's $209.9B", "AMD's CHF 3.1B"; #144).
const ATTACHED = /^(?:['’]s)?\s*(?:(?:at|with)\s+)?(?:(?:[A-Z]{1,4}\.?(?:[ \u00a0\u202f][A-Z]{1,4})?\p{Sc}?|\p{Sc})[ \u00a0\u202f]?)?$/u;
// The same without a currency prefix, for a label that is also a currency word.
const ATTACHED_PLAIN = /^(?:['’]s)?\s*(?:(?:at|with)\s+)?$/i;
// A possessive naming the figure through its metric and "of" ("versus AMD's
// FY2025 net margin of 12.0%", "AMD's FY2025 (ended December 2025) revenue of
// $34.7B"; #240): group 1 is the phrase between, checked by `namesMetric`.
const POSSESSED = /^['’]s\s+(.+?)\s+of\s+(?:(?:[A-Z]{1,4}\.?(?:[ \u00a0\u202f][A-Z]{1,4})?\p{Sc}?|\p{Sc})[ \u00a0\u202f]?)?$/u;
// A magnitude comparison in words ("more than double", "thirteen times AMD's",
// "sixfold", "one in eight", "half as large", "a third of", "by a factor of
// six") is a computation the number check cannot see (#228): it always goes.
// Not even a cited claim licenses one, since a claim's "AMD's revenue doubled"
// must not ground "NVDA's revenue doubled"; the model quotes a displayed figure
// (a growth rate) instead. Direction ("higher") is not a magnitude.
// ponytail: a word list, not a parser; add a phrase when the eval shows one.
const COUNT = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|(?:a )?dozen)`;
const MAGNITUDE = new RegExp(
  String.raw`\b(?:(?:doubl|tripl|trebl|quadrupl|quintupl|sextupl|septupl|octupl)(?:ed(?! down\b| as an?\b)|(?:es|ing)(?! down\b| as\b))|halved|` +
    String.raw`(?:${COUNT}|several|many|multiple|a few|a couple of)[- ]?fold|${COUNT}[ -](?:in|out[ -]of)[ -](?:every[ -])?${COUNT}|${COUNT}[ -]of[ -]every[ -]${COUNT}|(?:increas|ris|rose|grew|grow|jump|climb|expand|surg|soar|fell|fall|declin|dropp?|shr[ai]nk|gain|slid|slip)\w* ${COUNT}(?:[- ]${COUNT})? (?:per ?cent|(?:percentage|basis) points?|points?|bps|bp)\b|(?<!(?:first|second|back|front|latter|former|last|later|earlier|1st|2nd)[ -])half (?:as|the size)|(?:a|${COUNT})[- ](?:third|fourth|quarter(?!s? (?:of|as) (?:results|data|history|figures|detail|segment|reported|financials|filings?|fiscal|FY|calendar|\d{4})\b)|fifth|sixth|seventh|eighth|ninth|tenth|hundredth)s? (?:of|as|that of|what|the (?:size|amount|level|value|total|revenue|sales|income|profit|earnings|margins?))|` +
    String.raw`orders? of magnitude|by half|(?:advantage|difference|gap|spread|lead|premium|discount|edge|deficit|shortfall)\b(?: [a-z]+){0,2}? (?:was|is|were|are|of|at|stood at|came to|reached|widened to|narrowed to|amounted to|totall?ed) (?:(?:${COUNT}(?:[- ]${COUNT})?|\d+(?:\.\d+)?) (?:(?:percentage|basis) points?|points?|per ?cent|bps|bp|dollars?|cents?|euros?|pounds?|yen|billion|million|trillion)\b|\d+(?:\.\d+)?%)|\d+(?:\.\d+)?[- ]?fold\b|${COUNT} and (?:an?|${COUNT})[- ](?:half|third|quarter|fourth|fifth)s? times\b|${COUNT}-times\b|${COUNT} (?:dollars?|cents?|euros?|pounds?|yen|yuan) (?:per|for each|for every) (?:${COUNT} )?(?:dollars?|cents?|euros?|pounds?|yen|yuan)\b|(?:${COUNT} times|twice) [^.,;:]*?\b(?:what|that of)\b|(?:increas|ris|rose|grew|grow|jump|climb|expand|surg|soar|fell|fall|declin|dropp?|shr[ai]nk|multipli)\w* (?:by )?\d+(?:\.\d+)?(?:[x×]|[- ]?fold)(?!\w)|(?:up|down) \d+(?:\.\d+)?(?:[x×]|[- ]?fold)(?!\w)|than (?:its |their |the |[A-Z]{2,}['’]s )?(?:entire|whole|combined) (?:[^\s.,;]+ ){0,3}?(?:revenue|sales|income|profit|earnings|margin|cash flow|base|value|total)\b|${COUNT}(?:[- ]${COUNT})? (?:points? (?:higher|lower|above|below|ahead|behind|more|less|wider|narrower)|(?:(?:billion|million|trillion)(?: dollars)?|dollars?|cents?|euros?|pounds?) (?:higher|lower|above|below|ahead|behind|more|less))|(?:exceed|beat|trail|lag|outpac|surpass|top|increas|rais|ris|rose|grew|grow|jump|climb|expand|surg|soar|fell|fall|declin|dropp?|shr[ai]nk|cut|lower|widen|narrow|boost)\w*(?: [A-Za-z'’]+){0,2}? by ${COUNT}(?:[- ]${COUNT})? (?:billion|million|trillion|dollars?|cents?|euros?|pounds?|yen|bps|bp|per ?cent|(?:percentage|basis) points?)|${COUNT}(?:[- ]${COUNT})? (?:(?:percentage|basis) points|points?|per ?cent|bps|bp|dollars?|cents?|euros?|pounds?|yen|yuan|rupees?|won|francs?) (?:higher|lower|above|below|ahead|behind|wider|narrower|more|less|greater|larger|smaller|bigger)\b|(?:${COUNT}|\d+(?:\.\d+)?)-to-${COUNT}|${COUNT}-to-\d+(?:\.\d+)?|(?:${COUNT}|\d+(?:\.\d+)?) to one\b|by (?:${COUNT}|several|many|a few|a couple of) times\b|${COUNT} (?:[a-z]+ )?for every ${COUNT}|(?:a|${COUNT})[- ](?:half|third|quarter|fourth|fifth|sixth|seventh|eighth|ninth|tenth|hundredth)s? (?:higher|lower|larger|smaller|bigger|greater|more|less)|(?:by )?a factor of (?:${COUNT}|several|a few|about|roughly|nearly|almost|over|more than))\b`,
  "i",
);
// Which phrases count (each case has a test):
// - "N times" after a number word or "twice": unless it ends the clause or
//   counts occurrences or frequency ("three times this year", "twice a month").
// - after digits: unless a valuation basis follows ("52.3 times earnings"), so
//   "52.3 times AMD's scale" and "52.3 times last year's level" go; a digit
//   "x", "×" or "fold" before a word likewise, unless the word is a valuation
//   basis, an occurrence or a connective ("52.3x is", "52.3x versus AMD's
//   41.2x"), so a displayed "52.3×" stays.
// - after "several", "many", "a few", "half", "hundreds of": only before the thing compared
//   ("several times AMD's", "many times larger"), so "volatile times" stays.
// - a bare "double"/"triple" after a degree word that ends the clause or meets
//   the thing compared ("nearly double.", "more than double AMD's"), or right
//   before the thing compared ("double AMD's"); not "double taxation",
//   "concern over triple-net leases" or "double bottom". "doubled" always counts,
//   except "doubled down", "doubles as collateral" and "doubled as a hedge".
// - "half" before the thing compared or "of", unless an ordinal half of a
//   period ("first half of NVDA's fiscal 2026").
// - worded differences ("forty percentage points", "fifty percent", "six
//   billion dollars more", "six dollars higher", "six bps higher", "six-to-one", "six dollars for
//   every one", "a third higher", "three out of four", "larger
//   than its entire revenue", "the margin gap was fifty percentage points" or
//   "53.6 percentage points", "six dollars per dollar", "a five-times
//   increase", "grew fifty percent", "one-in-eight"; "per cent" as well as
//   "percent"; "by <amount>" only after a
//   change or comparison verb, so "funded by six million dollars" stays; a gap
//   noun only with a measuring link, so "advantage stems from one million
//   developers" stays),
//   though a quantity ("three million units") or a direction ("faster than the
//   entire sector") is not one.
// - a digit percent against another company ("53.6% higher than AMD's"): a
//   displayed growth rate compares with a prior period, not a company.
// - "52.3x versus …" only stays before a second multiple ("versus AMD's
//   41.2x"); "half the year" is a duration.
// A valuation basis after a displayed multiple ("52.3 times earnings", "a
// 52.3× P/E multiple"): the figure is the multiple itself, not a ratio.
// Lowercase: MULTIPLIER sees the normalized (lowercased) sentence.
const VALUATION = String.raw`(?:(?:trailing |forward |ttm |ntm )?(?:earnings|sales|book|ebitda|ebit|revenue|cash flow|free cash flow|fcf|eps|p\/e|pe|p\/s|p\/b|ev\/ebitda|ev\/sales|price[- ]to[- ][a-z]+|multiple)\b)`;
// Occurrences and frequency after "N times" / "twice" ("three times this year",
// "3 times a month", "twice annually", "three times and then", "three times to
// discuss"): event counts.
const OCCURRENCE = String.raw`(?:this (?:year|quarter|month|week|period)\b(?!['’]s)|(?:in|during|since|so far|each|per|over|within|across|throughout|before|after|between|annually|yearly|quarterly|monthly|weekly|daily|and|or|but|then|while|when|to)\b|last (?:year|quarter|month)\b(?!['’]s)|a (?:year|quarter|month|week|day)\b)`;
const COMPARED = String.raw`(?:(?:the )?(?:last|prior|previous) (?:year|quarter|month|period)['’]s\b|year-ago\b|as\b|the\b|that of\b|of [A-Z]|its\b|their\b|what\b|(?:larger|bigger|greater|higher|lower|smaller|more|less|faster|slower)\b|[A-Z]{2,}\b)`;
const MULTIPLIER = new RegExp(
  String.raw`\b(?:${COUNT} times|twice)(?!\s*(?:[.,;:!?]|$)| ${OCCURRENCE})|` +
    String.raw`\b(?:several|many|a few|a couple of|multiple|half|(?:tens|dozens|hundreds|thousands|millions|billions) of) times ${COMPARED}|\b(?:double|triple|quadruple) ${COMPARED}|\b\d+(?:\.\d+)? times (?!${VALUATION}|${OCCURRENCE})[A-Za-z]|\b(?:more than|nearly|almost|roughly|about|over|less than|at least|close to) (?:double|triple|quadruple)(?=\s*(?:[.,;:!?)]|$)|\s+${COMPARED})|\b\d+(?:\.\d+)?(?:[xX×]|[- ]?fold) (?!${VALUATION}|${OCCURRENCE}|(?:is|was|are|were|and|or|but|for|at|on|to|from|by|with|while)\b|(?:versus|vs\.?) (?:[A-Z]{2,}['’]s )?\d)[A-Za-z]|\b\d+(?:\.\d+)?(?:%| per ?cent| percentage points?| basis points?| points?| bps) (?:(?:higher|lower|more|less|greater|larger|smaller|bigger) than|above|below|ahead of|behind) [A-Z]{2,}\b|` +
    String.raw`(?<!(?:[Ff]irst|[Ss]econd|[Bb]ack|[Ff]ront|[Ll]atter|[Ff]ormer|[Ll]ast|[Ll]ater|[Ee]arlier|1st|2nd)[ -])\b[Hh]alf (?!(?:of )?the (?:year|quarter|month|week|day|period|time|session|decade)\b)(?:of\b|${COMPARED})`,
);
// A stated cause ("driven by Data Center", "reflecting higher revenue") must be
// made of the answer's own data (#249): every content word after the causal
// connective comes from a displayed text, a cited claim (so a management
// attribution the turn cites passes), a metric or a company, or the short list
// of data words below. A hedge or disclaimer does not withdraw a cause ("could
// reflect pricing power, but the data does not show the cause" goes, #261); an
// explicit gap names none ("the data does not explain why margins rose").
// ponytail: a vocabulary check, not a semantic one; an interpretation the data
// cannot show ("pricing power") goes too, unless labelled as a hypothesis.
const CONNECTIVE = String.raw`(?:driven by|due to|because of|owing to|attributable to|as a result of|thanks to|on the back of|fuell?ed by|stemming from|caused by|result(?:s|ed)? from|reflect(?:s|ed|ing)?)`;
const CAUSAL = new RegExp(
  String.raw`\b${CONNECTIVE}\s+((?:(?!\b(?:although|though|but|while|whereas|yet|however|${CONNECTIVE})\b)[^,;:.])+)`,
  "gi",
);
// A cause the data does not show is allowed only as a labelled hypothesis (#261):
// a blockquote item with its confidence in words and one explanation, resting on
// an observation the answer shows ("> **Unverified hypothesis (medium
// confidence):** … may reflect …, given its gross margin of 70.8%").
// The basis is held to the cause check, and the numbers to the number check;
// any further sentence on the line is ordinary prose (#262 review). #208's
// analyst_inference replaces this label.
const HYPOTHESIS = /^\s*>\s*\*\*Unverified hypothesis \((?:low|medium|high) confidence\):\*\*\s+/i;
// A line claiming to be a hypothesis: the phrase at its start, behind any list,
// quote or bold marker; prose that mentions one ("would be an unverified
// hypothesis") claims nothing (#262 review).
const HYPOTHESIS_CLAIM = /^\s*(?:(?:[-*+]|\d{1,2}[.)])\s+)?(?:>\s*)?[*_]*\s*unverified hypothesis\b/i;
// Ordinary comparison and trend words a basis may use besides the answer's own.
// ponytail: a word list from the 2026-10-08 eval's phrasing; extend it from eval
// evidence, not invented sentences (#261).
const BASIS_WORDS = new Set([
  "versus", "vs", "compared", "relative", "while", "despite", "still", "even", "only", "after", "before", "since",
  "grew", "grow", "growing", "rose", "fell", "declined", "dropped", "expanded", "contracted", "recovered",
  "sequentially", "ending", "ended", "same", "prior", "previous", "following", "alongside", "adjacent",
]);
const BASIS = /\b(?:given|based on)\b(.*)$/i;
const MAX_HYPOTHESES = 2;
const CAUSE_STOP = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "its", "their", "that", "this", "these", "those", "to", "for",
  "with", "by", "from", "as", "at", "which", "both", "more", "less", "than", "over", "across", "into", "per", "each",
  "also", "it", "they", "is", "was", "were", "are", "be", "been", "largely", "mostly", "partly", "primarily",
  "mainly", "entirely", "company", "same",
]);
const CAUSE_DATA_WORDS = new Set([
  "reported", "mix", "figures", "figure", "data", "shown", "displayed", "higher", "lower", "stronger", "weaker",
  "rising", "falling", "larger", "smaller", "growth", "decline", "increase", "decrease", "revenue", "margin",
  "margins", "sales", "income", "profit", "profits", "earnings", "segment", "segments", "quarter", "quarters",
  "quarterly", "year", "years", "annual", "period", "periods", "fiscal", "price", "prices", "return", "returns",
  "above", "below",
]);
// A figure is not a word: its unit ("B" in "$209.9B") is dropped with it; any
// other digit-led term is ("5G" leaves "g"), and a fiscal year or quarter stays
// whole ("FY2025's", "Q4's"; #262 review).
const causeWords = (text: string) =>
  (text.toLowerCase().replace(/(?<![a-z0-9.,])\d[\d.,]*(?:bn|mn|tn|[bmktx])?\b/g, " ").match(/[a-z][a-z0-9'’-]*/g) ?? []).map((word) => word.replace(/['’]s$/, ""));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_WORDS = new Set(MONTHS.map((month) => month.toLowerCase()));
// A day as written: "December 31, 2025", "31 December 2025" or "2025-12-31".
const DATE = String.raw`(?:(?:${MONTHS.join("|")}) \d{1,2},? \d{4}|\d{1,2} (?:${MONTHS.join("|")}),? \d{4}|\d{4}-\d{2}-\d{2})`;
// The chart window in words: the window's own range of two days ("window runs
// from … to …", "range between … and …") or a range of two closes ("from the …
// close to the … close"). A lone date ("to August 31, 2026", "after the August
// 31, 2026 close") or a range of something else ("NVDA's fiscal year runs from
// …") is not one.
// ponytail: wording, not provenance; tie dates to their block if one leaks through.
const WINDOW_DAYS = new RegExp(String.raw`(?<=\b(?:window|range|period)(?: (?:runs|covers|spans|goes|extends|stretches|is))? )(?:from|between) (?:the )?(${DATE})(?: close)? (?:to|through|thru|until|and) (?:the )?(${DATE})(?: close)?|\bfrom the (${DATE}) close (?:to|through|thru|until) the (${DATE}) close\b`, "g");
function isoDate(date: string): string {
  if (/^\d{4}-/.test(date)) return date;
  const [, first, second, year] = date.match(/^(\S+) (\S+?),? (\d{4})$/)!;
  const [month, day] = /^\d/.test(first) ? [second, first] : [first, second];
  return `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
}
const PRONOUN = /\b(?:its|it|their|they|the former|the latter)\b/i;
// Between a figure and the company that owns it: its unit, then a preposition
// ("% for ", "B at ", " percent in "). No punctuation and no other words, so a
// comparison ("74.6%, ahead of NVDA", "beaten by NVDA", "49.2% from AMD's
// level") never reads as owner.
const OWNED_BY = /^[^\s,;:]*\s*(?:(?:percent|billion|million|trillion|bn|mn)\s+)?(?:for|at|in)\s+$/i;

// The metric labels the figure where it is shown ("Net Margin").
export type AttributedFigure = { company: string; value: string; metric?: string };

export function keepSupportedSentences(
  text: string,
  supportingTexts: ReadonlyArray<string>,
  attributedFigures: ReadonlyArray<AttributedFigure> = [],
  // Displayed dates ("2025-12-31"), which the narrative may write with their day.
  displayedDates: ReadonlyArray<string> = [],
  // Every displayed figure's metric ("Gross margin"), a single company's too:
  // what a hypothesis's basis may name (#262 review).
  displayedMetrics: ReadonlyArray<string> = [],
  // The answer's subjects ("NVDA"), which a single-company answer's figures do
  // not carry: a hypothesis basis may name them (2026-10-08 eval). They own no figure.
  subjectLabels: ReadonlyArray<string> = [],
): { text: string; removed: string[] } {
  // A year is supported in either form ("FY 2025 to FY 2026" shown supports
  // "2025-2026"); only owning one tells them apart.
  const bothForms = (number: string) => /^(?:FY)?\d{4}$/.test(number) ? [number.replace("FY", ""), `FY${number.replace("FY", "")}`] : [number];
  const supported = new Set(supportingTexts.flatMap(numbersIn).flatMap(bothForms));
  const owners = new Map<string, Set<string>>();
  // The metrics of each company's figure with that number ("AMD\u000012" -> ["Net Margin"]).
  const metricsOf = new Map<string, string[]>();
  for (const figure of attributedFigures) {
    for (const number of numbersIn(figure.value)) {
      const companies = owners.get(number) ?? new Set<string>();
      companies.add(figure.company);
      owners.set(number, companies);
      if (figure.metric) {
        const key = `${figure.company}\u0000${number}`;
        metricsOf.set(key, [...metricsOf.get(key) ?? [], figure.metric]);
      }
    }
  }
  // A number every company owns (the fiscal year both report, "FY2025") is no
  // one's in particular: it needs no company, as long as there are two to share it.
  const everyone = new Set(attributedFigures.map((figure) => figure.company));
  for (const [number, companies] of owners) {
    if (everyone.size > 1 && companies.size === everyone.size) {
      owners.delete(number);
      for (const form of bothForms(number)) supported.add(form);
    }
  }
  // A one-letter ticker ("A") cannot be told from the article, so it is never
  // recognized; sentences quoting its figures are dropped.
  // The words of the figures' currency prefixes ("CHF" in "CHF 3.1B", "F" and
  // "CFA" in "F CFA 3.1B"): a label that is one can't be told from the
  // currency before a figure.
  const currencyWords = new Set(attributedFigures.flatMap((figure) =>
    figure.value.match(/^[-−]?(\D*)/)![1].match(/[A-Za-z]+/g) ?? []
  ));
  const companies = [...new Set(attributedFigures.map((figure) => figure.company))]
    .filter((company) => company.length > 1);

  // The words a stated cause may use: the turn's own displayed and cited text.
  const vocabulary = new Set([
    ...supportingTexts.flatMap(causeWords),
    ...attributedFigures.flatMap((figure) => causeWords(`${figure.company} ${figure.metric ?? ""}`)),
  ]);
  // Each displayed metric as a whole name, without its qualifier ("Revenue
  // growth (QoQ)" -> "revenue growth"): one word of it ("gross") is no basis.
  const metricName = (metric: string) => causeWords(metric.replace(/\([^)]*\)/g, "")).join(" ");
  const metricNames = [...new Set([...attributedFigures.flatMap((figure) => figure.metric ?? []), ...displayedMetrics]
    .map(metricName).filter(Boolean))];
  // In a comparison, the metrics each company has displayed: a basis naming a
  // company cites one of its own ("given NVDA's gross margin" needs NVDA's).
  const metricsOwned = (company: string) =>
    attributedFigures.filter((figure) => figure.company === company && figure.metric).map((figure) => metricName(figure.metric!));
  const known = (word: string) => CAUSE_STOP.has(word) || CAUSE_DATA_WORDS.has(word) || vocabulary.has(word);
  const groundedCause = (sentence: string) =>
    [...sentence.matchAll(CAUSAL)].every((match) => causeWords(match[1]).every(known));
  // A hypothesis's one explanation (a single causal clause), resting on an
  // observation of the answer's own: it names a displayed metric ("given its
  // gross margin of 70.8%"); not generic words ("given the data shown above"),
  // a title's wrapper words ("the side shown"), a company or a year alone
  // ("given NVDA", "based on 2026", #262 review).
  // ponytail: an explanation without a connective ("and an acquisition lifted
  // revenue") is not counted; #208's typed assertions bound that.
  const groundedBasis = (sentence: string) => {
    const basis = sentence.match(BASIS)?.[1];
    if (basis === undefined || [...sentence.matchAll(CAUSAL)].length > 1) return false;
    // Its words are the answer's own, or ordinary comparison and trend words
    // ("versus", "grew sequentially", "ending December", 2026-10-08 eval); an
    // invented premise ("after its inventory charge"), an unshown qualifier
    // ("subscription revenue") or another company ("at TSLA") is not (#265
    // review). A company is a compared one or the hypothesis's own subject,
    // the sentence's opening possessive ("NVDA's revenue may …"); another
    // capitalized word ("AI demand", "TSLA's pricing") is not one (#265 review).
    const subject = sentence.match(/^\s*([A-Z][A-Z0-9.]{1,5})['’]s\b/)?.[1];
    // The turn's subject labels only in a single-company answer, whose figures
    // carry no company; a comparison names its own (#268 review).
    const named = new Set([...companies, ...(companies.length === 0 ? subjectLabels : []), ...(subject === undefined ? [] : [subject])]);
    const words = causeWords(basis.replace(/\b([A-Z][A-Z0-9.]{1,5})(?:['’]s)?\b/g, (mention, ticker: string) => named.has(ticker) ? " " : mention));
    const cites = (name: string) => ` ${words.join(" ")} `.includes(` ${name} `);
    // A month only as the answer shows it, in full or abbreviated ("ended Jan
    // 2026" allows "January", not "December", #265 review).
    const shownMonth = (word: string) => MONTH_WORDS.has(word) && (vocabulary.has(word) || vocabulary.has(word.slice(0, 3)));
    return words.every((word) => (MONTH_WORDS.has(word) ? shownMonth(word) : known(word) || BASIS_WORDS.has(word))) &&
      metricNames.some(cites) &&
      companyMentions(basis, companies).every(({ company }) => metricsOwned(company).some(cites));
  };
  let hypotheses = 0;
  const dates = new Set(displayedDates);
  // A displayed day in the chart window's own words reads as its month
  // ("from the December 31, 2025 close" -> "from the December 2025 close"); a
  // displayed day dates nothing else ("NVDA's FY2026 ended December 31, 2025").
  const asMonth = (date: string) => `${MONTHS[Number(isoDate(date).slice(5, 7)) - 1]} ${isoDate(date).slice(0, 4)}`;
  const withDisplayedDays = (sentence: string) =>
    sentence.replace(WINDOW_DAYS, (window: string, ...ends: Array<string | undefined>) => {
      const [from, to] = ends[0] !== undefined ? ends as [string, string] : [ends[2]!, ends[3]!];
      return dates.has(isoDate(from)) && dates.has(isoDate(to)) ? window.replace(from, asMonth(from)).replace(to, asMonth(to)) : window;
    });
  const removed: string[] = [];
  // null marks a line the guard dropped whole.
  const lines: Array<string | null> = [];
  // Lines are boundaries too, so each bullet of a list is judged on its own.
  for (const line of text.trim().split(/\r?\n/)) {
    if (line.trim() === "") {
      lines.push("");
      continue;
    }
    // A list marker ("1.", "-") is not a sentence: it is set aside, and stays
    // with whatever of its item is kept.
    // A labelled line is a hypothesis within the cap, or it goes whole (#262 review).
    // Any line claiming to be one counts toward the cap; one not in exactly the
    // labelled form (bold only, behind a list marker) goes whole.
    const label = line.match(HYPOTHESIS)?.[0];
    const claimed = label !== undefined || HYPOTHESIS_CLAIM.test(line);
    const withinCap = claimed && ++hypotheses <= MAX_HYPOTHESES;
    if (claimed && label === undefined) {
      removed.push(line.trim());
      lines.push(null);
      continue;
    }
    const lead = label ?? line.match(LIST_MARKER)?.[0] ?? line.match(/^\s*/)![0];
    const sentences = line.slice(lead.length).trim().split(SENTENCE_BREAK);
    const keeps = sentences.map((written, sentenceIndex) => {
      // A displayed date written with its day ("December 31, 2025") is checked as
      // its month and year, so the day is not a figure (#240); any other day is.
      const sentence = withDisplayedDays(written);
      // Inline Markdown ("double **AMD's**") is ignored for both checks.
      const plain = sentence.replace(/[*_`]+/g, "");
      // MULTIPLIER is case-sensitive so that a ticker ("AMD") counts as the
      // thing compared: the sentence is lowercased, whatever its case ("Six
      // Times AMD's", "SIX TIMES AMD'S"), and the companies' labels restored.
      const normalized = companies.reduce(
        (text, company) => text.replace(new RegExp(`(?<![a-z0-9])${escapeRegExp(company.toLowerCase())}(?![a-z0-9])`, "g"), company),
        plain.toLowerCase(),
      );
      if (MAGNITUDE.test(plain) || MULTIPLIER.test(normalized) ||
        (label !== undefined && sentenceIndex === 0 ? !(withinCap && groundedBasis(plain)) : !groundedCause(plain))) {
        removed.push(written);
        return false;
      }
      const allNumbers = numberMatches(sentence);
      const mentions = companyMentions(sentence, companies);
      // Digits inside a label ("issuer:12ab34cd") are not figures, and a label
      // inside a figure ("-CHF 3.1B" when CHF is a ticker) is not a mention.
      const within = (at: number, start: number, length: number) => at >= start && at < start + length;
      const numbers = allNumbers.filter((n) => !mentions.some((m) => within(n.index, m.index, m.company.length)));
      const named = mentions.filter((m) => !numbers.some((n) => within(m.index, n.index, n.end - n.index)));
      if (numbers.some(({ number }) => !supported.has(number) && !owners.has(number))) {
        removed.push(written);
        return false;
      }
      // Figures that need a company (any comparison value, even one a claim or
      // title repeats); each claims the stretch of text around it.
      const attributed = numbers.filter(({ number }) => owners.has(number));
      let carried: string[] = [];
      // A name after a figure that the figure took is used up; the next figure's
      // stretch starts past it.
      let usedUpTo = 0;
      const isSupported = attributed.every(({ number, index, end }, i) => {
        // A fiscal year with no company named between it and this figure is
        // part of the phrase naming it ("AMD's FY2025 net margin of 12.0%"), so
        // it does not end the stretch; "NVDA reported FY2026; AMD revenue..." does.
        const boundary = attributed.slice(0, i).findLast((n) =>
          !n.number.startsWith("FY") || named.some((mention) => mention.index >= n.end && mention.index < index)
        );
        const from = Math.max(boundary?.end ?? 0, usedUpTo);
        const to = i === attributed.length - 1 ? sentence.length : attributed[i + 1].index;
        const stretch = named.filter((mention) => mention.index >= from && mention.index < index);
        // A company introduced as a comparison is not the figure's owner
        // ("Unlike AMD, the company achieved 49.2%"; "Compared with AMD,
        // NVDA's 74.6%"). A company directly attached to the figure ("versus
        // AMD's 49.2%", "shows AAPL at 6.05%") owns it, comparison or not, and
        // outranks any other company in the stretch (#144).
        const comparisons = stretch.filter((mention) => COMPARED_WITH.test(sentence.slice(0, mention.index)));
        const subjects = stretch.filter((mention) => !comparisons.includes(mention));
        // A pronoun with no company subject ("Its margin was 49.2% in AMD's
        // filing") refers back to an earlier figure's company in the sentence,
        // if any: nothing named near this figure may claim it.
        const pronounSubject = subjects.length === 0 && PRONOUN.test(sentence.slice(from, index));
        // A currency-word label is attached by a possessive or "at"/"with"
        // ("CHF's 49.2%", "CHF at 49.2%"); right before a figure, only as a
        // comparison company, as before #144: whether "CHF 3.1B" names CHF or
        // the franc is unknowable.
        const attached = stretch.filter((mention) => {
          const between = sentence.slice(mention.index + mention.company.length, index);
          // Another company in between ("AMD's NET margin of" with NET a ticker) breaks it.
          const phrase = between.match(POSSESSED)?.[1];
          if (phrase !== undefined && !stretch.some((other) => other.index > mention.index) &&
              namesMetric(phrase, metricsOf.get(`${mention.company}\u0000${number}`) ?? [])) return true;
          return currencyWords.has(mention.company)
            ? ATTACHED_PLAIN.test(between) && (between.trim() !== "" || comparisons.includes(mention))
            : ATTACHED.test(between);
        });
        const before = attached.length > 0 ? attached : subjects;
        // An unattached comparison company ("compared with AMD's revenue of
        // $74.6B") may be the figure's real subject, so nothing else may claim
        // it: neither a name after the figure nor the carried company.
        const blocked = before.length === 0 && comparisons.length > 0;
        // Only the first name after it, and only when a preposition ties it to
        // the figure ("74.6% for NVDA"); "49.2%, exceeding AMD" names a comparison.
        const next = named.find((mention) => mention.index >= end && mention.index < to);
        const after = before.length === 0 && !pronounSubject && !blocked && next !== undefined &&
            OWNED_BY.test(sentence.slice(end, next.index))
          ? next
          : undefined;
        if (after !== undefined) usedUpTo = after.index + after.company.length;
        const credited = before.length > 0
          ? before.map((mention) => mention.company)
          : after !== undefined
          ? [after.company]
          : blocked
          ? []
          : carried;
        carried = credited;
        return credited.length > 0 && credited.every((company) => owners.get(number)!.has(company));
      });
      if (!isSupported) removed.push(written);
      return isSupported;
    });
    const kept = sentences.filter((_, index) => keeps[index]);
    if (label !== undefined && !keeps[0]) {
      removed.push(...kept);
      lines.push(null);
      continue;
    }
    lines.push(kept.length > 0 ? lead + kept.join(" ") : null);
  }
  return { text: withoutEmptySections(lines), removed };
}

// The cause check alone, for an answer that shows no figures (#263): with
// nothing displayed there is no vocabulary to ground a cause in, so any stated
// cause goes, hedged or not. A labelled hypothesis within the cap stays, and a
// line claiming to be one in any other form goes whole, as in
// keepSupportedSentences. An explicit gap ("the data does not show why") names
// no cause and stays. Numbers are not checked: there are none shown to check
// them against (#181).
export function keepUncausedSentences(text: string): { text: string; removed: string[] } {
  let hypotheses = 0;
  const removed: string[] = [];
  const lines: Array<string | null> = [];
  for (const line of text.trim().split(/\r?\n/)) {
    if (line.trim() === "") {
      lines.push("");
      continue;
    }
    const label = line.match(HYPOTHESIS)?.[0];
    const claimed = label !== undefined || HYPOTHESIS_CLAIM.test(line);
    if (claimed) {
      const kept = label !== undefined && ++hypotheses <= MAX_HYPOTHESES;
      if (!kept) removed.push(line.trim());
      lines.push(kept ? line : null);
      continue;
    }
    const lead = line.match(LIST_MARKER)?.[0] ?? line.match(/^\s*/)![0];
    const sentences = line.slice(lead.length).trim().split(SENTENCE_BREAK);
    const kept = sentences.filter((sentence) => {
      const causal = new RegExp(CAUSAL.source, "i").test(sentence.replace(/[*_`]+/g, ""));
      if (causal) removed.push(sentence);
      return !causal;
    });
    lines.push(kept.length > 0 ? lead + kept.join(" ") : null);
  }
  return { text: withoutEmptySections(lines), removed };
}

// The kept lines (null: dropped whole) as text. A heading whose section lost
// everything goes too: the guard dropped lines before the next heading at its
// level or above, and kept none of them. A heading with a figure in it
// ("## Revenue: $62.1B") is content: its figure passed the guard.
function withoutEmptySections(lines: ReadonlyArray<string | null>): string {
  const level = (line: string | null) =>
    line !== null && HEADING.test(line) && !/\d/.test(line) ? line.trim().match(/^#+/)?.[0].length ?? 7 : 0;
  const keepHeading = (i: number): boolean => {
    let lost = false;
    for (const line of lines.slice(i + 1)) {
      if (line === null) lost = true;
      else if (line.trim() === "") continue;
      else if (level(line) === 0) return true;
      else if (level(line) <= level(lines[i])) break;
    }
    return !lost;
  };
  const shown = lines.filter((line, i): line is string => line !== null && (level(line) === 0 || keepHeading(i)));
  return shown.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Whether the words between a possessive and "of" name one of the figure's
// metrics: words of that metric ("net margin" for Net Margin), periods
// ("FY2025", "Q4") and a period-end note ("(ended December 2025)"), nothing
// else, and all of the metric's name. So a new subject ("AMD's results this
// competitor's net margin of"), a dash or another metric ("AMD's gross margin
// of" Net Margin's 12.0%) breaks it.
function namesMetric(phrase: string, metrics: ReadonlyArray<string>): boolean {
  const words = phrase.replace(/\((?:ended|ending) [A-Z][a-z]+ \d{4}\)/g, " ").split(/\s+/).filter(Boolean);
  // Periods are not metric words: "FY2025", "Q4", and "fiscal (year) 2025" (#240).
  const named = words.filter((word) => !/^[A-Z]*\d+$/.test(word) && !/^(?:fiscal|year|fiscal-year)$/i.test(word));
  // Both split the same way, so a label repeated verbatim matches ("revenue
  // growth (YoY)", "P/E"), and so does "YoY" without its parentheses.
  const bare = (word: string) => word.toLowerCase().replace(/^\((.*)\)$/, "$1");
  const used = new Set(named.map(bare));
  return metrics.some((metric) => {
    const vocabulary = metric.split(/\s+/).map(bare);
    // The whole name but its parenthesized qualifier: part of it could be
    // another metric ("revenue" for Revenue Growth (YoY), "margin").
    const required = metric.replace(/\([^)]*\)/g, " ").split(/\s+/).filter(Boolean).map(bare);
    return [...used].every((word) => vocabulary.includes(word)) && required.every((word) => used.has(word));
  });
}

function numbersIn(text: string): string[] {
  return numberMatches(text).map(({ number }) => number);
}

// A fiscal year ("FY2025", "2025 fiscal year") is keyed apart from a calendar year
// ("December 2025"): a company owns its fiscal year, while a chart's window
// year belongs to every company, and matching by number alone let the window
// make every fiscal year shared (#244).
function numberMatches(text: string): Array<{ number: string; index: number; end: number }> {
  return [...text.matchAll(NUMBER)].map((match) => {
    const fiscal = /^\d{4}$/.test(match[0]) &&
      (FISCAL.test(text.slice(0, match.index)) || FISCAL_AFTER.test(text.slice(match.index + match[0].length)));
    return { number: (fiscal ? "FY" : "") + numberKey(match[0]), index: match.index, end: match.index + match[0].length };
  });
}

// Where each company label appears in the sentence, in order.
function companyMentions(
  sentence: string,
  companies: ReadonlyArray<string>,
): Array<{ company: string; index: number }> {
  return companies
    .flatMap((company) => {
      const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(company)}(?![A-Za-z0-9])`, "g");
      return [...sentence.matchAll(pattern)].map((match) => ({ company, index: match.index }));
    })
    .sort((a, b) => a.index - b.index);
}

// The comparable value: "62.1" for "$62.1B", "-10" for "-10.0%", and "-0" kept
// apart from "0" ("-0.0%" is a displayed decline).
function numberKey(raw: string): string {
  // The sign plus the digits: a currency prefix ("-CHF ") must not leak in.
  const sign = /^[-−]/.test(raw) ? "-" : "";
  const value = Number(sign + raw.match(/\d+(?:,\d{3})*(?:\.\d+)?$/)![0].replaceAll(",", ""));
  return Object.is(value, -0) ? "-0" : String(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
