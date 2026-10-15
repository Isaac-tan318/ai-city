import { Descriptions, characters } from '../data/characters';
import { CHARACTER_HOMES, CHARACTER_WORKPLACES, homeFor, workplaceFor } from '../data/cityLocations';
import {
  COMMUTE_MINUTES,
  backgroundFor,
  hasNightShiftDuty,
  isSleepStep,
  mergeFixedObligations,
} from '../data/routines';
import { groundTruthFor } from '../data/groundTruth';
import { activitiesForName, ACTIVITIES } from './constants';

// The 17 added when the town went from 8 to 25.
const WIDER_CAST = [
  'Yvonne', 'Bernard', 'Nikhil', 'Nurul', 'Ratna', 'Kerem', 'Irina', 'Emeka', 'Sharifah',
  'Hanna', 'Naomi', 'Tiago', 'Harpreet', 'Mateo', 'Dylan', 'Aroha', 'Ravi',
];

// The 25 added when it went from 25 to 50.
const FIFTY_CAST = [
  'Faisal', 'Somchai', 'Katrin', 'Pilar', 'Danuta', 'Camille', 'Sipho', 'Lucia',
  'Bryan', 'Farah', 'Anh', 'Tomoko', 'Daniyal', 'Grace', 'Priya', 'Hafiz', 'Meihua',
  'Arun', 'Nadia', 'Tavita', 'Sofia', 'Haoran', 'Siti', 'Gordon', 'Meera',
];

// Everyone who is not one of the original eight. The per-character checks below
// apply to all of them equally - the 8/17/25 split is only history.
const NEW_CAST = [...WIDER_CAST, ...FIFTY_CAST];

// Whose "Sleep/work rhythm" pushes their morning past the ordinary commute slot:
// a student is up at 08:00 and a night owl at 09:00, so commuteInterval clamps
// the walk to work (or drops it) rather than shortening their night. Checked
// separately below.
const LATE_RISERS = [
  'Tiago', 'Bryan', 'Farah', 'Anh', 'Tomoko', 'Daniyal', 'Sipho', 'Gordon', 'Haoran',
];

// A flat one-block "LLM schedule" to overlay the fixed obligations onto.
const idleDay = (x: number, y: number) => [
  {
    startMinute: 0,
    locationId: 'home',
    destination: { x, y },
    activity: 'pottering about',
    description: 'at home',
  },
];

// The step in effect at a given game-minute: the last one that has started.
const stepAt = <T extends { startMinute: number }>(schedule: T[], minute: number): T =>
  [...schedule].reverse().find((s) => s.startMinute <= minute)!;

describe('the wider cast', () => {
  it('is fifty agents: the original 8, then 17, then 25 more', () => {
    expect(Descriptions).toHaveLength(50);
    for (const name of NEW_CAST) {
      expect(Descriptions.find((d) => d.name === name)).toBeDefined();
    }
  });

  it('gives every character a unique name', () => {
    const names = Descriptions.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // Five files are keyed by character NAME and nothing links them but the string,
  // so a typo in any one of them is a character who silently has no home, no
  // shift, no hidden constraints or no idle behaviour. Check all fifty, not just
  // the ones a particular expansion added.
  it.each(Descriptions.map((d) => d.name))('%s is wired up in all five files', (name) => {
    expect(CHARACTER_HOMES[name]).toBeDefined();
    expect(homeFor(name)).toBeDefined();
    expect(groundTruthFor(name)).toBeDefined();
    expect(activitiesForName(name)).not.toBe(ACTIVITIES);
    // Bernard is the one deliberate exception: retired, so no workplace.
    if (name !== 'Bernard') expect(workplaceFor(name)).toBeDefined();
  });

  it('only dresses characters in sprites that exist', () => {
    const sprites = new Set(characters.map((c) => c.name));
    for (const d of Descriptions) expect(sprites.has(d.character)).toBe(true);
  });

  it.each(NEW_CAST)('%s has an identity and a profile', (name) => {
    const d = Descriptions.find((x) => x.name === name)!;
    expect(d.identity).toMatch(/personality is best described as/);
    expect(Object.keys(d.profile ?? {}).length).toBeGreaterThan(10);
  });

  it.each(NEW_CAST.filter((n) => n !== 'Bernard'))(
    '%s is on shift at their workplace at 10am on a weekday',
    (name) => {
      const home = homeFor(name)!;
      // Day 1 is Monday.
      const schedule = mergeFixedObligations(name, 1, idleDay(home.x, home.y));
      const at10 = [...schedule].reverse().find((s) => s.startMinute <= 10 * 60)!;
      expect(at10.locationId).toBe(CHARACTER_WORKPLACES[name].locationId);
      expect(at10.activity).toBe(workplaceFor(name)!.activity);
    },
  );

  it.each(NEW_CAST.filter((n) => n !== 'Bernard' && !LATE_RISERS.includes(n)))(
    '%s sets off for work before the shift starts, not at it',
    (name) => {
      const home = homeFor(name)!;
      const schedule = mergeFixedObligations(name, 1, idleDay(home.x, home.y));
      const commute = schedule.find((s) => s.activity === 'heading to work')!;
      // The walk is its own block, pointed at the workplace and ending exactly
      // when the shift begins — so nine o'clock is when they ARRIVE.
      expect(commute).toBeDefined();
      expect(commute.startMinute).toBe(9 * 60 - COMMUTE_MINUTES);
      expect(commute.locationId).toBe(CHARACTER_WORKPLACES[name].locationId);
      expect(stepAt(schedule, 9 * 60 - 1)).toBe(commute);
      expect(stepAt(schedule, 9 * 60).activity).toBe(workplaceFor(name)!.activity);
    },
  );

  it('never starts a commute before the character is out of bed', () => {
    // Tiago is a night owl: he wakes at 09:00, which is when his shift starts.
    // There is no room for a commute, and inventing one would mean pulling him
    // out of bed at 08:15 — quietly shortening a night the sleep rhythm set.
    const home = homeFor('Tiago')!;
    const schedule = mergeFixedObligations('Tiago', 1, idleDay(home.x, home.y));
    expect(schedule.find((s) => s.activity === 'heading to work')).toBeUndefined();
    expect(isSleepStep(stepAt(schedule, 8 * 60 + 30))).toBe(true);
  });

  // Same rule, the other branch: a student is up at 08:00, so the commute is
  // clamped to the window after they are up and about rather than starting at
  // 08:15 and reaching back into their night.
  it.each(['Bryan', 'Farah', 'Anh', 'Tomoko', 'Daniyal', 'Sipho'])(
    'clamps the commute for %s to after they are up, not before',
    (name) => {
      const home = homeFor(name)!;
      const schedule = mergeFixedObligations(name, 1, idleDay(home.x, home.y));
      const commute = schedule.find((s) => s.activity === 'heading to work');
      if (commute) {
        expect(commute.startMinute).toBeGreaterThanOrEqual(8 * 60 + 45);
        expect(commute.startMinute).toBeLessThan(9 * 60);
      }
      expect(isSleepStep(stepAt(schedule, 7 * 60))).toBe(true);
    },
  );

  // The bug this guards: a home-based obligation used to label itself with the
  // BUILDING it sat in ('hdb', 'university'), which made workLeashAnchor and the
  // short-term "is this a work block" check treat a night in bed as a shift for
  // anyone whose home and workplace share a location. Every student does.
  it.each(['Sipho', 'Bryan', 'Grace', 'Priya', 'Ratna', 'Emeka', 'Aroha', 'Pilar', 'Siti'])(
    'labels the night at home for %s as home, not as the building they work in',
    (name) => {
      const home = homeFor(name)!;
      const schedule = mergeFixedObligations(name, 1, idleDay(home.x, home.y));
      const asleep = schedule.filter((s) => isSleepStep(s));
      expect(asleep.length).toBeGreaterThan(0);
      for (const step of asleep) {
        expect(step.locationId).toBe('home');
        expect(step.destination).toEqual({ x: home.x, y: home.y });
      }
    },
  );

  it('gives a night-shift worker a commute to the evening shift too', () => {
    const home = homeFor('Nurul')!;
    // Tuesday: she clocks on at 22:00.
    const tuesday = mergeFixedObligations('Nurul', 2, idleDay(home.x, home.y));
    const commute = stepAt(tuesday, 22 * 60 - 1);
    expect(commute.activity).toBe('heading to work');
    expect(commute.startMinute).toBe(22 * 60 - COMMUTE_MINUTES);
  });

  // homes.test.ts checks that all fifty are asleep at home at 3am on day 1, and
  // roster.test.ts checks they are at work at 10am on it. Both are only true
  // while no night shift touches Monday — its small hours belong to Monday
  // itself, and the morning after a Sunday night is spent sleeping it off.
  it.each(Descriptions.map((d) => d.name))('does not put %s on a night shift on day 1', (name) => {
    expect(hasNightShiftDuty(name, 1)).toBe(false);
  });

  it('leaves the weekend free of commutes', () => {
    const home = homeFor('Yvonne')!;
    const saturday = mergeFixedObligations('Yvonne', 6, idleDay(home.x, home.y));
    expect(saturday.find((s) => s.activity === 'heading to work')).toBeUndefined();
  });

  it('marks what it added as fixed, and leaves the planned blocks alone', () => {
    // The `fixed` flag is what the engine reads to decide an agent may not put
    // this off: an obligation interrupts a conversation, a plan does not.
    const home = homeFor('Yvonne')!;
    const schedule = mergeFixedObligations('Yvonne', 1, idleDay(home.x, home.y));
    for (const activity of ['heading to work', 'drafting policy papers at her desk']) {
      expect(schedule.find((s) => s.activity === activity)!.fixed).toBe(true);
    }
    expect(schedule.filter((s) => isSleepStep(s)).every((s) => s.fixed)).toBe(true);
    // The LLM's own block survives the merge unflagged.
    expect(schedule.find((s) => s.activity === 'pottering about')!.fixed).toBeUndefined();
  });

  it('leaves Bernard free all day — he is retired', () => {
    const home = homeFor('Bernard')!;
    const schedule = mergeFixedObligations('Bernard', 1, idleDay(home.x, home.y));
    // No work block anywhere: every step is at home, and the only ones the
    // merge added are the night's sleep and the getting-up that follows it.
    expect(schedule.every((s) => s.destination.x === home.x && s.destination.y === home.y)).toBe(
      true,
    );
    expect(stepAt(schedule, 10 * 60).activity).toBe('pottering about');
  });

  it('sends the Muslim characters home for Friday prayer', () => {
    for (const name of [
      'Nurul', 'Ratna', 'Kerem', 'Sharifah',
      'Faisal', 'Farah', 'Daniyal', 'Hafiz', 'Nadia', 'Siti',
    ]) {
      expect(backgroundFor(name).religion).toBe('muslim');
      const home = homeFor(name)!;
      const friday = mergeFixedObligations(name, 5, idleDay(home.x, home.y));
      const at1pm = [...friday].reverse().find((s) => s.startMinute <= 13 * 60)!;
      expect(at1pm.activity).toBe('observing Friday prayer at home');
    }
  });

  it('sends the Christian characters home for Sunday service', () => {
    for (const name of [
      'Irina', 'Emeka', 'Hanna', 'Mateo', 'Aroha',
      'Pilar', 'Danuta', 'Lucia', 'Grace', 'Sofia',
      // Tavita is christian too, but Sunday night is one of his shifts, so his
      // service and his roster are checked apart from each other.
    ]) {
      expect(backgroundFor(name).religion).toBe('christian');
      const home = homeFor(name)!;
      const sunday = mergeFixedObligations(name, 7, idleDay(home.x, home.y));
      const at1030 = [...sunday].reverse().find((s) => s.startMinute <= 10 * 60 + 30)!;
      expect(at1030.activity).toBe('observing Sunday service at home');
    }
  });
});
