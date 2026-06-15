// Shared in-game time logic. The GameClock UI imports the same constants so
// the server-side schedule logic and the on-screen clock never drift.

// The day is split into THREE segments that each run at a different real-world
// speed, so time "feels" fast or slow depending on what's happening:
//   • Daytime (6 AM→6 PM): stretched — passes slowly (lots going on).
//   • Evening (6 PM→12 AM): a normal pace.
//   • Deep night (12 AM→6 AM): heavily compressed — flies by (everyone asleep).
// Each segment still maps to its real span of game-hours; only the real-world
// duration differs.
//
// Daytime: 12 game-hours over 7 real minutes (~35s per game-hour).
export const DAY_MS = 7 * 60 * 1000;
// Evening: 6 game-hours over 2 real minutes (~20s per game-hour).
export const EVENING_MS = 2 * 60 * 1000;
// Deep night: 6 game-hours over 1 real minute (~10s per game-hour — quick).
export const DEEP_NIGHT_MS = 1 * 60 * 1000;
// Full day+night cycle in real-world ms (still 10 minutes total, so day
// counting, scenario timers, and schedules stay aligned).
export const CYCLE_MS = DAY_MS + EVENING_MS + DEEP_NIGHT_MS;

// In-game game-day length in "game minutes" — we map a full real cycle to 24h.
export const MINUTES_PER_DAY = 24 * 60;

export type GameTime = {
  // 1-indexed game day since the world started.
  dayNumber: number;
  // 0..1440 — game minutes since 00:00 today.
  minutesIntoDay: number;
  // 0..24 (float) — same as minutesIntoDay / 60, for display.
  hour: number;
  isDay: boolean;
  // e.g. "7:30 AM"
  timeStr: string;
};

export function computeGameTime(now: number, worldStartTime: number | undefined): GameTime {
  if (!worldStartTime) {
    return { dayNumber: 1, minutesIntoDay: 6 * 60, hour: 6, isDay: true, timeStr: '6:00 AM' };
  }
  const elapsed = now - worldStartTime;
  const cycleProgress = ((elapsed % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  const isDay = cycleProgress < DAY_MS;
  const dayNumber = Math.floor(elapsed / CYCLE_MS) + 1;
  // Three segments, each mapping its real-ms slice to its span of game-hours:
  //   [0, DAY_MS)                          → 6 AM..6 PM   (daytime, slow)
  //   [DAY_MS, DAY_MS+EVENING_MS)          → 6 PM..12 AM  (evening, normal)
  //   [DAY_MS+EVENING_MS, CYCLE_MS)        → 12 AM..6 AM  (deep night, quick)
  let rawHours: number;
  if (cycleProgress < DAY_MS) {
    rawHours = 6 + (cycleProgress / DAY_MS) * 12;
  } else if (cycleProgress < DAY_MS + EVENING_MS) {
    rawHours = 18 + ((cycleProgress - DAY_MS) / EVENING_MS) * 6;
  } else {
    rawHours = ((cycleProgress - DAY_MS - EVENING_MS) / DEEP_NIGHT_MS) * 6;
  }
  const hour = rawHours % 24;
  const minutesIntoDay = Math.floor(hour * 60);
  const h12 = Math.floor(hour) % 12 || 12;
  const minutes = Math.floor((hour % 1) * 60);
  const ampm = hour < 12 ? 'AM' : 'PM';
  const timeStr = `${h12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  return { dayNumber, minutesIntoDay, hour, isDay, timeStr };
}

// Map a game hour (0..24, where 6 = 6 AM) to its real-world ms offset from the
// start of the cycle (i.e. the `cycleProgress` value computeGameTime works with,
// measured from 6 AM). Accounts for the non-uniform day/night speeds, so callers
// that need real-ms thresholds for specific game times (lighting ramps, skip
// buttons) stay correct without re-deriving the piecewise mapping themselves.
export function cycleProgressForHour(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6 && h < 18) {
    // Daytime: 6 AM..6 PM across the (stretched) day segment.
    return ((h - 6) / 12) * DAY_MS;
  }
  if (h >= 18) {
    // Evening: 6 PM..12 AM across the evening segment.
    return DAY_MS + ((h - 18) / 6) * EVENING_MS;
  }
  // Deep night: 12 AM..6 AM across the (compressed) deep-night segment.
  return DAY_MS + EVENING_MS + (h / 6) * DEEP_NIGHT_MS;
}

// Format a past/absolute engine-ms timestamp as an in-game wall time, e.g.
// "Day 49, 2:08 AM". Use this anywhere we'd otherwise print real calendar time
// (new Date(ts).toLocaleString()) so conversation/memory timestamps stay on the
// same accelerated Singapore clock as the "current time" shown to the LLM.
export function formatGameTimestamp(ts: number, worldStartTime: number | undefined): string {
  const gt = computeGameTime(ts, worldStartTime);
  return `Day ${gt.dayNumber}, ${gt.timeStr}`;
}

// "HH:MM" (24h) → minutes-into-day; tolerant of "H:MM" and "HH:MM AM/PM".
export function parseTimeOfDay(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(min) || min < 0 || min >= 60) return null;
  const ampm = m[3]?.toUpperCase();
  if (ampm === 'AM') h = h === 12 ? 0 : h;
  else if (ampm === 'PM') h = h === 12 ? 12 : h + 12;
  if (h < 0 || h >= 24) return null;
  return h * 60 + min;
}

// Minutes from `currentMinutes` until `targetMinutes` of the next occurrence,
// handling wrap-around past midnight.
export function gameMinutesUntil(targetMinutes: number, currentMinutes: number): number {
  const delta = targetMinutes - currentMinutes;
  return delta >= 0 ? delta : delta + MINUTES_PER_DAY;
}

// Day-of-week derived from the 1-indexed game day. Day 1 is treated as Monday,
// so each block of 7 game days forms a Mon–Sun week.
const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export function dayOfWeekIndex(dayNumber: number): number {
  return (((dayNumber - 1) % 7) + 7) % 7;
}

export function dayOfWeekName(dayNumber: number): string {
  return DAY_NAMES[dayOfWeekIndex(dayNumber)];
}

// Monday–Friday are weekdays (indices 0–4); Saturday/Sunday are the weekend.
export function isWeekday(dayNumber: number): boolean {
  return dayOfWeekIndex(dayNumber) < 5;
}
