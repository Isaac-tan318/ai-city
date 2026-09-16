import { splitProfileConstraints } from './profileConstraints';

describe('splitting a profile into fixed facts and background', () => {
  test('a dietary rule is a fixed fact; a hobby is not', () => {
    const { constraints, rest } = splitProfileConstraints({
      'Dietary rule': 'Halal only; no pork; no alcohol',
      Hobby: 'Badminton',
    });
    expect(constraints).toEqual([['Dietary rule', 'Halal only; no pork; no alcohol']]);
    expect(rest).toEqual([['Hobby', 'Badminton']]);
  });

  test('a field saying there is no constraint is not a fixed fact', () => {
    // Otherwise a third of the block reads "nothing to worry about", which is
    // how a block stops being read at all.
    const { constraints, rest } = splitProfileConstraints({
      'Dietary rule': 'No restrictions; runs on iced Milo',
      'Mobility level': 'No limitation',
      Allergy: 'None',
    });
    expect(constraints).toEqual([]);
    expect(rest).toHaveLength(3);
  });

  test('a real limitation in the same field IS a fixed fact', () => {
    const { constraints } = splitProfileConstraints({
      'Mobility level': 'Mild limitation; avoids steep routes',
    });
    expect(constraints).toHaveLength(1);
  });

  test('taste and disposition stay in the background block', () => {
    // These bend. Folding them in would flatten the distinction entirely.
    const { constraints, rest } = splitProfileConstraints({
      'Food likes': 'Spicy Sichuan food',
      'Food dislikes': 'Very bland food',
      Personality: 'Cautious, formal',
      'Conflict style': 'Avoids direct conflict',
      Occupation: 'Ward nurse',
    });
    expect(constraints).toEqual([]);
    expect(rest).toHaveLength(5);
  });

  test('allergies, health conditions and religious schedules all count', () => {
    const { constraints } = splitProfileConstraints({
      Allergy: 'Shellfish',
      'Health condition': 'Doctor-ordered low salt',
      'Religious schedule constraint': 'Friday prayers are fixed',
      'Other social taboo / constraint': 'Cannot accept gifts from suppliers',
    });
    expect(constraints).toHaveLength(4);
  });

  test('empty values are dropped from both blocks', () => {
    const { constraints, rest } = splitProfileConstraints({
      'Dietary rule': '   ',
      Hobby: '',
      Nationality: 'Singapore',
    });
    expect(constraints).toEqual([]);
    expect(rest).toEqual([['Nationality', 'Singapore']]);
  });

  test('an empty profile produces no blocks rather than throwing', () => {
    expect(splitProfileConstraints({})).toEqual({ constraints: [], rest: [] });
  });
});
