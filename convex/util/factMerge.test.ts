import {
  countNewFacts,
  dropResolved,
  splitCompoundFacts,
  factOverlap,
  mergeFacts,
  normalizeFact,
  saysTheSameThing,
} from './factMerge';

describe('normalizeFact', () => {
  test('trims, lowercases, and drops trailing punctuation', () => {
    expect(normalizeFact('  Likes Iced Milo!! ')).toBe('likes iced milo');
    expect(normalizeFact('Wants to leave?')).toBe('wants to leave');
  });
});

describe('saysTheSameThing', () => {
  test('exact restatements match', () => {
    expect(saysTheSameThing('likes iced Milo', 'Likes iced milo.')).toBe(true);
  });

  test('matches paraphrases that differ only by filler words', () => {
    // Observed live: these two accumulated as separate "preferences".
    expect(
      saysTheSameThing(
        'would rather deal with squeeze than get soaked',
        'would rather deal with a squeeze than get soaked',
      ),
    ).toBe(true);
    expect(
      saysTheSameThing('wants to unwind on the way home', 'wants to unwind on the way home'),
    ).toBe(true);
  });

  test('matches when one fact elaborates on the other', () => {
    expect(
      saysTheSameThing('prefers iced Milo for drinks', 'prefers iced Milo and hot chocolate'),
    ).toBe(true);
  });

  test('keeps genuinely different facts apart', () => {
    expect(saysTheSameThing('halal only, no pork', 'has a shellfish allergy')).toBe(false);
    expect(saysTheSameThing('wants cheap hawker food', 'wants to splurge on a nice restaurant')).toBe(
      false,
    );
    expect(saysTheSameThing('is on a tight student budget', 'happy to treat everyone')).toBe(false);
  });

  test('does not merge everything into the first fact it sees', () => {
    const facts = [
      'halal only, no pork or alcohol',
      'has a shellfish allergy',
      'doctor ordered low salt',
      'is on a tight budget',
    ];
    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        expect(saysTheSameThing(facts[i], facts[j])).toBe(false);
      }
    }
  });

  test('an all-stopword fact never matches by overlap', () => {
    expect(factOverlap('to the and of', 'likes iced Milo')).toBe(0);
  });
});

describe('mergeFacts', () => {
  test('appends genuinely new facts', () => {
    expect(mergeFacts(['likes hawker food'], ['has a shellfish allergy'])).toEqual([
      'likes hawker food',
      'has a shellfish allergy',
    ]);
  });

  test('replaces a restatement in place rather than appending', () => {
    const merged = mergeFacts(
      ['prefers iced Milo for drinks'],
      ['prefers iced Milo and hot chocolate for drinks'],
    );
    expect(merged).toHaveLength(1);
    // Newest wording wins — it reflects the most recent thing said.
    expect(merged[0]).toBe('prefers iced Milo and hot chocolate for drinks');
  });

  test('does not grow when the same fact is re-extracted every turn', () => {
    let facts: string[] = [];
    for (let turn = 0; turn < 10; turn++) {
      facts = mergeFacts(facts, ['wants to unwind on the way home']);
    }
    expect(facts).toEqual(['wants to unwind on the way home']);
  });

  test('ignores blank entries', () => {
    expect(mergeFacts(['a fact about food'], ['', '   '])).toEqual(['a fact about food']);
  });

  test('cleans duplicates already sitting in the stored list', () => {
    // Rows written before the fuzzy merge existed carry restatements like these.
    const stale = [
      'wants to grab good food beforehand',
      'wants good food beforehand',
      'feeling under the weather',
      'feeling under the weather',
    ];
    expect(mergeFacts(stale, [])).toEqual([
      'wants good food beforehand',
      'feeling under the weather',
    ]);
  });

  test('caps the list, keeping the most recent', () => {
    const existing = [
      'halal only, no pork',
      'shellfish allergy',
      'doctor ordered low salt',
      'tight student budget',
      'cannot stand for long',
      'needs somewhere quiet',
      'splits the bill exactly',
      'happy to treat everyone',
    ];
    const merged = mergeFacts(existing, ['refuses to queue longer than ten minutes'], 8);
    expect(merged).toHaveLength(8);
    expect(merged[7]).toBe('refuses to queue longer than ten minutes');
    // Oldest falls off the front once the cap is reached.
    expect(merged).not.toContain('halal only, no pork');
  });
});

describe('splitCompoundFacts', () => {
  test('splits a run-on entry into separate facts', () => {
    expect(
      splitCompoundFacts(['wants comfort food; open to something new', 'has a shellfish allergy']),
    ).toEqual(['wants comfort food', 'open to something new', 'has a shellfish allergy']);
  });

  test('leaves atomic facts alone and drops empties', () => {
    expect(splitCompoundFacts(['likes hawker food', ' ; ', ''])).toEqual(['likes hawker food']);
  });
});

describe('mergeFacts compound handling', () => {
  test('splits a stored run-on and dedupes its parts against what is known', () => {
    // A legacy row: one entry holding three facts, one already known separately.
    const stale = ['wants comfort food; wants to treat herself', 'wants to treat herself'];
    expect(mergeFacts(stale, [])).toEqual(['wants comfort food', 'wants to treat herself']);
  });
});

describe('countNewFacts', () => {
  test('counts only facts that are not already covered', () => {
    expect(countNewFacts(['likes hawker food'], ['has a shellfish allergy'])).toBe(1);
    expect(countNewFacts(['likes hawker food'], ['likes hawker food'])).toBe(0);
    expect(countNewFacts(['prefers iced Milo for drinks'], ['prefers iced Milo'])).toBe(0);
  });

  test('does not double-count restatements within the same batch', () => {
    expect(
      countNewFacts([], ['wants good food beforehand', 'wants to grab good food beforehand']),
    ).toBe(1);
  });

  test('still counts new facts when the existing list is at its cap', () => {
    // The regression this exists for: mergeFacts caps at 8, so a full list stays
    // length 8 and any growth-based count reports zero forever.
    const full = [
      'halal only, no pork',
      'shellfish allergy',
      'doctor ordered low salt',
      'tight student budget',
      'cannot stand for long',
      'needs somewhere quiet',
      'splits the bill exactly',
      'happy to treat everyone',
    ];
    expect(mergeFacts(full, ['refuses to queue longer than ten minutes'])).toHaveLength(8);
    expect(countNewFacts(full, ['refuses to queue longer than ten minutes'])).toBe(1);
  });

  test('ignores blanks', () => {
    expect(countNewFacts([], ['', '  '])).toBe(0);
  });
});

describe('dropResolved', () => {
  test('removes questions the transcript has answered', () => {
    const open = ['Does Clara have any dietary restrictions?', 'What is her budget?'];
    expect(dropResolved(open, ['Does Clara have dietary restrictions'])).toEqual([
      'What is her budget?',
    ]);
  });

  test('matches resolutions that are paraphrased', () => {
    expect(
      dropResolved(['What specific seafood does Clara prefer?'], ['what seafood Clara prefers']),
    ).toEqual([]);
  });

  test('leaves everything alone when nothing was resolved', () => {
    const open = ['What is her budget?'];
    expect(dropResolved(open, [])).toBe(open);
  });
});
