import {
  DECISION_MARGIN_THRESHOLD,
  DECISION_OUTCOME_MAX_AFFINITY_DELTA,
  DECISION_TABOO_AFFINITY_PENALTY,
  DIMENSION_KEYS,
  DimensionFactors,
  OptionEstimate,
  SCORE_STABILITY_THRESHOLD,
  TopScoreSnapshot,
  UTILITY_WEIGHTS,
  affinityDeltaFromUtility,
  checkStoppingCriteria,
  computeRegret,
  groupUtility,
  individualUtility,
  snapFactor,
  snapFactors,
} from './scoring';

const factors = (value: number): DimensionFactors => ({
  essentialNeeds: value,
  preferenceMatch: value,
  costTimeBurden: value,
  fairness: value,
  socialComfort: value,
  relationshipImpact: value,
});

const estimate = (
  optionId: string,
  estimatedScore: number,
  overrides: Partial<OptionEstimate> = {},
): OptionEstimate => ({ optionId, estimatedScore, tabooRisk: false, ...overrides });

// A history entry that makes the leader look settled, so tests can isolate the
// criterion they actually care about.
const settled = (optionId: string, groupUtility: number): TopScoreSnapshot[] => [
  { optionId, groupUtility },
];

describe('UTILITY_WEIGHTS', () => {
  test('sums to 100 so a fully satisfied agent scores exactly 100', () => {
    const total = DIMENSION_KEYS.reduce((acc, key) => acc + UTILITY_WEIGHTS[key], 0);
    expect(total).toBe(100);
  });
});

describe('snapFactor', () => {
  test('passes through the allowed levels unchanged', () => {
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      expect(snapFactor(level)).toBe(level);
    }
  });

  test('snaps to the nearest allowed level', () => {
    expect(snapFactor(0.6)).toBe(0.5);
    expect(snapFactor(0.63)).toBe(0.75);
    expect(snapFactor(0.85)).toBe(0.75);
    expect(snapFactor(0.9)).toBe(1);
    expect(snapFactor(0.1)).toBe(0);
  });

  test('clamps out-of-range input', () => {
    expect(snapFactor(1.7)).toBe(1);
    expect(snapFactor(-3)).toBe(0);
    expect(snapFactor(42)).toBe(1);
  });

  test('treats non-finite input as 0 rather than propagating NaN', () => {
    expect(snapFactor(NaN)).toBe(0);
    expect(snapFactor(Infinity)).toBe(0);
    expect(snapFactor(-Infinity)).toBe(0);
    expect(snapFactor(undefined as unknown as number)).toBe(0);
  });

  test('snapFactors fills in every dimension, defaulting missing keys to 0', () => {
    expect(snapFactors({ essentialNeeds: 0.9, fairness: 0.4 })).toEqual({
      essentialNeeds: 1,
      preferenceMatch: 0,
      costTimeBurden: 0,
      fairness: 0.5,
      socialComfort: 0,
      relationshipImpact: 0,
    });
  });
});

describe('individualUtility', () => {
  test('all factors satisfied scores 100', () => {
    expect(individualUtility(factors(1), false)).toBe(100);
  });

  test('all factors unsatisfied scores 0', () => {
    expect(individualUtility(factors(0), false)).toBe(0);
  });

  test('applies the documented weights', () => {
    // Only essential needs met: 35 * 1.0.
    expect(
      individualUtility({ ...factors(0), essentialNeeds: 1 }, false),
    ).toBe(35);
    // Only relationship impact met: 5 * 1.0 — the lightest dimension.
    expect(
      individualUtility({ ...factors(0), relationshipImpact: 1 }, false),
    ).toBe(5);
    // Half marks across the board.
    expect(individualUtility(factors(0.5), false)).toBe(50);
  });

  test('a hard taboo zeroes an otherwise perfect score', () => {
    expect(individualUtility(factors(1), true)).toBe(0);
  });

  test('snaps factors before weighting', () => {
    // 0.6 snaps to 0.5, so this must equal the all-0.5 case rather than 60.
    expect(individualUtility(factors(0.6), false)).toBe(50);
  });

  test('missing dimensions count as 0 instead of throwing', () => {
    expect(individualUtility({ essentialNeeds: 1 }, false)).toBe(35);
  });
});

describe('groupUtility', () => {
  test('averages the individual utilities', () => {
    expect(groupUtility([100, 50, 0])).toBe(50);
  });

  test('a single taboo violation drags the group mean down', () => {
    expect(groupUtility([100, 100, 0])).toBeCloseTo(66.67, 2);
  });

  test('returns 0 for an empty group', () => {
    expect(groupUtility([])).toBe(0);
  });
});

describe('checkStoppingCriteria', () => {
  test('decides when all three criteria hold', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 80), estimate('b', 60)],
      settled('a', 79),
    );
    expect(check.canDecide).toBe(true);
    expect(check.blockedBy).toEqual([]);
    expect(check.top?.optionId).toBe('a');
    expect(check.runnerUp?.optionId).toBe('b');
    expect(check.margin).toBe(20);
    expect(check.drift).toBe(1);
  });

  test('ranks by estimated score regardless of input order', () => {
    const check = checkStoppingCriteria(
      [estimate('low', 40), estimate('high', 90), estimate('mid', 60)],
      settled('high', 90),
    );
    expect(check.top?.optionId).toBe('high');
    expect(check.runnerUp?.optionId).toBe('mid');
  });

  test('blocks on taboo risk even when the margin is huge and the score is stable', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 90, { tabooRisk: true }), estimate('b', 20)],
      settled('a', 90),
    );
    expect(check.canDecide).toBe(false);
    expect(check.blockedBy).toEqual(['taboo']);
  });

  test('blocks on taboo risk when a participant is named, even if the flag is false', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 90, { riskyForPlayerIds: ['p:3'] }), estimate('b', 20)],
      settled('a', 90),
    );
    expect(check.canDecide).toBe(false);
    expect(check.blockedBy).toEqual(['taboo']);
  });

  test('blocks when the margin is under the threshold', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 70), estimate('b', 64)],
      settled('a', 70),
    );
    expect(check.canDecide).toBe(false);
    expect(check.blockedBy).toEqual(['margin']);
    expect(check.margin).toBe(6);
  });

  test('a margin exactly at the threshold passes (>= 10.0)', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 70), estimate('b', 60)],
      settled('a', 70),
    );
    expect(check.margin).toBe(DECISION_MARGIN_THRESHOLD);
    expect(check.blockedBy).not.toContain('margin');
  });

  test('blocks on the first turn because there is no prior estimate', () => {
    const check = checkStoppingCriteria([estimate('a', 90), estimate('b', 20)], []);
    expect(check.canDecide).toBe(false);
    expect(check.blockedBy).toEqual(['stability']);
    expect(check.drift).toBeUndefined();
  });

  test('blocks when the leading estimate is still moving', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 90), estimate('b', 20)],
      settled('a', 80),
    );
    expect(check.canDecide).toBe(false);
    expect(check.blockedBy).toEqual(['stability']);
    expect(check.drift).toBe(10);
  });

  test('a drift exactly at the threshold blocks (< 3.0 is strict)', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 90), estimate('b', 20)],
      settled('a', 90 - SCORE_STABILITY_THRESHOLD),
    );
    expect(check.blockedBy).toContain('stability');
  });

  test('a changed front-runner is unstable even when the two scores are close', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 90), estimate('b', 20)],
      settled('b', 89),
    );
    expect(check.canDecide).toBe(false);
    expect(check.leaderChanged).toBe(true);
    expect(check.drift).toBeUndefined();
    expect(check.blockedBy).toEqual(['stability']);
  });

  test('compares against the most recent turn only', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 80), estimate('b', 60)],
      [
        { optionId: 'a', groupUtility: 10 },
        { optionId: 'a', groupUtility: 79 },
      ],
    );
    expect(check.drift).toBe(1);
    expect(check.canDecide).toBe(true);
  });

  test('reports every failing criterion at once', () => {
    const check = checkStoppingCriteria(
      [estimate('a', 70, { tabooRisk: true }), estimate('b', 68)],
      [],
    );
    expect(check.blockedBy).toEqual(['taboo', 'margin', 'stability']);
  });

  test('a lone candidate has no margin to clear', () => {
    const check = checkStoppingCriteria([estimate('a', 40)], settled('a', 41));
    expect(check.margin).toBeUndefined();
    expect(check.runnerUp).toBeUndefined();
    expect(check.canDecide).toBe(true);
  });

  test('no scored options at all is its own blocker', () => {
    const check = checkStoppingCriteria([], []);
    expect(check.canDecide).toBe(false);
    expect(check.blockedBy).toEqual(['insufficient-options']);
    expect(check.top).toBeUndefined();
  });

  test('ignores estimates with non-finite scores', () => {
    const check = checkStoppingCriteria(
      [estimate('broken', NaN), estimate('a', 80), estimate('b', 60)],
      settled('a', 80),
    );
    expect(check.top?.optionId).toBe('a');
    expect(check.canDecide).toBe(true);
  });
});

describe('affinityDeltaFromUtility', () => {
  test('a violated hard taboo is a distinct, steeper grievance', () => {
    expect(affinityDeltaFromUtility(100, true)).toBe(-DECISION_TABOO_AFFINITY_PENALTY);
    expect(affinityDeltaFromUtility(0, true)).toBe(-DECISION_TABOO_AFFINITY_PENALTY);
  });

  test('a well-served agent warms to the decider', () => {
    expect(affinityDeltaFromUtility(100, false)).toBe(DECISION_OUTCOME_MAX_AFFINITY_DELTA);
  });

  test('a poorly served agent cools toward the decider', () => {
    expect(affinityDeltaFromUtility(0, false)).toBe(-DECISION_OUTCOME_MAX_AFFINITY_DELTA);
  });

  test('a middling outcome barely moves the needle', () => {
    expect(affinityDeltaFromUtility(55, false)).toBe(0);
  });

  test('stays within bounds across the whole utility range', () => {
    for (let u = 0; u <= 100; u += 1) {
      const delta = affinityDeltaFromUtility(u, false);
      expect(delta).toBeGreaterThanOrEqual(-DECISION_OUTCOME_MAX_AFFINITY_DELTA);
      expect(delta).toBeLessThanOrEqual(DECISION_OUTCOME_MAX_AFFINITY_DELTA);
      expect(Number.isInteger(delta)).toBe(true);
    }
  });

  test('is monotonic in utility', () => {
    let previous = -Infinity;
    for (let u = 0; u <= 100; u += 5) {
      const delta = affinityDeltaFromUtility(u, false);
      expect(delta).toBeGreaterThanOrEqual(previous);
      previous = delta;
    }
  });
});

describe('computeRegret', () => {
  const scores = [
    { optionId: 'a', title: 'Hawker centre', groupUtility: 82 },
    { optionId: 'b', title: 'New café', groupUtility: 61 },
    { optionId: 'c', title: 'Zi char', groupUtility: 74 },
  ];

  test('reports how much better the best option would have been', () => {
    const result = computeRegret(scores, 'b');
    expect(result?.best.optionId).toBe('a');
    expect(result?.selected.optionId).toBe('b');
    expect(result?.regret).toBe(21);
  });

  test('picking the best option is zero regret', () => {
    expect(computeRegret(scores, 'a')?.regret).toBe(0);
  });

  test('regret is never negative', () => {
    const result = computeRegret([{ optionId: 'only', title: 'Only', groupUtility: 30 }], 'only');
    expect(result?.regret).toBe(0);
  });

  test('returns undefined when the selected option was never scored', () => {
    expect(computeRegret(scores, 'missing')).toBeUndefined();
    expect(computeRegret([], 'a')).toBeUndefined();
  });
});
