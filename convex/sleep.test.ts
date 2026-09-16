import { homeFor } from '../data/cityLocations';
import {
  isSleepStep,
  mergeFixedObligations,
  sleepWindowFor,
  worksNightShift,
  hasNightShiftDuty,
  DEFAULT_BED_MINUTE,
  DEFAULT_WAKE_MINUTE,
  NIGHT_SHIFT_START,
  POST_NIGHT_SLEEP_END,
} from '../data/routines';
import { sleepPressureFloor, tooTiredToSocialize } from './aiTown/shortTerm';
import {
  FATIGUE_BASELINE,
  FATIGUE_SOCIAL_CUTOFF,
  SLEEP_PRESSURE_PEAK,
  SLEEP_PRESSURE_RAMP_MINUTES,
} from './constants';

// A flat one-block "LLM schedule" to overlay the fixed obligations onto: whatever
// survives the merge is the merge's own doing.
const idleDay = (x: number, y: number) => [
  {
    startMinute: 0,
    locationId: 'home',
    destination: { x, y },
    activity: 'pottering about',
    description: 'at home',
  },
];

const scheduleFor = (name: string, dayNumber: number) => {
  const home = homeFor(name)!;
  return mergeFixedObligations(name, dayNumber, idleDay(home.x, home.y));
};

// The step in effect at a given game-minute: the last one that has started.
const stepAt = <T extends { startMinute: number }>(schedule: T[], minute: number): T =>
  [...schedule].reverse().find((s) => s.startMinute <= minute)!;

// Day 1 is a Monday, so day N + 1 is the next weekday along.
const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;

describe('the nightly sleep block', () => {
  const ORDINARY = ['Yvonne', 'Nikhil', 'Sharifah', 'Naomi', 'Harpreet', 'Emeka'];

  it.each(ORDINARY)('puts %s in bed at midnight and at 11pm', (name) => {
    const schedule = scheduleFor(name, MONDAY);
    expect(isSleepStep(stepAt(schedule, 0))).toBe(true);
    expect(isSleepStep(stepAt(schedule, 23 * 60))).toBe(true);
  });

  it.each(ORDINARY)('has %s up and about by mid-morning', (name) => {
    const schedule = scheduleFor(name, MONDAY);
    expect(isSleepStep(stepAt(schedule, 10 * 60))).toBe(false);
  });

  it('wakes them at their own hour and beds them down at their own hour', () => {
    const schedule = scheduleFor('Yvonne', MONDAY);
    const { bed, wake } = sleepWindowFor('Yvonne');
    expect({ bed, wake }).toEqual({ bed: DEFAULT_BED_MINUTE, wake: DEFAULT_WAKE_MINUTE });
    expect(isSleepStep(stepAt(schedule, wake - 1))).toBe(true);
    expect(isSleepStep(stepAt(schedule, wake))).toBe(false);
    expect(isSleepStep(stepAt(schedule, bed - 1))).toBe(false);
    expect(isSleepStep(stepAt(schedule, bed))).toBe(true);
  });

  it('reads the bedtime off the persona library rather than one town-wide hour', () => {
    // Bernard's row says "Early sleeper"; Tiago's says "Late-night worker / night owl".
    expect(sleepWindowFor('Bernard')).toEqual({ bed: 21 * 60, wake: 6 * 60 });
    expect(sleepWindowFor('Tiago')).toEqual({ bed: 1 * 60, wake: 9 * 60 });
    // Which means at 22:00 one of them is asleep and the other is not.
    expect(isSleepStep(stepAt(scheduleFor('Bernard', MONDAY), 22 * 60))).toBe(true);
    expect(isSleepStep(stepAt(scheduleFor('Tiago', MONDAY), 22 * 60))).toBe(false);
  });

  it('keeps a night owl in bed through the small hours instead', () => {
    const schedule = scheduleFor('Tiago', MONDAY);
    expect(isSleepStep(stepAt(schedule, 30))).toBe(false); // 00:30, still out
    expect(isSleepStep(stepAt(schedule, 3 * 60))).toBe(true); // 03:00, home in bed
    expect(isSleepStep(stepAt(schedule, 10 * 60))).toBe(false); // 10:00, up
  });

  it('gives every sleep block a getting-up step to wake into', () => {
    // Waking is what resets fatigue, so it has to be a step of its own rather
    // than whenever the LLM's first entry happens to start.
    const schedule = scheduleFor('Yvonne', MONDAY);
    const { wake } = sleepWindowFor('Yvonne');
    expect(stepAt(schedule, wake).activity).toBe('waking up and getting ready');
  });
});

describe('the night-shift roster', () => {
  it('rosters only the two shift workers, and not every night', () => {
    expect(worksNightShift('Nurul', TUESDAY)).toBe(true);
    expect(worksNightShift('Nurul', MONDAY)).toBe(false);
    expect(worksNightShift('Dylan', THURSDAY)).toBe(true);
    expect(worksNightShift('Dylan', TUESDAY)).toBe(false);
    // Nobody else is on it at all, on any day of the week.
    for (const name of ['Yvonne', 'Bernard', 'Tiago', 'Hanna', 'Sharifah']) {
      for (let day = 1; day <= 7; day++) {
        expect(worksNightShift(name, day)).toBe(false);
      }
    }
  });

  it('has Nurul on the ward at midnight while the town sleeps', () => {
    // She clocks on at 22:00 Tuesday and is still there through Wednesday's
    // small hours — the two halves of one night, across two game-days.
    const tuesday = scheduleFor('Nurul', TUESDAY);
    const wednesday = scheduleFor('Nurul', WEDNESDAY);
    expect(stepAt(tuesday, NIGHT_SHIFT_START).locationId).toBe('changi_hospital');
    expect(isSleepStep(stepAt(tuesday, 23 * 60))).toBe(false);
    expect(stepAt(wednesday, 2 * 60).locationId).toBe('changi_hospital');
    // Meanwhile a colleague on no roster is in bed at the same moment.
    expect(isSleepStep(stepAt(scheduleFor('Hanna', WEDNESDAY), 2 * 60))).toBe(true);
  });

  it('sends her home to sleep through the middle of the day after', () => {
    const wednesday = scheduleFor('Nurul', WEDNESDAY);
    expect(isSleepStep(stepAt(wednesday, 9 * 60))).toBe(true);
    expect(stepAt(wednesday, POST_NIGHT_SLEEP_END).activity).toBe('waking up and getting ready');
  });

  it('gives a night-shift day no ordinary 9-to-6 block on top', () => {
    expect(hasNightShiftDuty('Nurul', TUESDAY)).toBe(true);
    expect(hasNightShiftDuty('Nurul', WEDNESDAY)).toBe(true);
    // Tuesday she is free in the day before clocking on; Wednesday she is asleep.
    expect(stepAt(scheduleFor('Nurul', TUESDAY), 10 * 60).locationId).not.toBe('changi_hospital');
    expect(isSleepStep(stepAt(scheduleFor('Nurul', WEDNESDAY), 10 * 60))).toBe(true);
  });

  it('puts her back on an ordinary night once the run ends', () => {
    // Thursday: off the ward at 06:00, day sleep, and then a normal bedtime —
    // the evening block must come back rather than leaving her up all night.
    const thursday = scheduleFor('Nurul', THURSDAY);
    expect(stepAt(thursday, 2 * 60).locationId).toBe('changi_hospital');
    expect(isSleepStep(stepAt(thursday, 23 * 60))).toBe(true);
  });
});

describe('sleep pressure', () => {
  it('is flat through the day and peaks at bedtime', () => {
    const ramp = SLEEP_PRESSURE_RAMP_MINUTES;
    expect(sleepPressureFloor(ramp + 1, ramp)).toBe(0);
    expect(sleepPressureFloor(ramp, ramp)).toBe(0);
    expect(sleepPressureFloor(ramp / 2, ramp)).toBe(Math.round(SLEEP_PRESSURE_PEAK / 2));
    expect(sleepPressureFloor(0, ramp)).toBe(SLEEP_PRESSURE_PEAK);
  });

  it('holds at the peak for as long as they are asleep', () => {
    // 0 means "in the block"; it never eases off partway through the night, so
    // an agent woken by a scenario is still exhausted rather than refreshed.
    expect(sleepPressureFloor(0, SLEEP_PRESSURE_RAMP_MINUTES)).toBe(SLEEP_PRESSURE_PEAK);
  });

  it('applies no pressure when there is no sleep block ahead', () => {
    // A night-shift worker on the first evening of a run: at work, not overdue
    // for bed. Anything else would have them nodding off on shift.
    expect(sleepPressureFloor(undefined, SLEEP_PRESSURE_RAMP_MINUTES)).toBe(0);
  });

  it('crosses the socialising cutoff before bedtime, not at it', () => {
    // The point of the ramp: they stop accepting invitations while still up, so
    // the evening winds down rather than a conversation ending mid-sentence
    // because someone hit their bedtime.
    const ramp = SLEEP_PRESSURE_RAMP_MINUTES;
    expect(FATIGUE_SOCIAL_CUTOFF).toBeLessThan(SLEEP_PRESSURE_PEAK);
    // Half an hour from bed: done talking.
    expect(tooTiredToSocialize(sleepPressureFloor(30, ramp))).toBe(true);
    // Two hours out: still good company.
    expect(tooTiredToSocialize(sleepPressureFloor(120, ramp))).toBe(false);
  });

  it('leaves a rested agent sociable', () => {
    expect(tooTiredToSocialize(FATIGUE_BASELINE)).toBe(false);
  });
});

// Agent.minutesUntilSleep is what feeds the floor. It reads the agent's own
// schedule, which means the day boundary has to be handled: a night owl's
// bedtime sits at the TOP of today's step list, already behind them, so the
// naive "look for a later sleep step" answer is "never" — and they would then
// cheerfully hold a conversation at half past midnight.
describe('finding the next bedtime in a merged schedule', () => {
  // The same walk Agent.minutesUntilSleep does, over a merged day.
  const nextSleep = (name: string, dayNumber: number, minutesIntoDay: number) => {
    const schedule = scheduleFor(name, dayNumber);
    const current = stepAt(schedule, minutesIntoDay);
    if (isSleepStep(current)) return 0;
    const later = schedule.find((s) => s.startMinute > minutesIntoDay && isSleepStep(s));
    if (later) return later.startMinute - minutesIntoDay;
    // The wrap: fall back to the declared bedtime, unless they're clocking on.
    if (worksNightShift(name, dayNumber)) return undefined;
    const { bed } = sleepWindowFor(name);
    const delta = bed - minutesIntoDay;
    return delta >= 0 ? delta : delta + 24 * 60;
  };

  it('finds tonight’s block for an ordinary evening', () => {
    expect(nextSleep('Yvonne', MONDAY, 20 * 60)).toBe(DEFAULT_BED_MINUTE - 20 * 60);
  });

  it('wraps past midnight for a night owl', () => {
    // Tiago goes to bed at 01:00, which today's schedule already lists at the
    // top. At 22:00 he is three hours from bed, not an infinity from it.
    expect(nextSleep('Tiago', MONDAY, 22 * 60)).toBe(3 * 60);
    // And mid-morning he is nowhere near it, so the floor stays flat.
    expect(nextSleep('Tiago', MONDAY, 10 * 60)).toBeGreaterThan(SLEEP_PRESSURE_RAMP_MINUTES);
  });

  it('gives a night-shift worker clocking on no bedtime to ramp toward', () => {
    // Nurul is on the ward from 22:00; she should not be nodding off at 23:00.
    expect(nextSleep('Nurul', TUESDAY, 20 * 60)).toBeUndefined();
    expect(nextSleep('Nurul', TUESDAY, 23 * 60)).toBeUndefined();
  });

  it('ramps a night-shift worker toward the day sleep that follows the shift', () => {
    // Wednesday 05:00: she comes off at 06:00 and is in bed at 07:00.
    expect(nextSleep('Nurul', WEDNESDAY, 5 * 60)).toBe(2 * 60);
    expect(nextSleep('Nurul', WEDNESDAY, 9 * 60)).toBe(0); // asleep
  });
});
