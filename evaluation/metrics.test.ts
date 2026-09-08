import {
  ChoiceRecord,
  DirectionalTest,
  GradedOpportunity,
  StateTransition,
  classifyTransition,
  directionalConsistency,
  disclosurePlausibility,
  dynamicStateValidity,
  isReset,
  optionCoverage,
  personaFidelity,
  rate,
  scoreDirectionalTest,
  wilson,
  withinGroupDiversity,
} from './src/metrics';

describe('rate and Wilson intervals', () => {
  test('an empty denominator gives an undefined rate, not zero', () => {
    const r = rate(0, 0);
    expect(r.rate).toBeNaN();
    expect(r.lo).toBeNaN();
    expect(r.hi).toBeNaN();
  });

  test('the interval brackets the point estimate and stays inside [0,1]', () => {
    const r = rate(2, 3);
    expect(r.rate).toBeCloseTo(0.6667, 3);
    expect(r.lo).toBeGreaterThanOrEqual(0);
    expect(r.hi).toBeLessThanOrEqual(1);
    expect(r.lo).toBeLessThan(r.rate);
    expect(r.hi).toBeGreaterThan(r.rate);
  });

  test('a perfect score still carries uncertainty at small n', () => {
    const small = wilson(3, 3);
    const large = wilson(300, 300);
    expect(small.lo).toBeLessThan(large.lo);
    expect(small.hi).toBe(1);
  });

  test('0/n does not collapse the interval to a point', () => {
    const r = wilson(0, 10);
    expect(r.lo).toBe(0);
    expect(r.hi).toBeGreaterThan(0);
  });

  test('more evidence narrows the interval', () => {
    const few = wilson(5, 10);
    const many = wilson(50, 100);
    expect(many.hi - many.lo).toBeLessThan(few.hi - few.lo);
  });
});

describe('Component 1 — persona fidelity', () => {
  const opp = (
    name: string,
    kind: 'persona' | 'hardConstraint',
    verdict: 'consistent' | 'contradicts' | 'unclear',
  ): GradedOpportunity => ({ characterName: name, conversationId: 'c1', kind, verdict });

  test('unclear verdicts leave both numerator and denominator', () => {
    const result = personaFidelity([
      opp('Rahman', 'persona', 'consistent'),
      opp('Rahman', 'persona', 'contradicts'),
      opp('Rahman', 'persona', 'unclear'),
    ]);
    expect(result.pcr.denominator).toBe(2);
    expect(result.pcr.numerator).toBe(1);
    expect(result.abstention.numerator).toBe(1);
    expect(result.abstention.denominator).toBe(3);
  });

  test('HCCR counts only hard-constraint opportunities', () => {
    const result = personaFidelity([
      opp('James', 'persona', 'contradicts'),
      opp('James', 'hardConstraint', 'consistent'),
      opp('James', 'hardConstraint', 'contradicts'),
    ]);
    expect(result.hccr.denominator).toBe(2);
    expect(result.hccr.numerator).toBe(1);
    // The persona contradiction lowers PCR but must not touch HCCR.
    expect(result.pcr.numerator).toBe(1);
    expect(result.pcr.denominator).toBe(3);
  });

  test('a clean run reports HCCR of exactly zero, the desired value', () => {
    const result = personaFidelity([
      opp('Nurul', 'hardConstraint', 'consistent'),
      opp('Nurul', 'hardConstraint', 'consistent'),
    ]);
    expect(result.hccr.rate).toBe(0);
  });

  test('per-character breakdown separates the population', () => {
    const result = personaFidelity([
      opp('A', 'persona', 'consistent'),
      opp('B', 'persona', 'contradicts'),
    ]);
    expect(result.byCharacter.map((c) => c.name)).toEqual(['A', 'B']);
    expect(result.byCharacter[0].pcr.rate).toBe(1);
    expect(result.byCharacter[1].pcr.rate).toBe(0);
  });
});

describe('Component 2 — directional consistency', () => {
  const test1 = (over: Partial<DirectionalTest> = {}): DirectionalTest => ({
    dimensionId: 'conflict-avoidance',
    observable: 'immediate objection',
    expected: 'high<low',
    high: { n: 10, hits: 2 },
    low: { n: 10, hits: 7 },
    ...over,
  });

  test('the worked example from the framework follows the expected direction', () => {
    // 2/10 highly conflict-avoidant object vs 7/10 low conflict-avoidance.
    const scored = scoreDirectionalTest(test1());
    expect(scored.highRate).toBe(0.2);
    expect(scored.lowRate).toBe(0.7);
    expect(scored.follows).toBe(true);
  });

  test('a reversed result fails rather than being reinterpreted', () => {
    const scored = scoreDirectionalTest(test1({ high: { n: 10, hits: 8 } }));
    expect(scored.follows).toBe(false);
  });

  test('an empty group is inconclusive, not a failure', () => {
    const scored = scoreDirectionalTest(test1({ low: { n: 0, hits: 0 } }));
    expect(scored.follows).toBeUndefined();
    expect(scored.inconclusiveReason).toBe('empty-group');
  });

  test('an exact tie is inconclusive and stays out of the DCR denominator', () => {
    const result = directionalConsistency([
      test1({ high: { n: 10, hits: 5 }, low: { n: 10, hits: 5 } }),
      test1(),
    ]);
    expect(result.inconclusive).toHaveLength(1);
    expect(result.inconclusive[0].inconclusiveReason).toBe('tie');
    expect(result.dcr.denominator).toBe(1);
    expect(result.dcr.rate).toBe(1);
  });

  test('DCR is a plain share of conclusive tests', () => {
    const result = directionalConsistency([
      test1(),
      test1({ dimensionId: 'directness', expected: 'high>low' }),
    ]);
    // The second reuses high=0.2 low=0.7 but expects high>low, so it fails.
    expect(result.dcr.numerator).toBe(1);
    expect(result.dcr.denominator).toBe(2);
  });
});

describe('Component 3 — option coverage', () => {
  test('coverage counts distinct options actually taken', () => {
    const result = optionCoverage(['o1', 'o2', 'o3', 'o4'], ['o1', 'o1', 'o2']);
    expect(result.coverage.numerator).toBe(2);
    expect(result.coverage.denominator).toBe(4);
    expect(result.neverSelected).toEqual(['o3', 'o4']);
  });

  test('full coverage still exposes a lopsided population', () => {
    const spread = optionCoverage(['o1', 'o2'], ['o1', 'o2']);
    const lopsided = optionCoverage(['o1', 'o2'], ['o1', 'o1', 'o1', 'o1', 'o1', 'o2']);
    expect(spread.coverage.rate).toBe(1);
    expect(lopsided.coverage.rate).toBe(1);
    // Identical coverage, very different populations — hence topOptionShare.
    expect(lopsided.topOptionShare).toBeGreaterThan(spread.topOptionShare);
  });

  test('selections outside the feasible set are ignored', () => {
    const result = optionCoverage(['o1'], ['o1', 'nonsense']);
    expect(result.coverage.numerator).toBe(1);
    expect(result.topOptionShare).toBe(1);
  });

  test('no selections leaves the share undefined rather than zero', () => {
    expect(optionCoverage(['o1', 'o2'], []).topOptionShare).toBeNaN();
  });
});

describe('Component 3 — within-group diversity', () => {
  const choice = (over: Partial<ChoiceRecord> = {}): ChoiceRecord => ({
    scenarioId: 's1',
    characterName: 'A',
    background: 'Singaporean Chinese',
    optionIds: ['o1', 'o2', 'o3'],
    chosenOptionId: 'o1',
    feasibleOptionIds: ['o1', 'o2', 'o3'],
    choiceDetermined: false,
    ...over,
  });

  test('a pair choosing differently counts toward WGDR', () => {
    const result = withinGroupDiversity([
      choice({ characterName: 'A', chosenOptionId: 'o1' }),
      choice({ characterName: 'B', chosenOptionId: 'o2' }),
    ]);
    expect(result.eligiblePairs).toBe(1);
    expect(result.wgdr.rate).toBe(1);
  });

  test('total convergence produces WGDR of zero over a real denominator', () => {
    const result = withinGroupDiversity([
      choice({ characterName: 'A' }),
      choice({ characterName: 'B' }),
      choice({ characterName: 'C' }),
    ]);
    expect(result.eligiblePairs).toBe(3);
    expect(result.wgdr.rate).toBe(0);
  });

  test('a determined choice is excluded, so forced agreement is not read as convergence', () => {
    const result = withinGroupDiversity([
      choice({ characterName: 'A', choiceDetermined: true }),
      choice({ characterName: 'B' }),
    ]);
    expect(result.eligiblePairs).toBe(0);
    expect(result.exclusions['choice-determined']).toBe(1);
    expect(result.wgdr.rate).toBeNaN();
  });

  test('an NPC with only one feasible option is excluded', () => {
    const result = withinGroupDiversity([
      choice({ characterName: 'A', feasibleOptionIds: ['o1'] }),
      choice({ characterName: 'B' }),
    ]);
    expect(result.exclusions['single-feasible-option']).toBe(1);
    expect(result.eligiblePairs).toBe(0);
  });

  test('NPCs from different backgrounds are never paired', () => {
    const result = withinGroupDiversity([
      choice({ characterName: 'A', background: 'X' }),
      choice({ characterName: 'B', background: 'Y', chosenOptionId: 'o2' }),
    ]);
    expect(result.eligiblePairs).toBe(0);
    expect(result.excludedPairs).toBe(0);
  });

  test('differing option sets are excluded rather than compared', () => {
    const result = withinGroupDiversity([
      choice({ characterName: 'A' }),
      choice({ characterName: 'B', optionIds: ['o1', 'o2'], chosenOptionId: 'o2' }),
    ]);
    expect(result.exclusions['different-option-set']).toBe(1);
  });
});

describe('Component 4 — disclosure plausibility', () => {
  test('only relevant opportunities count toward the disclosure denominator', () => {
    const result = disclosurePlausibility(
      [
        {
          characterName: 'R',
          conversationId: 'c1',
          constraint: 'halal',
          opportunity: true,
          disclosed: true,
        },
        {
          characterName: 'R',
          conversationId: 'c2',
          constraint: 'halal',
          opportunity: false,
          disclosed: false,
        },
      ],
      [],
    );
    expect(result.relevantDisclosure.denominator).toBe(1);
    expect(result.relevantDisclosure.rate).toBe(1);
  });

  test('premature disclosure is measured per interaction, not per constraint', () => {
    const result = disclosurePlausibility(
      [],
      [
        { characterName: 'R', conversationId: 'c1', prematureDisclosure: true },
        { characterName: 'R', conversationId: 'c2', prematureDisclosure: false },
        { characterName: 'S', conversationId: 'c1', prematureDisclosure: false },
      ],
    );
    expect(result.prematureDisclosure.numerator).toBe(1);
    expect(result.prematureDisclosure.denominator).toBe(3);
    expect(result.byCharacter.find((c) => c.name === 'R')!.prematureDisclosure.rate).toBe(0.5);
  });
});

describe('Component 5 — dynamic state validity', () => {
  const trans = (over: Partial<StateTransition> = {}): StateTransition => ({
    characterName: 'A',
    at: 1,
    cause: 'activity',
    component: 'fatigue',
    valueBefore: 20,
    valueAfter: 32,
    baseline: 10,
    expected: 'up',
    crossScenario: false,
    ...over,
  });

  test('a rise when a rise was expected is correct', () => {
    expect(classifyTransition(trans())).toBe('correct');
  });

  test('a fall when a rise was expected is wrong', () => {
    expect(classifyTransition(trans({ valueAfter: 15 }))).toBe('wrong-direction');
  });

  test('a gauge pinned at the ceiling is clamped, not wrong', () => {
    expect(classifyTransition(trans({ valueBefore: 100, valueAfter: 100 }))).toBe('clamped');
    expect(classifyTransition(trans({ expected: 'down', valueBefore: 0, valueAfter: 0 }))).toBe(
      'clamped',
    );
  });

  test('no movement mid-range is its own verdict', () => {
    expect(classifyTransition(trans({ valueAfter: 20 }))).toBe('no-movement');
  });

  test('decay is judged against the baseline, from either side', () => {
    const fromAbove = trans({
      expected: 'toward-baseline',
      cause: 'dailyDecay',
      valueBefore: 50,
      valueAfter: 25,
      baseline: 10,
    });
    const fromBelow = trans({
      expected: 'toward-baseline',
      cause: 'dailyDecay',
      valueBefore: 5,
      valueAfter: 8,
      baseline: 10,
    });
    expect(classifyTransition(fromAbove)).toBe('correct');
    expect(classifyTransition(fromBelow)).toBe('correct');
  });

  test('already at baseline, staying put is correct', () => {
    const atRest = trans({
      expected: 'toward-baseline',
      valueBefore: 10,
      valueAfter: 10,
      baseline: 10,
    });
    expect(classifyTransition(atRest)).toBe('correct');
  });

  test('a manual override is excluded from the accuracy denominator', () => {
    const result = dynamicStateValidity(
      [trans(), trans({ expected: 'unconstrained', cause: 'manualOverride' })],
      { resetThreshold: 25, validResetCauses: ['manualOverride'] },
    );
    expect(result.stateTransitionAccuracy.denominator).toBe(1);
    expect(result.verdicts.unconstrained).toBe(1);
  });

  test('a big jump back to baseline is a reset; a small drift is not', () => {
    const big = trans({ valueBefore: 80, valueAfter: 20, baseline: 10 });
    const small = trans({ valueBefore: 80, valueAfter: 75, baseline: 10 });
    expect(isReset(big, 25)).toBe(true);
    expect(isReset(small, 25)).toBe(false);
  });

  test('moving further from baseline is never a reset', () => {
    expect(isReset(trans({ valueBefore: 20, valueAfter: 90, baseline: 10 }), 25)).toBe(false);
  });

  test('a reset from a valid cause is expected; from any other cause it is not', () => {
    const reset = (cause: string) =>
      trans({ cause, valueBefore: 80, valueAfter: 15, baseline: 10, crossScenario: true });
    const result = dynamicStateValidity([reset('dailyDecay'), reset('conversationFeelings')], {
      resetThreshold: 25,
      validResetCauses: ['dailyDecay', 'meal', 'manualOverride'],
    });
    expect(result.unexpectedResetRate.numerator).toBe(1);
    expect(result.unexpectedResetRate.denominator).toBe(2);
    expect(result.unexpectedResets[0].cause).toBe('conversationFeelings');
  });

  test('a well-behaved run reports the desired zero reset rate', () => {
    const result = dynamicStateValidity([trans({ crossScenario: true })], {
      resetThreshold: 25,
      validResetCauses: ['dailyDecay'],
    });
    expect(result.unexpectedResetRate.rate).toBe(0);
  });
});
