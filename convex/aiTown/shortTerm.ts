// Helpers for the short-term memory system: four per-agent affective /
// physiological gauges (mood, stress, fatigue, hunger) plus a derived financial
// pressure from the economic balance. Kept dependency-light (imports only plain
// constants), like affinity.ts, so it can be shared by the engine tick, the
// input handlers, the prompt builder, the scorer, and the frontend inspector
// without dragging in the Game/Agent circular-import tangle.
import {
  SHORT_TERM_MIN,
  SHORT_TERM_MAX,
  MOOD_BASELINE,
  STRESS_BASELINE,
  FATIGUE_BASELINE,
  HUNGER_BASELINE,
  DEFAULT_BALANCE,
  FINANCIAL_COMFORT_THRESHOLD,
} from '../constants';

// The four mutable gauges plus a timestamp for time-decay bookkeeping. Stored on
// the Agent as `shortTerm` (lazily created — absent means "at baseline").
export type ShortTermComponent = 'mood' | 'stress' | 'fatigue' | 'hunger';

// The same four, enumerable at runtime. Anything that has to visit every gauge
// — the transition log, the manual-override handler — reads this rather than
// repeating the list and quietly missing one when a fifth is added.
export const SHORT_TERM_COMPONENTS: ShortTermComponent[] = ['mood', 'stress', 'fatigue', 'hunger'];

export type ShortTerm = {
  mood: number;
  stress: number;
  fatigue: number;
  hunger: number;
  // Engine time the gauges were last touched (for future rate-based decay).
  updatedAt: number;
};

// Where each gauge rests / decays back toward.
export const SHORT_TERM_BASELINES: Record<ShortTermComponent, number> = {
  mood: MOOD_BASELINE,
  stress: STRESS_BASELINE,
  fatigue: FATIGUE_BASELINE,
  hunger: HUNGER_BASELINE,
};

// Snap a gauge to a rounded integer within [SHORT_TERM_MIN, SHORT_TERM_MAX].
export function clampGauge(n: number): number {
  return Math.max(SHORT_TERM_MIN, Math.min(SHORT_TERM_MAX, Math.round(n)));
}

// A fresh gauge set at baseline (used when an agent has no stored shortTerm yet).
export function defaultShortTerm(now: number): ShortTerm {
  return {
    mood: MOOD_BASELINE,
    stress: STRESS_BASELINE,
    fatigue: FATIGUE_BASELINE,
    hunger: HUNGER_BASELINE,
    updatedAt: now,
  };
}

// The effective gauges for an agent: its stored values or the baseline defaults.
export function shortTermOrDefault(shortTerm: ShortTerm | undefined, now: number): ShortTerm {
  return shortTerm ?? defaultShortTerm(now);
}

// The single debit path for the economic model. Every place that takes money off
// an agent (daily living costs, meals, activity costs) goes through this so the
// balance can never run negative: an agent who can't cover something pays what
// they have and the rest is reported as `shortfall` for the caller to react to
// (e.g. eating at home instead of at a hawker stall).
export function spend(
  balance: number | undefined,
  amount: number,
): { balance: number; paid: number; shortfall: number } {
  const available = Math.max(0, balance ?? DEFAULT_BALANCE);
  const wanted = Math.max(0, amount);
  const paid = Math.min(available, wanted);
  return { balance: available - paid, paid, shortfall: wanted - paid };
}

// True when the agent can cover `amount` outright. Used to filter choices BEFORE
// they're made (see pickActivity) rather than only clamping the debit afterwards.
export function canAfford(balance: number | undefined, amount: number | undefined): boolean {
  return Math.max(0, balance ?? DEFAULT_BALANCE) >= Math.max(0, amount ?? 0);
}

// A savings balance → a 0–100 financial-pressure gauge. Pressure is 0 at/above the
// comfort threshold and 100 at (or below) zero savings, linear in between.
export function financialPressure(balance: number | undefined): number {
  const b = balance ?? DEFAULT_BALANCE;
  if (b >= FINANCIAL_COMFORT_THRESHOLD) return 0;
  if (b <= 0) return 100;
  return clampGauge(((FINANCIAL_COMFORT_THRESHOLD - b) / FINANCIAL_COMFORT_THRESHOLD) * 100);
}

// The full short-term picture a decision or prompt consumes: the four gauges plus
// derived financial pressure and the existing signals (health, and — when a
// specific other is in view — affinity) so callers read ONE combined model rather
// than re-deriving. Existing state (health/affinity) is reused, not duplicated.
export type ShortTermSnapshot = {
  mood: number;
  stress: number;
  fatigue: number;
  hunger: number;
  financialPressure: number;
  balance: number;
  health: 'well' | 'sick';
};

export function buildShortTermSnapshot(opts: {
  shortTerm?: ShortTerm;
  balance?: number;
  health?: 'well' | 'sick';
  now: number;
}): ShortTermSnapshot {
  const st = shortTermOrDefault(opts.shortTerm, opts.now);
  return {
    mood: clampGauge(st.mood),
    stress: clampGauge(st.stress),
    fatigue: clampGauge(st.fatigue),
    hunger: clampGauge(st.hunger),
    financialPressure: financialPressure(opts.balance),
    balance: opts.balance ?? DEFAULT_BALANCE,
    health: opts.health ?? 'well',
  };
}

// One adjustment to a single gauge, produced by an interaction/scenario outcome.
export type ShortTermDelta = { component: ShortTermComponent; delta: number };

// Per-agent reactivity multipliers derived from the durable profile — this is how
// "the same event affects different agents differently" (spec point 4). A resilient
// character gains less stress; a fit one tires less slowly; and so on. Returns a
// sparse map (missing component ⇒ multiplier 1).
export function shortTermSensitivity(
  profile?: Record<string, string>,
): Partial<Record<ShortTermComponent, number>> {
  if (!profile) return {};
  const text = Object.values(profile).join(' ').toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));
  const mult: Partial<Record<ShortTermComponent, number>> = {};
  if (has('resilient', 'calm', 'easygoing', 'even-tempered', 'unflappable', 'stoic', 'laid-back')) {
    mult.stress = 0.6;
  }
  if (has('anxious', 'high-strung', 'highly strung', 'nervous', 'worrier', 'easily stressed')) {
    mult.stress = 1.4;
  }
  if (has('energetic', 'athletic', 'fit', 'active', 'sporty', 'high energy')) {
    mult.fatigue = 0.7;
  }
  if (has('chronic fatigue', 'night shift', 'frail', 'tires easily', 'low energy', 'sickly')) {
    mult.fatigue = 1.4;
  }
  return mult;
}

// Apply a set of gauge deltas on top of an agent's current short-term state,
// scaled by optional per-component reactivity multipliers, clamped to [0,100].
// Returns the new gauges plus a signed `net` valence (positive = feeling better:
// mood up, or stress/fatigue/hunger down) for the transient map badge.
export function applyShortTermDeltas(
  base: ShortTerm | undefined,
  deltas: ShortTermDelta[],
  now: number,
  multipliers?: Partial<Record<ShortTermComponent, number>>,
): { shortTerm: ShortTerm; net: number } {
  const st: ShortTerm = { ...shortTermOrDefault(base, now) };
  let net = 0;
  for (const { component, delta } of deltas) {
    const mult = multipliers?.[component] ?? 1;
    const before = st[component];
    const after = clampGauge(before + delta * mult);
    net += component === 'mood' ? after - before : before - after;
    st[component] = after;
  }
  st.updatedAt = now;
  return { shortTerm: st, net };
}

// Decay every gauge a step back toward its baseline (called once per game-day).
export function decayTowardBaseline(st: ShortTerm, amount: number, now: number): ShortTerm {
  const step = (v: number, baseline: number) => {
    if (v > baseline) return Math.max(baseline, v - amount);
    if (v < baseline) return Math.min(baseline, v + amount);
    return v;
  };
  return {
    mood: clampGauge(step(st.mood, MOOD_BASELINE)),
    stress: clampGauge(step(st.stress, STRESS_BASELINE)),
    fatigue: clampGauge(step(st.fatigue, FATIGUE_BASELINE)),
    hunger: clampGauge(step(st.hunger, HUNGER_BASELINE)),
    updatedAt: now,
  };
}

// --- Descriptors (for prompts + the inspector) ---

// A coarse intensity band for a gauge value, phrased for the given direction so a
// high stress reads "very stressed" while a high mood reads "great".
type Band = 'none' | 'slight' | 'moderate' | 'high';

function band(n: number): Band {
  if (n >= 75) return 'high';
  if (n >= 50) return 'moderate';
  if (n >= 25) return 'slight';
  return 'none';
}

// Build the first-person clause injected into an agent's own prompt, e.g.
// "Right now you feel a bit low, quite tired, and are watching your budget closely."
// Returns undefined when everything is unremarkable (nothing worth telling the LLM).
export function shortTermSelfDescription(s: ShortTermSnapshot): string | undefined {
  const parts: string[] = [];
  // Mood (low is the notable direction; high just reads "in good spirits").
  if (s.mood <= 25) parts.push('in low spirits');
  else if (s.mood >= 80) parts.push('in good spirits');
  // Stress.
  const stress = band(s.stress);
  if (stress === 'high') parts.push('very stressed');
  else if (stress === 'moderate') parts.push('rather stressed');
  // Fatigue.
  const fatigue = band(s.fatigue);
  if (fatigue === 'high') parts.push('exhausted');
  else if (fatigue === 'moderate') parts.push('tired');
  // Hunger.
  const hunger = band(s.hunger);
  if (hunger === 'high') parts.push('very hungry');
  else if (hunger === 'moderate') parts.push('getting hungry');
  // Financial pressure.
  if (s.financialPressure >= 66) parts.push('anxious about money');
  else if (s.financialPressure >= 33) parts.push('watching your budget');
  if (parts.length === 0) return undefined;
  return `Right now you feel ${joinClause(parts)}.`;
}

function joinClause(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

// --- Inspector styling (mirrors affinityColor) ---

// Colour for a gauge bar. For "good-high" gauges (mood) high is green; for
// "bad-high" gauges (stress/fatigue/hunger/pressure) high is red.
export function gaugeColor(component: ShortTermComponent | 'financialPressure', n: number): string {
  const goodHigh = component === 'mood';
  const severity = goodHigh ? 100 - n : n;
  if (severity >= 75) return '#f87171';
  if (severity >= 50) return '#fb923c';
  if (severity >= 25) return '#fcd34d';
  return '#4ade80';
}

export const SHORT_TERM_EMOJI: Record<ShortTermComponent | 'financialPressure', string> = {
  mood: '🙂',
  stress: '😰',
  fatigue: '🥱',
  hunger: '🍚',
  financialPressure: '💰',
};
