import { v } from 'convex/values';
import {
  ActionCtx,
  DatabaseReader,
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { LLMMessage, chatCompletion, fetchEmbedding } from '../util/llm';
import { asyncMap } from '../util/asyncMap';
import * as embeddingsCache from './embeddingsCache';
import { GameId, agentId, conversationId, playerId } from '../aiTown/ids';
import { SerializedPlayer } from '../aiTown/player';
import { memoryFields } from './schema';
import { formatGameTimestamp } from '../aiTown/gameTime';
import {
  MAX_AFFINITY_CHANGE_PER_CONVERSATION,
  MAX_SHORT_TERM_CHANGE_PER_EVENT,
  REFLECTION_IMPORTANCE_THRESHOLD,
  REFLECTION_MIN_MEMORIES,
  REFLECTION_OBSERVATIONS,
  REFLECTION_OBSERVATION_CANDIDATES,
  REFLECTION_OBSERVATION_WEIGHT_CAP,
} from '../constants';
import type { ShortTermComponent, ShortTermDelta } from '../aiTown/shortTerm';

// One affinity adjustment produced by the end-of-conversation evaluation.
export type AffinityDelta = { playerId: string; delta: number };

// How long to wait before updating a memory's last access time.
export const MEMORY_ACCESS_THROTTLE = 300_000; // In ms
// We fetch 10x the number of memories by relevance, to have more candidates
// for sorting by relevance + recency + importance.
const MEMORY_OVERFETCH = 10;
const selfInternal = internal.agent.memory;

export type Memory = Doc<'memories'>;
export type MemoryType = Memory['data']['type'];
export type MemoryOfType<T extends MemoryType> = Omit<Memory, 'data'> & {
  data: Extract<Memory['data'], { type: T }>;
};

export async function rememberConversation(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  conversationId: GameId<'conversations'>,
) {
  const data = await ctx.runQuery(selfInternal.loadConversation, {
    worldId,
    playerId,
    conversationId,
  });
  const { player, otherPlayer, otherParticipants, worldStartTime } = data;
  const messages = await ctx.runQuery(selfInternal.loadMessages, { worldId, conversationId });
  if (!messages.length) {
    return { affinityDeltas: [] as AffinityDelta[], shortTermDeltas: [] as ShortTermDelta[] };
  }

  const rosterNames = otherParticipants.map((p) => p.name).join(', ');
  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: `You are ${player.name}, and you just finished a conversation with ${otherPlayer.name}. I would
      like you to summarize the conversation from ${player.name}'s perspective, using first-person pronouns like
      "I," and add if you liked or disliked this interaction. Then, on a line beginning with
      "Commitments:", state any concrete plans you agreed to (who, what, where, and when) — for example
      "Commitments: meet ${otherPlayer.name} somewhere at 3pm". If you made no concrete plans, write
      "Commitments: none". Finally, on a separate last line beginning with "Affinity:", output strict JSON
      mapping each of these people — ${rosterNames} — to an integer from -10 to 10 capturing how your regard
      for them shifted during THIS conversation: negative if you clashed, disagreed, or were treated badly
      (e.g. a tense decision where you held conflicting views), positive if it was warm, supportive, or you
      found common ground, and 0 if neutral try to keep neutral unless the conversation was particularly moving. For example: "Affinity: {"${otherPlayer.name}": 0}". Then, on ANOTHER separate last line beginning with
      "Feelings:", output strict JSON with two integers from -10 to 10 describing how THIS conversation left
      YOU feeling: "mood" (positive if it lifted your spirits — a warm chat, a good outcome; negative if it
      was draining or upsetting) and "stress" (positive if it left you more tense or pressured — a conflict,
      being dismissed, an unresolved problem; negative if it relieved tension). Keep both near 0 unless the
      conversation was genuinely affecting. For example: "Feelings: {"mood": 0, "stress": 0}".`,
    },
  ];
  const authors = new Set<GameId<'players'>>();
  for (const message of messages) {
    const author = message.author === player.id ? player : otherPlayer;
    authors.add(author.id as GameId<'players'>);
    const recipient = message.author === player.id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name} to ${recipient.name}: ${message.text}`,
    });
  }
  llmMessages.push({ role: 'user', content: 'Summary:' });
  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 500,
  });
  // Split off the affinity + feelings judgements so they never get stored as
  // memory text (parse feelings from the affinity-cleaned summary).
  const { summary: summaryAfterAffinity, deltas: affinityDeltas } = parseAffinityLine(
    content,
    otherParticipants,
  );
  const { summary, deltas: shortTermDeltas } = parseFeelingsLine(summaryAfterAffinity);
  const description = `Conversation with ${otherPlayer.name} at ${formatGameTimestamp(
    data.conversation._creationTime,
    worldStartTime,
  )}: ${summary}`;
  const importance = await calculateImportance(description);
  const { embedding } = await fetchEmbedding(description);
  authors.delete(player.id as GameId<'players'>);
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId,
    playerId: player.id,
    description,
    importance,
    lastAccess: messages[messages.length - 1]._creationTime,
    data: {
      type: 'conversation',
      conversationId,
      playerIds: [...authors],
    },
    embedding,
  });
  // Reflection is NOT triggered from here any more. It runs on its own cadence
  // from the agent tick (see Agent.maybeReflect): a silent agent needs to reflect
  // too, and two trigger paths could run concurrently and race on learnedTraits.
  return { description, affinityDeltas, shortTermDeltas };
}

// A lasting takeaway an agent forms when a scenario wraps up (spec point 6).
// Unlike the per-conversation memories the scenario's chats already produce, this
// captures the OUTCOME and the agent's residual feelings about it, and returns
// mood/stress deltas to apply. Stored under its own 'scenarioOutcome' memory
// type so it's recalled later when a similar scenario recurs.
export type ScenarioMemoryInput = {
  name: string; // the character's own name
  scenarioName: string;
  instruction: string;
  goal?: string;
  goalMet: boolean;
  outcome: string; // 'tasks' | 'decision'
  wasPlanner: boolean;
  conflict?: string;
};

export async function rememberScenarioOutcome(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
  input: ScenarioMemoryInput,
): Promise<{ description: string; shortTermDeltas: ShortTermDelta[] }> {
  const roleNote = input.wasPlanner
    ? 'You were the one who pulled the plan together.'
    : 'You took part in it.';
  const outcomeNote = input.goalMet
    ? 'In the end the group reached a workable decision or got the work done.'
    : 'It wrapped up without really resolving.';
  const prompt = [
    `You are ${input.name}. A situation just wrapped up: "${input.scenarioName}".`,
    `What it was about: ${input.instruction}`,
    input.goal ? `The aim was: ${input.goal}` : '',
    input.conflict ? `There was disagreement over: ${input.conflict}` : '',
    `${outcomeNote} ${roleNote}`,
    `In 1-2 first-person sentences, note how this went for you and how you feel about the outcome — a lasting takeaway, not a play-by-play.`,
    `Then, on a separate last line beginning with "Feelings:", output strict JSON with two integers from -20 to 20: "mood" (positive if the outcome pleased you, negative if it left you deflated) and "stress" (positive if it left you tense or frustrated — e.g. you were overruled or it stayed unresolved; negative if it relieved pressure). For example: "Feelings: {"mood": 0, "stress": 0}".`,
  ]
    .filter(Boolean)
    .join('\n');

  let content = '';
  try {
    const res = await chatCompletion({ messages: [{ role: 'user', content: prompt }], max_tokens: 220 });
    content = res.content;
  } catch (err) {
    console.error(`rememberScenarioOutcome LLM failed: ${(err as Error).message}`);
    content = `${roleNote} ${outcomeNote}`;
  }
  const { summary, deltas: parsedDeltas } = parseFeelingsLine(content);
  const description = `${input.scenarioName}: ${summary || `${roleNote} ${outcomeNote}`}`;
  // Heuristic fallback so short-term still moves even if the Feelings line is absent.
  const shortTermDeltas = parsedDeltas.length > 0 ? parsedDeltas : heuristicScenarioFeelings(input);
  const importance = await calculateImportance(description);
  const { embedding } = await fetchEmbedding(description);
  await ctx.runMutation(selfInternal.insertScenarioOutcomeMemory, {
    playerId,
    description,
    importance,
    embedding,
    scenarioName: input.scenarioName,
    goalMet: input.goalMet,
  });
  return { description, shortTermDeltas };
}

// Deterministic mood/stress fallback from a scenario outcome, used when the LLM
// omits or garbles the Feelings line.
function heuristicScenarioFeelings(input: ScenarioMemoryInput): ShortTermDelta[] {
  if (input.goalMet) {
    return [
      { component: 'mood', delta: 6 },
      { component: 'stress', delta: -4 },
    ];
  }
  return [
    { component: 'mood', delta: -5 },
    { component: 'stress', delta: input.conflict ? 10 : 6 },
  ];
}

// Pull the trailing `Feelings: {"mood":..,"stress":..}` line out of the summary:
// returns the cleaned summary (line removed so it isn't stored) plus the parsed,
// clamped mood/stress deltas. Tolerant of a missing/malformed line.
function parseFeelingsLine(content: string): { summary: string; deltas: ShortTermDelta[] } {
  const kept: string[] = [];
  let jsonText: string | undefined;
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*Feelings:\s*(.*)$/i);
    if (m && jsonText === undefined) {
      jsonText = m[1];
    } else {
      kept.push(line);
    }
  }
  const summary = kept.join('\n').trim();
  const deltas: ShortTermDelta[] = [];
  if (jsonText) {
    try {
      const match = jsonText.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(match ? match[0] : jsonText);
      for (const component of ['mood', 'stress'] as ShortTermComponent[]) {
        const raw = obj[component];
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n) || n === 0) continue;
        const clamped = Math.max(
          -MAX_SHORT_TERM_CHANGE_PER_EVENT,
          Math.min(MAX_SHORT_TERM_CHANGE_PER_EVENT, Math.round(n)),
        );
        if (clamped !== 0) deltas.push({ component, delta: clamped });
      }
    } catch {
      // Unparseable feelings line — leave short-term state unchanged.
    }
  }
  return { summary, deltas };
}

// Pull the trailing `Affinity: {...}` line out of the summary completion: it
// returns the cleaned summary (with that line removed so it isn't stored as a
// memory) plus the parsed, clamped per-participant affinity deltas. Tolerant of a
// missing or malformed line — affinity simply doesn't change in that case.
function parseAffinityLine(
  content: string,
  roster: { id: string; name: string }[],
): { summary: string; deltas: AffinityDelta[] } {
  const kept: string[] = [];
  let jsonText: string | undefined;
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*Affinity:\s*(.*)$/i);
    if (m && jsonText === undefined) {
      jsonText = m[1];
    } else {
      kept.push(line);
    }
  }
  const summary = kept.join('\n').trim();
  const deltas: AffinityDelta[] = [];
  if (jsonText) {
    try {
      const match = jsonText.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(match ? match[0] : jsonText);
      for (const person of roster) {
        const raw = obj[person.name];
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n) || n === 0) continue;
        const clamped = Math.max(
          -MAX_AFFINITY_CHANGE_PER_CONVERSATION,
          Math.min(MAX_AFFINITY_CHANGE_PER_CONVERSATION, Math.round(n)),
        );
        if (clamped !== 0) deltas.push({ playerId: person.id, delta: clamped });
      }
    } catch {
      // Unparseable affinity line — leave affinity unchanged for this conversation.
    }
  }
  return { summary, deltas };
}

export const loadConversation = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const conversation = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', args.conversationId))
      .first();
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const otherParticipator = await ctx.db
      .query('participatedTogether')
      .withIndex('conversation', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('conversationId', args.conversationId),
      )
      .first();
    if (!otherParticipator) {
      throw new Error(
        `Couldn't find other participant in conversation ${args.conversationId} with player ${args.playerId}`,
      );
    }
    const otherPlayerId = otherParticipator.player2;
    let otherPlayer: SerializedPlayer | Doc<'archivedPlayers'> | null =
      world.players.find((p) => p.id === otherPlayerId) ?? null;
    if (!otherPlayer) {
      otherPlayer = await ctx.db
        .query('archivedPlayers')
        .withIndex('worldId', (q) => q.eq('worldId', world._id).eq('id', otherPlayerId))
        .first();
    }
    if (!otherPlayer) {
      throw new Error(`Conversation ${args.conversationId} other player not found`);
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${otherPlayerId} not found`);
    }
    // Full roster of OTHER participants (for group conversations) so affinity
    // changes can be attributed to each person by name. Falls back to the single
    // otherPlayer for older archived conversations without a participants list.
    const rosterIds = (conversation.participants ?? []).filter((pid) => pid !== args.playerId);
    const otherParticipants: { id: string; name: string }[] = [];
    for (const pid of rosterIds) {
      const d = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) =>
          q.eq('worldId', args.worldId).eq('playerId', pid as GameId<'players'>),
        )
        .first();
      otherParticipants.push({ id: pid, name: d?.name ?? 'Someone' });
    }
    if (otherParticipants.length === 0) {
      otherParticipants.push({ id: otherPlayerId, name: otherPlayerDescription.name });
    }
    return {
      player: { ...player, name: playerDescription.name },
      conversation,
      otherPlayer: { ...otherPlayer, name: otherPlayerDescription.name },
      otherParticipants,
      worldStartTime: world.worldStartTime,
    };
  },
});

export async function searchMemories(
  ctx: ActionCtx,
  playerId: GameId<'players'>,
  searchEmbedding: number[],
  n: number = 3,
) {
  const candidates = await ctx.vectorSearch('memoryEmbeddings', 'embedding', {
    vector: searchEmbedding,
    filter: (q) => q.eq('playerId', playerId),
    limit: n * MEMORY_OVERFETCH,
  });
  const rankedMemories = await ctx.runMutation(selfInternal.rankAndTouchMemories, {
    candidates,
    n,
  });
  return rankedMemories.map(({ memory }) => memory);
}

function makeRange(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return [min, max] as const;
}

function normalize(value: number, range: readonly [number, number]) {
  const [min, max] = range;
  return (value - min) / (max - min);
}

export const rankAndTouchMemories = internalMutation({
  args: {
    candidates: v.array(v.object({ _id: v.id('memoryEmbeddings'), _score: v.number() })),
    n: v.number(),
  },
  handler: async (ctx, args) => {
    const ts = Date.now();
    const relatedMemories = await asyncMap(args.candidates, async ({ _id }) => {
      const memory = await ctx.db
        .query('memories')
        .withIndex('embeddingId', (q) => q.eq('embeddingId', _id))
        .first();
      if (!memory) throw new Error(`Memory for embedding ${_id} not found`);
      return memory;
    });

    // TODO: fetch <count> recent memories and <count> important memories
    // so we don't miss them in case they were a little less relevant.
    const recencyScore = relatedMemories.map((memory) => {
      const hoursSinceAccess = (ts - memory.lastAccess) / 1000 / 60 / 60;
      return 0.99 ** Math.floor(hoursSinceAccess);
    });
    const relevanceRange = makeRange(args.candidates.map((c) => c._score));
    const importanceRange = makeRange(relatedMemories.map((m) => m.importance));
    const recencyRange = makeRange(recencyScore);
    const memoryScores = relatedMemories.map((memory, idx) => ({
      memory,
      overallScore:
        normalize(args.candidates[idx]._score, relevanceRange) +
        normalize(memory.importance, importanceRange) +
        normalize(recencyScore[idx], recencyRange),
    }));
    memoryScores.sort((a, b) => b.overallScore - a.overallScore);
    const accessed = memoryScores.slice(0, args.n);
    await asyncMap(accessed, async ({ memory }) => {
      if (memory.lastAccess < ts - MEMORY_ACCESS_THROTTLE) {
        await ctx.db.patch(memory._id, { lastAccess: ts });
      }
    });
    return accessed;
  },
});

export const loadMessages = internalQuery({
  args: {
    worldId: v.id('worlds'),
    conversationId,
  },
  handler: async (ctx, args): Promise<Doc<'messages'>[]> => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    return messages;
  },
});

async function calculateImportance(description: string) {
  const { content: importanceRaw } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: `On the scale of 0 to 9, where 0 is purely mundane (e.g., brushing teeth, making bed) and 9 is extremely poignant (e.g., a break up, college acceptance), rate the likely poignancy of the following piece of memory.
      Memory: ${description}
      Answer on a scale of 0 to 9. Respond with number only, e.g. "5"`,
      },
    ],
    temperature: 0.0,
    max_tokens: 1,
  });

  let importance = parseFloat(importanceRaw);
  if (isNaN(importance)) {
    importance = +(importanceRaw.match(/\d+/)?.[0] ?? NaN);
  }
  if (isNaN(importance)) {
    console.debug('Could not parse memory importance from: ', importanceRaw);
    importance = 5;
  }
  return importance;
}

const { embeddingId: _embeddingId, ...memoryFieldsWithoutEmbeddingId } = memoryFields;

export const insertMemory = internalMutation({
  args: {
    agentId,
    embedding: v.array(v.float64()),
    ...memoryFieldsWithoutEmbeddingId,
  },
  handler: async (ctx, { agentId: _, embedding, ...memory }): Promise<void> => {
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      playerId: memory.playerId,
      embedding,
    });
    await ctx.db.insert('memories', {
      ...memory,
      embeddingId,
    });
  },
});

// Promote salient observations into the embedded memory stream.
//
// The engine writes every observation to the `observations` table, but only the
// ones that scored above OBSERVATION_EMBED_MIN_IMPORTANCE earn an embedding and
// a `memories` row — that's what makes them retrievable in dialogue and worth
// reflecting on. Embedding is an action (network I/O), so the engine schedules
// this from saveDiff with the ids it just inserted.
export const promoteObservations = internalAction({
  args: { observationIds: v.array(v.id('observations')) },
  handler: async (ctx, args): Promise<void> => {
    const pending = await ctx.runQuery(selfInternal.loadObservationsToPromote, {
      observationIds: args.observationIds,
    });
    if (pending.length === 0) return;
    const { embeddings } = await embeddingsCache.fetchBatch(
      ctx,
      pending.map((o) => o.description),
    );
    await ctx.runMutation(selfInternal.writePromotedObservations, {
      promoted: pending.map((o, i) => ({
        observationId: o._id,
        playerId: o.playerId,
        description: o.description,
        importance: o.importance,
        at: o.at,
        subjectPlayerIds: o.subjectPlayerIds ?? [],
        embedding: embeddings[i],
      })),
    });
  },
});

export const loadObservationsToPromote = internalQuery({
  args: { observationIds: v.array(v.id('observations')) },
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.observationIds) {
      const observation = await ctx.db.get(id);
      // Skip anything already promoted — a retry of this action must not create
      // a second memory row for the same observation.
      if (observation && !observation.promoted) out.push(observation);
    }
    return out;
  },
});

export const writePromotedObservations = internalMutation({
  args: {
    promoted: v.array(
      v.object({
        observationId: v.id('observations'),
        playerId,
        description: v.string(),
        importance: v.number(),
        at: v.number(),
        subjectPlayerIds: v.array(playerId),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    for (const item of args.promoted) {
      const existing = await ctx.db.get(item.observationId);
      if (!existing || existing.promoted) continue;
      const embeddingId = await ctx.db.insert('memoryEmbeddings', {
        playerId: item.playerId,
        embedding: item.embedding,
      });
      await ctx.db.insert('memories', {
        playerId: item.playerId,
        description: item.description,
        importance: item.importance,
        lastAccess: item.at,
        embeddingId,
        data: {
          type: 'observation',
          subjectPlayerIds: item.subjectPlayerIds,
        },
      });
      await ctx.db.patch(item.observationId, { promoted: true });
    }
  },
});

// A scenario's lasting takeaway. Stored under its own memory type rather than as
// a reflection: `lastReflectionTs` is derived from the newest reflection-typed
// memory, so writing these as reflections restarted the reflection accumulator
// every time a scenario wrapped up.
export const insertScenarioOutcomeMemory = internalMutation({
  args: {
    playerId,
    description: v.string(),
    importance: v.number(),
    embedding: v.array(v.float64()),
    scenarioName: v.optional(v.string()),
    goalMet: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<void> => {
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      playerId: args.playerId,
      embedding: args.embedding,
    });
    await ctx.db.insert('memories', {
      playerId: args.playerId,
      description: args.description,
      importance: args.importance,
      lastAccess: Date.now(),
      embeddingId,
      data: {
        type: 'scenarioOutcome',
        scenarioName: args.scenarioName,
        goalMet: args.goalMet,
      },
    });
  },
});

export const insertReflectionMemories = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
    reflections: v.array(
      v.object({
        description: v.string(),
        relatedMemoryIds: v.array(v.id('memories')),
        importance: v.number(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, { playerId, reflections }) => {
    const lastAccess = Date.now();
    for (const { embedding, relatedMemoryIds, ...rest } of reflections) {
      const embeddingId = await ctx.db.insert('memoryEmbeddings', {
        playerId,
        embedding,
      });
      await ctx.db.insert('memories', {
        playerId,
        embeddingId,
        lastAccess,
        ...rest,
        data: {
          type: 'reflection',
          relatedMemoryIds,
        },
      });
    }
  },
});

// Returns whether a reflection actually happened, plus the strongest insight.
// The caller only advances the reflection window when `reflected` is true — a
// below-threshold check must not consume the memories it declined to reflect on.
export async function reflectOnMemories(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
  since?: number,
): Promise<{ reflected: boolean; topInsight?: string }> {
  const { memories: newMemories, observations, name } = await ctx.runQuery(
    internal.agent.memory.getReflectionMemories,
    {
      worldId,
      playerId,
      numberOfItems: 100,
      since,
    },
  );

  // Observations are DISCOUNTED in the sum. They're far more numerous than
  // conversation memories, so at full weight ambient perception alone would trip
  // the threshold every few game-minutes and reflection would be constant.
  const sumOfImportanceScore =
    newMemories.reduce((acc, curr) => acc + curr.importance, 0) +
    observations.reduce(
      (acc, curr) => acc + Math.min(curr.importance, REFLECTION_OBSERVATION_WEIGHT_CAP),
      0,
    );
  const shouldReflect =
    newMemories.length + observations.length >= REFLECTION_MIN_MEMORIES &&
    sumOfImportanceScore > REFLECTION_IMPORTANCE_THRESHOLD;

  if (!shouldReflect) {
    return { reflected: false };
  }
  console.debug('sum of importance score = ', sumOfImportanceScore);
  console.debug('Reflecting...');
  const prompt = ['[no prose]', '[Output only JSON]', `You are ${name}, statements about you:`];
  newMemories.forEach((m, idx) => {
    prompt.push(`Statement ${idx}: ${m.description}`);
  });
  // Listed after the memories and never cited back: `statementIds` indexes into
  // `newMemories` alone, so observations inform the insights without being
  // eligible as `relatedMemoryIds` (they aren't rows in `memories`).
  if (observations.length > 0) {
    prompt.push('Things you noticed around you recently:');
    observations.forEach((o) => {
      prompt.push(`- ${o.description}`);
    });
  }
  prompt.push('What 3 high-level insights can you infer from the above statements?');
  prompt.push(
    'Return in JSON format, where the key is a list of input statements that contributed to your insights and value is your insight. Make the response parseable by Typescript JSON.parse() function. DO NOT escape characters or include "\n" or white space in response.',
  );
  prompt.push(
    'Example: [{insight: "...", statementIds: [1,2]}, {insight: "...", statementIds: [1]}, ...]',
  );

  const { content: reflection } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: prompt.join('\n'),
      },
    ],
  });

  let topInsight: string | undefined;
  try {
    const insights = JSON.parse(reflection) as { insight: string; statementIds: number[] }[];
    const memoriesToSave = await asyncMap(insights, async (item) => {
      // The model occasionally cites a statement number that doesn't exist; drop
      // those rather than throwing the whole reflection away on one bad index.
      const relatedMemoryIds = (item.statementIds ?? [])
        .filter((idx: number) => Number.isInteger(idx) && idx >= 0 && idx < newMemories.length)
        .map((idx: number) => newMemories[idx]._id);
      const importance = await calculateImportance(item.insight);
      const { embedding } = await fetchEmbedding(item.insight);
      console.debug('adding reflection memory...', item.insight);
      return {
        description: item.insight,
        embedding,
        importance,
        relatedMemoryIds,
      };
    });

    await ctx.runMutation(selfInternal.insertReflectionMemories, {
      worldId,
      playerId,
      reflections: memoriesToSave,
    });
    // The single strongest insight is a candidate to promote to a durable
    // "learned trait" (a stable pattern across many memories) — returned so the
    // caller can write it to the agent, separate from the authored profile.
    topInsight = insights.find((i) => i.insight?.trim())?.insight?.trim();
  } catch (e) {
    console.error('error saving or parsing reflection', e);
    console.debug('reflection', reflection);
    // The LLM call happened and the window's material has been considered, so
    // this counts as reflected — retrying the same statements would just burn
    // another call on the same unparseable answer.
    return { reflected: true };
  }
  return { reflected: true, topInsight };
}
export const getReflectionMemories = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    numberOfItems: v.number(),
    // Start of the reflection window: only material formed after this is new.
    // Passed in from the Agent (`lastReflectionAt`) rather than derived from the
    // newest reflection-typed memory, which any reflection-shaped write could
    // silently reset.
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const since = args.since ?? 0;
    const memories = (
      await ctx.db
        .query('memories')
        .withIndex('playerId', (q) => q.eq('playerId', player.id))
        .order('desc')
        .take(args.numberOfItems)
    ).filter((m) => m._creationTime > since);

    // Observations live in their own table (see convex/aiTown/schema.ts) and are
    // fetched separately so ambient perception can't crowd conversation memories
    // out of the window — they're capped and listed as their own block.
    const observations = (
      await ctx.db
        .query('observations')
        .withIndex('player', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
        .order('desc')
        .take(REFLECTION_OBSERVATION_CANDIDATES)
    )
      .filter((o) => o.at > since)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, REFLECTION_OBSERVATIONS);

    return {
      name: playerDescription.name,
      memories,
      observations,
    };
  },
});

export async function latestMemoryOfType<T extends MemoryType>(
  db: DatabaseReader,
  playerId: GameId<'players'>,
  type: T,
) {
  const entry = await db
    .query('memories')
    .withIndex('playerId_type', (q) => q.eq('playerId', playerId).eq('data.type', type))
    .order('desc')
    .first();
  if (!entry) return null;
  return entry as MemoryOfType<T>;
}
