// The perception stream: what an agent SEES, as opposed to what it is told.
//
// Before this existed the memory stream had exactly two inputs — conversation
// summaries and scenario outcomes — so an agent could only ever remember things
// people said to it. Observations are the paper's primary memory-stream input,
// and they're what the reacting loop and reflection both read.
//
// Everything here is deterministic: no LLM is involved in producing an
// observation or scoring it. That's what makes it affordable to run a perception
// pass for every agent every few seconds.
//
// Kept dependency-light (convex/values, ./ids, and plain data modules) for the
// same reason as relationshipEvents.ts and affinity.ts: the engine, the memory
// action and the frontend all import it, and anything reaching into
// convex/aiTown/inputs.ts from here would form a circular import.
import { ObjectType, v } from 'convex/values';
import { playerId } from './ids';
import { FamilyTie, isFamilyMember } from './affinity';
import { AFFINITY_STANDOUT_DELTA, DEFAULT_AFFINITY } from '../constants';

export const serializedObservation = {
  // The observer — whose memory stream this belongs to.
  playerId,
  // Engine time (`now`) when it was perceived.
  at: v.number(),
  // Natural-language statement, e.g. "Saw Cedric wiping down the counter at the
  // Peranakan shophouses."
  description: v.string(),
  // Heuristic 1–6 salience. Drives both promotion into the embedded memory
  // stream and the reacting loop's cost gate.
  importance: v.number(),
  // Who the observation is about, so retrieval and the UI can filter by person.
  subjectPlayerIds: v.optional(v.array(playerId)),
  locationId: v.optional(v.string()),
  // Set once the reacting loop has considered it, so each observation prompts a
  // reaction at most once.
  processed: v.boolean(),
  // Set once promoted into `memories` with an embedding.
  promoted: v.boolean(),
};
export type SerializedObservation = ObjectType<typeof serializedObservation>;

// One entry of an agent's dedupe state: a subject key and a hash of the last
// state we recorded for it. Hashes rather than text because this lives on the
// Agent, which lives in the world document, which is rewritten every step.
export const observedFingerprint = v.object({
  k: v.string(),
  h: v.number(),
});

// Cheap, stable string hash. Only ever compared against itself, so collision
// resistance doesn't matter — a collision costs one skipped observation.
export function fingerprint(...parts: (string | undefined)[]): number {
  const s = parts.map((p) => p ?? '').join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function observationText(opts: {
  name: string;
  activity?: string;
  locationName: string;
}): string {
  return opts.activity
    ? `Saw ${opts.name} ${opts.activity} at ${opts.locationName}.`
    : `Saw ${opts.name} at ${opts.locationName}.`;
}

export function conversationObservationText(names: string[], locationName: string): string {
  if (names.length === 0) return '';
  const who =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${who} ${names.length === 1 ? 'was' : 'were'} talking at ${locationName}.`;
}

// How much this observation is worth remembering, 1–6.
//
// The paper spends an LLM call per memory on this; that's unaffordable at
// perception frequency, so it's a rule table instead. The rules all key off
// "would this stand out to THIS observer": family, someone they feel unusually
// strongly about, someone somewhere they wouldn't normally be, someone unwell.
export function observationImportance(opts: {
  family?: FamilyTie[];
  subjectName?: string;
  affinity?: number;
  // The observer's average affinity across everyone they know. Affinity is
  // scored RELATIVE to this, not against fixed thresholds: in a town where
  // everyone has warmed to everyone else the absolute number carries no
  // information, and a fixed ">= 75" rule then fires on every observation and
  // promotes the entire ambient stream into long-term memory.
  affinityMean?: number;
  // True when the subject is at neither their own workplace nor their home —
  // seeing a colleague at the hawker centre is worth more than seeing them at
  // their desk.
  outOfPlace?: boolean;
  subjectSick?: boolean;
  // Several people together says more than one person alone.
  groupSize?: number;
}): number {
  let score = 1;
  if (isFamilyMember(opts.family, opts.subjectName)) score += 2;
  const affinity = opts.affinity ?? DEFAULT_AFFINITY;
  const baseline = opts.affinityMean ?? DEFAULT_AFFINITY;
  if (Math.abs(affinity - baseline) >= AFFINITY_STANDOUT_DELTA) score += 2;
  if (opts.outOfPlace) score += 1;
  if (opts.subjectSick) score += 1;
  if ((opts.groupSize ?? 0) >= 3) score += 1;
  return Math.max(1, Math.min(6, score));
}

// The observer's average regard for the people they know, used as the baseline
// the rule above measures against. Undefined when they have no stored affinities
// yet, in which case the neutral default stands in.
export function affinityMean(affinities: Record<string, number> | undefined): number | undefined {
  if (!affinities) return undefined;
  const values = Object.values(affinities);
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
