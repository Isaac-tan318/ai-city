import { conditionOf, resolveConstraintText } from './src/corpus/conditions';
import { characterProfiles } from '../data/characterProfiles';
import { groundTruth } from '../data/groundTruth';

// The classifier decides which constraints are gated behind an activation
// check, so it is tested against the constraint strings the cast actually
// carries rather than against invented examples. A regex that is right about a
// sentence nobody wrote is worth nothing here.
describe('conditional constraints — the real cast', () => {
  const dietaryRules = Object.values(characterProfiles)
    .map((p) => p['Dietary rule'])
    .filter((r): r is string => !!r);

  test('the profile corpus contains both kinds, so this test can fail', () => {
    expect(dietaryRules.filter((r) => conditionOf(r).conditional).length).toBeGreaterThan(3);
    expect(dietaryRules.filter((r) => !conditionOf(r).conditional).length).toBeGreaterThan(3);
  });

  test.each([
    'May avoid animal products during fasting periods',
    'Avoids animal products during fasting periods',
    'Vegetarian on observance days; otherwise no strict restriction',
    'May avoid meat on Lent Fridays',
    'May avoid meat on some Lent Fridays',
    'No strict rule; sometimes vegetarian by personal observance',
    'Vegetarian for community meals',
  ])('conditional: %s', (rule) => {
    expect(conditionOf(rule).conditional).toBe(true);
    expect(conditionOf(rule).trigger).not.toBe('');
  });

  test.each([
    'Halal only; no pork; no alcohol',
    'Halal only; budget-sensitive',
    'Strict vegetarian; no beef',
    'No pork; limited alcohol',
    'Avoids lactose/dairy-heavy food',
    'Kosher-style: avoids pork and shellfish',
    'No restriction except peanut allergy',
  ])('unconditional: %s', (rule) => {
    expect(conditionOf(rule).conditional).toBe(false);
  });

  test('a rule with one unconditional half stays ungated', () => {
    // "vegetarian on prayer days" is conditional, but the beef rule binds every
    // day. Gating the whole constraint to protect the conditional half would
    // hide a real restriction, which is the worse error of the two.
    const rule = 'Avoids beef; vegetarian on prayer days; limits red meat';
    expect(conditionOf(rule).conditional).toBe(false);
  });

  test('"otherwise no strict restriction" does not count as a rule that binds', () => {
    const condition = conditionOf('Vegetarian on observance days; otherwise no strict restriction');
    expect(condition.conditional).toBe(true);
    expect(condition.clauses).toHaveLength(2);
  });

  test('a cautious verb in an absolute rule is not a condition', () => {
    // Yvonne's public-sector taboo hedges about what an arrangement could look
    // like; it binds at all times regardless.
    expect(conditionOf(groundTruth.Yvonne.hardTaboos[0]).conditional).toBe(false);
  });

  test("Irina's fast and Ratna's halal rule are classified apart", () => {
    expect(conditionOf(groundTruth.Irina.hardTaboos[0]).conditional).toBe(true);
    for (const taboo of groundTruth.Ratna.hardTaboos) {
      expect(conditionOf(taboo).conditional).toBe(false);
    }
  });

  test('an empty constraint is not conditional', () => {
    expect(conditionOf('').conditional).toBe(false);
    expect(conditionOf('   ').clauses).toEqual([]);
  });
});

describe('resolving a quoted attribute back to the rule it names', () => {
  const irina = {
    'Dietary rule': 'May avoid animal products during fasting periods',
    'Food dislikes': 'Loud casual dining environments',
  };

  test('a field name resolves to its value', () => {
    // The judge answered "Dietary rule" — the label, not the rule. Classifying
    // the label alone would call an Orthodox fast unconditional.
    expect(resolveConstraintText('Dietary rule', irina, [])).toBe(
      'May avoid animal products during fasting periods',
    );
    expect(conditionOf(resolveConstraintText('Dietary rule', irina, [])).conditional).toBe(true);
  });

  test('field names match regardless of case and spacing', () => {
    expect(resolveConstraintText('  dietary rule ', irina, [])).toBe(
      'May avoid animal products during fasting periods',
    );
  });

  test('an attribute that is already the rule is returned unchanged', () => {
    const quoted = 'May avoid animal products during fasting periods';
    expect(resolveConstraintText(quoted, irina, [])).toBe(quoted);
  });

  test('a partial quote resolves to the hard taboo it came from', () => {
    const taboo = groundTruth.Irina.hardTaboos[0];
    expect(resolveConstraintText('During Orthodox fasting periods', irina, [taboo])).toBe(taboo);
  });

  test('an unrecognised attribute falls through to itself', () => {
    expect(resolveConstraintText('Something nobody wrote', irina, [])).toBe(
      'Something nobody wrote',
    );
  });

  test('a short attribute does not match a long rule by accident', () => {
    // "tea" appearing inside a longer preference must not resolve to it; a
    // three-letter substring is not evidence of which rule was meant.
    expect(resolveConstraintText('tea', irina, ['Tea, bread, soups'])).toBe('tea');
  });
});
