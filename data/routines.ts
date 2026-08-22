// Background-driven FIXED routines (Stage 1 of the routines feature).
//
// These are deterministic obligations layered ON TOP of the LLM-generated daily
// schedule. The LLM plans the flexible parts of a character's day; this module
// guarantees the rigid parts land at exact times regardless of what the LLM did:
//   - Weekday 9 AM–6 PM work shifts (everyone with a workplace).
//   - Sunday Christian service (christian characters) — held at home.
//   - Friday Muslim prayer (muslim characters) — held at home.
//
// These location-based obligations are merged into the schedule as real steps
// the agent walks to (fixed obligations always win on time conflicts).
//
// This file is intentionally self-contained (only imports sibling data modules)
// so it can be shared by both the Convex backend and any frontend tooling.

import { Descriptions } from './characters';
import {
  CHARACTER_WORKPLACES,
  getLocationById,
  homeFor,
  type CityLocation,
} from './cityLocations';

export type Religion = 'none' | 'muslim' | 'christian';
export type Background = { occupation: string; religion: Religion };

// Structurally compatible with ScheduleStep in convex/aiTown/agent.ts. Kept as a
// local shape so this module stays free of backend imports.
export type SchedStep = {
  startMinute: number;
  locationId: string;
  destination: { x: number; y: number };
  activity: string;
  emoji?: string;
  description: string;
};

// Does this block have the character asleep? Lives here (rather than in the
// engine) so both the agent tick and the scenario manager read the same rule —
// the engine resets fatigue on it and keeps sleepers from wandering, the manager
// won't drag someone out of bed into a scenario.
export function isSleepStep(step: { activity: string; description: string }): boolean {
  return /\b(sleep|sleeping|bed|turning in|going to sleep|rest for the night)\b/.test(
    `${step.activity} ${step.description}`.toLowerCase(),
  );
}

// A half-open time interval [start, end) (game-minutes into the day) carrying the
// step that should be active during it. Used internally by the overlay merge.
type Interval = { start: number; end: number; step: SchedStep };

const MINUTES_PER_DAY = 24 * 60;

// ---- Tunables (game-minutes into the day) --------------------------------

// Weekday work shift. Applies to every character that has a workplace.
const SHIFT_START = 9 * 60; // 09:00
const SHIFT_END = 18 * 60; // 18:00
const LUNCH_START = 12 * 60; // 12:00
const LUNCH_END = 13 * 60; // 13:00

// Sunday Christian service — observed at the character's home.
const SERVICE_START = 10 * 60; // 10:00
const SERVICE_END = 11 * 60 + 30; // 11:30

// Friday Muslim prayer (Jumu'ah, around midday) — observed at the character's
// home. The window is generous so the agent has time to travel home and back.
const FRIDAY_PRAYER_START = 12 * 60 + 30; // 12:30
const FRIDAY_PRAYER_END = 14 * 60; // 14:00

// ---- Background lookup ----------------------------------------------------

const DEFAULT_BACKGROUND: Background = { occupation: 'resident', religion: 'none' };

export function backgroundFor(characterName: string): Background {
  const d = Descriptions.find((x) => x.name === characterName) as
    | { background?: Background }
    | undefined;
  return d?.background ?? DEFAULT_BACKGROUND;
}

// Day 1 is treated as Monday, matching gameTime.dayOfWeekIndex. Recomputed here
// (rather than imported from the backend) to keep this module dependency-light.
function dayOfWeekIndex(dayNumber: number): number {
  return (((dayNumber - 1) % 7) + 7) % 7;
}

// ---- Obligation construction ---------------------------------------------

function stepAt(loc: CityLocation, activity: string, emoji: string, description: string): SchedStep {
  return {
    startMinute: 0, // overwritten with the interval start when flattened
    locationId: loc.id,
    destination: { x: loc.x, y: loc.y },
    activity,
    emoji,
    description,
  };
}

// The location-based fixed obligations for a character on a given game-day,
// expressed as time intervals to overlay onto the LLM schedule.
function locationObligations(characterName: string, dayNumber: number): Interval[] {
  const obs: Interval[] = [];
  const bg = backgroundFor(characterName);
  const dow = dayOfWeekIndex(dayNumber);

  // Weekday work shift (Mon–Fri), with a lunch break carved out of it.
  const workplace = CHARACTER_WORKPLACES[characterName];
  if (workplace && dow < 5) {
    const loc = getLocationById(workplace.locationId);
    if (loc) {
      obs.push({
        start: SHIFT_START,
        end: SHIFT_END,
        step: stepAt(loc, workplace.activity, '💼', 'on shift at work'),
      });
      obs.push({
        start: LUNCH_START,
        end: LUNCH_END,
        step: stepAt(loc, 'taking a lunch break', '🍜', 'lunch break'),
      });
    }
  }

  // Sunday Christian service — held at home.
  if (bg.religion === 'christian' && dow === 6) {
    const loc = homeFor(characterName);
    if (loc) {
      obs.push({
        start: SERVICE_START,
        end: SERVICE_END,
        step: stepAt(loc, 'observing Sunday service at home', '⛪', 'Sunday service at home'),
      });
    }
  }

  // Friday Muslim prayer — held at home.
  if (bg.religion === 'muslim' && dow === 4) {
    const loc = homeFor(characterName);
    if (loc) {
      obs.push({
        start: FRIDAY_PRAYER_START,
        end: FRIDAY_PRAYER_END,
        step: stepAt(loc, 'observing Friday prayer at home', '🕌', 'Friday prayer at home'),
      });
    }
  }

  return obs;
}

// ---- Interval overlay merge ----------------------------------------------

// Turn an LLM schedule (sorted by startMinute) into a list of intervals that
// tile the day, each carrying its step.
function toIntervals(schedule: SchedStep[]): Interval[] {
  const sorted = [...schedule].sort((a, b) => a.startMinute - b.startMinute);
  const out: Interval[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].startMinute;
    const end = i + 1 < sorted.length ? sorted[i + 1].startMinute : MINUTES_PER_DAY;
    if (end > start) out.push({ start, end, step: sorted[i] });
  }
  return out;
}

// Overlay one obligation interval onto a base set of intervals: any base time
// covered by the obligation is removed (the obligation wins), and the surviving
// base fragments before/after the obligation are kept so the underlying activity
// resumes automatically once the obligation ends.
function overlay(base: Interval[], ob: Interval): Interval[] {
  const out: Interval[] = [];
  for (const b of base) {
    if (b.end <= ob.start || b.start >= ob.end) {
      out.push(b); // no overlap
      continue;
    }
    if (b.start < ob.start) out.push({ start: b.start, end: ob.start, step: b.step });
    if (b.end > ob.end) out.push({ start: ob.end, end: b.end, step: b.step });
    // The covered middle is dropped — the obligation replaces it.
  }
  out.push(ob);
  out.sort((a, b) => a.start - b.start);
  return out;
}

// Merge the deterministic fixed obligations for a character/day on top of the
// LLM-generated schedule. Fixed obligations always win on time conflicts.
export function mergeFixedObligations(
  characterName: string,
  dayNumber: number,
  llmSchedule: SchedStep[],
): SchedStep[] {
  const obligations = locationObligations(characterName, dayNumber);
  if (obligations.length === 0) return llmSchedule;

  let intervals = toIntervals(llmSchedule);
  // Apply earliest-starting first; a later obligation (e.g. lunch) can carve
  // into an earlier one (e.g. the shift) because overlay treats the running
  // result as the new base each pass.
  for (const ob of [...obligations].sort((a, b) => a.start - b.start || a.end - b.end)) {
    intervals = overlay(intervals, ob);
  }

  intervals.sort((a, b) => a.start - b.start);
  return intervals
    .filter((iv) => iv.end > iv.start)
    .map((iv) => ({ ...iv.step, startMinute: iv.start }));
}

// ===========================================================================
// Stage 2 — CONTEXTUAL random events
// ===========================================================================
//
// Short micro-events tied to the character's CURRENT schedule block. While an
// agent is settled at a location during work hours, they draw from that
// location's work pool (meetings, coffee runs, etc.); at any other time/place
// they draw from a generic "flexible" pool. This is what makes an A*STAR
// researcher experience office events 9 AM–6 PM but free-form activities
// outside those hours. The caller (tickSchedule) decides HOW OFTEN to swap one
// of these in; this module just owns the pools and the selection rule.

export type ContextualEvent = { description: string; emoji: string };

// Work-hour event pools, keyed by the locationId an agent is settled at. Keys
// correspond to the workplaces in CHARACTER_WORKPLACES / CITY_LOCATIONS.
const LOCATION_EVENTS: Record<string, ContextualEvent[]> = {
  astar: [
    { description: 'in a team stand-up meeting', emoji: '📊' },
    { description: 'grabbing a coffee from the pantry', emoji: '☕' },
    { description: 'running an experiment', emoji: '🧪' },
    { description: 'reviewing a colleague’s paper', emoji: '📄' },
    { description: 'debugging the lab rig', emoji: '🔧' },
  ],
  fusionopolis: [
    { description: 'in a sprint planning meeting', emoji: '🗓️' },
    { description: 'whiteboarding with the team', emoji: '🧑‍🏫' },
    { description: 'grabbing a coffee', emoji: '☕' },
    { description: 'on a video call with a client', emoji: '💻' },
  ],
  mbs: [
    { description: 'waiting in the taxi queue for a fare', emoji: '🚕' },
    { description: 'chatting with a tourist', emoji: '🗺️' },
    { description: 'wiping down the cab', emoji: '🧽' },
    { description: 'grabbing a quick kopi', emoji: '☕' },
  ],
  restaurant: [
    { description: 'taking a customer’s order', emoji: '📝' },
    { description: 'firing up the wok', emoji: '🔥' },
    { description: 'clearing and wiping tables', emoji: '🧽' },
    { description: 'restocking the chili sauce', emoji: '🌶️' },
  ],
  shophouses: [
    { description: 'pulling an espresso shot', emoji: '☕' },
    { description: 'steaming milk for a latte', emoji: '🥛' },
    { description: 'chatting up a regular', emoji: '💬' },
    { description: 'grinding fresh beans', emoji: '⚙️' },
  ],
  university: [
    { description: 'sitting in a lecture', emoji: '🎓' },
    { description: 'cramming in the library', emoji: '📚' },
    { description: 'in a group project huddle', emoji: '👥' },
    { description: 'queuing for an iced Milo', emoji: '🥤' },
  ],
};

// Off-hours / non-work pool: free-form activities for any time the agent isn't
// on the clock at a work location.
const FLEXIBLE_EVENTS: ContextualEvent[] = [
  { description: 'scrolling on the phone', emoji: '📱' },
  { description: 'people-watching', emoji: '👀' },
  { description: 'taking a slow stroll', emoji: '🚶' },
  { description: 'grabbing a snack', emoji: '🍪' },
  { description: 'listening to music', emoji: '🎧' },
  { description: 'relaxing for a bit', emoji: '😌' },
];

// Pick a contextual micro-event appropriate to where/when the agent is. During
// work hours (09:00–18:00) at a location with a work pool, returns an office-y
// event; otherwise returns a flexible one.
export function pickContextualEvent(
  locationId: string,
  minutesIntoDay: number,
): ContextualEvent {
  const inWorkHours = minutesIntoDay >= SHIFT_START && minutesIntoDay < SHIFT_END;
  const workPool = LOCATION_EVENTS[locationId];
  const pool = inWorkHours && workPool ? workPool : FLEXIBLE_EVENTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ===========================================================================
// Stage 3 — sick-day schedule (deterministic rest at home)
// ===========================================================================
//
// When the probabilistic health roll marks an agent sick, they skip their
// normal day (and the LLM planner) and rest at home instead. Kept here next to
// the other schedule builders so all schedule shapes live in one place.
export function buildSickSchedule(home: { x: number; y: number }): SchedStep[] {
  const step = (
    startMinute: number,
    activity: string,
    emoji: string,
  ): SchedStep => ({
    startMinute,
    locationId: 'home',
    destination: home,
    activity,
    emoji,
    description: 'sick at home, resting',
  });
  return [
    step(0, 'resting in bed, feeling unwell', '🤒'),
    step(8 * 60, 'dozing in and out, feeling lousy', '🤒'),
    step(12 * 60, 'sipping soup, still under the weather', '🍵'),
    step(16 * 60, 'resting on the couch', '🤒'),
    step(20 * 60, 'trying to sleep it off', '😴'),
  ];
}
