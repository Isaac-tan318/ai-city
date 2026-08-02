// The Decider inventing its own scenarios.
//
// data/scenarios.ts is a fixed catalogue of six decision scenarios, so a town left
// running long enough replays the same six situations forever. This lets the
// Decider stage a *new* one, built out of what has actually happened: constraints
// people have let slip, relationships that have soured, threads left hanging.
//
// The information rule from convex/decider.ts still holds — data/groundTruth.ts is
// never read here. The generator sees only what the town has said out loud, which
// is the point: a situation built around a constraint someone actually mentioned
// is grounded, and one built around a constraint nobody has mentioned would be the
// generator cheating at its own experiment.
//
// Generated scenarios are always universal decision scenarios, so they run the
// full Decider -> Focal -> Evaluator pipeline and get scored for regret exactly
// like a catalogue one. See convex/aiTown/generatedScenario.ts for why.

import { v } from 'convex/values';
import { z } from 'zod';
import { api, internal } from './_generated/api';
import { Doc, Id } from './_generated/dataModel';
import {
  action,
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from './_generated/server';
import { SerializedGeneratedScenario } from './aiTown/generatedScenario';
import { MAX_DECISION_OPTIONS } from './constants';
import { chatCompletion } from './util/llm';
import { parseLLMJson } from './util/llmJson';
import { ALL_SCENARIOS } from '../data/scenarios';

const selfInternal = internal.scenarioGen;

// --- Schema ------------------------------------------------------------------

export const GeneratedScenarioSchema = z.object({
  name: z.string().min(1),
  emoji: z.string().min(1),
  instruction: z.string().min(1),
  whatHappens: z.string().min(1),
  background: z.string().min(1),
  relationships: z.string().min(1),
  context: z.string().min(1),
  goals: z.string().min(1),
  conflict: z.string().default(''),
  topics: z.array(z.string()).min(2),
  completionGoal: z.string().min(1),
  reasoning: z.string().default(''),
  groundedIn: z.array(z.string()).default([]),
});

// --- Town state the generator is allowed to see -------------------------------

export type TownSnapshot = {
  cast: { playerId: string; name: string; identity: string }[];
  // What any focal agent has managed to infer about anyone, flattened. These are
  // beliefs from conversation, not ground truth.
  learned: { about: string; taboos: string[]; preferences: string[]; open: string[] }[];
  // Recent friction, so a generated scenario can build on a real grudge.
  frictions: string[];
  // Names of situations the town has already been through, so it stops repeating.
  recentScenarios: string[];
};

export const loadTownSnapshot = internalQuery({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args): Promise<TownSnapshot | null> => {
    const world = await ctx.db.get(args.worldId);
    if (!world) return null;

    const descriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const nameOf = new Map(descriptions.map((d) => [d.playerId, d.name]));

    // Only agents, not the human player — a generated scenario enlists NPCs.
    const agentPlayerIds = new Set(world.agents.map((a) => a.playerId));
    const agentDescriptions = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const identityOf = new Map<string, string>();
    for (const agent of world.agents) {
      const desc = agentDescriptions.find((d) => d.agentId === agent.id);
      if (desc) identityOf.set(agent.playerId, desc.identity);
    }
    const cast = descriptions
      .filter((d) => agentPlayerIds.has(d.playerId))
      .map((d) => ({
        playerId: d.playerId,
        name: d.name,
        // First sentence only — enough to place someone, short enough that eight
        // of them still leave room for the rest of the prompt.
        identity: (identityOf.get(d.playerId) ?? '').split(/(?<=\.)\s/)[0] ?? '',
      }));

    // Merge everything anyone has learned about each person into one view.
    const knowledge = await ctx.db
      .query('perceivedKnowledge')
      .withIndex('by_focal', (q) => q.eq('worldId', args.worldId))
      .collect();
    const byTarget = new Map<string, { taboos: string[]; preferences: string[]; open: string[] }>();
    for (const row of knowledge) {
      const key = row.targetPlayerId;
      const entry = byTarget.get(key) ?? { taboos: [], preferences: [], open: [] };
      entry.taboos.push(...row.knownTaboos);
      entry.preferences.push(...row.knownPreferences);
      entry.open.push(...row.uncertainties);
      byTarget.set(key, entry);
    }
    const learned = [...byTarget.entries()]
      .map(([playerId, entry]) => ({
        about: nameOf.get(playerId) ?? playerId,
        taboos: [...new Set(entry.taboos)].slice(0, 4),
        preferences: [...new Set(entry.preferences)].slice(0, 5),
        open: [...new Set(entry.open)].slice(0, 3),
      }))
      .filter((e) => e.taboos.length || e.preferences.length);

    const events = await ctx.db
      .query('relationshipEvents')
      .withIndex('world', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(40);
    const frictions = events
      .filter((e) => (e.delta ?? 0) < 0 && e.reason)
      .slice(0, 8)
      .map((e) => {
        const actor = nameOf.get(e.actor) ?? 'someone';
        const target = e.target ? nameOf.get(e.target) ?? 'someone' : undefined;
        return target ? `${actor} toward ${target}: ${e.reason}` : `${actor}: ${e.reason}`;
      });

    const previous = await ctx.db
      .query('generatedScenarios')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(10);
    const recentScenarios = [
      ...new Set([...previous.map((p) => p.name), ...ALL_SCENARIOS.map((s) => s.name)]),
    ];

    return { cast, learned, frictions, recentScenarios };
  },
});

// --- Generation ----------------------------------------------------------------

export type GeneratedScenarioDraft = SerializedGeneratedScenario & {
  reasoning: string;
  groundedIn: string[];
};

export async function generateScenarioDraft(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
): Promise<GeneratedScenarioDraft | undefined> {
  const snapshot = await ctx.runQuery(selfInternal.loadTownSnapshot, { worldId });
  if (!snapshot || snapshot.cast.length < 2) return undefined;

  const castLines = snapshot.cast.map((c) => ` - ${c.name}: ${c.identity}`);
  const learnedLines = snapshot.learned.map(
    (l) =>
      ` - ${l.about}: constraints mentioned [${l.taboos.join('; ') || 'none'}]; ` +
      `wants [${l.preferences.join('; ') || 'nothing noted'}]` +
      (l.open.length ? `; still unclear [${l.open.join('; ')}]` : ''),
  );

  const prompt = [
    `You invent situations for a Singapore-themed town simulation. Your job is to stage ONE new situation that forces this group into a real joint decision.`,
    ``,
    `The residents:`,
    ...castLines,
    ``,
    ...(learnedLines.length
      ? [`What has come up in their conversations so far:`, ...learnedLines, ``]
      : []),
    ...(snapshot.frictions.length
      ? [`Recent friction between them:`, ...snapshot.frictions.map((f) => ` - ${f}`), ``]
      : []),
    `Situations they have ALREADY been through — invent something genuinely different from all of these: ${snapshot.recentScenarios.join('; ')}.`,
    ``,
    `Design the new situation so that:`,
    `- It is an everyday Singapore situation these specific people would plausibly end up in together — not a disaster, not a spectacle.`,
    `- It forces ONE concrete joint choice with about ${MAX_DECISION_OPTIONS} plausible answers, not an open-ended chat.`,
    `- The pressure comes from things you actually see above: a constraint someone mentioned, an unresolved disagreement, a difference in budget or schedule. Build on what is real rather than inventing new facts about anyone.`,
    `- Somebody's needs genuinely conflict with somebody else's, so the group cannot simply please everyone.`,
    ``,
    `Fields:`,
    `- "name": 2-4 words, the way a person would refer to it ("The Broken Lift").`,
    `- "emoji": a single emoji.`,
    `- "instruction": the directive given to every participant, second person, telling them what they are trying to settle and to push for what they want.`,
    `- "whatHappens", "background", "relationships", "context": one or two sentences each, for the info panel.`,
    `- "goals": what each person is trying to get out of it.`,
    `- "conflict": the fault line — the opposing positions, named.`,
    `- "topics": 4-5 concrete things they will have to work through.`,
    `- "completionGoal": one sentence describing when the group has actually settled it.`,
    `- "reasoning": at most 25 words on why this situation, these people, now. A fragment, not a sentence — no "This scenario..." preamble.`,
    `- "groundedIn": the specific facts from above you built on, at most 8 words each. Leave empty if you invented the premise from nothing.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"name":"...","emoji":"...","instruction":"...","whatHappens":"...","background":"...","relationships":"...","context":"...","goals":"...","conflict":"...","topics":["..."],"completionGoal":"...","reasoning":"...","groundedIn":["..."]}`,
  ]
    .filter(Boolean)
    .join('\n');

  const { content } = await chatCompletion({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1400,
    response_format: { type: 'json_object' },
  });

  const parsed = parseLLMJson(content, GeneratedScenarioSchema, `generateScenario/${worldId}`);
  if (!parsed) return undefined;

  return {
    defId: `gen-${Date.now()}`,
    name: parsed.name.trim(),
    emoji: parsed.emoji.trim().slice(0, 4),
    instruction: parsed.instruction.trim(),
    whatHappens: parsed.whatHappens.trim(),
    background: parsed.background.trim(),
    relationships: parsed.relationships.trim(),
    context: parsed.context.trim(),
    goals: parsed.goals.trim(),
    conflict: parsed.conflict.trim() || undefined,
    topics: parsed.topics.map((t) => t.trim()).filter(Boolean),
    completionGoal: parsed.completionGoal.trim(),
    minParticipants: 2,
    reasoning: parsed.reasoning.trim(),
    groundedIn: parsed.groundedIn.map((g) => g.trim()).filter(Boolean),
  };
}

// --- Persistence ----------------------------------------------------------------

export const saveGeneratedScenario = internalMutation({
  args: {
    worldId: v.id('worlds'),
    draft: v.any(),
    createdBy: v.union(v.literal('auto'), v.literal('manual')),
  },
  handler: async (ctx, args) => {
    const draft = args.draft as GeneratedScenarioDraft;
    return await ctx.db.insert('generatedScenarios', {
      worldId: args.worldId,
      defId: draft.defId,
      name: draft.name,
      emoji: draft.emoji,
      instruction: draft.instruction,
      whatHappens: draft.whatHappens,
      background: draft.background,
      relationships: draft.relationships,
      context: draft.context,
      goals: draft.goals,
      conflict: draft.conflict,
      topics: draft.topics,
      completionGoal: draft.completionGoal,
      minParticipants: draft.minParticipants,
      reasoning: draft.reasoning,
      groundedIn: draft.groundedIn,
      createdBy: args.createdBy,
      at: Date.now(),
    });
  },
});

// Stamp a generated scenario as actually played, so the panel can tell a draft
// from one the town lived through.
export const markGeneratedScenarioUsed = internalMutation({
  args: { worldId: v.id('worlds'), defId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('generatedScenarios')
      .withIndex('by_defId', (q) => q.eq('worldId', args.worldId).eq('defId', args.defId))
      .unique();
    if (row && !row.usedAt) {
      await ctx.db.patch(row._id, { usedAt: Date.now() });
    }
  },
});

// --- Operations ------------------------------------------------------------------

// Automatic path: the scenario manager asked for a fresh situation instead of
// drawing from the catalogue. Lock-free, and it ALWAYS sends its input — an empty
// draft releases the manager's guard so it falls back to the catalogue next tick
// rather than waiting forever on a generation that failed.
export const generateAndStartScenario = internalAction({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args): Promise<void> => {
    let draft: GeneratedScenarioDraft | undefined;
    try {
      draft = await generateScenarioDraft(ctx, args.worldId);
      if (draft) {
        await ctx.runMutation(selfInternal.saveGeneratedScenario, {
          worldId: args.worldId,
          draft,
          createdBy: 'auto',
        });
        console.log(
          `[decider] staged a new scenario "${draft.name}" — ${draft.reasoning || 'no reasoning given'}`,
        );
      }
    } catch (err) {
      console.error(`generateAndStartScenario failed:`, err);
    }
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'startGeneratedScenario',
      args: {
        scenario: draft ? stripDraft(draft) : undefined,
        manual: false,
      },
    });
  },
});

// Manual path: the scenario creator's "Generate" button. Returns the draft for the
// human to read and edit; firing it is a separate, deliberate step.
export const draftScenario = action({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args): Promise<GeneratedScenarioDraft | null> => {
    const draft = await generateScenarioDraft(ctx, args.worldId);
    if (!draft) return null;
    await ctx.runMutation(selfInternal.saveGeneratedScenario, {
      worldId: args.worldId,
      draft,
      createdBy: 'manual',
    });
    return draft;
  },
});

// Drop the panel-only fields before handing the scenario to the engine.
function stripDraft(draft: GeneratedScenarioDraft): SerializedGeneratedScenario {
  const { reasoning: _reasoning, groundedIn: _groundedIn, ...rest } = draft;
  return rest;
}

// --- Panel query --------------------------------------------------------------

export const recentGeneratedScenarios = query({
  args: { worldId: v.id('worlds'), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<'generatedScenarios'>[]> => {
    return await ctx.db
      .query('generatedScenarios')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(Math.min(args.limit ?? 25, 100));
  },
});
