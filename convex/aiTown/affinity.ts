// Helpers for the relationship system. Kept dependency-light (imports only plain
// constants) so it can be shared by the engine inputs, the prompt builder, the
// memory op, and the frontend inspector without risking the circular-import
// tangle around convex/aiTown/inputs.ts.
import {
  DEFAULT_AFFINITY,
  FAMILY_BASE_AFFINITY,
  HOSTILE_AFFINITY_THRESHOLD,
  MAX_AFFINITY,
  MIN_AFFINITY,
} from '../constants';

// A single authored family tie, e.g. { name: 'Sarah', relation: 'younger sister' }.
// Stored on AgentDescription; immutable. Relations are directional, so each
// character lists the tie from their own perspective.
export type FamilyTie = { name: string; relation: string };

// Snap an affinity value to a rounded integer within [MIN_AFFINITY, MAX_AFFINITY].
export function clampAffinity(n: number): number {
  return Math.max(MIN_AFFINITY, Math.min(MAX_AFFINITY, Math.round(n)));
}

// Is `otherName` one of this character's authored family members?
export function isFamilyMember(family: FamilyTie[] | undefined, otherName: string | undefined): boolean {
  if (!family || !otherName) return false;
  return family.some((f) => f.name === otherName);
}

// The directional relation label this character uses for `otherName`, if any.
export function familyRelation(
  family: FamilyTie[] | undefined,
  otherName: string | undefined,
): string | undefined {
  if (!family || !otherName) return undefined;
  return family.find((f) => f.name === otherName)?.relation;
}

// The starting affinity for a pair with no stored value yet.
export function defaultAffinity(isFamily: boolean): number {
  return isFamily ? FAMILY_BASE_AFFINITY : DEFAULT_AFFINITY;
}

// The effective affinity a character feels toward another: the stored value if
// one exists, otherwise the family-aware default.
export function affinityToward(opts: {
  affinities?: Record<string, number>;
  otherPlayerId: string;
  family?: FamilyTie[];
  otherName?: string;
}): number {
  const stored = opts.affinities?.[opts.otherPlayerId];
  if (stored !== undefined) return stored;
  return defaultAffinity(isFamilyMember(opts.family, opts.otherName));
}

// A short human/LLM-readable descriptor for an affinity score.
export function affinityLabel(n: number): string {
  if (n >= 80) return 'very close';
  if (n >= 65) return 'warm';
  if (n >= 45) return 'neutral';
  if (n >= HOSTILE_AFFINITY_THRESHOLD) return 'cool';
  return 'hostile';
}

// A small emoji for the inspector.
export function affinityEmoji(n: number): string {
  if (n >= 80) return '💚';
  if (n >= 65) return '🙂';
  if (n >= 45) return '😐';
  if (n >= HOSTILE_AFFINITY_THRESHOLD) return '🙁';
  return '💢';
}

// CSS colour for the inspector's affinity bar — green when warm, amber in the
// middle, red when hostile.
export function affinityColor(n: number): string {
  if (n >= 80) return '#4ade80';
  if (n >= 65) return '#86efac';
  if (n >= 45) return '#fcd34d';
  if (n >= HOSTILE_AFFINITY_THRESHOLD) return '#fb923c';
  return '#f87171';
}
