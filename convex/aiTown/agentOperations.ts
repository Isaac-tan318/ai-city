import { v } from 'convex/values';
import { internalAction, internalQuery } from '../_generated/server';
import { parseTimeOfDay, isWeekday, dayOfWeekName } from './gameTime';
import { WorldMap, serializedWorldMap } from './worldMap';
import { rememberConversation } from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  leaveConversationMessage,
  startConversationMessage,
} from '../agent/conversation';
import { assertNever } from '../util/assertNever';
import { serializedAgent, ScheduleStep, scheduleStep } from './agent';
import { activitiesForName, ACTIVITY_COOLDOWN, CONVERSATION_COOLDOWN } from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';
import { chatCompletion } from '../util/llm';
import { CITY_LOCATIONS, CityLocation, getLocationById, workplaceFor } from '../../data/cityLocations';
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
    try {
      await rememberConversation(
        ctx,
        args.worldId,
        args.agentId as GameId<'agents'>,
        args.playerId as GameId<'players'>,
        args.conversationId as GameId<'conversations'>,
      );
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

export const agentGenerateMessage = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    otherPlayerId: playerId,
    operationId: v.string(),
    type: v.union(v.literal('start'), v.literal('continue'), v.literal('leave')),
    messageUuid: v.string(),
    // Engine wall-clock timestamp from the tick that triggered this operation.
    // Passed to the prompt builder so the time the LLM is told matches the game
    // clock, rather than whatever real time the action happens to execute at.
    gameTimeMs: v.number(),
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
      default:
        assertNever(args.type);
    }
    const text = await completionFn(
      ctx,
      args.worldId,
      args.conversationId as GameId<'conversations'>,
      args.playerId as GameId<'players'>,
      args.otherPlayerId as GameId<'players'>,
      args.gameTimeMs,
    );

    await ctx.runMutation(internal.aiTown.agent.agentSendMessage, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      agentId: args.agentId,
      playerId: args.playerId,
      text,
      messageUuid: args.messageUuid,
      leaveConversation: args.type === 'leave',
      operationId: args.operationId,
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
            destination: wanderDestination(map),
          },
        });
        return;
      } else {
        const activities = activitiesForName(player.name);
        const activity = activities[Math.floor(Math.random() * activities.length)];
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

function wanderDestination(worldMap: WorldMap) {
  // Wander someonewhere at least one tile away from the edge.
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
