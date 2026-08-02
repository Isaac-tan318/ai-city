// Merging free-text facts extracted from conversation.
//
// The Decider re-reads a scenario's whole transcript on every focal turn and
// paraphrases freely, so the same fact comes back worded differently each time.
// Exact-match dedupe let those pile up ("prefers iced Milo for drinks" sitting
// next to "likes iced Milo and hot chocolate for drinks"), which is not merely
// untidy: these lists are injected into the focal agent's prompt, and a wall of
// restatements crowds out the facts that actually differ.
//
// Pure and dependency-free so it can be unit-tested directly.

export function normalizeFact(fact: string): string {
  return fact.trim().toLowerCase().replace(/[.!?]+$/, '');
}

// Words too common to carry meaning when comparing two facts.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for', 'from',
  'has', 'have', 'he', 'her', 'his', 'if', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'she',
  'so', 'that', 'the', 'their', 'them', 'they', 'to', 'was', 'what', 'when', 'which', 'who',
  'will', 'with', 'would', 'you', 'your',
]);

// Crude plural/third-person stem so "prefer"/"prefers" and
// "restriction"/"restrictions" compare equal. It mangles a few words
// ("glass" -> "glas"), which is harmless because both sides are stemmed the same
// way — this only ever feeds a similarity comparison, never anything displayed.
function stem(word: string): string {
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

export function contentTokens(fact: string): Set<string> {
  return new Set(
    normalizeFact(fact)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
      .map(stem),
  );
}

// How much of the shorter fact's meaning the longer one already contains, 0..1.
export function factOverlap(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  const [shorter, longer] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (shorter.size === 0) return 0;
  let shared = 0;
  for (const token of shorter) {
    if (longer.has(token)) shared++;
  }
  return shared / shorter.size;
}

// Deliberately generous: a false merge loses a shade of nuance, while a false
// split leaves two near-identical lines competing for room in the prompt.
export const SAME_FACT_OVERLAP_THRESHOLD = 0.7;

export function saysTheSameThing(a: string, b: string): boolean {
  if (normalizeFact(a) === normalizeFact(b)) return true;
  return factOverlap(a, b) >= SAME_FACT_OVERLAP_THRESHOLD;
}

// One entry is meant to be one fact, but the extractor sometimes crams several
// into a single string ("wants comfort food; open to something new"). Left alone
// that defeats the dedupe (a compound never matches its own parts) and makes the
// entry boundaries unreadable wherever the list is joined for display.
export function splitCompoundFacts(facts: string[]): string[] {
  const out: string[] = [];
  for (const fact of facts) {
    for (const part of fact.split(';')) {
      const trimmed = part.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

// Union two fact lists, replacing anything restated with its newest wording and
// capping the total so a long scenario can't grow an unbounded prompt.
//
// The existing list is re-split and re-deduped rather than trusted, so rows
// written before these rules existed clean themselves up on the next write
// instead of carrying their duplicates and run-ons forever.
export function mergeFacts(existing: string[], incoming: string[], max = 8): string[] {
  const out: string[] = [];
  for (const fact of splitCompoundFacts([...existing, ...incoming])) {
    const trimmed = fact.trim();
    if (!trimmed) continue;
    const duplicateAt = out.findIndex((f) => saysTheSameThing(f, trimmed));
    if (duplicateAt >= 0) {
      out[duplicateAt] = trimmed;
      continue;
    }
    out.push(trimmed);
  }
  return out.slice(-max);
}

// How many of `incoming` say something `existing` doesn't already cover.
//
// Must be counted here rather than inferred from how much the merged list grew:
// mergeFacts caps its output, so for anyone with a full list a genuinely new fact
// evicts an old one and the length never moves. A length delta would report zero
// forever, which is the steady state for any long-lived agent.
export function countNewFacts(existing: string[], incoming: string[]): number {
  const known = [...existing];
  let count = 0;
  for (const fact of incoming) {
    const trimmed = fact.trim();
    if (!trimmed) continue;
    if (known.some((f) => saysTheSameThing(f, trimmed))) continue;
    known.push(trimmed);
    count++;
  }
  return count;
}

// Drop anything the extractor reports as now answered. Uses the same fuzzy match,
// since resolutions come back paraphrased too.
export function dropResolved(open: string[], resolved: string[]): string[] {
  if (resolved.length === 0) return open;
  return open.filter((u) => !resolved.some((r) => saysTheSameThing(r, u)));
}
