import { v } from 'convex/values';
import { internalAction, internalQuery } from '../_generated/server';
import { parseTimeOfDay } from './gameTime';
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
import { ACTIVITIES, ACTIVITY_COOLDOWN, CONVERSATION_COOLDOWN } from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';
import { chatCompletion } from '../util/llm';
import { CITY_LOCATIONS, getLocationById } from '../../data/cityLocations';
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
    await rememberConversation(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      args.conversationId as GameId<'conversations'>,
    );
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
    if (!player.pathfinding) {
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
        // TODO: have LLM choose the activity & emoji
        const activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
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
      justLeftConversation || recentlyAttemptedInvite
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
    return { identity: desc.identity, plan: desc.plan };
  },
});

function fallbackSchedule(home: { x: number; y: number } | undefined): ScheduleStep[] {
  const hdb = getLocationById('hdb')!;
  const homeLoc = home ?? { x: hdb.x, y: hdb.y };
  return [
    {
      startMinute: 6 * 60,
      locationId: 'home',
      destination: homeLoc,
      activity: 'waking up at home',
      emoji: '🛏️',
      description: 'morning at home, getting ready',
    },
    {
      startMinute: 12 * 60,
      locationId: 'restaurant',
      destination: { x: getLocationById('restaurant')!.x, y: getLocationById('restaurant')!.y },
      activity: 'eating at the hawker centre',
      emoji: '🍜',
      description: 'lunch break',
    },
    {
      startMinute: 22 * 60,
      locationId: 'home',
      destination: homeLoc,
      activity: 'going to sleep',
      emoji: '😴',
      description: 'back home for the night',
    },
  ];
}

function parseSchedule(
  raw: any,
  home: { x: number; y: number } | undefined,
): ScheduleStep[] | null {
  if (!raw || !Array.isArray(raw.schedule)) return null;
  const out: ScheduleStep[] = [];
  for (const entry of raw.schedule) {
    if (!entry || typeof entry !== 'object') continue;
    const startMinute =
      typeof entry.start_time === 'string'
        ? parseTimeOfDay(entry.start_time)
        : typeof entry.start_minute === 'number'
          ? entry.start_minute
          : null;
    if (startMinute === null) continue;
    const locId = (entry.location_id ?? entry.location ?? '').toString();
    let dest: { x: number; y: number } | undefined;
    if (locId === 'home' && home) {
      dest = home;
    } else {
      const loc = getLocationById(locId);
      if (loc) dest = { x: loc.x, y: loc.y };
    }
    if (!dest) continue;
    out.push({
      startMinute,
      locationId: locId,
      destination: dest,
      activity: (entry.activity ?? 'hanging around').toString(),
      emoji: typeof entry.emoji === 'string' ? entry.emoji : undefined,
      description: (entry.description ?? entry.activity ?? '').toString(),
    });
  }
  out.sort((a, b) => a.startMinute - b.startMinute);
  return out.length > 0 ? out : null;
}

export const agentPlanDay = internalAction({
  args: {
    worldId: v.id('worlds'),
    agentId,
    playerName: v.string(),
    home: v.optional(point),
    homeName: v.optional(v.string()),
    dayNumber: v.number(),
    currentTimeStr: v.string(),
    currentMinutesIntoDay: v.number(),
    existingSchedule: v.optional(v.array(scheduleStep)),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const ctxData = await ctx.runQuery(internal.aiTown.agentOperations.getAgentPlanContext, {
      worldId: args.worldId,
      agentId: args.agentId,
    });
    const identity = ctxData?.identity ?? `${args.playerName} is a resident of Singapore.`;
    const plan = ctxData?.plan ?? '';

    const locationList = CITY_LOCATIONS.map(
      (l) => `- ${l.id} — ${l.name}: ${l.description}`,
    ).join('\n');
    const homeStr = args.homeName ? `${args.homeName} (use location_id "home")` : 'no fixed home';
    const replanNote = args.existingSchedule
      ? `\nThis is a RE-PLAN. The previous schedule was disrupted. Produce a new schedule for the REST of today, starting at ${args.currentTimeStr}.`
      : '';

    const prompt = [
      `You are planning a single day in the life of ${args.playerName}, who lives in Singapore.`,
      `Identity: ${identity}`,
      plan ? `Long-term plan / goal: ${plan}` : '',
      `Home: ${homeStr}`,
      `Today is Day ${args.dayNumber}. The current in-game time is ${args.currentTimeStr}.`,
      ``,
      `Available locations (use the location_id verbatim):`,
      locationList,
      `- home — the character's home`,
      ``,
      `Produce a believable daily schedule of 4–7 entries that fits this character.`,
      `Each entry needs: start_time (24h "HH:MM"), location_id, activity (short phrase), emoji (one), description (one sentence).`,
      `The character should generally wake at home in the morning and return home at night.`,
      `Pick locations that suit the character's personality and goal.`,
      replanNote,
      ``,
      `Respond ONLY with strict JSON of the form:`,
      `{"schedule":[{"start_time":"07:30","location_id":"shophouses","activity":"opening the cafe","emoji":"☕","description":"setting up for the morning rush"}]}`,
    ]
      .filter(Boolean)
      .join('\n');

    let parsed: ScheduleStep[] | null = null;
    try {
      const { content } = await chatCompletion({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        response_format: { type: 'json_object' },
      });
      const json = extractJson(content);
      parsed = parseSchedule(json, args.home);
    } catch (err) {
      console.error(`agentPlanDay LLM failed for ${args.playerName}:`, err);
    }
    const schedule = parsed ?? fallbackSchedule(args.home);

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
