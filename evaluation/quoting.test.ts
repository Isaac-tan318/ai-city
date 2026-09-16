import { normalizeForMatch, quoteAppearsIn } from './src/judges/quoting';

describe('grounding a judge quote in the transcript', () => {
  const lines = [
    'I’d prefer something warm and comforting like soto or spicy tempeh.',
    'If we find a hawker that has grilled meat and some halal options, that would work.',
  ];

  test('an exact quote is grounded', () => {
    expect(quoteAppearsIn('like soto or spicy tempeh', lines)).toBe(true);
  });

  test('curly and straight punctuation are the same words', () => {
    expect(quoteAppearsIn("I'd prefer something warm", lines)).toBe(true);
    expect(quoteAppearsIn('I’d prefer something warm', lines)).toBe(true);
  });

  test('case and trailing punctuation do not matter', () => {
    expect(quoteAppearsIn('SPICY TEMPEH!', lines)).toBe(true);
  });

  test('an ellipsis splices two places, and both must be real', () => {
    expect(quoteAppearsIn('If we find a hawker … some halal options', lines)).toBe(true);
    expect(quoteAppearsIn('If we find a hawker … and I never drink', lines)).toBe(false);
  });

  test('a long quote may match on a run of words when the tail drifts', () => {
    expect(
      quoteAppearsIn('has grilled meat and some halal options nearby somewhere', lines),
    ).toBe(true);
  });

  test('a short invention is not grounded', () => {
    expect(quoteAppearsIn('I only eat halal', lines)).toBe(false);
  });

  test('an empty quote is never grounded', () => {
    expect(quoteAppearsIn('', lines)).toBe(false);
    expect(quoteAppearsIn('   ', lines)).toBe(false);
  });

  test('a short quote cannot be stitched across two separate turns', () => {
    // "tempeh. If we find" spans the end of one line and the start of another;
    // nobody said that phrase, and at this length nothing partial will save it.
    expect(quoteAppearsIn('tempeh if we find', lines)).toBe(false);
  });

  test('a mostly-invented long quote is not grounded by one real phrase in it', () => {
    expect(
      quoteAppearsIn(
        'I never drink alcohol and I only eat halal but if we find a hawker',
        lines,
      ),
    ).toBe(false);
  });

  test('nothing is grounded when the speaker never spoke', () => {
    expect(quoteAppearsIn('anything at all', [])).toBe(false);
  });

  test('normalisation keeps word boundaries rather than joining words', () => {
    expect(normalizeForMatch('soto/tempeh')).toBe('soto tempeh');
    expect(normalizeForMatch('  Halal — only!  ')).toBe('halal only');
  });
});
