import {
  affinityMean,
  conversationObservationText,
  fingerprint,
  observationImportance,
  observationText,
} from './aiTown/observation';
import { parseSubSteps } from './aiTown/agentOperations';
import { MAX_SUBSTEPS_PER_BLOCK, SUBSTEP_MIN_MINUTES } from './constants';
import type { FamilyTie } from './aiTown/affinity';

const family: FamilyTie[] = [{ name: 'Sarah', relation: 'younger sister' }];

describe('observationImportance', () => {
  test('a stranger going about their business is the floor', () => {
    expect(observationImportance({ subjectName: 'Cedric', affinity: 50 })).toBe(1);
  });

  test('family stands out', () => {
    expect(observationImportance({ family, subjectName: 'Sarah', affinity: 50 })).toBe(3);
  });

  test('people we feel unusually strongly about stand out, in either direction', () => {
    const warm = observationImportance({ subjectName: 'Cedric', affinity: 80, affinityMean: 50 });
    const hostile = observationImportance({ subjectName: 'Cedric', affinity: 20, affinityMean: 50 });
    expect(warm).toBe(3);
    expect(hostile).toBe(3);
    // Indifference is what makes an observation ambient.
    expect(observationImportance({ subjectName: 'Cedric', affinity: 55, affinityMean: 50 })).toBe(1);
  });

  test('affinity is judged relative to the observer, not against a fixed bar', () => {
    // Regression: affinity only ever climbs in ordinary conversation and
    // saturates near 100 across a long-running town. Against a fixed ">= 75"
    // bar every single observation then scored salient, so the whole ambient
    // stream was promoted into long-term memory and tripped the reaction gate.
    const everyoneAdored = observationImportance({
      subjectName: 'Cedric',
      affinity: 100,
      affinityMean: 100,
    });
    expect(everyoneAdored).toBe(1);
    // The one person they've fallen out with still stands out.
    expect(
      observationImportance({ subjectName: 'Rahman', affinity: 60, affinityMean: 100 }),
    ).toBe(3);
  });

  test('a group is more informative than one person alone', () => {
    expect(
      observationImportance({ subjectName: 'Cedric', affinity: 50, affinityMean: 50, groupSize: 3 }),
    ).toBe(2);
  });

  test('seeing someone somewhere they would not normally be adds salience', () => {
    expect(observationImportance({ subjectName: 'Cedric', affinity: 50, outOfPlace: true })).toBe(2);
  });

  test('reasons stack, and the result stays inside 1-6', () => {
    const stacked = observationImportance({
      family,
      subjectName: 'Sarah',
      affinity: 20,
      affinityMean: 50,
      outOfPlace: true,
      subjectSick: true,
    });
    expect(stacked).toBe(6);
    expect(stacked).toBeLessThanOrEqual(6);
  });

  test('an absent affinity is treated as neutral, not as zero', () => {
    // Reading a missing affinity as 0 would put every stranger far below the
    // baseline and make all ambient perception salient.
    expect(observationImportance({ subjectName: 'Cedric' })).toBe(1);
  });
});

describe('affinityMean', () => {
  test('averages what the observer actually feels', () => {
    expect(affinityMean({ 'p:1': 100, 'p:2': 50 })).toBe(75);
  });

  test('falls back to undefined when they know no one yet', () => {
    expect(affinityMean(undefined)).toBeUndefined();
    expect(affinityMean({})).toBeUndefined();
  });
});

describe('perception dedupe', () => {
  test('an unchanged subject produces an unchanged fingerprint', () => {
    expect(fingerprint('wiping down the counter', 'shophouses')).toBe(
      fingerprint('wiping down the counter', 'shophouses'),
    );
  });

  test('a changed activity or place changes the fingerprint', () => {
    const base = fingerprint('wiping down the counter', 'shophouses');
    expect(fingerprint('chatting up a regular', 'shophouses')).not.toBe(base);
    expect(fingerprint('wiping down the counter', 'hawker')).not.toBe(base);
  });

  test('having no activity is distinct from having one', () => {
    expect(fingerprint(undefined, 'shophouses')).not.toBe(
      fingerprint('wiping down the counter', 'shophouses'),
    );
  });

  test('fingerprints survive a JSON round trip', () => {
    // The dedupe state lives on the Agent, in the world document, and is
    // rebuilt from the database every ~30s. If it didn't survive serialization
    // every subject would be re-observed on that cadence.
    const observed = [{ k: 'player:p1', h: fingerprint('reading a book', 'park') }];
    const restored = JSON.parse(JSON.stringify(observed));
    expect(restored[0].h).toBe(fingerprint('reading a book', 'park'));
  });
});

describe('observation text', () => {
  test('includes the activity when there is one', () => {
    expect(
      observationText({ name: 'Cedric', activity: 'wiping down the counter', locationName: 'the cafe' }),
    ).toBe('Saw Cedric wiping down the counter at the cafe.');
  });

  test('degrades gracefully when there is no activity', () => {
    expect(observationText({ name: 'Cedric', locationName: 'the cafe' })).toBe(
      'Saw Cedric at the cafe.',
    );
  });

  test('a group reads as a list', () => {
    expect(conversationObservationText(['Cedric', 'James', 'Lukas'], 'the park')).toBe(
      'Cedric, James and Lukas were talking at the park.',
    );
  });
});

describe('parseSubSteps', () => {
  const block = { start: 9 * 60, end: 17 * 60 };
  const step = (time: string, activity = 'working') => ({ start_time: time, activity });

  test('anchors the first sub-step to the start of the block', () => {
    // Otherwise the agent has no sub-step covering the top of the block and
    // falls back to the whole-block activity until the second one begins.
    const out = parseSubSteps(
      { steps: [step('09:30'), step('12:00'), step('14:00')] },
      block.start,
      block.end,
    );
    expect(out[0].startMinute).toBe(block.start);
  });

  test('keeps every sub-step inside the parent block', () => {
    const out = parseSubSteps(
      { steps: [step('09:00'), step('08:00'), step('18:00'), step('12:00')] },
      block.start,
      block.end,
    );
    expect(out.every((s) => s.startMinute >= block.start && s.startMinute < block.end)).toBe(true);
  });

  test('drops sub-steps that crowd their predecessor', () => {
    const out = parseSubSteps(
      { steps: [step('09:00'), step('09:05'), step('12:00')] },
      block.start,
      block.end,
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startMinute - out[i - 1].startMinute).toBeGreaterThanOrEqual(
        SUBSTEP_MIN_MINUTES,
      );
    }
  });

  test('returns them in order', () => {
    const out = parseSubSteps(
      { steps: [step('14:00'), step('09:00'), step('12:00')] },
      block.start,
      block.end,
    );
    const times = out.map((s) => s.startMinute);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  test('caps the number of sub-steps', () => {
    const out = parseSubSteps(
      {
        steps: [
          step('09:00'),
          step('10:00'),
          step('11:00'),
          step('12:00'),
          step('13:00'),
          step('14:00'),
          step('15:00'),
        ],
      },
      block.start,
      block.end,
    );
    expect(out.length).toBeLessThanOrEqual(MAX_SUBSTEPS_PER_BLOCK);
  });

  test('a malformed or too-thin answer decomposes to nothing', () => {
    // The caller treats an empty list as "no decomposition", which keeps the
    // pre-existing whole-block activity — so bad model output degrades to the
    // old behaviour rather than to a broken schedule.
    expect(parseSubSteps({}, block.start, block.end)).toEqual([]);
    expect(parseSubSteps({ steps: 'nonsense' }, block.start, block.end)).toEqual([]);
    expect(parseSubSteps({ steps: [step('09:00')] }, block.start, block.end)).toEqual([]);
    expect(
      parseSubSteps({ steps: [{ start_time: '09:00' }, { activity: 'working' }] }, block.start, block.end),
    ).toEqual([]);
  });
});
