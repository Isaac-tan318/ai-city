// The `probe` pipeline: generate the controlled data Components 2 and 3 need.
//
// Organic town chat cannot support either of them. A directional test requires
// the same situation put to characters who differ on one attribute, and
// within-group diversity requires the same option set put to characters who
// share a background — neither ever happens by chance in a simulation where
// every conversation has its own context. So this puts the cast through
// standardized situations directly.
//
// The order of operations matters and is deliberate:
//
//   1. Group characters by attribute, deterministically, before anything is
//      generated. The grouping cannot be influenced by the responses.
//   2. Generate responses from profile and situation alone (probe/runner.ts).
//   3. Code the observable behaviour blind — the coder is not told the group.
//
// Each step is separated from the next by what it is NOT allowed to know. That
// is the whole design.
import {
  directionalConsistency,
  optionCoverage,
  withinGroupDiversity,
  type ChoiceRecord,
  type DirectionalTest,
  type OptionCoverageResult,
  type PlausibilityResult,
  type WithinGroupResult,
} from '../metrics';
import { ProfileIndex, type BackgroundAxis, type CharacterRecord } from '../corpus/profiles';
import type { Judge } from '../llm';
import { classify, DIMENSIONS, type Dimension, type Group } from '../theory/registry';
import { CHOICE_PROBES, type ChoiceProbe } from '../theory/probes';
import { assessFeasibility } from '../judges/choiceCoding';
import { codeBehaviour, type BehaviourLevel } from '../judges/behaviourCoding';
import { checkNeutrality, type NeutralityReport } from '../neutrality';
import { runProbe, type ProbeResult } from './runner';

export type ProbeOptions = {
  // Restrict to one dimension by id, for a cheap run.
  dimensionId?: string;
  // Cap on characters per attribute group, for the theory dimensions.
  // Undefined runs everyone who carries the attribute.
  perGroup?: number;
  // Separate cap for the choice probes, which have no high/low groups at all.
  //
  // These used to share --per-group, and it quietly wrecked Component 3:
  // --per-group 4 sliced the cast to the four alphabetically-first characters,
  // so a four-option menu could cover at most 4 picks (2/4 coverage looked like
  // polarization but was sample size), and those four had four different
  // nationalities, so within-group diversity had zero eligible pairs. When it
  // is set, the sample is drawn across background groups rather than off the
  // front of the alphabet.
  castSize?: number;
  // Skip the choice probes (Component 3) or the theory probes (Component 2).
  skipChoice: boolean;
  skipTheory: boolean;
  // Which shared characteristic counts as "the same background" for WGDR.
  backgroundAxis: BackgroundAxis;
};

export type DimensionRun = {
  dimensionId: string;
  attribute: string;
  observable: string;
  highLabel: string;
  lowLabel: string;
  groups: { high: string[]; low: string[]; unclassified: string[] };
  threshold: BehaviourLevel;
  responses: {
    name: string;
    group: Group;
    response: string;
    // The graded intensity, kept beside the boolean so a surprising rate can be
    // re-read at a different threshold without paying for the run again.
    level: BehaviourLevel;
    present: boolean;
  }[];
  test: DirectionalTest;
};

export type ChoiceProbeRun = {
  probeId: string;
  name: string;
  coverage: OptionCoverageResult;
  choices: ChoiceRecord[];
  // Characters whose reply did not commit to any option on the menu.
  abstained: string[];
  // How many characters were actually put in front of this menu, and whether
  // that is enough for the coverage figure to mean anything. With fewer
  // deciders than options, full coverage is impossible by construction and a
  // low one says nothing about the population.
  castSize: number;
  underpowered: boolean;
};

export type ProbeReport = {
  dimensions: DimensionRun[];
  plausibility?: PlausibilityResult;
  choiceProbes: ChoiceProbeRun[];
  withinGroup?: WithinGroupResult;
  neutrality: NeutralityReport;
};

export async function runProbes(
  judge: Judge,
  profiles: ProfileIndex,
  options: ProbeOptions,
): Promise<ProbeReport> {
  const dimensions: DimensionRun[] = [];

  if (!options.skipTheory) {
    const selected = options.dimensionId
      ? DIMENSIONS.filter((d) => d.id === options.dimensionId)
      : DIMENSIONS;
    if (options.dimensionId && selected.length === 0) {
      throw new Error(
        `No dimension '${options.dimensionId}'. Known: ${DIMENSIONS.map((d) => d.id).join(', ')}`,
      );
    }
    for (const dimension of selected) {
      dimensions.push(await runDimension(judge, profiles, dimension, options.perGroup));
    }
  }

  const choiceProbes: ChoiceProbeRun[] = [];
  if (!options.skipChoice) {
    for (const probe of CHOICE_PROBES) {
      choiceProbes.push(
        await runChoiceProbe(judge, profiles, probe, options.backgroundAxis, options.castSize),
      );
    }
  }

  const allChoices = choiceProbes.flatMap((p) => p.choices);
  return {
    dimensions,
    plausibility:
      dimensions.length > 0 ? directionalConsistency(dimensions.map((d) => d.test)) : undefined,
    choiceProbes,
    withinGroup: allChoices.length > 0 ? withinGroupDiversity(allChoices) : undefined,
    neutrality: checkNeutrality(),
  };
}

async function runDimension(
  judge: Judge,
  profiles: ProfileIndex,
  dimension: Dimension,
  perGroup?: number,
): Promise<DimensionRun> {
  // Step 1: grouping, before a single response exists.
  const groups: Record<Group, CharacterRecord[]> = { high: [], low: [], unclassified: [] };
  for (const character of profiles.withAttribute(dimension.attribute)) {
    groups[classify(dimension, character.self.profile[dimension.attribute])].push(character);
  }
  const high = perGroup ? groups.high.slice(0, perGroup) : groups.high;
  const low = perGroup ? groups.low.slice(0, perGroup) : groups.low;

  // Step 2: responses, from profile and situation only.
  const tested: { character: CharacterRecord; group: Group }[] = [
    ...high.map((c) => ({ character: c, group: 'high' as Group })),
    ...low.map((c) => ({ character: c, group: 'low' as Group })),
  ];
  const results = await Promise.all(
    tested.map(async ({ character, group }) => {
      const probe = await runProbe(judge, character, dimension.id, dimension.agentFacing);
      return { character, group, probe };
    }),
  );

  // Step 3: blind coding of the observable.
  const responses: DimensionRun['responses'] = [];
  await Promise.all(
    results.map(async ({ character, group, probe }) => {
      // Only a failed generation is skipped. A character who chose to say
      // nothing is an observation — coded 'absent' without spending a call,
      // since there is nothing for a coder to weigh — and dropping them would
      // silently remove exactly the people the theory predicts will stay quiet.
      if (!probe) return;
      if (!probe.response) {
        responses.push({
          name: character.name,
          group,
          response: '',
          level: 'absent',
          present: false,
        });
        return;
      }
      const coded = await codeBehaviour(judge, {
        dimensionId: dimension.id,
        characterName: character.name,
        situation: dimension.agentFacing.situation,
        observable: dimension.observable,
        response: probe.response,
        threshold: dimension.threshold,
      });
      if (!coded) return;
      responses.push({
        name: character.name,
        group,
        response: probe.response,
        level: coded.level,
        present: coded.present,
      });
    }),
  );

  const inGroup = (group: Group) => responses.filter((r) => r.group === group);
  return {
    dimensionId: dimension.id,
    attribute: dimension.attribute,
    observable: dimension.observable,
    threshold: dimension.threshold,
    highLabel: dimension.analysisOnly.highLabel,
    lowLabel: dimension.analysisOnly.lowLabel,
    groups: {
      high: groups.high.map((c) => c.name),
      low: groups.low.map((c) => c.name),
      unclassified: groups.unclassified.map((c) => c.name),
    },
    responses: responses.sort(
      (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
    ),
    test: {
      dimensionId: dimension.id,
      observable: dimension.observable,
      expected: dimension.analysisOnly.expected,
      // n counts characters who produced a codeable response, not those who
      // were selected — a dropped generation must not sit in the denominator
      // as an implicit "did not do it".
      high: { n: inGroup('high').length, hits: inGroup('high').filter((r) => r.present).length },
      low: { n: inGroup('low').length, hits: inGroup('low').filter((r) => r.present).length },
    },
  };
}

// Take a sample that keeps background groups intact. Slicing off the front of
// the alphabet is the one thing that must not happen here: within-group
// diversity needs characters who SHARE a background, and an alphabetical head
// is close to a guarantee that nobody does.
function sampleAcrossBackgrounds(
  profiles: ProfileIndex,
  backgroundAxis: BackgroundAxis,
  size: number,
): CharacterRecord[] {
  const groups = new Map<string, CharacterRecord[]>();
  for (const character of profiles.all()) {
    const key = profiles.background(character.name, backgroundAxis);
    const list = groups.get(key) ?? [];
    list.push(character);
    groups.set(key, list);
  }
  // Largest groups first, taken WHOLE before moving on.
  //
  // The obvious sampler — one from each group, then a second from each — is
  // exactly wrong here. Within-group diversity compares people who share a
  // background, so it needs depth inside a group, not breadth across them.
  // Round-robin over this cast produced fourteen characters from thirteen
  // different nationalities and therefore zero comparable pairs, which reads in
  // the report as "no diversity measured" when it really means "nobody was ever
  // put next to anyone comparable".
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
  const out: CharacterRecord[] = [];
  for (const group of ordered) {
    if (out.length >= size) break;
    out.push(...group.slice(0, size - out.length));
  }
  return out;
}

async function runChoiceProbe(
  judge: Judge,
  profiles: ProfileIndex,
  probe: ChoiceProbe,
  backgroundAxis: BackgroundAxis,
  castSize?: number,
): Promise<ChoiceProbeRun> {
  const cast = castSize
    ? sampleAcrossBackgrounds(profiles, backgroundAxis, castSize)
    : profiles.all();

  const results = await Promise.all(
    cast.map(async (character) => {
      const [outcome, feasibility] = await Promise.all([
        runProbe(judge, character, probe.id, {
          situation: probe.situation,
          ask: 'Which do you pick? Reply with ONLY strict JSON: {"optionId":"...","reason":"one short sentence"}',
          options: probe.options,
        }),
        assessFeasibility(judge, character, probe.options),
      ]);
      return { character, outcome, feasibility };
    }),
  );

  const choices: ChoiceRecord[] = [];
  const abstained: string[] = [];
  const selections: string[] = [];

  for (const { character, outcome, feasibility } of results) {
    if (!outcome?.chosenOptionId) {
      abstained.push(character.name);
      continue;
    }
    selections.push(outcome.chosenOptionId);
    const feasible = feasibility.filter((f) => f.feasible).map((f) => f.optionId);
    choices.push({
      scenarioId: probe.id,
      characterName: character.name,
      background: profiles.background(character.name, backgroundAxis),
      optionIds: probe.options.map((o) => o.optionId),
      chosenOptionId: outcome.chosenOptionId,
      feasibleOptionIds: feasible,
      // A choice is not free when constraints leave one option standing, or
      // when a profile field names one of the candidates outright.
      choiceDetermined:
        feasible.length <= 1 || feasibility.some((f) => f.feasible && f.namedByProfile),
    });
  }

  // Two deciders per option is the point below which a gap in coverage is more
  // likely to be sampling than preference.
  const underpowered = selections.length < probe.options.length * 2;

  return {
    probeId: probe.id,
    name: probe.name,
    coverage: optionCoverage(
      probe.options.map((o) => o.optionId),
      selections,
    ),
    choices,
    abstained: abstained.sort(),
    castSize: cast.length,
    underpowered,
  };
}
