// Which authored constraints are CONDITIONAL, and therefore only live when
// something in the world makes them live.
//
// A good part of this cast carries restrictions that bind only some of the time:
//
//   "May avoid animal products during fasting periods"          (Irina)
//   "Vegetarian on observance days; otherwise no strict rule"   (Yvonne)
//   "May avoid meat on Lent Fridays"                            (Marco, Paulo)
//
// Scored naively, these are free failures. The opportunity judge sees a proposal
// of grilled meat, sees a dietary rule mentioning meat, and records an
// opportunity — even on a day the rule does not apply, when the character has no
// constraint to disclose and nothing to be consistent with. The denominator
// grows by a moment that never existed.
//
// So conditional constraints are gated: an opportunity on one is only kept when
// the transcript actually establishes that the condition holds now. The
// classification is deliberately done here in code rather than left to the
// judge's discretion, for the same reason the arithmetic lives in metrics.ts —
// asked to decide both whether a rule is conditional and whether it was
// breached, a model will resolve the first question in whichever direction makes
// the second one easier to answer.
//
// The classifier is text-based because the constraint itself is text: nothing in
// the simulation models a fasting calendar, and inventing one here would be
// asserting a fact about the world the world does not hold.

// A single clause of a constraint, and whether it binds unconditionally.
export type ConstraintClause = {
  text: string;
  conditional: boolean;
  // The words that made it conditional, quoted — so a gated opportunity can be
  // explained rather than merely reported.
  trigger: string;
};

export type ConstraintCondition = {
  // True only when NOTHING in the constraint binds unconditionally. A rule like
  // "Avoids beef; vegetarian on prayer days" has an unconditional half, so it
  // stays ungated: the beef half is live every day, and gating the whole thing
  // would hide a real constraint to avoid over-counting a conditional one.
  conditional: boolean;
  trigger: string;
  clauses: ConstraintClause[];
};

// Markers that a clause applies only at certain times. Each is matched against
// one clause, and the matched text becomes the trigger shown in the report.
//
// These are period markers, not hedges in general: "may avoid X during Y" is
// conditional, but "cannot accept anything that could read as a benefit" is an
// absolute rule with a cautious verb in it, and must not be gated.
const CONDITION_PATTERNS: RegExp[] = [
  // "during Orthodox fasting periods", "during Ramadan", "while fasting"
  /\b(?:during|throughout|while|whilst)\s+[^,;]{2,60}/i,
  // A named occasion or weekday, which binds the rule to a date rather than to
  // the person. Listed before the looser markers below so the trigger the report
  // prints names the occasion rather than the preposition in front of it.
  /\b(?:ramadan|eid|hari raya|lent|lenten|advent|christmas|easter|diwali|deepavali|vaisakhi|songkran|obon|passover|high holidays|yom kippur|sabbath|shabbat|fast(?:ing)?\s+(?:day|days|period|periods)|observance day|observance days|prayer day|prayer days|prayer time|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  // "on observance days", "on Lent Fridays", "on prayer days", "on her rest day"
  /\bon\s+(?:selected\s+|some\s+|certain\s+)?[^,;]{0,30}\b(?:day|days|friday|fridays|sunday|sundays|saturday|saturdays|evening|evenings)\b/i,
  // "when she is fasting", "if it falls on a festival", "unless it is a feast day"
  /\b(?:when|whenever|if|unless)\s+[^,;]{2,60}/i,
  // A rule the profile itself marks as intermittent.
  /\bsometimes\b|\boccasionally\b|\bfrom time to time\b/i,
  // "may affect", "may avoid", "may matter" — the spreadsheet's own way of
  // writing a rule that applies on some occasions and not others.
  /\bmay\s+(?:avoid|affect|matter|apply|be\b)/i,
  // "for community meals", "for family religious events" — bound to an occasion
  // rather than to the person.
  /\bfor\s+(?:community|family|religious|festival|temple|church)\b[^,;]{0,40}/i,
];

// Clauses that state the absence of a restriction. "otherwise no strict
// restriction" is not an unconditional rule that keeps the constraint live — it
// is the explicit statement that the rest of the time nothing binds.
const NO_RESTRICTION = /\bno\s+(?:strict\s+)?(?:restriction|rule|limitation)|\bnone\b|\bno strict\b/i;

// Split on the separators the profile vocabulary actually uses. A constraint is
// frequently several rules in one string ("Avoids beef; vegetarian on prayer
// days; limits red meat") and they do not all bind at the same times.
function clausesOf(text: string): string[] {
  return text
    .split(/[;|]|(?:\s+—\s+)|(?:\.\s+)/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

export function conditionOf(constraintText: string): ConstraintCondition {
  const text = constraintText.trim();
  if (!text) return { conditional: false, trigger: '', clauses: [] };

  const clauses: ConstraintClause[] = clausesOf(text).map((clause) => {
    for (const pattern of CONDITION_PATTERNS) {
      const match = pattern.exec(clause);
      if (match) return { text: clause, conditional: true, trigger: match[0].trim() };
    }
    return { text: clause, conditional: false, trigger: '' };
  });

  // Clauses that only say "and otherwise nothing applies" are neither a
  // conditional rule nor an unconditional one, so they do not vote.
  const binding = clauses.filter((c) => !NO_RESTRICTION.test(c.text));
  const conditional = binding.length > 0 && binding.every((c) => c.conditional);
  return {
    conditional,
    trigger: conditional ? (binding.find((c) => c.trigger)?.trigger ?? '') : '',
    clauses,
  };
}

// The judge quotes an `attribute` from the profile block it was shown, and that
// block carries both field names and values. It will sometimes answer with the
// name ("Dietary rule") and sometimes with the value ("May avoid animal products
// during fasting periods"), and only the value can be classified — so resolve
// the name back to the text it labels before asking whether it is conditional.
//
// `candidates` are the profile values, hard taboos and essential needs for that
// character; `profileFields` maps the field names to their values.
export function resolveConstraintText(
  attribute: string,
  profileFields: Record<string, string>,
  candidates: string[],
): string {
  const wanted = normalize(attribute);
  if (!wanted) return attribute;

  // An exact field name: "Dietary rule" -> its value.
  for (const [key, value] of Object.entries(profileFields)) {
    if (normalize(key) === wanted && value.trim()) return value.trim();
  }
  // The attribute already IS a value, or quotes part of one.
  for (const candidate of [...Object.values(profileFields), ...candidates]) {
    const text = candidate.trim();
    if (!text) continue;
    const norm = normalize(text);
    if (norm === wanted) return text;
    if (norm.includes(wanted) && wanted.length >= 8) return text;
    if (wanted.includes(norm) && norm.length >= 8) return text;
  }
  // "Dietary rule: vegetarian on observance days" — a field name with its value
  // glued on. Classify the whole thing; the marker is in the value half.
  return attribute;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
