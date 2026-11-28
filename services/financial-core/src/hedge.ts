// A hedge right before a figure ("about", "roughly", "nearly", "~"…): it claims no exact value.
// ponytail: these words only. "Over" and "more than" are bounds, which the trailing-zero
// rule reads loosely within a tenth of the data ("over $60B" matches 62.1 billion, "over
// $100B" is wrong for 140 billion). This module imports nothing, so web can read it (#819).
const HEDGE = /(?:\b(?:about|approximately|around|roughly|nearly|almost|close to)\s+|[~≈]\s?)$/iu;

// The text right before a figure hedges it, read from its last 24 characters.
export const endsInHedge = (text: string): boolean => HEDGE.test(text.slice(-24));
