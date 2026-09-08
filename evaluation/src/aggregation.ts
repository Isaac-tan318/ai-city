// Group-utility aggregation rules, compared side by side.
//
// The engine currently aggregates with a plain mean (see `groupUtility` in
// convex/scoring.ts), justified there on the grounds that the hard-taboo zero
// already encodes "unacceptable to anyone", so taking a min on top of it would
// double-count. That is a defensible choice, but it is a choice, and the
// interesting question is not "what do four different rules score this option?"
// — it is "does the option that wins, and the regret that follows, actually
// change if you aggregate differently?" If every rule crowns the same option,
// the choice of rule is not worth arguing about on this data. If they disagree,
// the disagreement is the finding.
//
// Pure arithmetic over per-agent utilities that the Evaluator already computed.
// No LLM, no I/O, no re-scoring.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AggregationRule = 'utilitarian' | 'maxmin' | 'averageWithoutMisery' | 'nash';

export const AGGREGATION_RULES: AggregationRule[] = [
  'utilitarian',
  'maxmin',
  'averageWithoutMisery',
  'nash',
];

// Individual utilities are on the Evaluator's 0-100 scale, where 0 means either
// "completely dissatisfied" or "a hard constraint was violated".
export type OptionUtilities = {
  optionId: string;
  title: string;
  utilities: number[];
};

export type AggregationOptions = {
  // Below this, a participant counts as miserable and is excluded from the
  // average-without-misery mean. The framework notes this threshold is
  // necessarily arbitrary, so it is a parameter rather than a constant.
  miseryThreshold: number;
};

export const DEFAULT_AGGREGATION_OPTIONS: AggregationOptions = { miseryThreshold: 40 };

export function utilitarian(utilities: number[]): number {
  if (utilities.length === 0) return 0;
  return round2(utilities.reduce((a, b) => a + b, 0) / utilities.length);
}

export function maxmin(utilities: number[]): number {
  if (utilities.length === 0) return 0;
  return round2(Math.min(...utilities));
}

// The mean over everyone who is not miserable. Returns 0 when everybody is
// below the threshold: an option nobody can tolerate has no defensible average.
export function averageWithoutMisery(utilities: number[], threshold: number): number {
  const kept = utilities.filter((u) => u >= threshold);
  if (kept.length === 0) return 0;
  return round2(kept.reduce((a, b) => a + b, 0) / kept.length);
}

// Geometric mean. Deliberately NOT smoothed with an epsilon: a zero here means a
// hard constraint was violated for somebody, and Nash collapsing to 0 in that
// case is the property that makes it worth reporting alongside the mean. The
// report flags which options were zeroed this way rather than hiding it.
export function nash(utilities: number[]): number {
  if (utilities.length === 0) return 0;
  if (utilities.some((u) => u <= 0)) return 0;
  const logSum = utilities.reduce((acc, u) => acc + Math.log(u), 0);
  return round2(Math.exp(logSum / utilities.length));
}

export function aggregate(
  utilities: number[],
  rule: AggregationRule,
  opts: AggregationOptions = DEFAULT_AGGREGATION_OPTIONS,
): number {
  switch (rule) {
    case 'utilitarian':
      return utilitarian(utilities);
    case 'maxmin':
      return maxmin(utilities);
    case 'averageWithoutMisery':
      return averageWithoutMisery(utilities, opts.miseryThreshold);
    case 'nash':
      return nash(utilities);
  }
}

// Diagnostics reported beside the aggregation table rather than folded into it.
// The framework's assessment is explicit that combining several fairness terms
// into one weighted score partially double-counts the same concern.
export type Diagnostics = {
  mean: number;
  min: number;
  variance: number;
  zeroed: number;
};

export function diagnostics(utilities: number[]): Diagnostics {
  if (utilities.length === 0) return { mean: 0, min: 0, variance: 0, zeroed: 0 };
  const mean = utilities.reduce((a, b) => a + b, 0) / utilities.length;
  const variance = utilities.reduce((acc, u) => acc + (u - mean) ** 2, 0) / utilities.length;
  return {
    mean: round2(mean),
    min: round2(Math.min(...utilities)),
    variance: round2(variance),
    zeroed: utilities.filter((u) => u <= 0).length,
  };
}

export type RuleOutcome = {
  rule: AggregationRule;
  scores: { optionId: string; title: string; score: number }[];
  bestOptionId: string;
  bestOptionTitle: string;
  bestScore: number;
  selectedScore: number;
  // best - selected, on that rule's own scale. Not comparable across rules;
  // what IS comparable is whether it is zero.
  regret: number;
  optimal: boolean;
};

export type AggregationComparison = {
  scenarioId: string;
  scenarioName: string;
  selectedOptionId: string;
  outcomes: RuleOutcome[];
  // The heart of it: did every rule pick the same option?
  rulesAgree: boolean;
  // Options driven to zero by Nash because somebody scored 0. Reported so the
  // zero is read as a hard-constraint violation, not a scaling artefact.
  nashZeroed: string[];
  diagnostics: ({ optionId: string; title: string } & Diagnostics)[];
};

export function compareAggregations(
  input: {
    scenarioId: string;
    scenarioName: string;
    selectedOptionId: string;
    options: OptionUtilities[];
  },
  opts: AggregationOptions = DEFAULT_AGGREGATION_OPTIONS,
): AggregationComparison | undefined {
  if (input.options.length === 0) return undefined;

  const outcomes: RuleOutcome[] = AGGREGATION_RULES.map((rule) => {
    const scores = input.options.map((o) => ({
      optionId: o.optionId,
      title: o.title,
      score: aggregate(o.utilities, rule, opts),
    }));
    // Ties break on optionId so the comparison is deterministic across runs.
    const ranked = [...scores].sort((a, b) =>
      b.score === a.score ? a.optionId.localeCompare(b.optionId) : b.score - a.score,
    );
    const best = ranked[0];
    const selected = scores.find((s) => s.optionId === input.selectedOptionId);
    const selectedScore = selected?.score ?? 0;
    return {
      rule,
      scores,
      bestOptionId: best.optionId,
      bestOptionTitle: best.title,
      bestScore: best.score,
      selectedScore,
      regret: round2(Math.max(0, best.score - selectedScore)),
      optimal: best.optionId === input.selectedOptionId,
    };
  });

  return {
    scenarioId: input.scenarioId,
    scenarioName: input.scenarioName,
    selectedOptionId: input.selectedOptionId,
    outcomes,
    rulesAgree: new Set(outcomes.map((o) => o.bestOptionId)).size === 1,
    nashZeroed: input.options.filter((o) => nash(o.utilities) === 0).map((o) => o.optionId),
    diagnostics: input.options.map((o) => ({
      optionId: o.optionId,
      title: o.title,
      ...diagnostics(o.utilities),
    })),
  };
}

// Across many scenarios: how often does the choice of aggregation rule change
// which option should have won? A low number is the empirical case for leaving
// the engine's plain mean alone.
export function ruleDisagreementRate(comparisons: AggregationComparison[]): {
  disagreed: number;
  total: number;
  rate: number;
} {
  const total = comparisons.length;
  const disagreed = comparisons.filter((c) => !c.rulesAgree).length;
  return {
    disagreed,
    total,
    rate: total === 0 ? NaN : Math.round((disagreed / total) * 10000) / 10000,
  };
}
