// The Evaluator: the only thing in the system allowed to see the answer key.
//
// After the group commits, this scores EVERY candidate option against every
// participant's hidden ground truth (data/groundTruth.ts). Scoring only the
// chosen option would tell you how good the decision was in isolation; scoring
// all of them tells you how good it was *relative to what was available*, which
// is the number worth having:
//
//     regret = U_group(best available) − U_group(what they picked)
//
// Zero regret means the focal agent's questions surfaced enough to find the
// genuine optimum under incomplete information. Large regret means somebody's
// constraint never came up — and the transcript will show whether it was never
// asked about or asked about and missed.
//
// Division of labour with the LLM: it supplies judgements (does this option
// violate this person's stated constraint? how well does it meet their needs, on
// the five-level rubric?) and TypeScript does every piece of arithmetic. An LLM
// asked to total its own weighted score will return a number that doesn't match
// its own factors.

import { v } from 'convex/values';
import { z } from 'zod';
import { api, internal } from './_generated/api';
import { Doc, Id } from './_generated/dataModel';
import { ActionCtx, internalAction, internalMutation, internalQuery } from './_generated/server';
import { playerId } from './aiTown/ids';
import { serializedDecisionOption } from './aiTown/deliberation';
import {
  affinityDeltaFromUtility,
  computeRegret,
  DimensionFactors,
  groupUtility,
  individualUtility,
  OptionScore,
  snapFactors,
} from './scoring';
import { chatCompletion } from './util/llm';
import { parseLLMJson } from './util/llmJson';

const selfInternal = internal.evaluator;

// --- Schema ------------------------------------------------------------------

// The spec's EvaluatorOutputSchema minus `totalIndividualUtility` and
// `aggregatedGroupUtility`: those are derived, not reported. Asking for them
// invites the model to produce a total that contradicts the factors it just gave.
export const EvaluatorOutputSchema = z.object({
  agentScores: z.array(
    z.object({
      name: z.string(),
      hardTabooViolated: z.boolean(),
      violatedTaboo: z.string().nullable().default(null),
      // One short line on why this person landed where they did — the human
      // reading of the six numbers, shown beside them in the scorecard.
      reason: z.string().default(''),
      dimensionFactors: z.object({
        essentialNeeds: z.number(),
        preferenceMatch: z.number(),
        costTimeBurden: z.number(),
        fairness: z.number(),
        socialComfort: z.number(),
        relationshipImpact: z.number(),
      }),
    }),
  ),
  analyticalCommentary: z.string().default(''),
});

export type EvaluatedAgentScore = {
  playerId: string;
  name: string;
  hardTabooViolated: boolean;
  violatedTaboo?: string;
  // The evaluator's one-line account of why this person landed here.
  reason?: string;
  dimensionFactors: DimensionFactors;
  totalIndividualUtility: number;
};

// Written to the `evaluations` table. Spelled out rather than inferred: several
// functions here call ctx.runQuery on `internal`, and an inferred return type
// that transitively depends on the generated api makes the api type graph
// circular, which silently degrades inferred types across the whole repo.
export type EvaluationRow = {
  worldId: Id<'worlds'>;
  scenarioId: string;
  scenarioName: string;
  focalPlayerId: string;
  focalName: string;
  selectedOptionId: string;
  selectedOptionTitle: string;
  aggregatedGroupUtility: number;
  bestOptionId: string;
  bestOptionTitle: string;
  bestGroupUtility: number;
  regret: number;
  questionsAsked: number;
  forcedDecision: boolean;
  optionScores: OptionScore[];
  agentScores: {
    playerId: string;
    name: string;
    hardTabooViolated: boolean;
    violatedTaboo?: string;
    reason?: string;
    dimensionFactors: DimensionFactors;
    totalIndividualUtility: number;
  }[];
  commentary: string;
  at: number;
};

// --- Data access --------------------------------------------------------------

export const loadGroundTruth = internalQuery({
  args: { worldId: v.id('worlds'), playerIds: v.array(playerId) },
  handler: async (ctx, args): Promise<Doc<'groundTruthProfiles'>[]> => {
    const out: Doc<'groundTruthProfiles'>[] = [];
    for (const pid of args.playerIds) {
      const row = await ctx.db
        .query('groundTruthProfiles')
        .withIndex('by_player', (q) => q.eq('worldId', args.worldId).eq('playerId', pid))
        .unique();
      if (row) out.push(row);
    }
    return out;
  },
});

export const saveEvaluation = internalMutation({
  args: {
    row: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('evaluations', args.row);
  },
});

// --- Scoring one option --------------------------------------------------------

async function scoreOption(
  ctx: ActionCtx,
  option: { optionId: string; title: string; details: string },
  profiles: Doc<'groundTruthProfiles'>[],
  transcript: { authorName: string; text: string }[],
  scenarioName: string,
): Promise<{ scores: EvaluatedAgentScore[]; commentary: string } | undefined> {
  const profileBlocks = profiles.map((p) =>
    [
      `${p.name}:`,
      `  background: ${p.culturalBackground}; ${p.religion}`,
      `  ABSOLUTE constraints: ${p.hardTaboos.length ? p.hardTaboos.join(' | ') : 'none'}`,
      `  essential needs: ${p.essentialNeeds.join(' | ') || 'none'}`,
      `  preferences: ${p.preferences.join(' | ') || 'none'}`,
      `  budget ceiling: ${p.budgetLimit > 0 ? `about S$${p.budgetLimit}` : 'no real limit'}`,
    ].join('\n'),
  );

  const prompt = [
    `You are scoring how well one option would actually serve each person in a group, using private information about them that they did not necessarily share.`,
    `Scenario: ${scenarioName}`,
    `Option under evaluation — "${option.title}": ${option.details}`,
    ``,
    `The people, and the TRUTH about each of them:`,
    ...profileBlocks,
    ``,
    transcript.length
      ? `For context, what they actually said to each other:\n${transcript
          .map((m) => `${m.authorName}: ${m.text}`)
          .join('\n')}`
      : `(no transcript available)`,
    ``,
    `For EACH person, report:`,
    `- "hardTabooViolated": true only if this option violates one of their ABSOLUTE constraints — a religious rule, a medical or allergy limit, a legal issue. A merely disliked or over-budget option is NOT a violation. If true, quote the constraint in "violatedTaboo".`,
    `- "dimensionFactors": six numbers, each EXACTLY one of 1, 0.75, 0.5, 0.25, or 0:`,
    `    1 = fully satisfied / high match / no burden`,
    `    0.75 = basically satisfied / minor inconvenience`,
    `    0.5 = moderate compromise / medium burden`,
    `    0.25 = barely feasible / heavy burden`,
    `    0 = unfeasible / completely dissatisfied`,
    `  essentialNeeds — does it meet their essential practical needs?`,
    `  preferenceMatch — how well does it match what they actually like?`,
    `  costTimeBurden — is it affordable and convenient FOR THEM, against their budget ceiling? (1 = easily affordable, 0 = far beyond their means)`,
    `  fairness — are they carrying a proportionate share of the cost and hassle?`,
    `  socialComfort — will they feel at ease there?`,
    `  relationshipImpact — will this leave them on better terms with the others?`,
    `- "reason": ONE short clause, at most 12 words, naming what drove their score — the specific need met or missed, not a restatement of the numbers. Write "Highly matched preference; low cost burden" or "Met dietary need, but a long trip", never "scored 0.75 on preference".`,
    `Score honestly from the private information, NOT from what they said out loud. Someone who politely agreed to something that does not suit them still scores low.`,
    `Include every person listed, using their EXACT name.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"agentScores":[{"name":"...","hardTabooViolated":false,"violatedTaboo":null,"reason":"...","dimensionFactors":{"essentialNeeds":1,"preferenceMatch":0.75,"costTimeBurden":0.5,"fairness":1,"socialComfort":0.75,"relationshipImpact":1}}],"analyticalCommentary":"one or two sentences on who this option serves well and who it fails"}`,
  ]
    .filter(Boolean)
    .join('\n');

  const { content } = await chatCompletion({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1400,
    response_format: { type: 'json_object' },
  });

  const parsed = parseLLMJson(content, EvaluatorOutputSchema, `evaluate/${option.optionId}`);
  if (!parsed) return undefined;

  const byName = new Map(profiles.map((p) => [p.name.toLowerCase(), p]));
  const scores: EvaluatedAgentScore[] = [];
  for (const entry of parsed.agentScores) {
    const profile = byName.get(entry.name.trim().toLowerCase());
    if (!profile) continue; // A name that isn't in this scenario.
    const factors = snapFactors(entry.dimensionFactors);
    scores.push({
      playerId: profile.playerId,
      name: profile.name,
      hardTabooViolated: entry.hardTabooViolated,
      violatedTaboo: entry.violatedTaboo ?? undefined,
      reason: entry.reason.trim() || undefined,
      dimensionFactors: factors,
      totalIndividualUtility: individualUtility(factors, entry.hardTabooViolated),
    });
  }
  // A partial scoring would make the group mean incomparable across options, so
  // treat it as a failed option rather than quietly averaging over fewer people.
  if (scores.length !== profiles.length) {
    console.error(
      `evaluate/${option.optionId}: scored ${scores.length}/${profiles.length} participants — dropping this option`,
    );
    return undefined;
  }
  return { scores, commentary: parsed.analyticalCommentary };
}

// --- The operation --------------------------------------------------------------

export const evaluateFinalDecision = internalAction({
  args: {
    worldId: v.id('worlds'),
    scenarioId: v.string(),
    scenarioName: v.string(),
    focalPlayerId: playerId,
    focalName: v.string(),
    options: v.array(serializedDecisionOption),
    selectedOptionId: v.string(),
    participantIds: v.array(playerId),
    questionsAsked: v.number(),
    forcedDecision: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    // Scheduled lock-free, so there is no operation lock to release and this may
    // safely bail on any failure. An absent evaluation row is better research
    // data than a fabricated one.
    try {
      await evaluateDecision(ctx, args);
    } catch (err) {
      console.error(`evaluateFinalDecision failed for ${args.scenarioId}:`, err);
    }
  },
});

export type EvaluateDecisionArgs = {
  worldId: Id<'worlds'>;
  scenarioId: string;
  scenarioName: string;
  focalPlayerId: string;
  focalName: string;
  options: { optionId: string; title: string; details: string }[];
  selectedOptionId: string;
  participantIds: string[];
  questionsAsked: number;
  forcedDecision: boolean;
  transcriptOverride?: { authorName: string; text: string }[];
  // The dry run drives this directly and doesn't want to nudge a live world's
  // relationships as a side effect of a diagnostic.
  applyFeedback?: boolean;
};

export async function evaluateDecision(
  ctx: ActionCtx,
  args: EvaluateDecisionArgs,
): Promise<EvaluationRow | undefined> {
  await ctx.runMutation(internal.groundTruth.ensureGroundTruth, { worldId: args.worldId });

  const profiles = await ctx.runQuery(selfInternal.loadGroundTruth, {
    worldId: args.worldId,
    playerIds: args.participantIds,
  });
  if (profiles.length < 2) {
    console.error(
      `evaluateDecision ${args.scenarioId}: only ${profiles.length} ground-truth profiles for ` +
        `${args.participantIds.length} participants — cannot score.`,
    );
    return undefined;
  }

  const transcript =
    args.transcriptOverride ??
    (await ctx.runQuery(internal.agent.conversation.loadScenarioMessages, {
      worldId: args.worldId,
      scenarioId: args.scenarioId,
      limit: 60,
    }));

  // One call per option rather than one giant N×M call: smaller responses
  // validate far more reliably, and a failure costs one option instead of the
  // whole evaluation.
  const optionScores: OptionScore[] = [];
  const commentaries: string[] = [];
  let selectedScores: EvaluatedAgentScore[] | undefined;

  for (const option of args.options) {
    const result = await scoreOption(
      ctx,
      option,
      profiles,
      transcript,
      args.scenarioName,
    );
    if (!result) {
      commentaries.push(`(scoring failed for "${option.title}"; excluded from the comparison)`);
      continue;
    }
    const utility = groupUtility(result.scores.map((s) => s.totalIndividualUtility));
    optionScores.push({ optionId: option.optionId, title: option.title, groupUtility: utility });
    commentaries.push(`${option.title}: ${result.commentary}`);
    if (option.optionId === args.selectedOptionId) {
      selectedScores = result.scores;
    }
  }

  const regret = computeRegret(optionScores, args.selectedOptionId);
  if (!regret || !selectedScores) {
    console.error(
      `evaluateDecision ${args.scenarioId}: the chosen option ${args.selectedOptionId} could not be scored — no evaluation written.`,
    );
    return undefined;
  }

  const row: EvaluationRow = {
    worldId: args.worldId,
    scenarioId: args.scenarioId,
    scenarioName: args.scenarioName,
    focalPlayerId: args.focalPlayerId,
    focalName: args.focalName,
    selectedOptionId: regret.selected.optionId,
    selectedOptionTitle: regret.selected.title,
    aggregatedGroupUtility: regret.selected.groupUtility,
    bestOptionId: regret.best.optionId,
    bestOptionTitle: regret.best.title,
    bestGroupUtility: regret.best.groupUtility,
    regret: regret.regret,
    questionsAsked: args.questionsAsked,
    forcedDecision: args.forcedDecision,
    optionScores,
    agentScores: selectedScores.map((s) => ({
      playerId: s.playerId,
      name: s.name,
      hardTabooViolated: s.hardTabooViolated,
      violatedTaboo: s.violatedTaboo,
      reason: s.reason,
      dimensionFactors: s.dimensionFactors,
      totalIndividualUtility: s.totalIndividualUtility,
    })),
    commentary: commentaries.join('\n'),
    at: Date.now(),
  };
  await ctx.runMutation(selfInternal.saveEvaluation, { row });

  const violations = selectedScores.filter((s) => s.hardTabooViolated).map((s) => s.name);
  console.log(
    `[evaluator] "${args.scenarioName}" chose ${regret.selected.title} — group utility ` +
      `${regret.selected.groupUtility}/100, best available ${regret.best.title} ` +
      `(${regret.best.groupUtility}), regret ${regret.regret}` +
      (violations.length ? `, hard constraint violated for ${violations.join(', ')}` : '') +
      (args.forcedDecision ? ' [forced]' : ''),
  );

  // Feed the outcome back into the simulation: how each participant now feels
  // about whoever made the call. See the applyEvaluationOutcome handler for why
  // this is affinity only.
  if (args.applyFeedback !== false) {
    const deltas = selectedScores
      .map((s) => ({
        playerId: s.playerId,
        delta: affinityDeltaFromUtility(s.totalIndividualUtility, s.hardTabooViolated),
        reason: reasonFor(s, args.focalName, regret.selected.title),
      }))
      .filter((d) => d.delta !== 0);
    if (deltas.length > 0) {
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'applyEvaluationOutcome',
        args: {
          focalPlayerId: args.focalPlayerId,
          scenarioId: args.scenarioId,
          scenarioName: args.scenarioName,
          deltas,
        },
      });
    }
  }

  return row;
}

// Short human-readable why, shown in the Tensions feed and the relationship
// inspector alongside the affinity change.
function reasonFor(score: EvaluatedAgentScore, focalName: string, optionTitle: string): string {
  if (score.hardTabooViolated) {
    return `${focalName} picked ${optionTitle}, which they simply can't do`;
  }
  if (score.totalIndividualUtility >= 80) {
    return `${focalName} picked ${optionTitle}, which suited them well`;
  }
  if (score.totalIndividualUtility <= 35) {
    return `${focalName} picked ${optionTitle}, which didn't work for them`;
  }
  return `${focalName} picked ${optionTitle}`;
}
