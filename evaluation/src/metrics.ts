// Every rate the evaluation framework defines, and nothing else.
//
// Deliberately dependency-free — no LLM, no I/O, no zod — exactly like
// convex/scoring.ts, so it can be unit-tested directly and so the arithmetic is
// never done by a language model. The judges in ../judges supply categorical
// verdicts (consistent / contradicts / unclear, disclosed / not, objected / not)
// and this file turns counts into rates. An LLM asked to compute its own rate
// will return a number that disagrees with the verdicts it just gave.
//
// Every rate carries a Wilson 95% interval. That is not decoration: most of
// these denominators are small (a handful of hard-constraint opportunities per
// character), and a bare "0.67" from 2/3 invites a conclusion the data cannot
// support.

// --- Rates and intervals ------------------------------------------------------

export type Rate = {
  numerator: number;
  denominator: number;
  // NaN when the denominator is 0 — an undefined rate, not a zero one. Callers
  // must render it as "n/a" rather than 0%.
  rate: number;
  // Wilson score interval, 95%. Both NaN when the denominator is 0.
  lo: number;
  hi: number;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Wilson score interval. Preferred over the normal approximation because it
// stays inside [0,1] and stays sane at 0/n and n/n, which is exactly where these
// metrics live (a desired HCCR is 0, a desired URR is 0).
export function wilson(
  numerator: number,
  denominator: number,
  z = 1.96,
): { lo: number; hi: number } {
  if (denominator <= 0) return { lo: NaN, hi: NaN };
  const p = numerator / denominator;
  const z2 = z * z;
  const denom = 1 + z2 / denominator;
  const centre = p + z2 / (2 * denominator);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator);
  return {
    lo: round4(Math.max(0, (centre - spread) / denom)),
    hi: round4(Math.min(1, (centre + spread) / denom)),
  };
}

export function rate(numerator: number, denominator: number): Rate {
  const n = Math.max(0, numerator);
  const d = Math.max(0, denominator);
  const { lo, hi } = wilson(n, d);
  return { numerator: n, denominator: d, rate: d === 0 ? NaN : round4(n / d), lo, hi };
}

// --- Component 1: Persona Fidelity -------------------------------------------

// One graded opportunity. `kind` decides which denominator it lands in: a
// hard-constraint opportunity counts toward HCCR, everything else toward PCR.
export type FidelityVerdict = 'consistent' | 'contradicts' | 'unclear';

export type GradedOpportunity = {
  characterName: string;
  conversationId: string;
  kind: 'persona' | 'hardConstraint';
  verdict: FidelityVerdict;
};

export type PersonaFidelityResult = {
  // PCR = profile-consistent responses / relevant behavioural opportunities.
  pcr: Rate;
  // HCCR = responses contradicting confirmed hard constraints / hard-constraint
  // opportunities. The desired value is 0.
  hccr: Rate;
  // Opportunities the judge would not call either way. Excluded from both rates
  // above rather than silently scored as passes, and reported so a high
  // abstention rate is visible as the confound it is.
  abstention: Rate;
  byCharacter: { name: string; pcr: Rate; hccr: Rate }[];
};

export function personaFidelity(graded: GradedOpportunity[]): PersonaFidelityResult {
  const decided = graded.filter((g) => g.verdict !== 'unclear');
  const hard = decided.filter((g) => g.kind === 'hardConstraint');

  const names = [...new Set(graded.map((g) => g.characterName))].sort();
  const byCharacter = names.map((name) => {
    const mine = decided.filter((g) => g.characterName === name);
    const myHard = mine.filter((g) => g.kind === 'hardConstraint');
    return {
      name,
      pcr: rate(mine.filter((g) => g.verdict === 'consistent').length, mine.length),
      hccr: rate(myHard.filter((g) => g.verdict === 'contradicts').length, myHard.length),
    };
  });

  return {
    pcr: rate(decided.filter((g) => g.verdict === 'consistent').length, decided.length),
    hccr: rate(hard.filter((g) => g.verdict === 'contradicts').length, hard.length),
    abstention: rate(graded.filter((g) => g.verdict === 'unclear').length, graded.length),
    byCharacter,
  };
}

// --- Component 2: Theory-Anchored Behavioural Plausibility -------------------

// The literature predicts a difference between groups, not a value for any one
// NPC. So a test compares the rate of the observable behaviour in the high-
// attribute group against the low-attribute group.
export type ExpectedDirection = 'high<low' | 'high>low';

export type DirectionalTest = {
  dimensionId: string;
  observable: string;
  expected: ExpectedDirection;
  high: { n: number; hits: number };
  low: { n: number; hits: number };
};

export type DirectionalTestResult = DirectionalTest & {
  highRate: number;
  lowRate: number;
  // undefined when either group is empty, or when the two rates tie — neither
  // supports nor contradicts the prediction, so it is excluded from DCR rather
  // than scored as a failure.
  follows?: boolean;
  inconclusiveReason?: 'empty-group' | 'tie';
};

export function scoreDirectionalTest(test: DirectionalTest): DirectionalTestResult {
  const highRate = test.high.n === 0 ? NaN : round4(test.high.hits / test.high.n);
  const lowRate = test.low.n === 0 ? NaN : round4(test.low.hits / test.low.n);
  if (test.high.n === 0 || test.low.n === 0) {
    return { ...test, highRate, lowRate, inconclusiveReason: 'empty-group' };
  }
  if (highRate === lowRate) {
    return { ...test, highRate, lowRate, inconclusiveReason: 'tie' };
  }
  const follows = test.expected === 'high<low' ? highRate < lowRate : highRate > lowRate;
  return { ...test, highRate, lowRate, follows };
}

export type PlausibilityResult = {
  // DCR = tests that follow the expected behavioural direction / total tests.
  // The framework is explicit that 100% is not the goal; individual NPCs may
  // legitimately depart from the population tendency.
  dcr: Rate;
  tests: DirectionalTestResult[];
  inconclusive: DirectionalTestResult[];
};

export function directionalConsistency(tests: DirectionalTest[]): PlausibilityResult {
  const scored = tests.map(scoreDirectionalTest);
  const conclusive = scored.filter((t) => t.follows !== undefined);
  return {
    dcr: rate(conclusive.filter((t) => t.follows).length, conclusive.length),
    tests: conclusive,
    inconclusive: scored.filter((t) => t.follows === undefined),
  };
}

// --- Component 3: Population Behavioural Diversity ---------------------------

export type OptionCoverageResult = {
  coverage: Rate;
  feasibleOptionIds: string[];
  selectedOptionIds: string[];
  neverSelected: string[];
  // How lopsided the selections are: the share taken by the single most-picked
  // option. Coverage of 1.0 with 95% of picks on one option is convergence
  // wearing a coverage number as a disguise, so both are reported.
  topOptionShare: number;
};

export function optionCoverage(
  feasibleOptionIds: string[],
  selections: string[],
): OptionCoverageResult {
  const feasible = [...new Set(feasibleOptionIds)];
  const feasibleSet = new Set(feasible);
  const valid = selections.filter((s) => feasibleSet.has(s));
  const chosen = [...new Set(valid)];
  const counts = new Map<string, number>();
  for (const s of valid) counts.set(s, (counts.get(s) ?? 0) + 1);
  const top = valid.length === 0 ? 0 : Math.max(...counts.values());
  return {
    coverage: rate(chosen.length, feasible.length),
    feasibleOptionIds: feasible,
    selectedOptionIds: chosen,
    neverSelected: feasible.filter((o) => !chosen.includes(o)),
    topOptionShare: valid.length === 0 ? NaN : round4(top / valid.length),
  };
}

// One NPC's choice in one probe, with everything the eligibility filter needs.
export type ChoiceRecord = {
  scenarioId: string;
  characterName: string;
  // The background being evaluated — the axis on which NPCs count as "the same".
  background: string;
  optionIds: string[];
  chosenOptionId: string;
  // Options this NPC could actually take: a hard constraint removes an option
  // from their feasible set entirely.
  feasibleOptionIds: string[];
  // True when a hard constraint leaves exactly one option, or when a profile
  // field names one of the candidates outright. Either way the choice was not
  // free, so the pair must not count toward WGDR.
  choiceDetermined: boolean;
};

export type WithinGroupResult = {
  // WGDR = eligible same-background pairs making different choices / all
  // eligible same-background pairs.
  wgdr: Rate;
  eligiblePairs: number;
  excludedPairs: number;
  // Why pairs were dropped, so a suspiciously small denominator is explicable.
  exclusions: Record<string, number>;
  byBackground: { background: string; scenarioId: string; wgdr: Rate }[];
};

export function withinGroupDiversity(records: ChoiceRecord[]): WithinGroupResult {
  const exclusions: Record<string, number> = {
    'different-option-set': 0,
    'choice-determined': 0,
    'single-feasible-option': 0,
  };
  let eligible = 0;
  let differing = 0;
  const perGroup = new Map<
    string,
    { eligible: number; differing: number; background: string; scenarioId: string }
  >();

  // Group first so we never compare across scenarios or backgrounds, then form
  // every unordered pair inside a group.
  const groups = new Map<string, ChoiceRecord[]>();
  for (const r of records) {
    const key = `${r.scenarioId}::${r.background}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  for (const [key, list] of groups) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!sameOptionSet(a.optionIds, b.optionIds)) {
          exclusions['different-option-set']++;
          continue;
        }
        if (a.choiceDetermined || b.choiceDetermined) {
          exclusions['choice-determined']++;
          continue;
        }
        if (a.feasibleOptionIds.length < 2 || b.feasibleOptionIds.length < 2) {
          exclusions['single-feasible-option']++;
          continue;
        }
        eligible++;
        const differs = a.chosenOptionId !== b.chosenOptionId;
        if (differs) differing++;
        const g = perGroup.get(key) ?? {
          eligible: 0,
          differing: 0,
          background: a.background,
          scenarioId: a.scenarioId,
        };
        g.eligible++;
        if (differs) g.differing++;
        perGroup.set(key, g);
      }
    }
  }

  return {
    wgdr: rate(differing, eligible),
    eligiblePairs: eligible,
    excludedPairs: Object.values(exclusions).reduce((a, b) => a + b, 0),
    exclusions,
    byBackground: [...perGroup.values()].map((g) => ({
      background: g.background,
      scenarioId: g.scenarioId,
      wgdr: rate(g.differing, g.eligible),
    })),
  };
}

function sameOptionSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

// --- Component 4: Information-Disclosure Plausibility ------------------------

export type DisclosureRecord = {
  characterName: string;
  conversationId: string;
  constraint: string;
  // Did the constraint become relevant at all in this conversation?
  opportunity: boolean;
  // Was it actually stated, at any point?
  disclosed: boolean;
};

// One conversation x participant. `prematureDisclosure` is true when private
// information was volunteered in their opening turns without being asked and
// without the conversation having given them a reason to raise it.
export type InteractionRecord = {
  characterName: string;
  conversationId: string;
  prematureDisclosure: boolean;
};

export type DisclosureResult = {
  // Relevant Disclosure Rate: high is desirable — a constraint that matters
  // should not stay hidden forever.
  relevantDisclosure: Rate;
  // Premature Full-Disclosure Rate: low is desirable — an NPC should not open
  // every conversation by reciting its private constraints.
  prematureDisclosure: Rate;
  byCharacter: { name: string; relevantDisclosure: Rate; prematureDisclosure: Rate }[];
};

export function disclosurePlausibility(
  disclosures: DisclosureRecord[],
  interactions: InteractionRecord[],
): DisclosureResult {
  const opportunities = disclosures.filter((d) => d.opportunity);
  const names = [
    ...new Set([
      ...disclosures.map((d) => d.characterName),
      ...interactions.map((i) => i.characterName),
    ]),
  ].sort();
  return {
    relevantDisclosure: rate(opportunities.filter((d) => d.disclosed).length, opportunities.length),
    prematureDisclosure: rate(
      interactions.filter((i) => i.prematureDisclosure).length,
      interactions.length,
    ),
    byCharacter: names.map((name) => {
      const myOpps = opportunities.filter((d) => d.characterName === name);
      const myInts = interactions.filter((i) => i.characterName === name);
      return {
        name,
        relevantDisclosure: rate(myOpps.filter((d) => d.disclosed).length, myOpps.length),
        prematureDisclosure: rate(
          myInts.filter((i) => i.prematureDisclosure).length,
          myInts.length,
        ),
      };
    }),
  };
}

// --- Component 5: Longitudinal and Dynamic-State Validity --------------------

// What the Short-Term State Update Rules say should happen to one gauge for one
// observed event. 'toward-baseline' is the decay case; 'unconstrained' marks a
// legitimate manual override, which is excluded from the accuracy denominator.
export type ExpectedMove = 'up' | 'down' | 'toward-baseline' | 'unconstrained';

export type StateTransition = {
  characterName: string;
  at: number;
  cause: string;
  component: string;
  valueBefore: number;
  valueAfter: number;
  baseline: number;
  expected: ExpectedMove;
  // Set when the transition crosses a scenario boundary — the framework asks
  // specifically about continuity *across* scenarios.
  crossScenario: boolean;
};

export type TransitionVerdict =
  | 'correct'
  | 'wrong-direction'
  | 'no-movement'
  | 'clamped'
  | 'unconstrained';

export const GAUGE_MIN = 0;
export const GAUGE_MAX = 100;

export function classifyTransition(t: StateTransition): TransitionVerdict {
  if (t.expected === 'unconstrained') return 'unconstrained';
  const delta = t.valueAfter - t.valueBefore;

  if (t.expected === 'toward-baseline') {
    const gapBefore = Math.abs(t.valueBefore - t.baseline);
    const gapAfter = Math.abs(t.valueAfter - t.baseline);
    // Already resting at baseline: staying put is the correct behaviour.
    if (gapBefore === 0) return gapAfter === 0 ? 'correct' : 'wrong-direction';
    if (gapAfter < gapBefore) return 'correct';
    if (gapAfter === gapBefore) return 'no-movement';
    return 'wrong-direction';
  }

  // A gauge pinned at its ceiling cannot rise. That is the clamp doing its job,
  // not the update rule failing, so it is excluded rather than counted wrong.
  if (t.expected === 'up') {
    if (delta > 0) return 'correct';
    if (t.valueBefore >= GAUGE_MAX) return 'clamped';
    return delta === 0 ? 'no-movement' : 'wrong-direction';
  }
  if (delta < 0) return 'correct';
  if (t.valueBefore <= GAUGE_MIN) return 'clamped';
  return delta === 0 ? 'no-movement' : 'wrong-direction';
}

// A "reset" is a large jump back toward baseline. Some causes legitimately do
// that (the daily decay, a meal, a manual edit from the agents panel); any other
// cause producing one means state is being silently discarded between scenarios,
// which is what Unexpected Reset Rate is for. The desired value is 0.
export function isReset(t: StateTransition, threshold: number): boolean {
  const gapBefore = Math.abs(t.valueBefore - t.baseline);
  const gapAfter = Math.abs(t.valueAfter - t.baseline);
  return gapAfter < gapBefore && Math.abs(t.valueAfter - t.valueBefore) > threshold;
}

export type DynamicStateResult = {
  // State Transition Accuracy: updates with the correct direction / all
  // expected updates.
  stateTransitionAccuracy: Rate;
  // Unexpected Reset Rate over cross-scenario transitions. Desired: 0.
  unexpectedResetRate: Rate;
  verdicts: Record<TransitionVerdict, number>;
  unexpectedResets: StateTransition[];
};

export function dynamicStateValidity(
  transitions: StateTransition[],
  opts: { resetThreshold: number; validResetCauses: string[] },
): DynamicStateResult {
  const verdicts: Record<TransitionVerdict, number> = {
    correct: 0,
    'wrong-direction': 0,
    'no-movement': 0,
    clamped: 0,
    unconstrained: 0,
  };
  for (const t of transitions) verdicts[classifyTransition(t)]++;

  // Only transitions with a stated expectation and a real chance to move count.
  const scored = verdicts.correct + verdicts['wrong-direction'] + verdicts['no-movement'];

  const valid = new Set(opts.validResetCauses);
  const crossScenario = transitions.filter((t) => t.crossScenario);
  const unexpectedResets = crossScenario.filter(
    (t) => isReset(t, opts.resetThreshold) && !valid.has(t.cause),
  );

  return {
    stateTransitionAccuracy: rate(verdicts.correct, scored),
    unexpectedResetRate: rate(unexpectedResets.length, crossScenario.length),
    verdicts,
    unexpectedResets,
  };
}

// --- Formatting ---------------------------------------------------------------

// Render a rate for a terminal table. An undefined rate prints as "n/a (n=0)"
// rather than "0.0%", because those mean very different things here.
export function formatRate(r: Rate): string {
  if (r.denominator === 0) return 'n/a (n=0)';
  const pct = (r.rate * 100).toFixed(1).padStart(5);
  return `${pct}%  [${(r.lo * 100).toFixed(0)}-${(r.hi * 100).toFixed(0)}]  ${r.numerator}/${r.denominator}`;
}
