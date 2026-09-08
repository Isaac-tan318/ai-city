import { Descriptions } from '../data/characters';
import { CHARACTER_HOMES, CHARACTER_WORKPLACES, homeFor, workplaceFor } from '../data/cityLocations';
import { mergeFixedObligations, backgroundFor } from '../data/routines';
import { groundTruthFor } from '../data/groundTruth';
import { activitiesForName, ACTIVITIES } from './constants';

const NEW_CAST = [
  'Yvonne', 'Bernard', 'Nikhil', 'Nurul', 'Ratna', 'Kerem', 'Irina', 'Emeka', 'Sharifah',
  'Hanna', 'Naomi', 'Tiago', 'Harpreet', 'Mateo', 'Dylan', 'Aroha', 'Ravi',
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

describe('the wider cast', () => {
  it('adds 17 agents on top of the original 8', () => {
    expect(Descriptions).toHaveLength(25);
    for (const name of NEW_CAST) {
      expect(Descriptions.find((d) => d.name === name)).toBeDefined();
    }
  });

  it.each(NEW_CAST)('%s has a home, an identity and a profile', (name) => {
    const d = Descriptions.find((x) => x.name === name)!;
    expect(d.identity).toMatch(/personality is best described as/);
    expect(Object.keys(d.profile ?? {}).length).toBeGreaterThan(10);
    expect(CHARACTER_HOMES[name]).toBeDefined();
    expect(homeFor(name)).toBeDefined();
  });

  it.each(NEW_CAST)('%s has ground truth and bespoke activities', (name) => {
    expect(groundTruthFor(name)).toBeDefined();
    expect(activitiesForName(name)).not.toBe(ACTIVITIES);
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

  it('leaves Bernard free all day — he is retired', () => {
    const home = homeFor('Bernard')!;
    const schedule = mergeFixedObligations('Bernard', 1, idleDay(home.x, home.y));
    expect(schedule).toHaveLength(1);
    expect(schedule[0].locationId).toBe('home');
  });

  it('sends the Muslim characters home for Friday prayer', () => {
    for (const name of ['Nurul', 'Ratna', 'Kerem', 'Sharifah']) {
      expect(backgroundFor(name).religion).toBe('muslim');
      const home = homeFor(name)!;
      const friday = mergeFixedObligations(name, 5, idleDay(home.x, home.y));
      const at1pm = [...friday].reverse().find((s) => s.startMinute <= 13 * 60)!;
      expect(at1pm.activity).toBe('observing Friday prayer at home');
    }
  });

  it('sends the Christian characters home for Sunday service', () => {
    for (const name of ['Irina', 'Emeka', 'Hanna', 'Mateo', 'Aroha']) {
      expect(backgroundFor(name).religion).toBe('christian');
      const home = homeFor(name)!;
      const sunday = mergeFixedObligations(name, 7, idleDay(home.x, home.y));
      const at1030 = [...sunday].reverse().find((s) => s.startMinute <= 10 * 60 + 30)!;
      expect(at1030.activity).toBe('observing Sunday service at home');
    }
  });
});
