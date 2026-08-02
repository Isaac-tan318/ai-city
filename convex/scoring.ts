// Pure decision-utility math for the Decider-Focal-Evaluator engine.
//
// Deliberately dependency-free (no Convex imports, no LLM, no I/O) so it can be
// unit-tested directly and reused from both the engine and React. Every number
// that reaches the database goes through this file: the LLM supplies judgements
// (dimension factors, taboo flags, belief estimates) and TypeScript does all the
// arithmetic. An LLM that is asked to add up its own weighted score will happily
// return a total that doesn't match its own factors.

// --- Individual utility ------------------------------------------------------

// The 6-dimension weighting. Sums to 100, so a perfectly satisfied agent with no
// taboo violation scores exactly 100 and the group mean is directly comparable.
export const UTILITY_WEIGHTS = {
  essentialNeeds: 35,
  preferenceMatch: 20,
  costTimeBurden: 15,
  fairness: 15,
  socialComfort: 10,
  relationshipImpact: 5,
} as const;

export type DimensionKey = keyof typeof UTILITY_WEIGHTS;
export type DimensionFactors = Record<DimensionKey, number>;

export const DIMENSION_KEYS = Object.keys(UTILITY_WEIGHTS) as DimensionKey[];

// The only factor values the rubric allows:
//   1.0  fully satisfied / high match / no burden
//   0.75 basically satisfied / minor inconvenience
//   0.5  moderate compromise / medium burden
//   0.25 barely feasible / heavy burden
//   0.0  unfeasible / completely dissatisfied
export const FACTOR_LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Clamp to [0, 1] and snap to the nearest allowed level. LLMs routinely return
// 0.6 or 0.85 no matter how firmly the rubric is stated, and unsnapped factors
// would make two evaluations of the same situation incomparable. Non-finite
// input (missing key, null, NaN) snaps to 0 — the conservative direction.
export function snapFactor(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const clamped = Math.min(1, Math.max(0, raw));
  return Math.round(clamped * 4) / 4;
}

export function snapFactors(raw: Partial<Record<DimensionKey, number>>): DimensionFactors {
  const snapped = {} as DimensionFactors;
  for (const key of DIMENSION_KEYS) {
    snapped[key] = snapFactor(raw[key] as number);
  }
  return snapped;
}

// U_i(x). A hard taboo (religious restriction, medical/allergy constraint, legal
// rule) is absolute: it zeroes the score regardless of how well every other
// dimension scores. That's the whole point of the "hard" in hard taboo — an
// option that serves someone pork is not redeemed by being cheap and nearby.
export function individualUtility(
  factors: Partial<Record<DimensionKey, number>>,
  hardTabooViolated: boolean,
): number {
  if (hardTabooViolated) return 0;
  let total = 0;
  for (const key of DIMENSION_KEYS) {
    total += UTILITY_WEIGHTS[key] * snapFactor(factors[key] as number);
  }
  return round2(total);
}

// U_group(x) = mean of the individual utilities. A plain mean, not a min: the
// taboo zero already encodes "unacceptable to anyone", so averaging on top of it
// would double-count. An empty group scores 0.
export function groupUtility(perAgentUtilities: number[]): number {
  if (perAgentUtilities.length === 0) return 0;
  const sum = perAgentUtilities.reduce((acc, u) => acc + (Number.isFinite(u) ? u : 0), 0);
  return round2(sum / perAgentUtilities.length);
}

// --- Focal agent stopping criteria -------------------------------------------

export const DECISION_MARGIN_THRESHOLD = 10.0;
export const SCORE_STABILITY_THRESHOLD = 3.0;

// The focal agent's *belief* about one option — an estimate under incomplete
// information, not a ground truth score. `riskyForPlayerIds` names the people it
// suspects may have an undisclosed hard constraint against this option; a
// non-empty list means some estimated U_i could be 0.
export type OptionEstimate = {
  optionId: string;
  estimatedScore: number;
  tabooRisk: boolean;
  riskyForPlayerIds?: string[];
};

// One completed focal turn: which option led, and at what estimated group
// utility. Stored per scenario so the stability criterion can look back a turn.
export type TopScoreSnapshot = {
  optionId: string;
  groupUtility: number;
};

export type BlockingReason = 'insufficient-options' | 'taboo' | 'margin' | 'stability';

export type StoppingCheck = {
  canDecide: boolean;
  top?: OptionEstimate;
  runnerUp?: OptionEstimate;
  // Û_group(x*) − Û_group(x⁽²⁾). Undefined when there is no second option.
  margin?: number;
  // |Û⁽ᵗ⁾(x*) − Û⁽ᵗ⁻¹⁾(x*)|. Undefined on the first turn, or when the leading
  // option changed since the last turn (the two scores aren't comparable).
  drift?: number;
  // True when the leader changed since the previous turn — reported separately so
  // the UI can say "still changing its mind" rather than a bare stability number.
  leaderChanged: boolean;
  blockedBy: BlockingReason[];
};

// The authoritative ASK_QUESTION -> DECIDE gate. The LLM proposes an action, but
// this function decides, so the criteria are actually enforced rather than being
// a description of what the model was asked to do.
//
// Note that on the very first focal turn the stability criterion is unmet by
// construction (there is no t−1 to compare against), so the focal agent always
// asks at least one question before it may commit. That is intended: a decision
// made before anyone has been asked anything isn't a decision under incomplete
// information, it's a guess.
export function checkStoppingCriteria(
  estimates: OptionEstimate[],
  topScoreHistory: TopScoreSnapshot[],
): StoppingCheck {
  const ranked = estimates
    .filter((e) => Number.isFinite(e.estimatedScore))
    .sort((a, b) => b.estimatedScore - a.estimatedScore);

  const top = ranked[0];
  if (!top) {
    return { canDecide: false, leaderChanged: false, blockedBy: ['insufficient-options'] };
  }
  const runnerUp = ranked[1];
  const blockedBy: BlockingReason[] = [];

  // 1. Taboo safety: Û_i(x*) > 0 for every participant i.
  if (top.tabooRisk || (top.riskyForPlayerIds?.length ?? 0) > 0) {
    blockedBy.push('taboo');
  }

  // 2. Decision margin: the leader must be a clear winner, not a coin flip. With
  //    a single candidate there is nothing to be uncertain between, so it passes.
  const margin = runnerUp ? round2(top.estimatedScore - runnerUp.estimatedScore) : undefined;
  if (margin !== undefined && margin < DECISION_MARGIN_THRESHOLD) {
    blockedBy.push('margin');
  }

  // 3. Score stability: the leader's estimate must have settled. A changed leader
  //    is by definition unstable, whatever the two scores happen to be.
  const previous = topScoreHistory.length ? topScoreHistory[topScoreHistory.length - 1] : undefined;
  const leaderChanged = previous !== undefined && previous.optionId !== top.optionId;
  const drift =
    previous !== undefined && !leaderChanged
      ? round2(Math.abs(top.estimatedScore - previous.groupUtility))
      : undefined;
  if (drift === undefined || drift >= SCORE_STABILITY_THRESHOLD) {
    blockedBy.push('stability');
  }

  return { canDecide: blockedBy.length === 0, top, runnerUp, margin, drift, leaderChanged, blockedBy };
}

// Human-readable rendering of why the focal agent can't commit yet, for the
// deliberation panel and the dry-run logs.
export function describeBlockers(check: StoppingCheck): string {
  if (check.canDecide) return 'all criteria met';
  return check.blockedBy
    .map((reason) => {
      switch (reason) {
        case 'insufficient-options':
          return 'no scored options yet';
        case 'taboo':
          return `possible hard constraint (${check.top?.riskyForPlayerIds?.length ?? 0} at risk)`;
        case 'margin':
          return `margin ${check.margin?.toFixed(1) ?? '?'} < ${DECISION_MARGIN_THRESHOLD.toFixed(1)}`;
        case 'stability':
          if (check.leaderChanged) return 'front-runner changed';
          if (check.drift === undefined) return 'no prior estimate yet';
          return `drift ${check.drift.toFixed(1)} ≥ ${SCORE_STABILITY_THRESHOLD.toFixed(1)}`;
      }
    })
    .join(' · ');
}

// --- Evaluator feedback into the simulation ----------------------------------

// How far an evaluated outcome may move an agent's affinity toward whoever made
// the call. Kept small: one dinner going badly shouldn't undo a friendship, but
// repeatedly being the person whose constraints get ignored should show up.
export const DECISION_OUTCOME_MAX_AFFINITY_DELTA = 5;
export const DECISION_TABOO_AFFINITY_PENALTY = 8;

// Neutral point. An agent who scored ~55 on the group's choice feels neither
// served nor slighted by it.
const AFFINITY_NEUTRAL_UTILITY = 55;

// Maps "how well did the group's choice serve me" to a change in how I feel about
// the person who made that choice. Having a hard constraint overridden is a
// distinct grievance, not just a low score, so it gets its own steeper penalty.
export function affinityDeltaFromUtility(utility: number, hardTabooViolated: boolean): number {
  if (hardTabooViolated) return -DECISION_TABOO_AFFINITY_PENALTY;
  if (!Number.isFinite(utility)) return 0;
  const raw = (utility - AFFINITY_NEUTRAL_UTILITY) / 9;
  const clamped = Math.min(
    DECISION_OUTCOME_MAX_AFFINITY_DELTA,
    Math.max(-DECISION_OUTCOME_MAX_AFFINITY_DELTA, raw),
  );
  return Math.round(clamped);
}

// --- Regret ------------------------------------------------------------------

export type OptionScore = {
  optionId: string;
  title: string;
  groupUtility: number;
};

// How much better the group could have done. `selectedOptionId` must be present
// in `optionScores`; returns undefined otherwise so the caller can decline to
// write a misleading evaluation row rather than silently reporting 0 regret.
export function computeRegret(
  optionScores: OptionScore[],
  selectedOptionId: string,
): { best: OptionScore; selected: OptionScore; regret: number } | undefined {
  const selected = optionScores.find((o) => o.optionId === selectedOptionId);
  if (!selected || optionScores.length === 0) return undefined;
  const best = optionScores.reduce((a, b) => (b.groupUtility > a.groupUtility ? b : a));
  return { best, selected, regret: round2(Math.max(0, best.groupUtility - selected.groupUtility)) };
}
