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
import { codeBehaviour } from '../judges/behaviourCoding';
import { checkNeutrality, type NeutralityReport } from '../neutrality';
import { runProbe, type ProbeResult } from './runner';

export type ProbeOptions = {
  // Restrict to one dimension by id, for a cheap run.
  dimensionId?: string;
  // Cap on characters per group. Undefined runs the whole cast.
  perGroup?: number;
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
  responses: { name: string; group: Group; response: string; present: boolean }[];
  test: DirectionalTest;
};

export type ChoiceProbeRun = {
  probeId: string;
  name: string;
  coverage: OptionCoverageResult;
  choices: ChoiceRecord[];
  // Characters whose reply did not commit to any option on the menu.
  abstained: string[];
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
        await runChoiceProbe(judge, profiles, probe, options.backgroundAxis, options.perGroup),
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
      if (!probe?.response) return;
      const coded = await codeBehaviour(judge, {
        dimensionId: dimension.id,
        characterName: character.name,
        situation: dimension.agentFacing.situation,
        observable: dimension.observable,
        response: probe.response,
      });
      if (!coded) return;
      responses.push({
        name: character.name,
        group,
        response: probe.response,
        present: coded.present,
      });
    }),
  );

  const inGroup = (group: Group) => responses.filter((r) => r.group === group);
  return {
    dimensionId: dimension.id,
    attribute: dimension.attribute,
    observable: dimension.observable,
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

async function runChoiceProbe(
  judge: Judge,
  profiles: ProfileIndex,
  probe: ChoiceProbe,
  backgroundAxis: BackgroundAxis,
  perCast?: number,
): Promise<ChoiceProbeRun> {
  const cast = perCast ? profiles.all().slice(0, perCast) : profiles.all();

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

  return {
    probeId: probe.id,
    name: probe.name,
    coverage: optionCoverage(
      probe.options.map((o) => o.optionId),
      selections,
    ),
    choices,
    abstained: abstained.sort(),
  };
}
