// One place that knows what a character is, assembled from the repo's own data.
//
// Two views of the same person, kept strictly apart because the whole framework
// depends on the separation:
//
//   selfView  — the authored identity and structured profile the NPC itself is
//               given. This is what the probe runner may put in a prompt.
//   truthView — data/groundTruth.ts: hard constraints, essential needs, budget
//               ceiling. This is the answer key. It goes to judges only, never
//               to anything role-playing a character.
//
// Mixing the two would make every metric here meaningless at once: an NPC shown
// its own hard constraints in the prompt would disclose them perfectly, and
// Component 4 would report a triumph that measured nothing.
import { Descriptions, type Description } from '../../../data/characters';
import { groundTruth, type GroundTruthProfile } from '../../../data/groundTruth';
import type { GroundTruthRow } from './normalize';

// Which shared characteristic counts as "the same background" for the purpose
// of within-group diversity. Selected with --background.
export type BackgroundAxis = 'nationality' | 'region' | 'religion' | 'nationality-subgroup';

export const BACKGROUND_AXES: BackgroundAxis[] = [
  'nationality',
  'region',
  'religion',
  'nationality-subgroup',
];

export type SelfView = {
  name: string;
  identity: string;
  occupation?: string;
  religion?: string;
  // The structured key-value background (data/characterProfiles.ts vocabulary).
  profile: Record<string, string>;
};

export type TruthView = GroundTruthProfile & { name: string };

export type CharacterRecord = {
  name: string;
  self: SelfView;
  truth?: TruthView;
};

export class ProfileIndex {
  private readonly byName = new Map<string, CharacterRecord>();

  constructor(overrideGroundTruth: GroundTruthRow[] = []) {
    // Ground truth exported from a live world wins over the checked-in file:
    // if the two disagree, the world is what actually produced the transcript.
    const truthByName = new Map<string, TruthView>();
    for (const [name, profile] of Object.entries(groundTruth)) {
      truthByName.set(name.toLowerCase(), { name, ...profile });
    }
    for (const row of overrideGroundTruth) {
      truthByName.set(row.name.toLowerCase(), { ...row });
    }

    for (const description of Descriptions as Description[]) {
      const key = description.name.toLowerCase();
      this.byName.set(key, {
        name: description.name,
        self: {
          name: description.name,
          identity: description.identity,
          occupation: description.background?.occupation,
          religion: description.background?.religion,
          profile: description.profile ?? {},
        },
        truth: truthByName.get(key),
      });
    }
    // A world may contain a character the repo no longer defines. Keep the
    // ground truth so a transcript author is still recognised.
    for (const [key, truth] of truthByName) {
      if (this.byName.has(key)) continue;
      this.byName.set(key, {
        name: truth.name,
        self: { name: truth.name, identity: '', profile: {} },
        truth,
      });
    }
  }

  get(name: string): CharacterRecord | undefined {
    return this.byName.get(name.trim().toLowerCase());
  }

  has(name: string): boolean {
    return this.byName.has(name.trim().toLowerCase());
  }

  all(): CharacterRecord[] {
    return [...this.byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Everyone carrying a value for a structured profile field — the candidate
  // pool for one theory dimension.
  withAttribute(key: string): CharacterRecord[] {
    return this.all().filter((c) => !!c.self.profile[key]?.trim());
  }

  attribute(name: string, key: string): string | undefined {
    return this.get(name)?.self.profile[key];
  }

  // The background axis NPCs are grouped on for within-group diversity.
  //
  // This has to be a parameter, not a constant. The framework defines WGDR over
  // "NPCs sharing a similar TARGET background" — the axis is part of the
  // question being asked, and different axes ask genuinely different questions:
  // whether Singaporeans converge is not the same question as whether Muslims
  // do. It also has to be coarse enough to produce pairs at all. On this cast,
  // nationality-and-subgroup leaves exactly one group of two, so WGDR over it
  // would rest on a single pair and mean nothing.
  //
  // A character with no value on the axis gets a group of their own, so they can
  // never be paired with another unknown — an "unknown" group would compare
  // people who have nothing in common except a missing field.
  background(name: string, axis: BackgroundAxis = 'nationality'): string {
    const record = this.get(name);
    if (!record) return `unknown:${name}`;
    const field = (key: string) => record.self.profile[key]?.trim();
    const own = `unknown:${record.name}`;
    switch (axis) {
      case 'nationality':
        return field('Nationality') ?? record.truth?.culturalBackground ?? own;
      case 'region':
        return field('Region') ?? own;
      case 'religion':
        return field('Religion / worldview') ?? record.truth?.religion ?? own;
      case 'nationality-subgroup': {
        const nationality = field('Nationality');
        const subgroup = field('Cultural subgroup');
        if (nationality && subgroup) return `${nationality} / ${subgroup}`;
        return nationality ?? record.truth?.culturalBackground ?? own;
      }
    }
  }
}

// --- Prompt blocks -------------------------------------------------------------
//
// Two renderers, deliberately in the same file and next to each other, so it is
// obvious at a glance which one is safe to show a role-playing NPC.

// SAFE for an NPC prompt. Its own identity and its own structured background —
// nothing it would not know about itself, and no hard-constraint answer key.
export function renderSelfView(self: SelfView): string {
  const lines = [`You are ${self.name}.`, self.identity.trim()].filter(Boolean);
  const entries = Object.entries(self.profile).filter(([, v]) => v?.trim());
  if (entries.length > 0) {
    lines.push('', 'About you:');
    for (const [key, value] of entries) lines.push(`  ${key}: ${value}`);
  }
  return lines.join('\n');
}

// JUDGE ONLY. Never pass this to anything that speaks as a character.
// Mirrors the profile block convex/evaluator.ts builds, so a judgement here and
// a score there are made against the same description of the person.
export function renderTruthView(truth: TruthView): string {
  return [
    `${truth.name}:`,
    `  background: ${truth.culturalBackground}; ${truth.religion}`,
    `  ABSOLUTE constraints: ${truth.hardTaboos.length ? truth.hardTaboos.join(' | ') : 'none'}`,
    `  essential needs: ${truth.essentialNeeds.join(' | ') || 'none'}`,
    `  preferences: ${truth.preferences.join(' | ') || 'none'}`,
    `  budget ceiling: ${truth.budgetLimit > 0 ? `about S$${truth.budgetLimit}` : 'no real limit'}`,
    `  communication style: ${truth.communicationStyle}`,
  ].join('\n');
}

// JUDGE ONLY. The combined picture, used by the persona-fidelity judge, which
// has to weigh an utterance against both the authored identity and the hidden
// constraints.
export function renderFullProfile(record: CharacterRecord): string {
  const parts = [renderSelfView(record.self)];
  if (record.truth) {
    parts.push('', 'Private facts about them (they have not necessarily said these out loud):');
    parts.push(renderTruthView(record.truth));
  }
  return parts.join('\n');
}
