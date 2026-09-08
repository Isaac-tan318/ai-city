import {
  averageWithoutMisery,
  compareAggregations,
  diagnostics,
  maxmin,
  nash,
  ruleDisagreementRate,
  utilitarian,
} from './src/aggregation';

describe('the individual rules', () => {
  test('utilitarian is the plain mean the engine already uses', () => {
    expect(utilitarian([100, 50, 0])).toBe(50);
  });

  test('max-min reports the worst-off participant', () => {
    expect(maxmin([100, 50, 20])).toBe(20);
  });

  test('average-without-misery drops those below the threshold', () => {
    // 20 is excluded, so the mean is over 100 and 60.
    expect(averageWithoutMisery([100, 60, 20], 40)).toBe(80);
  });

  test('average-without-misery returns 0 when everybody is miserable', () => {
    expect(averageWithoutMisery([10, 20], 40)).toBe(0);
  });

  test('Nash collapses to zero when anyone is zeroed by a hard constraint', () => {
    expect(nash([100, 100, 0])).toBe(0);
    // ...and that is the point: the mean would still report a comfortable 66.7.
    expect(utilitarian([100, 100, 0])).toBeCloseTo(66.67, 1);
  });

  test('Nash sits below the mean whenever utilities are unequal', () => {
    expect(nash([80, 20])).toBeLessThan(utilitarian([80, 20]));
    expect(nash([50, 50])).toBe(utilitarian([50, 50]));
  });

  test('every rule handles an empty group without throwing', () => {
    expect(utilitarian([])).toBe(0);
    expect(maxmin([])).toBe(0);
    expect(nash([])).toBe(0);
    expect(averageWithoutMisery([], 40)).toBe(0);
  });
});

describe('diagnostics', () => {
  test('variance and the zeroed count are reported separately, not folded in', () => {
    const d = diagnostics([100, 100, 0]);
    expect(d.mean).toBeCloseTo(66.67, 1);
    expect(d.min).toBe(0);
    expect(d.zeroed).toBe(1);
    expect(d.variance).toBeGreaterThan(0);
  });
});

describe('comparing rules on one decision', () => {
  const input = {
    scenarioId: 's1',
    scenarioName: 'Dinner',
    selectedOptionId: 'o1',
    options: [
      // High mean, but ruins one person.
      { optionId: 'o1', title: 'Pork noodles', utilities: [100, 100, 0] },
      // Lower mean, nobody wrecked.
      { optionId: 'o2', title: 'Hawker centre', utilities: [65, 60, 62] },
    ],
  };

  test('the mean and the fairness rules disagree, which is the finding', () => {
    const result = compareAggregations(input)!;
    expect(result.rulesAgree).toBe(false);
    const byRule = Object.fromEntries(result.outcomes.map((o) => [o.rule, o.bestOptionId]));
    expect(byRule.utilitarian).toBe('o1');
    expect(byRule.maxmin).toBe('o2');
    expect(byRule.nash).toBe('o2');
  });

  test('the chosen option is optimal under the mean and regretful under Nash', () => {
    const result = compareAggregations(input)!;
    expect(result.outcomes.find((o) => o.rule === 'utilitarian')!.optimal).toBe(true);
    const nashOutcome = result.outcomes.find((o) => o.rule === 'nash')!;
    expect(nashOutcome.optimal).toBe(false);
    expect(nashOutcome.regret).toBeGreaterThan(0);
  });

  test('options zeroed by a hard constraint are named, not silently dropped', () => {
    expect(compareAggregations(input)!.nashZeroed).toEqual(['o1']);
  });

  test('when every rule agrees, the choice of rule does not matter on this data', () => {
    const result = compareAggregations({
      ...input,
      options: [
        { optionId: 'o1', title: 'A', utilities: [90, 90, 90] },
        { optionId: 'o2', title: 'B', utilities: [40, 40, 40] },
      ],
    })!;
    expect(result.rulesAgree).toBe(true);
    expect(result.outcomes.every((o) => o.optimal)).toBe(true);
  });

  test('no options yields no comparison rather than a fabricated one', () => {
    expect(compareAggregations({ ...input, options: [] })).toBeUndefined();
  });

  test('the disagreement rate aggregates across scenarios', () => {
    const disagreeing = compareAggregations(input)!;
    const agreeing = compareAggregations({
      ...input,
      options: [
        { optionId: 'o1', title: 'A', utilities: [90, 90, 90] },
        { optionId: 'o2', title: 'B', utilities: [40, 40, 40] },
      ],
    })!;
    const summary = ruleDisagreementRate([disagreeing, agreeing]);
    expect(summary).toEqual({ disagreed: 1, total: 2, rate: 0.5 });
  });
});
