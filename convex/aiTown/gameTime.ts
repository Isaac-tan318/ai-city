// Shared in-game time logic. The GameClock UI imports the same constants so
// the server-side schedule logic and the on-screen clock never drift.

// Full day+night cycle in real-world ms (10 minutes).
export const CYCLE_MS = 10 * 60 * 1000;
// Length of the day half of the cycle in real-world ms (5 minutes).
export const DAY_MS = 5 * 60 * 1000;

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
  // Day half spans 6 AM (06:00) to 6 PM (18:00); night half spans 18:00 back to 06:00.
  const rawHours = isDay
    ? 6 + (cycleProgress / DAY_MS) * 12
    : 18 + ((cycleProgress - DAY_MS) / DAY_MS) * 12;
  const hour = rawHours % 24;
  const minutesIntoDay = Math.floor(hour * 60);
  const h12 = Math.floor(hour) % 12 || 12;
  const minutes = Math.floor((hour % 1) * 60);
  const ampm = hour < 12 ? 'AM' : 'PM';
  const timeStr = `${h12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  return { dayNumber, minutesIntoDay, hour, isDay, timeStr };
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
