import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { ActionCtx, internalQuery } from '../_generated/server';
import { LLMMessage, chatCompletion } from '../util/llm';
import * as memory from './memory';
import { api, internal } from '../_generated/api';
import * as embeddingsCache from './embeddingsCache';
import { GameId, conversationId, playerId } from '../aiTown/ids';
import { FamilyTie, affinityLabel, affinityToward, familyRelation } from '../aiTown/affinity';
import {
  buildShortTermSnapshot,
  shortTermSelfDescription,
  type ShortTerm,
} from '../aiTown/shortTerm';
import {
  NUM_MEMORIES_TO_SEARCH,
  SCENARIO_GOAL_CHECK_MIN_MESSAGES,
  SCENARIO_HISTORY_MESSAGE_COUNT,
  SCENARIO_RECALL_MEMORY_COUNT,
  SCENARIO_TASK_DEFAULT_DURATION_MS,
  SCENARIO_TASK_MAX_DURATION_MS,
  SCENARIO_TASK_MIN_DURATION_MS,
} from '../constants';
import { computeGameTime, formatGameTimestamp } from '../aiTown/gameTime';
import { CITY_LOCATIONS } from '../../data/cityLocations';

const selfInternal = internal.agent.conversation;

type OtherParticipant = {
  id: string;
  name: string;
  identity?: string;
  // Compact, scenario-relevant summary of this participant (set during an active
  // scenario by the extraction op). When present it replaces `identity` in our
  // prompt so we see only what matters about them for the current activity.
  scenarioProfile?: string;
  human: boolean;
  position: { x: number; y: number };
  // What this participant is visibly doing right now (their live activity), so the
  // speaker can react to it — "still got the counter to wipe down?" — instead of
  // everyone talking in a vacuum. Undefined when they aren't mid-activity.
  activity?: string;
  // How the speaker relates to this participant: the directional family label (if
  // any) and the speaker's current affinity toward them (0–100). Computed in
  // queryPromptData from the speaker's own family + affinities.
  relationship?: string;
  affinity?: number;
};

// The live activity description for a player, or undefined if theirs has elapsed.
// Agents keep their schedule ("ambient") activity running while they walk around
// and while they talk, which is exactly what makes it worth putting in the prompt.
function liveActivity(player: { activity?: { description: string; until: number } }): string | undefined {
  if (!player.activity) return undefined;
  return player.activity.until > Date.now() ? player.activity.description : undefined;
}

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
  prompt.push(...currentTimeAndPlacePrompt(player, worldStartTime, gameTimeMs, agent));
  prompt.push(...selfAndOthersPrompt(agent, others));
  prompt.push(
    ...previousConversationPrompt(primaryOther, lastConversation, worldStartTime, gameTimeMs),
  );
  prompt.push(...relatedMemoriesPrompt(memories));
  if (agent?.scenarioId) {
    const scenarioMessages = await ctx.runQuery(selfInternal.loadScenarioMessages, {
      worldId,
      scenarioId: agent.scenarioId,
      excludeConversationId: conversationId,
      limit: SCENARIO_HISTORY_MESSAGE_COUNT,
    });
    prompt.push(...scenarioHistoryPrompt(scenarioMessages));
  }
  if (agent?.scenarioInstruction) {
    const pastScenarios = await recallPastScenarios(ctx, player.id as GameId<'players'>, agent, memories);
    prompt.push(...pastScenariosPrompt(pastScenarios));
  }
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
  prompt.push(...currentTimeAndPlacePrompt(player, worldStartTime, gameTimeMs, agent));
  prompt.push(...selfAndOthersPrompt(agent, others));
  prompt.push(...relatedMemoriesPrompt(memories));
  if (agent?.scenarioId) {
    const scenarioMessages = await ctx.runQuery(selfInternal.loadScenarioMessages, {
      worldId,
      scenarioId: agent.scenarioId,
      excludeConversationId: conversationId,
      limit: SCENARIO_HISTORY_MESSAGE_COUNT,
    });
    prompt.push(...scenarioHistoryPrompt(scenarioMessages));
  }
  if (agent?.scenarioInstruction) {
    const pastScenarios = await recallPastScenarios(ctx, player.id as GameId<'players'>, agent, memories);
    prompt.push(...pastScenariosPrompt(pastScenarios));
  }
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
  prompt.push(...currentTimeAndPlacePrompt(player, worldStartTime, gameTimeMs, agent));
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

// Once the scenario goal-judge marks the goal met, the designated speaker posts a
// short wrap-up that says HOW the group achieved it (the decision/arrangement they
// reached and who's doing what) — so the chat ends on the outcome, not just goodbyes.
export async function summarizeGoalMessage(
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
  const goal = agent?.scenarioGoal;
  const prompt = [
    `You are ${player.name}, wrapping up a conversation with ${audience}.`,
    goal
      ? `Your group has just achieved what you set out to do: ${goal}`
      : `Your group has just reached a conclusion.`,
    `In one or two short sentences (under 200 characters), tell the others — in character, first person — HOW you pulled it off: the key decision or arrangement you reached and who's doing what. Just the upshot, not a recap of the whole chat. Don't greet them again.`,
  ];
  prompt.push(...currentTimeAndPlacePrompt(player, worldStartTime, gameTimeMs, agent));
  prompt.push(...selfAndOthersPrompt(agent, others));
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
    max_tokens: 200,
    stop: stopWords(player.name, others),
  });
  return trimContentPrefx(content, lastPrompt);
}

// --- Dialogue orchestrator -------------------------------------------------
// After an agent speaks, decide which participant should speak next so that a
// 3–5 person conversation flows naturally instead of everyone talking at once
// (or nobody talking). The floor is only routed among other AGENTS — humans
// speak whenever they choose, so we never block waiting on a human.
//
// For SCENARIO conversations this also doubles as the goal-judge: once enough has
// been said, the same LLM call decides whether the scenario's goal has been met,
// so the conversation can wrap up instead of running to the hard cap. Returns the
// designated next speaker (undefined = open floor) plus whether the goal is met.
export async function decideNextSpeaker(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  speakerId: GameId<'players'>,
): Promise<{ nextSpeaker?: GameId<'players'>; goalMet: boolean; coveredTopics: number[] }> {
  const { player, others, agent } = await ctx.runQuery(selfInternal.queryPromptData, {
    worldId,
    playerId: speakerId,
    conversationId,
  });
  const candidates = others.filter((o) => !o.human);
  if (candidates.length === 0) {
    // Only humans left to address — open the floor and let them respond.
    return { nextSpeaker: undefined, goalMet: false, coveredTopics: [] };
  }

  // Only treat this as a scenario conversation (and judge its goal) when the
  // speaker is enlisted in a scenario that carries a completion goal.
  const scenarioGoal = agent?.scenarioInstruction ? agent?.scenarioGoal : undefined;
  const topics = (agent?.scenarioInstruction ? agent?.scenarioTopics : undefined) ?? [];
  const scenarioConflict = agent?.scenarioInstruction ? agent?.scenarioConflict : undefined;
  const prevMessages = await ctx.runQuery(api.messages.listMessages, { worldId, conversationId });
  const checkGoal = !!scenarioGoal && prevMessages.length >= SCENARIO_GOAL_CHECK_MIN_MESSAGES;

  // Fast path: a single other agent and no goal to judge — no LLM call needed.
  if (candidates.length === 1 && !checkGoal) {
    return { nextSpeaker: candidates[0].id as GameId<'players'>, goalMet: false, coveredTopics: [] };
  }

  const recent = prevMessages
    .slice(-8)
    .map((m) => `${m.authorName}: ${m.text}`)
    .join('\n');
  const candidateNames = candidates.map((c) => c.name);

  const promptLines = [
    `You are the moderator of a casual group conversation in a small town.`,
    `Everyone present: ${formatNameList([player.name, ...others.map((o) => o.name)])}.`,
    `${player.name} just finished speaking.`,
  ];
  if (checkGoal) {
    const numberedTopics = topics.map((t, i) => `${i + 1}. ${t}`).join('\n');
    promptLines.push(
      `This conversation is part of a scenario. Its overall goal: ${scenarioGoal}`,
      topics.length > 0 ? `Tasks it should work through:\n${numberedTopics}` : ``,
      scenarioConflict
        ? `There is a genuine disagreement at the heart of this: ${scenarioConflict} Only count the goal as met once the group has actually argued this out and reached a clear joint decision or compromise — NOT if they gave in instantly or never really engaged with the disagreement.`
        : ``,
      `First, decide who should speak next from: ${candidateNames.join(', ')} (pick whoever was addressed or asked a question, or who would most plausibly jump in).`,
      topics.length > 0
        ? `Second, list the task numbers above that the group has SUBSTANTIVELY covered so far (discussed with real content, not merely mentioned in passing).`
        : ``,
      `${topics.length > 0 ? 'Third' : 'Second'}, judge whether the group has now SUBSTANTIVELY achieved the overall goal — key points discussed and any decisions or arrangements actually made. Be strict: only true if it would feel natural to wrap up.`,
      ``,
      `Recent conversation:`,
      recent,
      ``,
      `Reply with ONLY strict JSON: {"next":"<one of: ${candidateNames.join(', ')}>","covered":[task numbers],"goalMet":true or false}`,
    );
  } else {
    promptLines.push(
      `Decide who should speak next so the conversation flows naturally — pick whoever was addressed or asked a question, or whoever would most plausibly jump in.`,
      `You must choose exactly one of these names: ${candidateNames.join(', ')}.`,
      ``,
      `Recent conversation:`,
      recent,
      ``,
      `Reply with ONLY the chosen name, nothing else.`,
    );
  }
  const prompt = promptLines.filter(Boolean).join('\n');

  let chosen: OtherParticipant | undefined;
  let goalMet = false;
  let coveredTopics: number[] = [];
  try {
    const { content } = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: checkGoal ? 60 : 10,
    });
    let nameText: string;
    if (checkGoal) {
      const parsed = parseGoalJudge(content, topics.length);
      goalMet = parsed.goalMet;
      coveredTopics = parsed.covered;
      nameText = (parsed.next ?? '').toLowerCase();
    } else {
      nameText = content.trim().toLowerCase();
    }
    chosen =
      candidates.find((c) => nameText === c.name.toLowerCase()) ??
      candidates.find((c) => nameText.includes(c.name.toLowerCase()));
  } catch (err) {
    console.error(`decideNextSpeaker failed: ${(err as Error).message}`);
  }
  if (!chosen) {
    // Fallback: the lone candidate, else whoever has gone longest without speaking.
    chosen =
      (candidates.length === 1 ? candidates[0] : undefined) ??
      pickLeastRecentSpeaker(candidates, prevMessages) ??
      candidates[Math.floor(Math.random() * candidates.length)];
  }
  return { nextSpeaker: chosen.id as GameId<'players'>, goalMet, coveredTopics };
}

// Tolerantly parse the goal-judge's JSON reply
// {"next": "...", "covered": [1,3], "goalMet": true}. `covered` is returned as
// 0-based topic indices, bounded to [0, topicCount).
function parseGoalJudge(
  content: string,
  topicCount: number,
): { next?: string; covered: number[]; goalMet: boolean } {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(match ? match[0] : content);
    const covered = Array.isArray(obj.covered)
      ? obj.covered
          .map((n: unknown) => Number(n) - 1)
          .filter((i: number) => Number.isInteger(i) && i >= 0 && i < topicCount)
      : [];
    return {
      next: typeof obj.next === 'string' ? obj.next : undefined,
      covered,
      goalMet: obj.goalMet === true || obj.goalMet === 'true',
    };
  } catch {
    // No parseable JSON: leave the next speaker to the fallback and read goalMet
    // loosely from the text so a goal that was clearly flagged still registers.
    return { next: undefined, covered: [], goalMet: /goalmet"?\s*[:=]\s*true/i.test(content) };
  }
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
  agent: {
    identity: string;
    profile?: Record<string, string>;
    scenarioInstruction?: string;
    scenarioTopics?: string[];
    scenarioGoal?: string;
    scenarioConflict?: string;
    health?: string;
    shortTerm?: ShortTerm;
    balance?: number;
    learnedTraits?: string[];
  } | null,
  others: OtherParticipant[],
): string[] {
  const prompt: string[] = [];
  if (agent) {
    prompt.push(`About you: ${agent.identity}`);
    // Self-full: the character is aware of its own complete structured background.
    if (agent.profile && Object.keys(agent.profile).length > 0) {
      const lines = Object.entries(agent.profile).map(([k, val]) => `  - ${k}: ${val}`);
      prompt.push([`Your background details:`, ...lines].join('\n'));
    }
    // Durable traits the character has learned about itself over time (promoted
    // from reflection); augments — never replaces — the authored background above.
    if (agent.learnedTraits && agent.learnedTraits.length > 0) {
      prompt.push(
        [
          `Things you've come to realise about yourself over time:`,
          ...agent.learnedTraits.map((t) => `  - ${t}`),
        ].join('\n'),
      );
    }
  }
  if (agent?.health === 'sick') {
    prompt.push(
      `You're feeling under the weather today — you've come down with a cold. You're low on energy and a little irritable, your replies are shorter and more subdued than usual, and you may mention not feeling well or wanting to head home and rest.`,
    );
  }
  // Short-term self-view: let temporary state (mood/stress/fatigue/hunger/money
  // worries) colour how the character comes across right now, without overriding
  // their stable personality.
  if (agent) {
    const selfState = shortTermSelfDescription(
      buildShortTermSnapshot({
        shortTerm: agent.shortTerm,
        balance: agent.balance,
        health: agent.health === 'sick' ? 'sick' : 'well',
        now: Date.now(),
      }),
    );
    if (selfState) {
      prompt.push(
        `${selfState} Let this temporary state colour your tone and choices in the moment, but stay in character.`,
      );
    }
  }
  for (const o of others) {
    // Others-filtered: during a scenario, show the compact scenario-relevant
    // profile; otherwise fall back to their full identity.
    const about = o.scenarioProfile ?? o.identity;
    if (about) {
      prompt.push(`About ${o.name}: ${about}`);
    }
    // Ground the speaker in how they relate to this person: family ties always,
    // affinity only when it's notable (family, or clearly warm/cool) so we don't
    // spam "neutral" into every line.
    const clauses: string[] = [];
    if (o.relationship) clauses.push(`they are your ${o.relationship}`);
    if (o.affinity !== undefined && (o.relationship || o.affinity >= 65 || o.affinity < 45)) {
      clauses.push(`you feel ${affinityLabel(o.affinity)} toward them`);
    }
    if (clauses.length > 0) {
      prompt.push(`Your relationship with ${o.name}: ${clauses.join(', ')}.`);
    }
    // What they're visibly up to, so the speaker can react to it rather than
    // talking past someone who is plainly in the middle of something.
    if (o.activity) {
      prompt.push(`${o.name} is ${o.activity} as you talk.`);
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
    if (agent.scenarioConflict) {
      prompt.push(
        `POINT OF DISAGREEMENT: ${agent.scenarioConflict}`,
        `You genuinely disagree with some of the others here. Pick the side that fits YOUR character, background and feelings toward them, and argue for it — make your case, push back when you disagree, and don't just cave to keep the peace. Let the argument actually play out over a few turns before anyone gives ground or a compromise is reached.`,
      );
    }
    if (agent.scenarioTopics && agent.scenarioTopics.length > 0) {
      prompt.push(
        `Work through these specific points over the conversation (advance the discussion — don't just repeat yourself or restate the situation):`,
        ...agent.scenarioTopics.map((t) => `  - ${t}`),
      );
    }
    if (agent.scenarioGoal) {
      prompt.push(
        `The goal of this conversation is: ${agent.scenarioGoal}. Keep it productive and moving toward that goal; once it's reached, you can wrap up naturally.`,
      );
    }
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
  player: { position: { x: number; y: number }; activity?: { description: string; until: number } },
  worldStartTime: number | undefined,
  gameTimeMs: number,
  agent: { schedule?: any[]; currentStepIndex?: number } | null,
): string[] {
  const position = player.position;
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
  // What they're physically doing right now, which is usually more concrete than
  // the plan above ("wiping down the counter" vs "working my shift at the cafe").
  // They carry on doing it through the conversation, so it's fair game to mention:
  // an interruption mid-task, an excuse to keep it short, or just small talk.
  const activity = liveActivity(player);
  if (activity) {
    prompt.push(
      `Right now you are ${activity} — you're carrying on with it while you talk. Mention or work it into what you say when it fits naturally; don't force it.`,
    );
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

// Render recent messages from the rest of the current scenario (its OTHER
// conversations) so the speaker stays consistent with what the group has already
// said or agreed — e.g. tasks another pair has already claimed.
function scenarioHistoryPrompt(msgs: { authorName: string; text: string }[]): string[] {
  const prompt: string[] = [];
  if (msgs.length > 0) {
    prompt.push(
      `Earlier in this same scenario, others said the following in conversations you weren't part of. Stay consistent with it — especially any plan already made or tasks already claimed or assigned; don't contradict or re-litigate it:`,
    );
    for (const m of msgs) {
      prompt.push(` - ${m.authorName}: ${m.text}`);
    }
  }
  return prompt;
}

// Recall memories of PAST scenarios (or similar situations) this agent lived through,
// so a new scenario is grounded in how earlier ones went. Every scenario conversation
// is already remembered by the ordinary memory flow; the ordinary search is seeded by
// WHO you're talking to, so it rarely surfaces those. We re-search seeded by the
// current scenario's theme (name + directive) to pull up the relevant ones, dropping
// any already shown by the generic search so we don't repeat them.
async function recallPastScenarios(
  ctx: ActionCtx,
  playerId: GameId<'players'>,
  agent: { scenarioName?: string; scenarioInstruction?: string },
  alreadyShown: memory.Memory[],
): Promise<memory.Memory[]> {
  const theme = [agent.scenarioName, agent.scenarioInstruction].filter(Boolean).join(': ');
  if (!theme) return [];
  const embedding = await embeddingsCache.fetch(ctx, `A past situation like this: ${theme}`);
  const found = await memory.searchMemories(ctx, playerId, embedding, SCENARIO_RECALL_MEMORY_COUNT);
  const shownIds = new Set(alreadyShown.map((m) => m._id));
  return found.filter((m) => !shownIds.has(m._id));
}

function pastScenariosPrompt(memories: memory.Memory[]): string[] {
  const prompt: string[] = [];
  if (memories.length > 0) {
    prompt.push(`You also recall these past situations like this one, which you can draw on:`);
    for (const m of memories) {
      prompt.push(` - ${m.description}`);
    }
  }
  return prompt;
}

// Exported for convex/focal.ts, which builds its own prompt but wants the chat
// history in exactly the same shape the ordinary message generators use.
export async function previousMessages(
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

// Recent messages from the rest of a scenario — every message stamped with this
// `scenarioId` EXCEPT those in `excludeConversationId` (the caller's current chat,
// which already comes through as the live history). Most recent `limit`, oldest
// first, with author names resolved.
export const loadScenarioMessages = internalQuery({
  args: {
    worldId: v.id('worlds'),
    scenarioId: v.string(),
    // Omit to read the whole scenario transcript (used by the task planner); pass
    // the caller's current conversation to skip messages already shown as live chat.
    excludeConversationId: v.optional(conversationId),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_scenario', (q) =>
        q.eq('worldId', args.worldId).eq('scenarioId', args.scenarioId),
      )
      .collect();
    const recent = rows
      .filter((m) => !args.excludeConversationId || m.conversationId !== args.excludeConversationId)
      .slice(-args.limit);
    const nameCache = new Map<string, string>();
    const out: { authorName: string; text: string }[] = [];
    for (const m of recent) {
      let name = nameCache.get(m.author);
      if (name === undefined) {
        const desc = await ctx.db
          .query('playerDescriptions')
          .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', m.author))
          .first();
        name = desc?.name ?? 'Someone';
        nameCache.set(m.author, name);
      }
      out.push({ authorName: name, text: m.text });
    }
    return out;
  },
});

// Context the task planner needs: the active scenario's framing plus its
// participants (name + the compact scenario profile others see).
export const loadScenarioPlanData = internalQuery({
  args: { worldId: v.id('worlds'), scenarioId: v.string() },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const sc = (world.activeScenarios ?? []).find((s) => s.id === args.scenarioId);
    if (!sc) return null;
    const participants: { id: string; name: string; scenarioProfile?: string }[] = [];
    for (let i = 0; i < sc.participantIds.length; i++) {
      const pid = sc.participantIds[i];
      const agent = world.agents.find((a) => a.playerId === pid);
      participants.push({
        id: pid,
        name: sc.participantNames[i] ?? 'Someone',
        scenarioProfile: agent?.scenarioProfile,
      });
    }
    return {
      name: sc.name,
      instruction: sc.instruction,
      context: sc.context,
      goals: sc.goals,
      participants,
    };
  },
});

// Turn a local scenario's just-concluded planning conversation into concrete,
// physical to-do tasks, each delegated to a participant (grounded in what they
// actually agreed). Returns [] on any failure so the caller degrades gracefully.
export async function planScenarioTasks(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  scenarioId: string,
): Promise<{ label: string; emoji: string; assigneeId: string; durationMs: number }[]> {
  const data = await ctx.runQuery(selfInternal.loadScenarioPlanData, { worldId, scenarioId });
  if (!data || data.participants.length === 0) return [];
  const transcript = await ctx.runQuery(selfInternal.loadScenarioMessages, {
    worldId,
    scenarioId,
    limit: 40,
  });
  const names = data.participants.map((p) => p.name);
  const profileLines = data.participants
    .filter((p) => p.scenarioProfile)
    .map((p) => ` - ${p.name}: ${p.scenarioProfile}`);
  const transcriptText =
    transcript.length > 0
      ? transcript.map((m) => `${m.authorName}: ${m.text}`).join('\n')
      : '(no transcript available)';
  const prompt = [
    `You are planning the hands-on work for a workplace scene in a small town.`,
    `Scenario: ${data.name} — ${data.instruction}`,
    `Situation: ${data.context}`,
    data.goals ? `Guidance on who does what: ${data.goals}` : ``,
    `People present (use these EXACT names as assignees): ${names.join(', ')}.`,
    ...(profileLines.length > 0 ? [`Relevant notes:`, ...profileLines] : []),
    ``,
    `They just finished talking and agreed a plan. Here is what they said:`,
    transcriptText,
    ``,
    `Turn their plan into concrete, physical to-do tasks — the actual hands-on work each person now goes off to DO (not talk about). Honour who agreed to do what. Give each person at least one task; aim for ${names.length}-${names.length + 3} tasks total. Keep each label a short imperative of at most ~6 words.`,
    `Reply with ONLY strict JSON, no prose: {"tasks":[{"label":"...","emoji":"<one emoji>","assignee":"<one of: ${names.join(
      ', ',
    )}>","durationSec":<number 20-90>}]}`,
  ]
    .filter(Boolean)
    .join('\n');

  const { content } = await chatCompletion({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 400,
  });
  return parseScenarioTasks(content, data.participants);
}

// Tolerantly parse the planner's JSON (`{"tasks":[{label,emoji,assignee,durationSec}]}`).
// Resolves assignee names to player ids (falling back to round-robin) and clamps
// durations to the configured range.
function parseScenarioTasks(
  content: string,
  participants: { id: string; name: string }[],
): { label: string; emoji: string; assigneeId: string; durationMs: number }[] {
  let arr: any[] = [];
  try {
    const match = content.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(match ? match[0] : content);
    arr = Array.isArray(obj.tasks) ? obj.tasks : Array.isArray(obj) ? obj : [];
  } catch {
    return [];
  }
  const byName = new Map(participants.map((p) => [p.name.toLowerCase(), p.id]));
  const out: { label: string; emoji: string; assigneeId: string; durationMs: number }[] = [];
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i] ?? {};
    const label = typeof t.label === 'string' ? t.label.trim() : '';
    if (!label) continue;
    const emoji = typeof t.emoji === 'string' && t.emoji.trim() ? t.emoji.trim() : '🛠️';
    const nameKey = typeof t.assignee === 'string' ? t.assignee.trim().toLowerCase() : '';
    let assigneeId =
      byName.get(nameKey) ??
      [...byName.entries()].find(([n]) => nameKey && (nameKey.includes(n) || n.includes(nameKey)))
        ?.[1];
    if (!assigneeId) assigneeId = participants[i % participants.length].id;
    const sec = Number(t.durationSec);
    const durationMs = Number.isFinite(sec)
      ? Math.min(SCENARIO_TASK_MAX_DURATION_MS, Math.max(SCENARIO_TASK_MIN_DURATION_MS, sec * 1000))
      : SCENARIO_TASK_DEFAULT_DURATION_MS;
    out.push({ label, emoji, assigneeId, durationMs });
  }
  return out;
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
    let agentProfile: Record<string, string> | undefined;
    let agentFamily: FamilyTie[] | undefined;
    if (agent) {
      const agentDescription = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
        .first();
      agentIdentity = agentDescription?.identity;
      // The character knows its OWN full structured background (self-full).
      agentProfile = agentDescription?.profile;
      // ...and how it relates to others (immutable family ties).
      agentFamily = agentDescription?.family;
    }
    // The speaker's current directional affinity toward others (mutable).
    const selfAffinities = agent?.affinities;

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
        // Others are filtered: during a scenario we show only their compact
        // scenario-relevant profile instead of their full identity.
        scenarioProfile: otherAgent?.scenarioProfile,
        human: !!otherPlayer.human,
        position: otherPlayer.position,
        activity: liveActivity(otherPlayer),
        relationship: agent ? familyRelation(agentFamily, desc?.name) : undefined,
        affinity: agent
          ? affinityToward({
              affinities: selfAffinities,
              otherPlayerId: pid,
              family: agentFamily,
              otherName: desc?.name,
            })
          : undefined,
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
            profile: agentProfile,
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
