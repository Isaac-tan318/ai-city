import { v } from 'convex/values';
import { internalAction, internalQuery } from '../_generated/server';
import { parseTimeOfDay, isWeekday, dayOfWeekName } from './gameTime';
import { WorldMap, serializedWorldMap } from './worldMap';
import { rememberConversation, rememberScenarioOutcome } from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  decideNextSpeaker,
  leaveConversationMessage,
  planScenarioTasks,
  startConversationMessage,
  summarizeGoalMessage,
} from '../agent/conversation';
import { assertNever } from '../util/assertNever';
import { serializedAgent, ScheduleStep, scheduleStep } from './agent';
import {
  activitiesForName,
  Activity,
  ACTIVITY_COOLDOWN,
  ACTIVITY_COST_PRESSURE_WEIGHT,
  ACTIVITY_ENERGY_FATIGUE_WEIGHT,
  CONVERSATION_COOLDOWN,
  RELATIONSHIP_EVENT_REASON_MAX_CHARS,
} from '../constants';
import { buildShortTermSnapshot } from './shortTerm';
import type { SerializedAgent } from './agent';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';
import { chatCompletion } from '../util/llm';
import {
  CITY_LOCATIONS,
  CityLocation,
  getLocationById,
  workplaceFor,
  workLeashAnchor,
} from '../../data/cityLocations';
import { WORK_LEASH_RADIUS } from '../constants';
import { point } from '../util/types';

export const agentRememberConversation = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    let affinityDeltas: { playerId: string; delta: number }[] = [];
    let shortTermDeltas: { component: string; delta: number }[] = [];
    let learnedTrait: string | undefined;
    let affinityReason: string | undefined;
    try {
      const result = await rememberConversation(
        ctx,
        args.worldId,
        args.agentId as GameId<'agents'>,
        args.playerId as GameId<'players'>,
        args.conversationId as GameId<'conversations'>,
      );
      affinityDeltas = result?.affinityDeltas ?? [];
      shortTermDeltas = result?.shortTermDeltas ?? [];
      learnedTrait = result?.learnedTrait;
      // Distill the memory summary into a short "why" snippet for the
      // relationship-event log: drop the boilerplate prefix, keep the first
      // sentence, cap the length.
      const description = (result as { description?: string })?.description;
      if (description) {
        const stripped = description.replace(/^Conversation with .*? at .*?: /, '');
        const firstSentence = stripped.split(/(?<=[.!?])\s/)[0] ?? stripped;
        affinityReason = firstSentence.slice(0, RELATIONSHIP_EVENT_REASON_MAX_CHARS).trim();
      }
    } catch (err) {
      // CRITICAL: never let a failed remember leave the agent stuck. If the
      // conversation can't be loaded (e.g. an abandoned invite that was never
      // archived → "Conversation not found"), rememberConversation throws. With
      // no catch, the operation would never reach finishRememberConversation
      // below, so the agent's inProgressOperation stays set until the 120s
      // ACTION_TIMEOUT. While stuck, the agent can't accept invites or send
      // messages — which silently froze conversations town-wide. Swallow the
      // error and fall through to finish the operation so the agent is freed.
      console.error(
        `agentRememberConversation failed for ${args.conversationId}: ${(err as Error).message}`,
      );
    }
    await sleep(Math.random() * 1000);
    // Apply any affinity shifts the summary judged, then free the agent.
    if (affinityDeltas.length > 0) {
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'agentApplyAffinity',
        args: {
          agentId: args.agentId,
          deltas: affinityDeltas,
          conversationId: args.conversationId,
          reason: affinityReason,
        },
      });
    }
    // Apply any mood/stress shifts the same verdict judged (folded into this same
    // post-conversation write-back rather than a separate op).
    if (shortTermDeltas.length > 0) {
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'agentApplyShortTerm',
        args: {
          agentId: args.agentId,
          deltas: shortTermDeltas,
          reason: affinityReason,
        },
      });
    }
    // Promote a stable, reflected-on pattern to a durable learned trait (kept
    // separate from the authored profile so runtime learning never clobbers it).
    if (learnedTrait) {
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'agentAddLearnedTrait',
        args: { agentId: args.agentId, trait: learnedTrait },
      });
    }
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishRememberConversation',
      args: {
        agentId: args.agentId,
        operationId: args.operationId,
      },
    });
  },
});

// Post-scenario write-back (spec point 6): when an automatic scenario ends, each
// participant forms a lasting memory of the OUTCOME and its residual mood/stress is
// applied. Scheduled (lock-free) from the scenario manager as the scenario is torn
// down; the scenario's own fields are passed in since the entry is about to be
// removed. Mirrors the agentRememberConversation flow.
export const agentRememberScenario = internalAction({
  args: {
    worldId: v.id('worlds'),
    agentId,
    playerId,
    name: v.string(),
    scenarioName: v.string(),
    instruction: v.string(),
    goal: v.optional(v.string()),
    goalMet: v.boolean(),
    outcome: v.string(),
    wasPlanner: v.boolean(),
    conflict: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let shortTermDeltas: { component: string; delta: number }[] = [];
    try {
      const result = await rememberScenarioOutcome(
        ctx,
        args.worldId,
        args.playerId as GameId<'players'>,
        {
          name: args.name,
          scenarioName: args.scenarioName,
          instruction: args.instruction,
          goal: args.goal,
          goalMet: args.goalMet,
          outcome: args.outcome,
          wasPlanner: args.wasPlanner,
          conflict: args.conflict,
        },
      );
      shortTermDeltas = result.shortTermDeltas;
    } catch (err) {
      console.error(`agentRememberScenario failed: ${(err as Error).message}`);
    }
    if (shortTermDeltas.length > 0) {
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'agentApplyShortTerm',
        args: {
          agentId: args.agentId,
          deltas: shortTermDeltas,
          reason: `after ${args.scenarioName}`,
        },
      });
    }
  },
});

// Loads the static background + name needed to extract a scenario-relevant
// profile. Kept tiny so the extraction action's only heavy step is the LLM call.
export const loadScenarioProfileContext = internalQuery({
  args: { worldId: v.id('worlds'), agentId, playerId },
  handler: async (ctx, args) => {
    const agentDescription = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId).eq('agentId', args.agentId as GameId<'agents'>),
      )
      .unique();
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId).eq('playerId', args.playerId as GameId<'players'>),
      )
      .unique();
    const world = await ctx.db.get(args.worldId);
    return {
      name: playerDescription?.name ?? 'the character',
      profile: agentDescription?.profile,
      scenarioName: world?.scenarioName,
    };
  },
});

// Distil a character's full structured background down to just the traits that
// matter for the current scenario — the compact view *other* participants see in
// their prompts (the character itself always sees its full background). Runs once
// per scenario per character (scheduled lock-free from Agent.tick), never per
// message, so the extra LLM call doesn't bottleneck the conversation loop.
export const agentExtractScenarioProfile = internalAction({
  args: {
    worldId: v.id('worlds'),
    agentId,
    playerId,
    scenarioInstruction: v.string(),
  },
  handler: async (ctx, args) => {
    const { name, profile, scenarioName } = await ctx.runQuery(
      internal.aiTown.agentOperations.loadScenarioProfileContext,
      { worldId: args.worldId, agentId: args.agentId, playerId: args.playerId },
    );
    // No structured background → nothing to distil; others fall back to identity.
    if (!profile || Object.keys(profile).length === 0) {
      return;
    }
    const profileLines = Object.entries(profile)
      .map(([k, val]) => `- ${k}: ${val}`)
      .join('\n');
    const scenarioLabel = scenarioName
      ? `${scenarioName}: ${args.scenarioInstruction}`
      : args.scenarioInstruction;
    const prompt = [
      `Here is ${name}'s full background as key-value pairs:`,
      profileLines,
      ``,
      `The current scenario / activity is:`,
      `"${scenarioLabel}"`,
      ``,
      `In 1-2 sentences, summarise ONLY the traits, constraints, and preferences from ${name}'s background that are most relevant to how others should perceive and interact with ${name} in THIS scenario. Write it as a compact third-person note about ${name} (e.g. "${name} is a strict vegetarian and prefers clear bill-splitting"). Mention nothing irrelevant to this scenario, and do not invent anything not present in the background.`,
    ].join('\n');

    let scenarioProfile = '';
    try {
      const { content } = await chatCompletion({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 160,
      });
      scenarioProfile = content.trim();
    } catch (err) {
      // Leave scenarioProfile unset on failure. The trigger guard in Agent.tick
      // already set scenarioProfileFor optimistically, so this won't retry-storm;
      // others simply fall back to the default identity for this scenario.
      console.error(
        `agentExtractScenarioProfile failed for ${args.agentId}: ${(err as Error).message}`,
      );
      return;
    }
    if (!scenarioProfile) return;

    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'agentSetScenarioProfile',
      args: {
        agentId: args.agentId,
        scenarioProfile,
        scenarioInstruction: args.scenarioInstruction,
      },
    });
  },
});

export const agentGenerateMessage = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    operationId: v.string(),
    type: v.union(
      v.literal('start'),
      v.literal('continue'),
      v.literal('leave'),
      v.literal('summary'),
    ),
    messageUuid: v.string(),
    // Engine wall-clock timestamp from the tick that triggered this operation.
    // Passed to the prompt builder so the time the LLM is told matches the game
    // clock, rather than whatever real time the action happens to execute at.
    gameTimeMs: v.number(),
    // The active-scenario instance id the speaker is enlisted in (if any), stamped
    // onto the outgoing message for cross-conversation scenario history.
    scenarioId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let completionFn;
    switch (args.type) {
      case 'start':
        completionFn = startConversationMessage;
        break;
      case 'continue':
        completionFn = continueConversationMessage;
        break;
      case 'leave':
        completionFn = leaveConversationMessage;
        break;
      case 'summary':
        completionFn = summarizeGoalMessage;
        break;
      default:
        assertNever(args.type);
    }
    const text = await completionFn(
      ctx,
      args.worldId,
      args.conversationId as GameId<'conversations'>,
      args.playerId as GameId<'players'>,
      args.gameTimeMs,
    );

    // After speaking (but not when leaving), the dialogue orchestrator picks who
    // should hold the floor next so a group chat flows instead of everyone (or
    // no one) talking. undefined = open floor (e.g. only humans remain). For a
    // scenario conversation it also reports whether the scenario's goal is met.
    // No next-speaker / goal re-judging for the terminal turns (leaving, or the
    // one-off goal summary that comes after the goal is already met).
    let nextSpeaker: GameId<'players'> | undefined;
    let goalMet = false;
    let coveredTopics: number[] = [];
    if (args.type !== 'leave' && args.type !== 'summary') {
      const decision = await decideNextSpeaker(
        ctx,
        args.worldId,
        args.conversationId as GameId<'conversations'>,
        args.playerId as GameId<'players'>,
      );
      nextSpeaker = decision.nextSpeaker;
      goalMet = decision.goalMet;
      coveredTopics = decision.coveredTopics;
    }

    await ctx.runMutation(internal.aiTown.agent.agentSendMessage, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      agentId: args.agentId,
      playerId: args.playerId,
      text,
      messageUuid: args.messageUuid,
      leaveConversation: args.type === 'leave',
      isGoalSummary: args.type === 'summary',
      scenarioId: args.scenarioId,
      operationId: args.operationId,
      nextSpeaker,
      goalMet,
      coveredTopics,
    });
  },
});

// Once a local scenario's planning conversation has agreed a plan, this op turns
// that plan into concrete, delegated tasks and feeds them back as an input, which
// flips the scenario into its "working" phase. Always sends the input (even with an
// empty task list) so the requesting agent's operation lock is released.
export const agentPlanScenarioTasks = internalAction({
  args: {
    worldId: v.id('worlds'),
    agentId,
    playerId,
    scenarioId: v.string(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    let tasks: { label: string; emoji: string; assigneeId: string; durationMs: number }[] = [];
    try {
      tasks = await planScenarioTasks(ctx, args.worldId, args.scenarioId);
    } catch (err) {
      console.error(`agentPlanScenarioTasks failed: ${(err as Error).message}`);
    }
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishPlanScenarioTasks',
      args: {
        operationId: args.operationId,
        agentId: args.agentId,
        scenarioId: args.scenarioId,
        tasks,
      },
    });
  },
});

export const agentDoSomething = internalAction({
  args: {
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    agent: v.object(serializedAgent),
    map: v.object(serializedWorldMap),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    // When set, skip the wander/activity branch and go straight to inviting a
    // nearby free agent. Used by scheduled agents who are settled at a location
    // and want to strike up a conversation without abandoning their spot.
    forceInvite: v.optional(v.boolean()),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { player, agent } = args;
    const map = new WorldMap(args.map);
    const now = Date.now();
    // If we're on shift, keep any wandering close to the workplace.
    const currentStep =
      agent.schedule && agent.currentStepIndex !== undefined
        ? agent.schedule[agent.currentStepIndex]
        : undefined;
    const leashAnchor = workLeashAnchor(player.name, currentStep);
    // Don't try to start a new conversation if we were just in one.
    const justLeftConversation =
      agent.lastConversation && now < agent.lastConversation + CONVERSATION_COOLDOWN;
    // Don't try again if we recently tried to find someone to invite.
    const recentlyAttemptedInvite =
      agent.lastInviteAttempt && now < agent.lastInviteAttempt + CONVERSATION_COOLDOWN;
    const recentActivity = player.activity && now < player.activity.until + ACTIVITY_COOLDOWN;
    // Decide whether to do an activity or wander somewhere.
    if (!args.forceInvite && !player.pathfinding) {
      if (recentActivity || justLeftConversation) {
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            destination: wanderDestination(map, leashAnchor),
          },
        });
        return;
      } else {
        const activities = activitiesForName(player.name);
        const activity = pickActivity(activities, agent, now);
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            activity: {
              description: activity.description,
              emoji: activity.emoji,
              until: Date.now() + activity.duration,
            },
            activityCost: activity.cost,
          },
        });
        return;
      }
    }
    const invitee =
      !args.forceInvite && (justLeftConversation || recentlyAttemptedInvite)
        ? undefined
        : await ctx.runQuery(internal.aiTown.agent.findConversationCandidate, {
            now,
            worldId: args.worldId,
            player: args.player,
            otherFreePlayers: args.otherFreePlayers,
          });

    // TODO: We hit a lot of OCC errors on sending inputs in this file. It's
    // easy for them to get scheduled at the same time and line up in time.
    await sleep(Math.random() * 1000);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishDoSomething',
      args: {
        operationId: args.operationId,
        agentId: args.agent.id,
        invitee,
      },
    });
  },
});

// Choose a free-roam activity by scoring each option against the agent's current
// short-term state instead of picking uniformly at random (spec point 5): a broke
// agent avoids costly options, a tired agent avoids high-energy ones. A small
// random term keeps behaviour varied so the same option isn't always chosen.
function pickActivity(activities: Activity[], agent: SerializedAgent, now: number): Activity {
  if (activities.length === 0) {
    return { description: 'taking a breather', emoji: '😮‍💨', duration: 20_000 };
  }
  const snap = buildShortTermSnapshot({
    shortTerm: agent.shortTerm,
    balance: agent.balance,
    health: agent.health,
    now,
  });
  let best: Activity | undefined;
  let bestScore = -Infinity;
  for (const activity of activities) {
    const cost = activity.cost ?? 0;
    const energy = activity.energy ?? 0;
    const score =
      Math.random() * 20 -
      ACTIVITY_COST_PRESSURE_WEIGHT * cost * (snap.financialPressure / 100) -
      ACTIVITY_ENERGY_FATIGUE_WEIGHT * energy * (snap.fatigue / 100);
    if (score > bestScore) {
      bestScore = score;
      best = activity;
    }
  }
  return best ?? activities[0];
}

function wanderDestination(worldMap: WorldMap, anchor?: { x: number; y: number }) {
  // On shift: pick a tile within the leash radius of the workplace so the agent
  // stays put. Otherwise wander anywhere at least one tile away from the edge.
  if (anchor) {
    const r = WORK_LEASH_RADIUS;
    const clamp = (v: number, max: number) => Math.min(Math.max(1, v), max - 2);
    return {
      x: clamp(anchor.x + Math.floor(Math.random() * (2 * r + 1)) - r, worldMap.width),
      y: clamp(anchor.y + Math.floor(Math.random() * (2 * r + 1)) - r, worldMap.height),
    };
  }
  return {
    x: 1 + Math.floor(Math.random() * (worldMap.width - 2)),
    y: 1 + Math.floor(Math.random() * (worldMap.height - 2)),
  };
}

export const getAgentPlanContext = internalQuery({
  args: {
    worldId: v.id('worlds'),
    agentId,
  },
  handler: async (ctx, args) => {
    const desc = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .first();
    if (!desc) return null;
    return { identity: desc.identity };
  },
});

function fallbackSchedule(
  home: { x: number; y: number } | undefined,
  workplace: CityLocation | undefined,
  weekday: boolean,
  workActivity?: string,
): ScheduleStep[] {
  const hdb = getLocationById('hdb')!;
  const homeLoc = home ?? { x: hdb.x, y: hdb.y };
  const restaurant = getLocationById('restaurant')!;
  const steps: ScheduleStep[] = [
    {
      startMinute: 7 * 60,
      locationId: 'home',
      destination: homeLoc,
      activity: 'waking up at home',
      emoji: '🛏️',
      description: 'morning at home, getting ready',
    },
  ];
  // Weekdays: a morning and afternoon block at the workplace, bracketing lunch.
  if (weekday && workplace) {
    steps.push({
      startMinute: 9 * 60,
      locationId: workplace.id,
      destination: { x: workplace.x, y: workplace.y },
      activity: workActivity ?? `working at ${workplace.name}`,
      emoji: '💼',
      description: `at ${workplace.name} for the morning`,
    });
  }
  steps.push({
    startMinute: 12 * 60 + 30,
    locationId: 'restaurant',
    destination: { x: restaurant.x, y: restaurant.y },
    activity: 'eating at the hawker centre',
    emoji: '🍜',
    description: 'lunch break',
  });
  if (weekday && workplace) {
    steps.push({
      startMinute: 13 * 60 + 30,
      locationId: workplace.id,
      destination: { x: workplace.x, y: workplace.y },
      activity: workActivity ?? `back at ${workplace.name}`,
      emoji: '💼',
      description: `at ${workplace.name} for the afternoon`,
    });
  }
  steps.push({
    startMinute: 22 * 60,
    locationId: 'home',
    destination: homeLoc,
    activity: 'going to sleep',
    emoji: '😴',
    description: 'back home for the night',
  });
  return steps;
}

// Build a single schedule step from a raw LLM entry object. Returns null if the
// entry is malformed or maps to no known location.
function parseStep(
  entry: any,
  home: { x: number; y: number } | undefined,
): ScheduleStep | null {
  if (!entry || typeof entry !== 'object') return null;
  const startMinute =
    typeof entry.start_time === 'string'
      ? parseTimeOfDay(entry.start_time)
      : typeof entry.start_minute === 'number'
        ? entry.start_minute
        : null;
  const locId = (entry.location_id ?? entry.location ?? '').toString();
  let dest: { x: number; y: number } | undefined;
  if (locId === 'home' && home) {
    dest = home;
  } else {
    const loc = getLocationById(locId);
    if (loc) dest = { x: loc.x, y: loc.y };
  }
  if (!dest) return null;
  return {
    // startMinute may be null for a reaction step (caller stamps it with "now").
    startMinute: startMinute ?? 0,
    locationId: locId,
    destination: dest,
    activity: (entry.activity ?? 'hanging around').toString(),
    emoji: typeof entry.emoji === 'string' ? entry.emoji : undefined,
    description: (entry.description ?? entry.activity ?? '').toString(),
  };
}

function parseSchedule(
  raw: any,
  home: { x: number; y: number } | undefined,
): ScheduleStep[] | null {
  if (!raw || !Array.isArray(raw.schedule)) return null;
  const out: ScheduleStep[] = [];
  for (const entry of raw.schedule) {
    // A normal schedule entry must carry a valid start_time; reaction steps
    // (parsed separately) are the only ones allowed to omit it.
    const hasTime =
      typeof entry?.start_time === 'string' || typeof entry?.start_minute === 'number';
    if (!hasTime) continue;
    const step = parseStep(entry, home);
    if (step) out.push(step);
  }
  out.sort((a, b) => a.startMinute - b.startMinute);
  return out.length > 0 ? out : null;
}

export const agentPlanDay = internalAction({
  args: {
    worldId: v.id('worlds'),
    agentId,
    playerId: v.optional(playerId),
    playerName: v.string(),
    home: v.optional(point),
    homeName: v.optional(v.string()),
    dayNumber: v.number(),
    currentTimeStr: v.string(),
    currentMinutesIntoDay: v.number(),
    existingSchedule: v.optional(v.array(scheduleStep)),
    scenarioInstruction: v.optional(v.string()),
    // Precomputed short-term self-state note (mood/fatigue/hunger/money worries) so
    // the plan reflects how the character feels right now.
    shortTermNote: v.optional(v.string()),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const ctxData = await ctx.runQuery(internal.aiTown.agentOperations.getAgentPlanContext, {
      worldId: args.worldId,
      agentId: args.agentId,
    });
    const identity = ctxData?.identity ?? `${args.playerName} is a resident of Singapore.`;

    // Fetch the last few conversation memories so the LLM can update the plan
    // based on what was discussed (e.g. arrangements made, invitations accepted).
    let recentMemoriesStr = '';
    if (args.playerId) {
      try {
        const memData = await ctx.runQuery(internal.agent.memory.getReflectionMemories, {
          worldId: args.worldId,
          playerId: args.playerId,
          numberOfItems: 8,
        });
        const convMemories = memData.memories
          .filter((m: any) => m.data.type === 'conversation')
          .slice(0, 5);
        if (convMemories.length > 0) {
          recentMemoriesStr =
            '\nRecent conversations — read these carefully for any commitments you made ' +
            '(who you agreed to meet, what you agreed to do, and where/when):\n' +
            convMemories.map((m: any) => `- ${m.description}`).join('\n');
        }
      } catch {
        // Memory fetch failure is non-fatal — proceed without memories.
      }
    }

    const weekday = isWeekday(args.dayNumber);
    const dayName = dayOfWeekName(args.dayNumber);
    const work = workplaceFor(args.playerName);

    const locationList = CITY_LOCATIONS.map(
      (l) => `- ${l.id} — ${l.name}: ${l.description}`,
    ).join('\n');
    const homeStr = args.homeName ? `${args.homeName} (use location_id "home")` : 'no fixed home';
    const workStr = work
      ? `Workplace: ${work.location.name} (use location_id "${work.location.id}") — ${work.activity}.`
      : '';
    const workRule =
      weekday && work
        ? `Today is a WEEKDAY: ${args.playerName} goes to work. Schedule a work block at "${work.location.id}" covering roughly 09:00–17:00 (you may split it around a short lunch elsewhere), then head home afterwards.`
        : work
          ? `Today is a WEEKEND: no work shift. Fill the day with rest, errands, and social time that fit the character.`
          : '';
    const replanNote = args.existingSchedule
      ? `\nThis is a RE-PLAN (current time: ${args.currentTimeStr}). A conversation may have changed your plans, or the previous schedule was disrupted. Produce a revised schedule for the REST of today only — keep entries whose start_time has already passed, and revise the rest.\nIMPORTANT: If in a recent conversation you agreed to meet someone or do something at a particular place and/or time, you MUST add a schedule entry for it (pick a sensible start_time if none was stated, and map the place to the closest location_id from the list above). Do not drop commitments you made.`
      : '';
    // A custom scenario was injected by the user (e.g. "a fire breaks out at the
    // hawker centre", "everyone gather at Marina Bay Sands"). It overrides the
    // normal routine and must dominate the rest of today's plan.
    const scenarioNote = args.scenarioInstruction
      ? `\n*** URGENT SCENARIO — THIS IS HAPPENING RIGHT NOW (${args.currentTimeStr}) AND OVERRIDES YOUR NORMAL ROUTINE ***\n"${args.scenarioInstruction}"\nYou must respond to this immediately and in character. In your JSON response, include a top-level "reaction" object describing the single action you take RIGHT NOW (this instant, at ${args.currentTimeStr}) in response to the scenario — with location_id (the closest match from the list above to where the event calls you), activity, emoji, and description. Do NOT give the reaction a start_time; it happens now. Then the "schedule" array covers the AFTERMATH for the rest of today (all entries strictly after ${args.currentTimeStr}), reflecting how the event reshaped your day.`
      : '';

    const prompt = [
      `You are planning a single day in the life of ${args.playerName}, who lives in Singapore.`,
      `Identity: ${identity}`,
      `Home: ${homeStr}`,
      workStr,
      `Today is Day ${args.dayNumber} (${dayName}, a ${weekday ? 'weekday' : 'weekend day'}). The current in-game time is ${args.currentTimeStr}.`,
      args.shortTermNote
        ? `Your current state: ${args.shortTermNote} Factor this into today's plan — rest or head home earlier if you're exhausted, make time to eat if hungry, and lean toward cheaper options if money is tight.`
        : '',
      scenarioNote,
      ``,
      `Available locations (use the location_id verbatim):`,
      locationList,
      `- home — the character's home`,
      recentMemoriesStr,
      ``,
      `Produce a believable daily schedule of 4–7 entries that fits this character.`,
      `Each entry needs: start_time (24h "HH:MM"), location_id, activity (short phrase), emoji (one), description (one sentence).`,
      `Keep timings consistent and realistic: wake at home around 07:00, take meals at regular times, and the FINAL entry must be "going to sleep" at home (location_id "home") around 22:00.`,
      workRule,
      `If recent memories mention plans or arrangements made in conversation, honour them.`,
      `Pick locations that suit the character's personality and goal.`,
      replanNote,
      args.scenarioInstruction
        ? `Remember: the URGENT SCENARIO above takes priority over everything else — the "reaction" object is what you do THIS INSTANT, and the schedule is the aftermath.`
        : '',
      ``,
      `Respond ONLY with strict JSON of the form:`,
      args.scenarioInstruction
        ? `{"reaction":{"location_id":"mbs","activity":"hurrying to shelter","emoji":"🏃","description":"rushing indoors to Marina Bay Sands to take cover"},"schedule":[{"start_time":"23:30","location_id":"home","activity":"going to sleep","emoji":"🌙","description":"settling down after the chaos"}]}`
        : `{"schedule":[{"start_time":"07:30","location_id":"shophouses","activity":"opening the cafe","emoji":"☕","description":"setting up for the morning rush"}]}`,
    ]
      .filter(Boolean)
      .join('\n');

    let parsed: ScheduleStep[] | null = null;
    let reaction: ScheduleStep | null = null;
    try {
      const { content } = await chatCompletion({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        response_format: { type: 'json_object' },
      });
      const json = extractJson(content);
      parsed = parseSchedule(json, args.home);
      // For a scenario re-plan, the LLM returns a separate "reaction" object: the
      // immediate, in-character action to take RIGHT NOW. We stamp it with the
      // current minute so it becomes the agent's active step this instant.
      if (args.scenarioInstruction && json?.reaction) {
        reaction = parseStep(json.reaction, args.home);
        if (reaction) reaction.startMinute = args.currentMinutesIntoDay;
      }
    } catch (err) {
      console.error(`agentPlanDay LLM failed for ${args.playerName}:`, err);
    }
    let schedule =
      parsed ?? fallbackSchedule(args.home, work?.location, weekday, work?.activity);
    if (reaction) {
      // Drop any aftermath entries the LLM mistakenly timed at/before "now" so the
      // reaction is unambiguously the current step, then make it the schedule head.
      schedule = [
        reaction,
        ...schedule.filter((s) => s.startMinute > args.currentMinutesIntoDay),
      ];
    }

    await sleep(Math.random() * 500);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishPlanDay',
      args: {
        operationId: args.operationId,
        agentId: args.agentId,
        schedule,
        dayNumber: args.dayNumber,
      },
    });
  },
});

function extractJson(content: string): any {
  // Most providers return clean JSON when response_format is set, but tolerate
  // ```json fences and leading prose just in case.
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : content;
  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return JSON.parse(body);
  }
  return JSON.parse(body.slice(firstBrace, lastBrace + 1));
}
