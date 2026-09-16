// Which of a character's structured profile fields describe something they
// cannot simply choose to ignore for an evening.
//
// Split out of the prompt builder and kept dependency-free (no imports at all)
// for the same reason as convex/aiTown/shortTerm.ts: the prompt builder, and a
// unit test, both need it, and conversation.ts drags in the generated api.
//
// The distinction this draws is the whole point. A profile is one flat
// key-value map, so "Dietary rule: Halal only; no pork; no alcohol" sits between
// a hobby and a hometown with identical weight, and a model reading it treats a
// religious restriction as another piece of colour. Naming the fixed ones
// separately is presentation of stipulated attributes — it says nothing about
// when, whether, or how a character should raise them, which is the behaviour
// under observation (see Component 4 in evaluation/README.md).

// Matched on the field name, so a profile that adds a new constraint field only
// has to name it recognisably.
//
// Deliberately excludes taste ("Food likes", "Food dislikes"), disposition
// ("Personality", "Conflict style") and circumstance ("Occupation"): those bend,
// and folding them in would flatten the distinction this exists to draw.
const CONSTRAINT_FIELD_PATTERN =
  /diet|allerg|health condition|mobility|sensory|religious schedule|festival|holiday constraint|observance|taboo|constraint|sleep\/work|rhythm/i;

// A constraint field whose value says there is no constraint. Common enough in
// the data ("Mobility level: No limitation", "Dietary rule: No restrictions")
// that keeping them would pad the block with non-facts — and a list where a
// third of the entries say "nothing to worry about" is a list that gets skimmed.
const NO_CONSTRAINT_VALUE = /^(no restrictions?|no limitations?|none|not applicable|n\/a)\b/i;

export function splitProfileConstraints(profile: Record<string, string>): {
  constraints: [string, string][];
  rest: [string, string][];
} {
  const constraints: [string, string][] = [];
  const rest: [string, string][] = [];
  for (const entry of Object.entries(profile)) {
    const value = entry[1]?.trim();
    if (!value) continue;
    const isConstraint =
      CONSTRAINT_FIELD_PATTERN.test(entry[0]) && !NO_CONSTRAINT_VALUE.test(value);
    (isConstraint ? constraints : rest).push(entry);
  }
  return { constraints, rest };
}
