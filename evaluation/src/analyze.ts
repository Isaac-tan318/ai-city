// The `analyze` pipeline: score a recorded corpus against the framework.
//
// Runs whatever the input can support and says so explicitly for the rest. A
// chat-history export gets Components 1 and 4 and the neutrality lint; a full
// bundle adds Option Coverage, within-group diversity over the participants of a
// single decision, Component 5, and the aggregation comparison.
//
// Nothing here computes a rate. Judgements are gathered into the record types
// metrics.ts defines and handed over in one call per component, so the counting
// rules live in one tested file rather than being re-derived at each call site.
import {
  disclosurePlausibility,
  dynamicStateValidity,
  optionCoverage,
  personaFidelity,
  rate,
  withinGroupDiversity,
  type ChoiceRecord,
  type DisclosureResult,
  type DynamicStateResult,
  type GradedOpportunity,
  type OptionCoverageResult,
  type PersonaFidelityResult,
  type StateTransition,
  type WithinGroupResult,
} from './metrics';
import {
  compareAggregations,
  ruleDisagreementRate,
  type AggregationComparison,
  type AggregationOptions,
} from './aggregation';
import type { Conversation, Corpus, Decision } from './corpus/normalize';
import { ProfileIndex, type BackgroundAxis, type CharacterRecord } from './corpus/profiles';
import type { Judge } from './llm';
import { findOpportunities, type Opportunity } from './judges/opportunities';
import { gradeOpportunities, type FidelityJudgement } from './judges/personaFidelity';
import {
  gradeDisclosures,
  gradePremature,
  type DisclosureJudgement,
  type PrematureJudgement,
} from './judges/disclosure';
import { codeEndorsements } from './judges/endorsement';
import { assessFeasibility } from './judges/choiceCoding';
import { judgeValence, type Valence } from './judges/valence';
import {
  baselineFor,
  expectedMove,
  RESET_THRESHOLD,
  VALID_RESET_CAUSES,
} from './theory/stateRules';
import { checkNeutrality, type NeutralityReport } from './neutrality';

export type AnalyzeOptions = {
  // Cap on conversations judged, so a smoke test costs a handful of calls.
  limit?: number;
  aggregation: AggregationOptions;
  // Which shared characteristic counts as "the same background" for WGDR.
  backgroundAxis: BackgroundAxis;
};

export type AnalyzeResult = {
  source: string;
  counts: {
    conversations: number;
    conversationsJudged: number;
    decisions: number;
    stateEvents: number;
    charactersSeen: number;
    unknownAuthors: string[];
  };
  capabilityNotes: string[];
  personaFidelity?: PersonaFidelityResult;
  disclosure?: DisclosureResult;
  coverage?: {
    perDecision: { scenarioId: string; scenarioName: string; result: OptionCoverageResult }[];
    endorsementRate: ReturnType<typeof rate>;
    withinGroup: WithinGroupResult;
  };
  dynamicState?: DynamicStateResult;
  aggregation?: {
    comparisons: AggregationComparison[];
    disagreement: ReturnType<typeof ruleDisagreementRate>;
  };
  neutrality: NeutralityReport;
  // Everything the rates above were computed from, kept so any number in the
  // report can be traced back to the utterance that produced it without paying
  // for the run again.
  evidence: {
    opportunities: Opportunity[];
    fidelity: FidelityJudgement[];
    disclosure: DisclosureJudgement[];
    premature: PrematureJudgement[];
  };
};

export async function analyze(
  judge: Judge,
  corpus: Corpus,
  options: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const profiles = new ProfileIndex(corpus.groundTruth);
  const conversations = options.limit
    ? corpus.conversations.slice(0, options.limit)
    : corpus.conversations;

  // Only judge people the repo actually knows. An unrecognised author has no
  // profile to be consistent with, so including them would put a guess in the
  // denominator; they are counted and named instead.
  const unknownAuthors = new Set<string>();
  const seen = new Set<string>();
  const pairs: { conversation: Conversation; character: CharacterRecord }[] = [];
  for (const conversation of conversations) {
    const speakers = [...new Set(conversation.messages.map((m) => m.author))];
    for (const name of speakers) {
      const record = profiles.get(name);
      if (!record) {
        unknownAuthors.add(name);
        continue;
      }
      seen.add(record.name);
      pairs.push({ conversation, character: record });
    }
  }

  // --- Components 1 and 4 -----------------------------------------------------
  const opportunities: Opportunity[] = [];
  const fidelity: FidelityJudgement[] = [];
  const disclosures: DisclosureJudgement[] = [];
  const interactions: PrematureJudgement[] = [];

  await Promise.all(
    pairs.map(async ({ conversation, character }) => {
      const found = await findOpportunities(judge, conversation, character);
      opportunities.push(...found);

      const [graded, disclosed, premature] = await Promise.all([
        gradeOpportunities(judge, conversation, character, found),
        gradeDisclosures(judge, conversation, character, found),
        gradePremature(judge, conversation, character),
      ]);
      fidelity.push(...graded);
      disclosures.push(...disclosed);
      if (premature) interactions.push(premature);
    }),
  );

  const graded: GradedOpportunity[] = fidelity.map((f) => ({
    characterName: f.characterName,
    conversationId: f.conversationId,
    kind: f.kind,
    verdict: f.verdict,
  }));

  // --- Component 3 ------------------------------------------------------------
  let coverage: AnalyzeResult['coverage'];
  if (corpus.decisions.length > 0) {
    coverage = await analyseDiversity(judge, corpus, profiles, options.backgroundAxis);
  }

  // --- Component 5 ------------------------------------------------------------
  let dynamicState: DynamicStateResult | undefined;
  if (corpus.stateEvents.length > 0) {
    dynamicState = await analyseDynamicState(judge, corpus);
  }

  // --- Aggregation comparison --------------------------------------------------
  const comparisons: AggregationComparison[] = [];
  for (const decision of corpus.decisions) {
    const comparison = buildComparison(decision, options.aggregation);
    if (comparison) comparisons.push(comparison);
  }

  return {
    source: corpus.source,
    counts: {
      conversations: corpus.conversations.length,
      conversationsJudged: conversations.length,
      decisions: corpus.decisions.length,
      stateEvents: corpus.stateEvents.length,
      charactersSeen: seen.size,
      unknownAuthors: [...unknownAuthors].sort(),
    },
    capabilityNotes: corpus.capabilities.notes,
    personaFidelity: graded.length > 0 ? personaFidelity(graded) : undefined,
    disclosure:
      disclosures.length > 0 || interactions.length > 0
        ? disclosurePlausibility(disclosures, interactions)
        : undefined,
    coverage,
    dynamicState,
    aggregation:
      comparisons.length > 0
        ? { comparisons, disagreement: ruleDisagreementRate(comparisons) }
        : undefined,
    neutrality: checkNeutrality(),
    evidence: { opportunities, fidelity, disclosure: disclosures, premature: interactions },
  };
}

// Component 3 over recorded decisions. A live scenario records only the focal
// agent's commitment, so each participant's position is read out of the
// transcript first — that is what turns one decision into N choices.
async function analyseDiversity(
  judge: Judge,
  corpus: Corpus,
  profiles: ProfileIndex,
  backgroundAxis: BackgroundAxis,
): Promise<AnalyzeResult['coverage']> {
  const perDecision: { scenarioId: string; scenarioName: string; result: OptionCoverageResult }[] =
    [];
  const choices: ChoiceRecord[] = [];
  let endorsed = 0;
  let asked = 0;

  for (const decision of corpus.decisions) {
    if (decision.options.length === 0) continue;
    // The transcript that produced this decision, joined through scenarioId.
    const transcript = corpus.conversations
      .filter((c) => c.scenarioIds.includes(decision.scenarioId))
      .flatMap((c) => c.messages)
      .sort((a, b) => a.at - b.at)
      .map((m) => ({ author: m.author, text: m.text }));
    if (transcript.length === 0) continue;

    const participants = decision.agentScores.map((a) => a.name);
    const endorsements = await codeEndorsements(judge, {
      scenarioId: decision.scenarioId,
      scenarioName: decision.scenarioName,
      participants,
      options: decision.options,
      transcript,
    });
    asked += participants.length;
    endorsed += endorsements.filter((e) => e.optionId).length;

    perDecision.push({
      scenarioId: decision.scenarioId,
      scenarioName: decision.scenarioName,
      result: optionCoverage(
        decision.options.map((o) => o.optionId),
        endorsements.map((e) => e.optionId).filter((id): id is string => !!id),
      ),
    });

    // Eligibility needs to know which options each person could actually take.
    for (const endorsement of endorsements) {
      if (!endorsement.optionId) continue;
      const record = profiles.get(endorsement.name);
      if (!record) continue;
      const feasibility = await assessFeasibility(judge, record, decision.options);
      const feasible = feasibility.filter((f) => f.feasible).map((f) => f.optionId);
      choices.push({
        scenarioId: decision.scenarioId,
        characterName: record.name,
        background: profiles.background(record.name, backgroundAxis),
        optionIds: decision.options.map((o) => o.optionId),
        chosenOptionId: endorsement.optionId,
        feasibleOptionIds: feasible,
        choiceDetermined:
          feasible.length <= 1 || feasibility.some((f) => f.feasible && f.namedByProfile),
      });
    }
  }

  return {
    perDecision,
    // How often a participant took a position at all. A low value means the
    // coverage denominators below rest on very few opinions.
    endorsementRate: rate(endorsed, asked),
    withinGroup: withinGroupDiversity(choices),
  };
}

// Component 5 from the short-term event log. Everything except conversation
// valence is read straight off the log; valence is judged from the transcript,
// never from the gauge movement it is being used to validate.
async function analyseDynamicState(judge: Judge, corpus: Corpus): Promise<DynamicStateResult> {
  const conversationsById = new Map(corpus.conversations.map((c) => [c.id, c]));

  // One valence judgement per (conversation, character), reused across every
  // gauge that conversation moved.
  const valenceCache = new Map<string, Valence | undefined>();
  const needed = new Set<string>();
  for (const event of corpus.stateEvents) {
    if (event.cause !== 'conversationFeelings' || !event.conversationId) continue;
    needed.add(`${event.conversationId}::${event.characterName}`);
  }
  await Promise.all(
    [...needed].map(async (key) => {
      const [conversationId, name] = key.split('::');
      const conversation = conversationsById.get(conversationId);
      if (!conversation) return;
      valenceCache.set(key, await judgeValence(judge, conversation, name));
    }),
  );

  // A transition is cross-scenario when the character's previous logged event
  // belonged to a different scenario — that is the boundary the framework asks
  // about, and the only place a silent reset would hide.
  const byCharacter = new Map<string, typeof corpus.stateEvents>();
  for (const event of corpus.stateEvents) {
    const list = byCharacter.get(event.characterName) ?? [];
    list.push(event);
    byCharacter.set(event.characterName, list);
  }

  const transitions: StateTransition[] = [];
  for (const [, events] of byCharacter) {
    const sorted = [...events].sort((a, b) => a.at - b.at);
    let previousScenario: string | undefined;
    let first = true;
    for (const event of sorted) {
      const key = `${event.conversationId}::${event.characterName}`;
      const expected = expectedMove(event.cause, event.component, {
        valence: valenceCache.get(key),
        goalMet: event.goalMet,
      });
      // No stated rule for this (cause, component) pair: excluded rather than
      // guessed at, so an unknown cause cannot inflate or deflate accuracy.
      if (!expected) {
        previousScenario = event.scenarioId;
        first = false;
        continue;
      }
      transitions.push({
        characterName: event.characterName,
        at: event.at,
        cause: event.cause,
        component: event.component,
        valueBefore: event.valueBefore,
        valueAfter: event.valueAfter,
        baseline: baselineFor(event.component),
        expected,
        crossScenario: !first && event.scenarioId !== previousScenario,
      });
      previousScenario = event.scenarioId;
      first = false;
    }
  }

  return dynamicStateValidity(transitions, {
    resetThreshold: RESET_THRESHOLD,
    validResetCauses: VALID_RESET_CAUSES,
  });
}

// The aggregation comparison needs a utility vector per option. The evaluations
// row keeps per-agent scores only for the option that won, so a bundle without
// per-option utilities can compare nothing and is skipped rather than compared
// against itself.
function buildComparison(
  decision: Decision,
  options: AggregationOptions,
): AggregationComparison | undefined {
  if (decision.perOptionUtilities.length < 2) return undefined;
  const titleById = new Map(decision.options.map((o) => [o.optionId, o.title]));
  return compareAggregations(
    {
      scenarioId: decision.scenarioId,
      scenarioName: decision.scenarioName,
      selectedOptionId: decision.selectedOptionId,
      options: decision.perOptionUtilities.map((o) => ({
        optionId: o.optionId,
        title: titleById.get(o.optionId) ?? o.optionId,
        utilities: o.utilities.map((u) => u.utility),
      })),
    },
    options,
  );
}
