import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { ActionCtx, internalQuery } from '../_generated/server';
import { LLMMessage, chatCompletion } from '../util/llm';
import * as memory from './memory';
import { api, internal } from '../_generated/api';
import * as embeddingsCache from './embeddingsCache';
import { GameId, conversationId, playerId } from '../aiTown/ids';
import { NUM_MEMORIES_TO_SEARCH } from '../constants';
import { computeGameTime, formatGameTimestamp } from '../aiTown/gameTime';
import { CITY_LOCATIONS } from '../../data/cityLocations';

const selfInternal = internal.agent.conversation;

type OtherParticipant = {
  id: string;
  name: string;
  identity?: string;
  human: boolean;
  position: { x: number; y: number };
};

export async function startConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  gameTimeMs: number,
): Promise<string> {
  const { player, others, agent, lastConversation, worldStartTime } = await ctx.runQuery(
    selfInternal.queryPromptData,
    { worldId, playerId, conversationId },
  );
  const audience = formatNameList(others.map((o) => o.name));
  const embedding = await embeddingsCache.fetch(ctx, `${player.name} is talking to ${audience}`);

  const memories = await memory.searchMemories(
    ctx,
    player.id as GameId<'players'>,
    embedding,
    Number(process.env.NUM_MEMORIES_TO_SEARCH) || NUM_MEMORIES_TO_SEARCH,
  );

  const primaryOther = others[0];
  const memoryWithOtherPlayer = memories.find(
    (m) =>
      m.data.type === 'conversation' && primaryOther && m.data.playerIds.includes(primaryOther.id),
  );
  const prompt = [
    others.length > 1
      ? `You are ${player.name}, and you just joined a group conversation with ${audience}.`
      : `You are ${player.name}, and you just started a conversation with ${audience}.`,
  ];
  prompt.push(...currentTimeAndPlacePrompt(player.position, worldStartTime, gameTimeMs, agent));
  prompt.push(...selfAndOthersPrompt(agent, others));
  prompt.push(
    ...previousConversationPrompt(primaryOther, lastConversation, worldStartTime, gameTimeMs),
  );
  prompt.push(...relatedMemoriesPrompt(memories));
  if (memoryWithOtherPlayer && primaryOther) {
    prompt.push(
      `You may briefly reference your last conversation with ${primaryOther.name} in one short clause, but keep it light.`,
    );
  }
  prompt.push(
    `Keep your greeting to one or two short sentences, like real spoken dialogue — under 200 characters. Don't monologue or give a speech.`,
  );
  const lastPrompt = speakerLabel(player.name, others);
  prompt.push(lastPrompt);

  const { content } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: prompt.join('\n'),
      },
    ],
    max_tokens: 120,
    stop: stopWords(player.name, others),
  });
  return trimContentPrefx(content, lastPrompt);
}

function trimContentPrefx(content: string, prompt: string) {
  if (content.startsWith(prompt)) {
    return content.slice(prompt.length).trim();
  }
  return content;
}

export async function continueConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  gameTimeMs: number,
): Promise<string> {
  const { player, others, conversation, agent, worldStartTime } = await ctx.runQuery(
    selfInternal.queryPromptData,
    { worldId, playerId, conversationId },
  );
  const audience = formatNameList(others.map((o) => o.name));
  const embedding = await embeddingsCache.fetch(
    ctx,
    others.length === 1
      ? `What do you think about ${others[0].name}?`
      : `What do you think about your conversation with ${audience}?`,
  );
  const memories = await memory.searchMemories(ctx, player.id as GameId<'players'>, embedding, 3);
  const prompt = [
    others.length > 1
      ? `You are ${player.name}, and you're currently in a group conversation with ${audience}.`
      : `You are ${player.name}, and you're currently in a conversation with ${audience}.`,
    `The conversation started at ${formatGameTimestamp(conversation.created, worldStartTime)}.`,
  ];
  prompt.push(...currentTimeAndPlacePrompt(player.position, worldStartTime, gameTimeMs, agent));
  prompt.push(...selfAndOthersPrompt(agent, others));
  prompt.push(...relatedMemoriesPrompt(memories));
  prompt.push(
    `Below is the current chat history.`,
    `DO NOT greet them again. Do NOT use the word "Hey" too often. Your response should be brief and within 200 characters.`,
  );

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt.join('\n'),
    },
    ...(await previousMessages(ctx, worldId, conversation.id as GameId<'conversations'>)),
  ];
  const lastPrompt = speakerLabel(player.name, others);
  llmMessages.push({ role: 'user', content: lastPrompt });

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    stop: stopWords(player.name, others),
  });
  return trimContentPrefx(content, lastPrompt);
}

export async function leaveConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  gameTimeMs: number,
): Promise<string> {
  const { player, others, conversation, agent, worldStartTime } = await ctx.runQuery(
    selfInternal.queryPromptData,
    { worldId, playerId, conversationId },
  );
  const audience = formatNameList(others.map((o) => o.name));
  const prompt = [
    `You are ${player.name}, and you're currently in a conversation with ${audience}.`,
    `You've decided to leave and would like to politely tell them you're heading off.`,
  ];
  prompt.push(...currentTimeAndPlacePrompt(player.position, worldStartTime, gameTimeMs, agent));
  prompt.push(...selfAndOthersPrompt(agent, others));
  prompt.push(
    `Below is the current chat history.`,
    `How would you like to tell them that you're leaving? Your response should be brief and within 200 characters.`,
  );
  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt.join('\n'),
    },
    ...(await previousMessages(ctx, worldId, conversation.id as GameId<'conversations'>)),
  ];
  const lastPrompt = speakerLabel(player.name, others);
  llmMessages.push({ role: 'user', content: lastPrompt });

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    stop: stopWords(player.name, others),
  });
  return trimContentPrefx(content, lastPrompt);
}

// --- Dialogue orchestrator -------------------------------------------------
// After an agent speaks, decide which participant should speak next so that a
// 3–5 person conversation flows naturally instead of everyone talking at once
// (or nobody talking). The floor is only routed among other AGENTS — humans
// speak whenever they choose, so we never block waiting on a human.
export async function decideNextSpeaker(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  speakerId: GameId<'players'>,
): Promise<GameId<'players'> | undefined> {
  const { player, others } = await ctx.runQuery(selfInternal.queryPromptData, {
    worldId,
    playerId: speakerId,
    conversationId,
  });
  const candidates = others.filter((o) => !o.human);
  if (candidates.length === 0) {
    // Only humans left to address — open the floor and let them respond.
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0].id as GameId<'players'>;
  }

  const prevMessages = await ctx.runQuery(api.messages.listMessages, { worldId, conversationId });
  const recent = prevMessages
    .slice(-8)
    .map((m) => `${m.authorName}: ${m.text}`)
    .join('\n');
  const candidateNames = candidates.map((c) => c.name);
  const prompt = [
    `You are the moderator of a casual group conversation in a small town.`,
    `Everyone present: ${formatNameList([player.name, ...others.map((o) => o.name)])}.`,
    `${player.name} just finished speaking. Decide who should speak next so the conversation flows naturally — pick whoever was addressed or asked a question, or whoever would most plausibly jump in.`,
    `You must choose exactly one of these names: ${candidateNames.join(', ')}.`,
    ``,
    `Recent conversation:`,
    recent,
    ``,
    `Reply with ONLY the chosen name, nothing else.`,
  ].join('\n');

  let chosen: OtherParticipant | undefined;
  try {
    const { content } = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 10,
    });
    const norm = content.trim().toLowerCase();
    chosen =
      candidates.find((c) => norm === c.name.toLowerCase()) ??
      candidates.find((c) => norm.includes(c.name.toLowerCase()));
  } catch (err) {
    console.error(`decideNextSpeaker failed: ${(err as Error).message}`);
  }
  if (!chosen) {
    // Fallback: hand the floor to whoever has gone longest without speaking.
    chosen =
      pickLeastRecentSpeaker(candidates, prevMessages) ??
      candidates[Math.floor(Math.random() * candidates.length)];
  }
  return chosen.id as GameId<'players'>;
}

function pickLeastRecentSpeaker(
  candidates: OtherParticipant[],
  messages: { author: string; _creationTime: number }[],
): OtherParticipant | undefined {
  const lastSpoke = new Map<string, number>();
  for (const m of messages) {
    lastSpoke.set(m.author, m._creationTime);
  }
  let best: OtherParticipant | undefined;
  let bestTime = Infinity;
  for (const c of candidates) {
    // Someone who hasn't spoken at all gets top priority (-1).
    const t = lastSpoke.get(c.id) ?? -1;
    if (t < bestTime) {
      bestTime = t;
      best = c;
    }
  }
  return best;
}

function formatNameList(names: string[]): string {
  if (names.length === 0) return 'no one';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// The label the model continues from. For a 1:1 chat we keep the explicit
// "X to Y:" form; for a group we just use "X:" since there's no single recipient.
function speakerLabel(name: string, others: { name: string }[]): string {
  return others.length === 1 ? `${name} to ${others[0].name}:` : `${name}:`;
}

function selfAndOthersPrompt(
  agent: { identity: string; scenarioInstruction?: string; health?: string } | null,
  others: OtherParticipant[],
): string[] {
  const prompt: string[] = [];
  if (agent) {
    prompt.push(`About you: ${agent.identity}`);
  }
  if (agent?.health === 'sick') {
    prompt.push(
      `You're feeling under the weather today — you've come down with a cold. You're low on energy and a little irritable, your replies are shorter and more subdued than usual, and you may mention not feeling well or wanting to head home and rest.`,
    );
  }
  for (const o of others) {
    if (o.identity) {
      prompt.push(`About ${o.name}: ${o.identity}`);
    }
  }
  if (others.length > 1) {
    prompt.push(
      `This is a group conversation with ${others.length + 1} people present (${formatNameList([
        ...others.map((o) => o.name),
        'you',
      ])}). Address the group or a specific person naturally, keep your turn short, and don't try to speak for anyone else.`,
    );
  }
  if (agent?.scenarioInstruction) {
    prompt.push(
      `SCENARIO DIRECTIVE (follow this right now): ${agent.scenarioInstruction}`,
      `Weave this directive naturally into the conversation without breaking character.`,
    );
  }
  return prompt;
}

function previousConversationPrompt(
  otherPlayer: { name: string } | undefined,
  conversation: { created: number } | null,
  worldStartTime: number | undefined,
  gameTimeMs: number,
): string[] {
  const prompt = [];
  if (conversation && otherPlayer) {
    const prev = formatGameTimestamp(conversation.created, worldStartTime);
    const now = formatGameTimestamp(gameTimeMs, worldStartTime);
    prompt.push(`Last time you chatted with ${otherPlayer.name} it was ${prev}. It's now ${now}.`);
  }
  return prompt;
}

function currentTimeAndPlacePrompt(
  position: { x: number; y: number },
  worldStartTime: number | undefined,
  gameTimeMs: number,
  agent: { schedule?: any[]; currentStepIndex?: number } | null,
): string[] {
  const prompt: string[] = [];
  if (worldStartTime !== undefined) {
    const gt = computeGameTime(gameTimeMs, worldStartTime);
    prompt.push(
      `It is currently Day ${gt.dayNumber}, ${gt.timeStr} (${gt.isDay ? 'daytime' : 'nighttime'}) in Singapore.`,
    );
  }
  // Find the nearest named location.
  let nearest: { name: string; d: number } | null = null;
  for (const loc of CITY_LOCATIONS) {
    const dx = loc.x - position.x;
    const dy = loc.y - position.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (!nearest || d < nearest.d) nearest = { name: loc.name, d };
  }
  if (nearest) {
    if (nearest.d <= 3) prompt.push(`You are at ${nearest.name}.`);
    else if (nearest.d <= 8) prompt.push(`You are on the street near ${nearest.name}.`);
    else prompt.push(`You are somewhere in the city, away from major landmarks.`);
  }
  if (agent && agent.schedule && agent.currentStepIndex !== undefined) {
    const step = agent.schedule[agent.currentStepIndex];
    if (step && step.description) {
      prompt.push(`Your current plan: ${step.description}.`);
    }
  }
  return prompt;
}

function relatedMemoriesPrompt(memories: memory.Memory[]): string[] {
  const prompt = [];
  if (memories.length > 0) {
    prompt.push(`Here are some related memories in decreasing relevance order:`);
    for (const memory of memories) {
      prompt.push(' - ' + memory.description);
    }
  }
  return prompt;
}

async function previousMessages(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
) {
  const llmMessages: LLMMessage[] = [];
  const prevMessages = await ctx.runQuery(api.messages.listMessages, { worldId, conversationId });
  for (const message of prevMessages) {
    llmMessages.push({
      role: 'user',
      content: `${message.authorName}: ${message.text}`,
    });
  }
  return llmMessages;
}

export const queryPromptData = internalQuery({
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
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
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
    const agent = world.agents.find((a) => a.playerId === args.playerId);
    let agentIdentity: string | undefined;
    if (agent) {
      const agentDescription = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
        .first();
      agentIdentity = agentDescription?.identity;
    }

    // Build the list of OTHER participants (everyone in the conversation but us),
    // each with their name, identity (if they're an agent), and human flag.
    const others: OtherParticipant[] = [];
    for (const membership of conversation.participants) {
      const pid = membership.playerId;
      if (pid === args.playerId) continue;
      const otherPlayer = world.players.find((p) => p.id === pid);
      if (!otherPlayer) continue; // May have just left the conversation.
      const desc = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', pid))
        .first();
      const otherAgent = world.agents.find((a) => a.playerId === pid);
      let identity: string | undefined;
      if (otherAgent) {
        const ad = await ctx.db
          .query('agentDescriptions')
          .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', otherAgent.id))
          .first();
        identity = ad?.identity;
      }
      others.push({
        id: pid,
        name: desc?.name ?? 'Someone',
        identity,
        human: !!otherPlayer.human,
        position: otherPlayer.position,
      });
    }

    // The most recent prior conversation with our primary interlocutor, for a
    // little continuity flavour in the opening line.
    let lastConversation = null;
    const primaryOther = others[0];
    if (primaryOther) {
      const lastTogether = await ctx.db
        .query('participatedTogether')
        .withIndex('edge', (q) =>
          q.eq('worldId', args.worldId).eq('player1', args.playerId).eq('player2', primaryOther.id),
        )
        .order('desc')
        .first();
      if (lastTogether) {
        lastConversation = await ctx.db
          .query('archivedConversations')
          .withIndex('worldId', (q) =>
            q.eq('worldId', args.worldId).eq('id', lastTogether.conversationId),
          )
          .first();
      }
    }
    return {
      player: { name: playerDescription.name, ...player },
      others,
      conversation,
      agent: agent
        ? {
            identity: agentIdentity ?? `${playerDescription.name} is a resident of Singapore.`,
            ...agent,
          }
        : null,
      lastConversation,
      worldStartTime: world.worldStartTime,
    };
  },
});

function stopWords(playerName: string, others: { name: string }[]): string[] {
  // Stop the model from continuing as anyone else in the room. OpenAI allows at
  // most 4 stop sequences, so we cap the list.
  const out: string[] = [];
  for (const o of others) {
    out.push(`${o.name}:`);
    if (others.length === 1) {
      out.push(`${o.name} to ${playerName}:`);
    }
    if (out.length >= 4) break;
  }
  return out.slice(0, 4);
}
