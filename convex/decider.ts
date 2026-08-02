// The Decider: everything the focal agent gets to KNOW.
//
// Two jobs, both strictly on the near side of the information barrier:
//
//  1. generateCandidateOptions — turn a decision scenario's framing into 3-4
//     concrete, meaningfully different things the group could actually choose
//     between. Without this the group "agrees" on a vague mood rather than an
//     option, and there is nothing to score.
//
//  2. extractMemoriesFromTranscript — read what people have actually said and
//     distil it into perceivedKnowledge: what the focal agent now believes about
//     each participant's constraints, and what it still doesn't know.
//
// Neither function reads data/groundTruth.ts. That is the entire point: the focal
// agent's beliefs must come from the conversation, so the gap between belief and
// truth is real and measurable. If you find yourself wanting ground truth here to
// make the agent smarter, you are deleting the experiment.

import { v } from 'convex/values';
import { z } from 'zod';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';
import {
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from './_generated/server';
import { api } from './_generated/api';
import { playerId } from './aiTown/ids';
import { MAX_DECISION_OPTIONS } from './constants';
import { chatCompletion } from './util/llm';
import { parseLLMJson } from './util/llmJson';
import { dropResolved, mergeFacts } from './util/factMerge';
import { CITY_LOCATIONS } from '../data/cityLocations';

const selfInternal = internal.decider;

// --- Schemas -----------------------------------------------------------------

export const CandidateOptionsSchema = z.object({
  // Why this SET of options — what axes it spans and what it is trying to force
  // the group to trade off. Kept for the decider panel: without it the options
  // arrive as bare facts and there is no way to see whether the framing was any
  // good, only whether the group chose well from it.
  reasoning: z.string().default(''),
  options: z
    .array(
      z.object({
        title: z.string().min(1),
        details: z.string().min(1),
        // Why this one is on the table at all.
        rationale: z.string().default(''),
        // Who the decider suspects this would quietly not suit. A guess made
        // without ground truth, which is exactly what makes it worth checking
        // against the evaluator afterwards.
        riskNote: z.string().default(''),
      }),
    )
    .min(2),
});

// The spec's MemoryExtractionSchema, with `targetAgentId` renamed to
// `targetPlayerId` (messages and affinities are keyed by player) and a
// confidence score added — a belief the agent is unsure of should not be
// weighted the same as one someone stated outright.
export const MemoryExtractionSchema = z.object({
  extractedFacts: z.array(
    z.object({
      targetName: z.string(),
      newTaboos: z.array(z.string()).default([]),
      newPreferences: z.array(z.string()).default([]),
      resolvedUncertainties: z.array(z.string()).default([]),
      openQuestions: z.array(z.string()).default([]),
      confidenceScore: z.number().min(0).max(1).default(0.5),
    }),
  ),
});

export type PerceivedKnowledgeRow = {
  targetPlayerId: string;
  targetName: string;
  knownTaboos: string[];
  knownPreferences: string[];
  uncertainties: string[];
  confidenceScore: number;
};

// Everything the Decider needs about a decision scenario, separated from where it
// came from. The live path loads it from the world doc; the dry run builds it
// from data/scenarios.ts, so both exercise exactly the same reasoning code.
export type DeliberationContext = {
  scenarioId: string;
  name: string;
  instruction: string;
  context: string;
  goals: string;
  conflict?: string;
  topics: string[];
  completionGoal?: string;
  participants: { playerId: string; name: string; scenarioProfile?: string }[];
};

// --- Queries and mutations ---------------------------------------------------

// The scenario framing plus its participants as the focal agent can see them:
// name and the compact `scenarioProfile` that the extraction LLM already derives
// for public consumption. Deliberately NOT each agent's full private `profile`.
export const loadDeliberationContext = internalQuery({
  args: { worldId: v.id('worlds'), scenarioId: v.string() },
  handler: async (ctx, args): Promise<DeliberationContext | null> => {
    const world = await ctx.db.get(args.worldId);
    if (!world) return null;
    const sc = (world.activeScenarios ?? []).find((s) => s.id === args.scenarioId);
    if (!sc) return null;
    const participants = sc.participantIds.map((pid, i) => ({
      playerId: pid,
      name: sc.participantNames[i] ?? 'Someone',
      scenarioProfile: world.agents.find((a) => a.playerId === pid)?.scenarioProfile,
    }));
    return {
      scenarioId: sc.id,
      name: sc.name,
      instruction: sc.instruction,
      context: sc.context,
      goals: sc.goals,
      conflict: sc.conflict,
      topics: sc.topics ?? [],
      completionGoal: sc.completionGoal,
      participants,
    };
  },
});

export const loadPerceivedKnowledge = internalQuery({
  args: { worldId: v.id('worlds'), focalPlayerId: playerId },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('perceivedKnowledge')
      .withIndex('by_focal', (q) =>
        q.eq('worldId', args.worldId).eq('focalPlayerId', args.focalPlayerId),
      )
      .collect();
  },
});

// Merge newly-extracted beliefs into what the focal agent already believed.
// Union rather than replace: a constraint mentioned once in message 3 should not
// evaporate because it wasn't repeated in message 9.
export const upsertPerceivedKnowledge = internalMutation({
  args: {
    worldId: v.id('worlds'),
    focalPlayerId: playerId,
    updates: v.array(
      v.object({
        targetPlayerId: playerId,
        newTaboos: v.array(v.string()),
        newPreferences: v.array(v.string()),
        resolvedUncertainties: v.array(v.string()),
        openQuestions: v.array(v.string()),
        confidenceScore: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      const existing = await ctx.db
        .query('perceivedKnowledge')
        .withIndex('by_focal_target', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('focalPlayerId', args.focalPlayerId)
            .eq('targetPlayerId', update.targetPlayerId),
        )
        .unique();

      const priorUncertainties = dropResolved(
        existing?.uncertainties ?? [],
        update.resolvedUncertainties,
      );

      const row = {
        worldId: args.worldId,
        focalPlayerId: args.focalPlayerId,
        targetPlayerId: update.targetPlayerId,
        knownTaboos: mergeFacts(existing?.knownTaboos ?? [], update.newTaboos),
        knownPreferences: mergeFacts(existing?.knownPreferences ?? [], update.newPreferences),
        uncertainties: mergeFacts(priorUncertainties, update.openQuestions),
        // The extractor's latest read, NOT a running maximum. Confidence answers
        // "how well does the focal agent understand this person right now", so a
        // high-water mark is wrong: one confident extraction would pin it at 100%
        // for the rest of the run, even while open questions kept piling up. It
        // also feeds the focal prompt, where a permanent 100% suppresses exactly
        // the questions the agent most needs to ask.
        confidenceScore: update.confidenceScore,
        updatedAt: Date.now(),
      };
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert('perceivedKnowledge', row);
      }
    }
  },
});


// --- Public queries for the decider panel ------------------------------------

// The Decider's framing of each recent decision, newest first.
export const recentDeciderTraces = query({
  args: { worldId: v.id('worlds'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('deciderTraces')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(Math.min(args.limit ?? 25, 100));
  },
});

// What each focal agent has actually worked out about the others, resolved to
// names. This is the belief state the questions are for: an agent's row here is
// what it *thinks* is true, which may be wrong or simply missing — comparing it
// with data/groundTruth.ts is the whole experiment.
export const deciderBeliefs = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('perceivedKnowledge')
      .withIndex('by_focal', (q) => q.eq('worldId', args.worldId))
      .collect();
    if (rows.length === 0) return [];

    const names = new Map<string, string>();
    const resolve = async (pid: string) => {
      const cached = names.get(pid);
      if (cached !== undefined) return cached;
      const desc = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', pid))
        .first();
      const name = desc?.name ?? pid;
      names.set(pid, name);
      return name;
    };

    // Group by focal agent so the panel reads as "what X has figured out".
    const byFocal = new Map<
      string,
      {
        focalPlayerId: string;
        focalName: string;
        targets: {
          targetPlayerId: string;
          targetName: string;
          knownTaboos: string[];
          knownPreferences: string[];
          uncertainties: string[];
          confidenceScore: number;
          updatedAt: number;
        }[];
      }
    >();
    for (const row of rows) {
      let entry = byFocal.get(row.focalPlayerId);
      if (!entry) {
        entry = {
          focalPlayerId: row.focalPlayerId,
          focalName: await resolve(row.focalPlayerId),
          targets: [],
        };
        byFocal.set(row.focalPlayerId, entry);
      }
      entry.targets.push({
        targetPlayerId: row.targetPlayerId,
        targetName: await resolve(row.targetPlayerId),
        knownTaboos: row.knownTaboos,
        knownPreferences: row.knownPreferences,
        uncertainties: row.uncertainties,
        confidenceScore: row.confidenceScore,
        updatedAt: row.updatedAt,
      });
    }
    return [...byFocal.values()].map((entry) => ({
      ...entry,
      targets: entry.targets.sort((a, b) => a.confidenceScore - b.confidenceScore),
    }));
  },
});

// --- Candidate option generation ---------------------------------------------

export async function generateCandidateOptions(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  scenarioId: string,
): Promise<{ reasoning: string; options: GeneratedOption[] }> {
  const data = await ctx.runQuery(selfInternal.loadDeliberationContext, { worldId, scenarioId });
  if (!data) return { reasoning: '', options: [] };
  return await generateOptionsFor(ctx, data);
}

// One generated option, with the reasoning behind it. The engine only stores the
// first three fields on the scenario (the world doc is rewritten every tick and
// wants to stay small); the full record goes to the `deciderTraces` table.
export type GeneratedOption = {
  optionId: string;
  title: string;
  details: string;
  rationale: string;
  riskNote: string;
};

export async function generateOptionsFor(
  ctx: ActionCtx,
  data: DeliberationContext,
): Promise<{ reasoning: string; options: GeneratedOption[] }> {
  const names = data.participants.map((p) => p.name);
  const profileLines = data.participants
    .filter((p) => p.scenarioProfile)
    .map((p) => ` - ${p.name}: ${p.scenarioProfile}`);
  const places = CITY_LOCATIONS.map((l) => `${l.name} (${l.description})`).join('; ');

  const prompt = [
    `You are setting up a group decision in a Singapore-themed town simulation.`,
    `Scenario: ${data.name} — ${data.instruction}`,
    `Situation: ${data.context}`,
    data.goals ? `What people want out of it: ${data.goals}` : ``,
    data.conflict ? `The fault line: ${data.conflict}` : ``,
    data.topics.length ? `Things they will argue about: ${data.topics.join('; ')}` : ``,
    `People involved: ${names.join(', ')}.`,
    ...(profileLines.length > 0 ? [`What is publicly known about them:`, ...profileLines] : []),
    `Places in this town you may draw on: ${places}`,
    ``,
    `Propose exactly ${MAX_DECISION_OPTIONS} concrete options this group could choose between.`,
    `Requirements:`,
    `- Every option must be a direct answer to THIS decision and nothing else. If the group is picking a film, every option is a film or a way of watching one; if it is picking a place to eat, every option is a place to eat. Do not drift into a different kind of choice.`,
    `- Each must be a specific, nameable choice ("the 9pm IMAX showing of the new horror release"), never a vague direction ("something scary").`,
    `- They must genuinely trade off against each other along cost, effort or travel, and what each actually offers — roughly: one cheap and familiar, one pricier or more ambitious, one low-effort, one that suits someone with a constraint the others don't share.`,
    `- At least one option should quietly be a poor fit for someone with a dietary, medical, religious or budget constraint — whichever of those this kind of decision can even run into — without flagging it in the option text.`,
    `- 'details' is one sentence: roughly what it costs per person, how much effort or travel it takes, and what it actually involves.`,
    ``,
    `Also explain your thinking:`,
    `- "reasoning": two or three sentences on what axes this set spans and what you are forcing the group to trade off against each other.`,
    `- "rationale" per option: why this one is worth putting on the table.`,
    `- "riskNote" per option: who among ${names.join(', ')} you suspect this would quietly not suit, and why. Say "no one obvious" if you genuinely can't name anyone. This is a guess from what is publicly known — you are not being told anyone's private constraints.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"reasoning":"...","options":[{"title":"...","details":"...","rationale":"...","riskNote":"..."}]}`,
  ]
    .filter(Boolean)
    .join('\n');

  const { content } = await chatCompletion({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1200,
    response_format: { type: 'json_object' },
  });

  const parsed = parseLLMJson(
    content,
    CandidateOptionsSchema,
    `generateCandidateOptions/${data.scenarioId}`,
  );
  if (!parsed) {
    return {
      reasoning: 'Option generation failed; fell back to the scenario’s authored talking points.',
      options: fallbackOptions(data.topics, data.name),
    };
  }
  return {
    reasoning: parsed.reasoning.trim(),
    options: parsed.options.slice(0, MAX_DECISION_OPTIONS).map((o, i) => ({
      optionId: `opt${i + 1}`,
      title: o.title.trim(),
      details: o.details.trim(),
      rationale: o.rationale.trim(),
      riskNote: o.riskNote.trim(),
    })),
  };
}

// If the LLM fails, derive something usable from the scenario's authored topics
// so the deliberation can still run rather than the scenario silently reverting
// to a plain chat. Deliberately thin — a degraded run should look degraded.
function fallbackOptions(topics: string[], scenarioName: string): GeneratedOption[] {
  const usable = topics.filter((t) => t.trim()).slice(0, MAX_DECISION_OPTIONS);
  if (usable.length < 2) return [];
  return usable.map((topic, i) => ({
    optionId: `opt${i + 1}`,
    title: topic.trim(),
    details: `An option raised during ${scenarioName}.`,
    rationale: '',
    riskNote: '',
  }));
}

// --- Memory extraction --------------------------------------------------------

// Read the scenario's transcript and update what the focal agent believes about
// everyone else. Returns the merged rows so the caller doesn't re-query.
export async function extractMemoriesFromTranscript(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  scenarioId: string,
  focalPlayerId: string,
  // Supplied by the dry run so it can drive the pipeline without a live chat.
  transcriptOverride?: { authorName: string; text: string }[],
): Promise<PerceivedKnowledgeRow[]> {
  const data = await ctx.runQuery(selfInternal.loadDeliberationContext, { worldId, scenarioId });
  if (!data) return [];
  return await extractMemoriesFor(ctx, worldId, data, focalPlayerId, transcriptOverride);
}

export async function extractMemoriesFor(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  data: DeliberationContext,
  focalPlayerId: string,
  transcriptOverride?: { authorName: string; text: string }[],
): Promise<PerceivedKnowledgeRow[]> {
  const transcript =
    transcriptOverride ??
    (await ctx.runQuery(internal.agent.conversation.loadScenarioMessages, {
      worldId,
      scenarioId: data.scenarioId,
      limit: 40,
    }));

  const focal = data.participants.find((p) => p.playerId === focalPlayerId);
  const others = data.participants.filter((p) => p.playerId !== focalPlayerId);
  if (others.length === 0) return [];

  // Nothing said yet — no beliefs to update, but the caller still wants whatever
  // is already on record.
  if (transcript.length === 0) {
    return await readKnowledge(ctx, worldId, focalPlayerId, data.participants);
  }

  const existing = await readKnowledge(ctx, worldId, focalPlayerId, data.participants);
  const priorLines = existing
    .filter((row) => row.knownTaboos.length || row.knownPreferences.length)
    .map(
      (row) =>
        ` - ${row.targetName}: constraints [${row.knownTaboos.join('; ') || 'none known'}]; ` +
        `likes [${row.knownPreferences.join('; ') || 'none known'}]`,
    );

  const prompt = [
    `You are tracking what ${focal?.name ?? 'the organiser'} has learned about the other people in a group conversation.`,
    `They are trying to pick one option for: ${data.name} — ${data.completionGoal ?? data.goals}`,
    `The other people are: ${others.map((o) => o.name).join(', ')}.`,
    ...(priorLines.length > 0 ? [`Already believed before this conversation:`, ...priorLines] : []),
    ``,
    `Transcript:`,
    transcript.map((m) => `${m.authorName}: ${m.text}`).join('\n'),
    ``,
    `For each OTHER person who revealed something, report what was learned. Rules:`,
    `- "newTaboos": only absolute constraints — a religious restriction, a medical or allergy limit, a legal rule. Something they cannot do, not something they would rather not do.`,
    `- "newPreferences": likes, dislikes, budget concerns, and convenience needs. Strong dislikes go here, NOT in newTaboos.`,
    `- Only record what was actually said or clearly implied in the transcript. Do not infer from someone's background what they "probably" cannot eat — an unstated constraint is exactly what is being tested for.`,
    `- "resolvedUncertainties": previously open questions this transcript has now answered.`,
    `- "openQuestions": what is still unknown about this person that would change which option is best for them. Phrase each as a short question.`,
    `- "confidenceScore": 0 to 1, how well ${focal?.name ?? 'the organiser'} now understands what this person needs.`,
    `- Omit anyone who revealed nothing new.`,
    `- Use each person's EXACT name as "targetName".`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"extractedFacts":[{"targetName":"...","newTaboos":[],"newPreferences":[],"resolvedUncertainties":[],"openQuestions":[],"confidenceScore":0.5}]}`,
  ]
    .filter(Boolean)
    .join('\n');

  const { content } = await chatCompletion({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 900,
    response_format: { type: 'json_object' },
  });

  const parsed = parseLLMJson(
    content,
    MemoryExtractionSchema,
    `extractMemoriesFromTranscript/${data.scenarioId}`,
  );
  if (!parsed) {
    // Beliefs simply don't advance this turn. The focal agent keeps deliberating
    // with what it already had, which will read as an unresolved uncertainty and
    // keep it asking — a safe failure direction.
    return existing;
  }

  const byName = new Map(others.map((o) => [o.name.toLowerCase(), o.playerId]));
  const updates = [];
  for (const fact of parsed.extractedFacts) {
    const targetPlayerId = byName.get(fact.targetName.trim().toLowerCase());
    if (!targetPlayerId) continue; // Hallucinated a name that isn't in the room.
    updates.push({
      targetPlayerId,
      newTaboos: fact.newTaboos,
      newPreferences: fact.newPreferences,
      resolvedUncertainties: fact.resolvedUncertainties,
      openQuestions: fact.openQuestions,
      confidenceScore: fact.confidenceScore,
    });
  }
  if (updates.length > 0) {
    await ctx.runMutation(selfInternal.upsertPerceivedKnowledge, {
      worldId,
      focalPlayerId,
      updates,
    });
  }
  return await readKnowledge(ctx, worldId, focalPlayerId, data.participants);
}

// Current beliefs, one row per other participant (including people nothing is
// known about yet, so the focal prompt can see who it has learned nothing from).
async function readKnowledge(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  focalPlayerId: string,
  participants: { playerId: string; name: string }[],
): Promise<PerceivedKnowledgeRow[]> {
  const rows = await ctx.runQuery(selfInternal.loadPerceivedKnowledge, {
    worldId,
    focalPlayerId,
  });
  const byTarget = new Map(rows.map((r) => [r.targetPlayerId, r]));
  return participants
    .filter((p) => p.playerId !== focalPlayerId)
    .map((p) => {
      const row = byTarget.get(p.playerId);
      return {
        targetPlayerId: p.playerId,
        targetName: p.name,
        knownTaboos: row?.knownTaboos ?? [],
        knownPreferences: row?.knownPreferences ?? [],
        uncertainties: row?.uncertainties ?? [],
        confidenceScore: row?.confidenceScore ?? 0,
      };
    });
}

// --- Operation ----------------------------------------------------------------

// Generate the option menu for a decision scenario. Fired once per scenario,
// lock-free, so the participants' conversation starts normally while it runs.
// Always sends its input, even with an empty list, so the guard flag resolves.
export const generateDecisionOptions = internalAction({
  args: {
    worldId: v.id('worlds'),
    scenarioId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    let options: GeneratedOption[] = [];
    try {
      const generated = await generateCandidateOptions(ctx, args.worldId, args.scenarioId);
      options = generated.options;
      if (options.length >= 2) {
        await ctx.runMutation(selfInternal.saveDeciderTrace, {
          worldId: args.worldId,
          scenarioId: args.scenarioId,
          reasoning: generated.reasoning,
          options,
        });
      }
    } catch (err) {
      console.error(`generateDecisionOptions failed for ${args.scenarioId}:`, err);
    }
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishGenerateDecisionOptions',
      args: {
        scenarioId: args.scenarioId,
        // The engine only needs what the agents choose between; the reasoning
        // stays in deciderTraces so the world doc doesn't carry prose it rewrites
        // on every tick.
        options: options.map((o) => ({
          optionId: o.optionId,
          title: o.title,
          details: o.details,
        })),
      },
    });
  },
});

export const saveDeciderTrace = internalMutation({
  args: {
    worldId: v.id('worlds'),
    scenarioId: v.string(),
    reasoning: v.string(),
    options: v.array(
      v.object({
        optionId: v.string(),
        title: v.string(),
        details: v.string(),
        rationale: v.string(),
        riskNote: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    const sc = (world?.activeScenarios ?? []).find((s) => s.id === args.scenarioId);
    const existing = await ctx.db
      .query('deciderTraces')
      .withIndex('by_scenario', (q) =>
        q.eq('worldId', args.worldId).eq('scenarioId', args.scenarioId),
      )
      .unique();
    const row = {
      worldId: args.worldId,
      scenarioId: args.scenarioId,
      scenarioName: sc?.name ?? args.scenarioId,
      participantNames: sc?.participantNames ?? [],
      reasoning: args.reasoning,
      options: args.options,
      at: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert('deciderTraces', row);
    }
  },
});
