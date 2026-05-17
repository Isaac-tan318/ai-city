import { ObjectType, v } from 'convex/values';
import { GameId, parseGameId } from './ids';
import { agentId, conversationId, playerId } from './ids';
import { serializedPlayer } from './player';
import { Game } from './game';
import {
  ACTION_TIMEOUT,
  AWKWARD_CONVERSATION_TIMEOUT,
  CONVERSATION_COOLDOWN,
  CONVERSATION_DISTANCE,
  INVITE_ACCEPT_PROBABILITY,
  INVITE_TIMEOUT,
  MAX_CONVERSATION_DURATION,
  MAX_CONVERSATION_MESSAGES,
  MESSAGE_COOLDOWN,
  MIDPOINT_THRESHOLD,
  PLAYER_CONVERSATION_COOLDOWN,
} from '../constants';
import { FunctionArgs } from 'convex/server';
import { MutationCtx, internalMutation, internalQuery } from '../_generated/server';
import { distance, pointsEqual } from '../util/geometry';
import { internal } from '../_generated/api';
import { movePlayer, stopPlayer, pickParkWaypoint } from './movement';
import { insertInput } from './insertInput';
import { point, Point } from '../util/types';
import { computeGameTime } from './gameTime';
import { ARRIVAL_RADIUS, SCHEDULE_DISRUPTION_MINUTES } from '../constants';
import { getLocationById, homeFor } from '../../data/cityLocations';

export type ScheduleStep = {
  startMinute: number;
  locationId: string;
  destination: Point;
  activity: string;
  emoji?: string;
  description: string;
};

export class Agent {
  id: GameId<'agents'>;
  playerId: GameId<'players'>;
  toRemember?: GameId<'conversations'>;
  lastConversation?: number;
  lastInviteAttempt?: number;
  inProgressOperation?: {
    name: string;
    operationId: string;
    started: number;
  };
  scenarioTarget?: Point;
  scenarioName?: string;
  scenarioArrivalTime?: number;
  home?: Point;
  schedule?: ScheduleStep[];
  scheduleGeneratedForDay?: number;
  currentStepIndex?: number;

  constructor(serialized: SerializedAgent) {
    const {
      id,
      lastConversation,
      lastInviteAttempt,
      inProgressOperation,
      scenarioTarget,
      scenarioName,
      scenarioArrivalTime,
      home,
      schedule,
      scheduleGeneratedForDay,
      currentStepIndex,
    } = serialized;
    const playerId = parseGameId('players', serialized.playerId);
    this.id = parseGameId('agents', id);
    this.playerId = playerId;
    this.toRemember =
      serialized.toRemember !== undefined
        ? parseGameId('conversations', serialized.toRemember)
        : undefined;
    this.lastConversation = lastConversation;
    this.lastInviteAttempt = lastInviteAttempt;
    this.inProgressOperation = inProgressOperation;
    this.scenarioTarget = scenarioTarget;
    this.scenarioName = scenarioName;
    this.scenarioArrivalTime = scenarioArrivalTime;
    this.home = home;
    this.schedule = schedule;
    this.scheduleGeneratedForDay = scheduleGeneratedForDay;
    this.currentStepIndex = currentStepIndex;
  }

  tick(game: Game, now: number) {
    const player = game.world.players.get(this.playerId);
    if (!player) {
      throw new Error(`Invalid player ID ${this.playerId}`);
    }
    if (!this.scenarioTarget && !this.scenarioArrivalTime && game.world.scenarioTarget) {
      this.scenarioTarget = game.world.scenarioTarget;
      this.scenarioName = game.world.scenarioName;
    }
    const PARK_RADIUS = 5;
    if (this.scenarioTarget) {
      const center = this.scenarioTarget;
      // Preempt any active conversation so the agent can head to the park.
      const activeConversation = game.world.playerConversation(player);
      if (activeConversation) {
        activeConversation.leave(game, now, player);
        delete this.toRemember;
      }
      delete player.activity;

      const distToCenter = distance(player.position, center);

      if (distToCenter > PARK_RADIUS) {
        // Approaching the park — ignore player collisions so agents don't jam.
        if (!player.pathfinding || !pointsEqual(player.pathfinding.destination, center)) {
          movePlayer(game, now, player, center, false, false);
        }
        return;
      }

      // Inside the meeting zone.
      if (!this.scenarioArrivalTime) {
        this.scenarioArrivalTime = now;
        // Cancel the approach pathfinding so the wander logic takes over.
        if (player.pathfinding) stopPlayer(player);
      }

      if (now - this.scenarioArrivalTime >= 30_000) {
        // 30 s is up — free the agent. Keep scenarioArrivalTime as a done-marker
        // so the propagation check above won't re-enlist them this session.
        delete this.scenarioTarget;
        delete this.scenarioName;
        if (player.pathfinding) stopPlayer(player);
        // Fall through to normal agent behaviour.
      } else {
        // Wander within the zone. ignorePlayers=true so agents aren't deadlocked
        // by the pile-up from the approach phase; they spread out naturally as
        // each picks a different random waypoint each stop.
        if (!player.pathfinding) {
          const waypoint = pickParkWaypoint(center, PARK_RADIUS, game.worldMap);
          if (waypoint) movePlayer(game, now, player, waypoint, false, true);
        }
        return;
      }
    }
    if (this.inProgressOperation) {
      if (now < this.inProgressOperation.started + ACTION_TIMEOUT) {
        // Wait on the operation to finish.
        return;
      }
      console.log(`Timing out ${JSON.stringify(this.inProgressOperation)}`);
      delete this.inProgressOperation;
    }
    // Schedule + plan execution: give the agent a real daily plan and walk them
    // through it. Conversation logic still runs below and can interrupt.
    if (this.tickSchedule(game, now, player)) {
      return;
    }
    const conversation = game.world.playerConversation(player);
    const member = conversation?.participants.get(player.id);

    const recentlyAttemptedInvite =
      this.lastInviteAttempt && now < this.lastInviteAttempt + CONVERSATION_COOLDOWN;
    const doingActivity = player.activity && player.activity.until > now;
    if (doingActivity && (conversation || player.pathfinding)) {
      player.activity!.until = now;
    }
    // If we're not in a conversation, do something.
    // If we aren't doing an activity or moving, do something.
    // If we have been wandering but haven't thought about something to do for
    // a while, do something.
    if (!conversation && !doingActivity && (!player.pathfinding || !recentlyAttemptedInvite)) {
      this.startOperation(game, now, 'agentDoSomething', {
        worldId: game.worldId,
        player: player.serialize(),
        otherFreePlayers: [...game.world.players.values()]
          .filter((p) => p.id !== player.id)
          .filter(
            (p) => ![...game.world.conversations.values()].find((c) => c.participants.has(p.id)),
          )
          .map((p) => p.serialize()),
        agent: this.serialize(),
        map: game.worldMap.serialize(),
      });
      return;
    }
    // Check to see if we have a conversation we need to remember.
    if (this.toRemember) {
      // Fire off the action to remember the conversation.
      console.log(`Agent ${this.id} remembering conversation ${this.toRemember}`);
      this.startOperation(game, now, 'agentRememberConversation', {
        worldId: game.worldId,
        playerId: this.playerId,
        agentId: this.id,
        conversationId: this.toRemember,
      });
      delete this.toRemember;
      return;
    }
    if (conversation && member) {
      const [otherPlayerId, otherMember] = [...conversation.participants.entries()].find(
        ([id]) => id !== player.id,
      )!;
      const otherPlayer = game.world.players.get(otherPlayerId)!;
      if (member.status.kind === 'invited') {
        // Accept a conversation with another agent with some probability and with
        // a human unconditionally.
        if (otherPlayer.human || Math.random() < INVITE_ACCEPT_PROBABILITY) {
          console.log(`Agent ${player.id} accepting invite from ${otherPlayer.id}`);
          conversation.acceptInvite(game, player);
          // Stop moving so we can start walking towards the other player.
          if (player.pathfinding) {
            delete player.pathfinding;
          }
        } else {
          console.log(`Agent ${player.id} rejecting invite from ${otherPlayer.id}`);
          conversation.rejectInvite(game, now, player);
        }
        return;
      }
      if (member.status.kind === 'walkingOver') {
        // Leave a conversation if we've been waiting for too long.
        if (member.invited + INVITE_TIMEOUT < now) {
          console.log(`Giving up on invite to ${otherPlayer.id}`);
          conversation.leave(game, now, player);
          return;
        }

        // Don't keep moving around if we're near enough.
        const playerDistance = distance(player.position, otherPlayer.position);
        if (playerDistance < CONVERSATION_DISTANCE) {
          return;
        }

        // Keep moving towards the other player.
        // If we're close enough to the player, just walk to them directly.
        if (!player.pathfinding) {
          let destination;
          if (playerDistance < MIDPOINT_THRESHOLD) {
            destination = {
              x: Math.floor(otherPlayer.position.x),
              y: Math.floor(otherPlayer.position.y),
            };
          } else {
            destination = {
              x: Math.floor((player.position.x + otherPlayer.position.x) / 2),
              y: Math.floor((player.position.y + otherPlayer.position.y) / 2),
            };
          }
          console.log(`Agent ${player.id} walking towards ${otherPlayer.id}...`, destination);
          movePlayer(game, now, player, destination);
        }
        return;
      }
      if (member.status.kind === 'participating') {
        const started = member.status.started;
        if (conversation.isTyping && conversation.isTyping.playerId !== player.id) {
          // Wait for the other player to finish typing.
          return;
        }
        if (!conversation.lastMessage) {
          const isInitiator = conversation.creator === player.id;
          const awkwardDeadline = started + AWKWARD_CONVERSATION_TIMEOUT;
          // Send the first message if we're the initiator or if we've been waiting for too long.
          if (isInitiator || awkwardDeadline < now) {
            // Grab the lock on the conversation and send a "start" message.
            console.log(`${player.id} initiating conversation with ${otherPlayer.id}.`);
            const messageUuid = crypto.randomUUID();
            conversation.setIsTyping(now, player, messageUuid);
            this.startOperation(game, now, 'agentGenerateMessage', {
              worldId: game.worldId,
              playerId: player.id,
              agentId: this.id,
              conversationId: conversation.id,
              otherPlayerId: otherPlayer.id,
              messageUuid,
              type: 'start',
            });
            return;
          } else {
            // Wait on the other player to say something up to the awkward deadline.
            return;
          }
        }
        // See if the conversation has been going on too long and decide to leave.
        const tooLongDeadline = started + MAX_CONVERSATION_DURATION;
        if (tooLongDeadline < now || conversation.numMessages > MAX_CONVERSATION_MESSAGES) {
          console.log(`${player.id} leaving conversation with ${otherPlayer.id}.`);
          const messageUuid = crypto.randomUUID();
          conversation.setIsTyping(now, player, messageUuid);
          this.startOperation(game, now, 'agentGenerateMessage', {
            worldId: game.worldId,
            playerId: player.id,
            agentId: this.id,
            conversationId: conversation.id,
            otherPlayerId: otherPlayer.id,
            messageUuid,
            type: 'leave',
          });
          return;
        }
        // Wait for the awkward deadline if we sent the last message.
        if (conversation.lastMessage.author === player.id) {
          const awkwardDeadline = conversation.lastMessage.timestamp + AWKWARD_CONVERSATION_TIMEOUT;
          if (now < awkwardDeadline) {
            return;
          }
        }
        // Wait for a cooldown after the last message to simulate "reading" the message.
        const messageCooldown = conversation.lastMessage.timestamp + MESSAGE_COOLDOWN;
        if (now < messageCooldown) {
          return;
        }
        // Grab the lock and send a message!
        console.log(`${player.id} continuing conversation with ${otherPlayer.id}.`);
        const messageUuid = crypto.randomUUID();
        conversation.setIsTyping(now, player, messageUuid);
        this.startOperation(game, now, 'agentGenerateMessage', {
          worldId: game.worldId,
          playerId: player.id,
          agentId: this.id,
          conversationId: conversation.id,
          otherPlayerId: otherPlayer.id,
          messageUuid,
          type: 'continue',
        });
        return;
      }
    }
  }

  // Returns true if the schedule handled this tick (caller should return).
  tickSchedule(game: Game, now: number, player: import('./player').Player): boolean {
    const gt = computeGameTime(now, game.world.worldStartTime);
    const conversation = game.world.playerConversation(player);
    const doingActivity = player.activity && player.activity.until > now;

    // Decide if we need a new plan.
    const noSchedule = !this.schedule || this.schedule.length === 0;
    const dayChanged =
      this.scheduleGeneratedForDay !== undefined && this.scheduleGeneratedForDay !== gt.dayNumber;
    let disrupted = false;
    if (this.schedule && this.currentStepIndex !== undefined && !noSchedule && !dayChanged) {
      const step = this.schedule[this.currentStepIndex];
      const nextStep = this.schedule[this.currentStepIndex + 1];
      if (step) {
        const stepEnd = nextStep ? nextStep.startMinute : 24 * 60;
        const overdueMinutes = gt.minutesIntoDay - stepEnd;
        const atDest = distance(player.position, step.destination) < ARRIVAL_RADIUS;
        if (overdueMinutes > SCHEDULE_DISRUPTION_MINUTES && !atDest) {
          disrupted = true;
        }
      }
    }

    const needsPlan = (noSchedule || dayChanged || disrupted) && !conversation && !doingActivity;
    if (needsPlan) {
      const playerName = player.name ?? 'someone';
      const home = this.home ?? (homeFor(playerName) ?? getLocationById('hdb'))!;
      const homePoint = this.home ?? { x: home.x, y: home.y };
      const homeLoc = homeFor(playerName);
      this.startOperation(game, now, 'agentPlanDay', {
        worldId: game.worldId,
        agentId: this.id,
        playerName,
        home: homePoint,
        homeName: homeLoc?.name,
        dayNumber: gt.dayNumber,
        currentTimeStr: gt.timeStr,
        currentMinutesIntoDay: gt.minutesIntoDay,
        existingSchedule: disrupted ? this.schedule : undefined,
      });
      return true;
    }

    if (!this.schedule || this.currentStepIndex === undefined) return false;

    // Advance past steps whose successor's start time has arrived.
    while (
      this.currentStepIndex < this.schedule.length - 1 &&
      gt.minutesIntoDay >= this.schedule[this.currentStepIndex + 1].startMinute
    ) {
      this.currentStepIndex += 1;
    }

    const step = this.schedule[this.currentStepIndex];
    if (!step) return false;

    // It isn't time for the first step yet — let the rest of the tick run.
    if (gt.minutesIntoDay < step.startMinute) return false;

    // Don't yank the agent out of an active conversation. The schedule can wait.
    if (conversation) return false;

    const atDest = distance(player.position, step.destination) < ARRIVAL_RADIUS;
    if (!atDest) {
      // Walk to the scheduled location.
      if (
        !player.pathfinding ||
        !pointsEqual(player.pathfinding.destination, step.destination)
      ) {
        try {
          movePlayer(game, now, player, step.destination);
        } catch (err) {
          // Movement can throw if in a conversation; ignore and re-try next tick.
          console.warn(`Schedule move failed for ${player.id}: ${(err as Error).message}`);
        }
      }
      return true;
    }

    // At the destination — set the activity for the duration of this step.
    if (!doingActivity) {
      const nextStep = this.schedule[this.currentStepIndex + 1];
      const stepEndMinutes = nextStep ? nextStep.startMinute : 24 * 60;
      const minutesLeft = Math.max(1, stepEndMinutes - gt.minutesIntoDay);
      // Game-minute → real-ms: each in-game minute lasts CYCLE_MS / (24*60).
      const realMsPerGameMinute = (10 * 60 * 1000) / (24 * 60);
      player.activity = {
        description: step.activity,
        emoji: step.emoji ?? '💭',
        until: now + minutesLeft * realMsPerGameMinute,
      };
    }
    return true;
  }

  startOperation<Name extends keyof AgentOperations>(
    game: Game,
    now: number,
    name: Name,
    args: Omit<FunctionArgs<AgentOperations[Name]>, 'operationId'>,
  ) {
    if (this.inProgressOperation) {
      throw new Error(
        `Agent ${this.id} already has an operation: ${JSON.stringify(this.inProgressOperation)}`,
      );
    }
    const operationId = game.allocId('operations');
    console.log(`Agent ${this.id} starting operation ${name} (${operationId})`);
    game.scheduleOperation(name, { operationId, ...args } as any);
    this.inProgressOperation = {
      name,
      operationId,
      started: now,
    };
  }

  serialize(): SerializedAgent {
    return {
      id: this.id,
      playerId: this.playerId,
      toRemember: this.toRemember,
      lastConversation: this.lastConversation,
      lastInviteAttempt: this.lastInviteAttempt,
      inProgressOperation: this.inProgressOperation,
      scenarioTarget: this.scenarioTarget,
      scenarioName: this.scenarioName,
      scenarioArrivalTime: this.scenarioArrivalTime,
      home: this.home,
      schedule: this.schedule,
      scheduleGeneratedForDay: this.scheduleGeneratedForDay,
      currentStepIndex: this.currentStepIndex,
    };
  }
}

export const scheduleStep = v.object({
  startMinute: v.number(),
  locationId: v.string(),
  destination: point,
  activity: v.string(),
  emoji: v.optional(v.string()),
  description: v.string(),
});

export const serializedAgent = {
  id: agentId,
  playerId: playerId,
  toRemember: v.optional(conversationId),
  lastConversation: v.optional(v.number()),
  lastInviteAttempt: v.optional(v.number()),
  inProgressOperation: v.optional(
    v.object({
      name: v.string(),
      operationId: v.string(),
      started: v.number(),
    }),
  ),
  scenarioTarget: v.optional(point),
  scenarioName: v.optional(v.string()),
  scenarioArrivalTime: v.optional(v.number()),
  home: v.optional(point),
  schedule: v.optional(v.array(scheduleStep)),
  scheduleGeneratedForDay: v.optional(v.number()),
  currentStepIndex: v.optional(v.number()),
};
export type SerializedAgent = ObjectType<typeof serializedAgent>;

type AgentOperations = typeof internal.aiTown.agentOperations;

export async function runAgentOperation(ctx: MutationCtx, operation: string, args: any) {
  let reference;
  switch (operation) {
    case 'agentRememberConversation':
      reference = internal.aiTown.agentOperations.agentRememberConversation;
      break;
    case 'agentGenerateMessage':
      reference = internal.aiTown.agentOperations.agentGenerateMessage;
      break;
    case 'agentDoSomething':
      reference = internal.aiTown.agentOperations.agentDoSomething;
      break;
    case 'agentPlanDay':
      reference = internal.aiTown.agentOperations.agentPlanDay;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
  await ctx.scheduler.runAfter(0, reference, args);
}

export const agentSendMessage = internalMutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    agentId,
    playerId,
    text: v.string(),
    messageUuid: v.string(),
    leaveConversation: v.boolean(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      text: args.text,
      messageUuid: args.messageUuid,
      worldId: args.worldId,
    });
    await insertInput(ctx, args.worldId, 'agentFinishSendingMessage', {
      conversationId: args.conversationId,
      agentId: args.agentId,
      timestamp: Date.now(),
      leaveConversation: args.leaveConversation,
      operationId: args.operationId,
    });
  },
});

export const findConversationCandidate = internalQuery({
  args: {
    now: v.number(),
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
  },
  handler: async (ctx, { now, worldId, player, otherFreePlayers }) => {
    const { position } = player;
    const candidates = [];

    for (const otherPlayer of otherFreePlayers) {
      // Find the latest conversation we're both members of.
      const lastMember = await ctx.db
        .query('participatedTogether')
        .withIndex('edge', (q) =>
          q.eq('worldId', worldId).eq('player1', player.id).eq('player2', otherPlayer.id),
        )
        .order('desc')
        .first();
      if (lastMember) {
        if (now < lastMember.ended + PLAYER_CONVERSATION_COOLDOWN) {
          continue;
        }
      }
      candidates.push({ id: otherPlayer.id, position });
    }

    // Sort by distance and take the nearest candidate.
    candidates.sort((a, b) => distance(a.position, position) - distance(b.position, position));
    return candidates[0]?.id;
  },
});
