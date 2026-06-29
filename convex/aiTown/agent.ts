import { ObjectType, v } from 'convex/values';
import { GameId, parseGameId } from './ids';
import { agentId, conversationId, playerId } from './ids';
import { serializedPlayer } from './player';
import { Conversation } from './conversation';
import { Game } from './game';
import {
  ACTION_TIMEOUT,
  AWKWARD_CONVERSATION_TIMEOUT,
  CONVERSATION_COOLDOWN,
  CONVERSATION_DISTANCE,
  GROUP_JOIN_RADIUS,
  INVITE_ACCEPT_PROBABILITY,
  INVITE_TIMEOUT,
  MAX_CONVERSATION_DURATION,
  MAX_CONVERSATION_MESSAGES,
  MAX_CONVERSATION_PARTICIPANTS,
  MAX_GROUP_CONVERSATION_MESSAGES,
  GROUP_LEAVE_MIN_MESSAGES,
  GROUP_LEAVE_PROBABILITY,
  MESSAGE_COOLDOWN,
  MIDPOINT_THRESHOLD,
  PLAYER_CONVERSATION_COOLDOWN,
} from '../constants';
import { FunctionArgs } from 'convex/server';
import { MutationCtx, internalMutation, internalQuery } from '../_generated/server';
import { distance, pointsEqual } from '../util/geometry';
import { internal } from '../_generated/api';
import { movePlayer, stopPlayer } from './movement';
import { insertInput } from './insertInput';
import { point, Point } from '../util/types';
import { computeGameTime, CYCLE_MS, isWeekday } from './gameTime';
import {
  ARRIVAL_RADIUS,
  SCENARIO_ARRIVAL_RADIUS,
  SCHEDULE_DISRUPTION_MINUTES,
  SCHEDULE_CHAT_RADIUS,
  WORK_LEASH_RADIUS,
  CONTEXTUAL_EVENT_PROBABILITY,
  CONTEXTUAL_EVENT_MINUTES,
  SICK_BASE_PROBABILITY,
  SICK_PER_WORKDAY_PROBABILITY,
  SICK_MAX_PROBABILITY,
  SICK_DURATION_DAYS,
  CONTAGION_PROBABILITY,
  SCENARIO_CONVO_MIN_MESSAGES,
  SCENARIO_CONVO_MAX_MESSAGES,
  SCENARIO_MAX_CONVO_DURATION,
} from '../constants';
import { getLocationById, homeFor, workLeashAnchor } from '../../data/cityLocations';
import { pickContextualEvent, buildSickSchedule } from '../../data/routines';

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
  scenarioInstruction?: string;
  home?: Point;
  schedule?: ScheduleStep[];
  scheduleGeneratedForDay?: number;
  currentStepIndex?: number;
  // Hard cooldown to prevent any path through tickSchedule from re-firing
  // `agentPlanDay` more than once per ~60s real time per agent. Protects
  // against ACTION_TIMEOUT re-fires when the LLM is slow.
  lastPlanAttempt?: number;
  scheduleNeedsRefresh?: boolean;
  // Set by a custom-scenario injection to force an immediate re-plan that
  // bypasses the normal plan cooldown/stagger throttle. Consumed (deleted) the
  // moment the replan fires.
  forcePlan?: boolean;
  // --- Stage 3: probabilistic health ---
  // Current health. Undefined is treated as 'well'.
  health?: 'well' | 'sick';
  // In-game days of illness remaining; decremented at each day rollover.
  sickDaysLeft?: number;
  // Number of consecutive work days accrued while well; raises the sick chance.
  consecutiveWorkDays?: number;
  // The game-day the once-per-day health roll last ran for (so it runs once).
  healthCheckedForDay?: number;
  // The conversation we last rolled contagion for (so we roll once per convo).
  lastContagionConversation?: GameId<'conversations'>;
  // --- Scenario-relevant background ---
  // Compact, scenario-relevant summary of THIS character that *others* see during
  // the active scenario. Produced once per scenario by the agentExtractScenarioProfile
  // LLM op (not per message/tick) and cleared when the scenario ends.
  scenarioProfile?: string;
  // The scenario instruction `scenarioProfile` was computed for — used as a cache
  // key so we only re-extract when the scenario actually changes. Also set
  // optimistically the moment extraction is scheduled, so the op isn't re-fired
  // every tick while the LLM call is in flight.
  scenarioProfileFor?: string;
  // The automatic-scenario instance this agent is a participant in (if any),
  // matching SerializedActiveScenario.id. Set/cleared by the scenario manager
  // (convex/aiTown/scenarios.ts); distinguishes automatic participants from the
  // manual global scenario so the two systems don't clobber each other.
  scenarioId?: string;
  // Concrete discussion beats and the completion goal for the current scenario's
  // conversations (copied from the ScenarioDef). Injected into the conversation
  // prompt and used by the dialogue goal-judge; cleared when the scenario ends.
  scenarioTopics?: string[];
  scenarioGoal?: string;
  // --- Relationships ---
  // Mutable, directional affinity this agent feels toward other players, keyed by
  // the other player's id (0–100; see convex/aiTown/affinity.ts). Lazily created:
  // an entry only exists once an interaction has moved it off the default.
  affinities?: Record<string, number>;
  // Transient marker of the most recent affinity shift, so the map can flash a
  // 💗/💔 above this character right after a conversation. `at` is the engine time
  // it happened; `net` is the summed delta (>0 warmed, <0 cooled). The frontend
  // only shows it for AFFINITY_INDICATOR_MS, so it doesn't need clearing.
  lastAffinityChange?: { at: number; net: number };

  constructor(serialized: SerializedAgent) {
    const {
      id,
      lastConversation,
      lastInviteAttempt,
      inProgressOperation,
      scenarioTarget,
      scenarioName,
      scenarioArrivalTime,
      scenarioInstruction,
      home,
      schedule,
      scheduleGeneratedForDay,
      currentStepIndex,
      lastPlanAttempt,
      scheduleNeedsRefresh,
      forcePlan,
      health,
      sickDaysLeft,
      consecutiveWorkDays,
      healthCheckedForDay,
      lastContagionConversation,
      scenarioProfile,
      scenarioProfileFor,
      scenarioId,
      scenarioTopics,
      scenarioGoal,
      affinities,
      lastAffinityChange,
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
    this.scenarioInstruction = scenarioInstruction;
    this.home = home;
    this.schedule = schedule;
    this.scheduleGeneratedForDay = scheduleGeneratedForDay;
    this.currentStepIndex = currentStepIndex;
    this.lastPlanAttempt = lastPlanAttempt;
    this.scheduleNeedsRefresh = scheduleNeedsRefresh;
    this.forcePlan = forcePlan;
    this.health = health;
    this.sickDaysLeft = sickDaysLeft;
    this.consecutiveWorkDays = consecutiveWorkDays;
    this.healthCheckedForDay = healthCheckedForDay;
    this.lastContagionConversation =
      lastContagionConversation !== undefined
        ? parseGameId('conversations', lastContagionConversation)
        : undefined;
    this.scenarioProfile = scenarioProfile;
    this.scenarioProfileFor = scenarioProfileFor;
    this.scenarioId = scenarioId;
    this.scenarioTopics = scenarioTopics;
    this.scenarioGoal = scenarioGoal;
    this.affinities = affinities;
    this.lastAffinityChange = lastAffinityChange;
  }

  tick(game: Game, now: number) {
    const player = game.world.players.get(this.playerId);
    if (!player) {
      throw new Error(`Invalid player ID ${this.playerId}`);
    }
    // Auto-expire a custom scenario one in-game day after it was injected so
    // agents stop re-enacting it in every conversation/plan. The episodic
    // memories they formed during the scenario are kept (stored separately in
    // the `memories` table) — we only drop the live directive.
    if (game.world.scenarioInstruction) {
      if (game.world.scenarioStartTime === undefined) {
        // Scenario injected before start-time tracking existed (or otherwise
        // missing its timestamp): start the one-day countdown from now so it
        // still expires instead of lingering forever.
        game.world.scenarioStartTime = now;
      } else if (now - game.world.scenarioStartTime >= CYCLE_MS) {
        delete game.world.scenarioInstruction;
        delete game.world.scenarioStartTime;
        for (const agent of game.world.agents.values()) {
          // Skip agents enlisted in an automatic scenario — those are owned by
          // the scenario manager (convex/aiTown/scenarios.ts), not the manual
          // global scenario being expired here.
          if (agent.scenarioId) continue;
          delete agent.scenarioInstruction;
          // Drop the cached scenario-relevant background so others revert to the
          // default identity blurb once the scenario is over.
          delete agent.scenarioProfile;
          delete agent.scenarioProfileFor;
        }
        // Drop the manual scenario's panel entry too, now that it has expired.
        const remaining = (game.world.activeScenarios ?? []).filter((s) => s.defId !== 'manual');
        game.world.activeScenarios = remaining.length > 0 ? remaining : undefined;
      }
    }
    if (this.scenarioInstruction === undefined && game.world.scenarioInstruction) {
      this.scenarioInstruction = game.world.scenarioInstruction;
    }
    // When a scenario is active, extract this character's scenario-relevant
    // background once (the compact view others see). We schedule the extraction
    // op directly rather than through startOperation: a scenario also forces an
    // agentPlanDay, and startOperation only allows one in-flight op per agent, so
    // routing extraction through it would throw. Extraction only writes a
    // descriptive string and never moves the agent, so it is safe to run
    // lock-free. Setting scenarioProfileFor optimistically here doubles as the
    // "already scheduled" guard so we don't re-fire it every tick.
    if (
      this.scenarioInstruction &&
      this.scenarioProfileFor !== this.scenarioInstruction &&
      game.agentDescriptions.get(this.id)?.profile
    ) {
      this.scenarioProfileFor = this.scenarioInstruction;
      game.scheduleOperation('agentExtractScenarioProfile', {
        worldId: game.worldId,
        agentId: this.id,
        playerId: this.playerId,
        scenarioInstruction: this.scenarioInstruction,
      });
    }
    if (this.inProgressOperation) {
      if (now < this.inProgressOperation.started + ACTION_TIMEOUT) {
        // Wait on the operation to finish.
        return;
      }
      console.log(`Timing out ${JSON.stringify(this.inProgressOperation)}`);
      delete this.inProgressOperation;
    }
    // Opportunistic group conversations: if we're free and a multi-party
    // conversation is already happening nearby with room to spare, walk over and
    // join it rather than starting our own. This is what turns a cluster of
    // agents (e.g. gathered at the park or hawker centre) into one 3–5 person
    // chat instead of several disconnected pairs.
    if (this.maybeJoinNearbyConversation(game, now, player)) {
      return;
    }
    // Scenario gathering: while a local scenario is in its gathering phase the
    // manager sets `scenarioTarget` to the spot. Walk there deterministically so
    // we're guaranteed to arrive before the scenario's content begins, then HOLD
    // at the spot. We don't fall through to the schedule here — otherwise a
    // schedule step pointing elsewhere (e.g. a lunch block) would tug us away and
    // we'd oscillate around the gather point. The manager clears `scenarioTarget`
    // and starts the content window once everyone has gathered, after which the
    // normal opportunistic-conversation logic forms the group.
    if (this.scenarioTarget && !game.world.playerConversation(player)) {
      const arrived = distance(player.position, this.scenarioTarget) < SCENARIO_ARRIVAL_RADIUS;
      if (!arrived) {
        if (
          !player.pathfinding ||
          !pointsEqual(player.pathfinding.destination, this.scenarioTarget)
        ) {
          try {
            movePlayer(game, now, player, this.scenarioTarget);
          } catch (err) {
            console.warn(`Scenario gather move failed for ${player.id}: ${(err as Error).message}`);
          }
        }
      } else if (player.pathfinding) {
        stopPlayer(player);
      }
      return;
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
      // The "inviter" we walk toward / accept from. For an emergent group join
      // there may be no single inviter, so fall back to the conversation creator
      // or any already-participating member.
      const participatingMembers = [...conversation.participants.entries()].filter(
        ([id, m]) => id !== player.id && m.status.kind === 'participating',
      );
      const anchorId =
        (participatingMembers[0] && participatingMembers[0][0]) ??
        (conversation.creator !== player.id ? conversation.creator : undefined) ??
        [...conversation.participants.keys()].find((id) => id !== player.id);
      const anchorPlayer = anchorId ? game.world.players.get(anchorId) : undefined;
      if (member.status.kind === 'invited') {
        // Accept a conversation with another agent with some probability and with
        // a human unconditionally.
        const inviter = anchorPlayer;
        // On shift, decline a (non-human) invite that would pull us away from our
        // workplace; a human can always reach us.
        const shiftStep =
          this.schedule && this.currentStepIndex !== undefined
            ? this.schedule[this.currentStepIndex]
            : undefined;
        const onShiftAnchor = workLeashAnchor(player.name, shiftStep);
        const pullsOffPost =
          !!onShiftAnchor &&
          !!inviter &&
          !inviter.human &&
          distance(onShiftAnchor, inviter.position) >= WORK_LEASH_RADIUS;
        if (pullsOffPost) {
          console.log(`Agent ${player.id} declining off-post invite to ${conversation.id}`);
          conversation.rejectInvite(game, now, player);
        } else if (!inviter || inviter.human || Math.random() < INVITE_ACCEPT_PROBABILITY) {
          console.log(`Agent ${player.id} accepting invite to ${conversation.id}`);
          conversation.acceptInvite(game, player);
          // Stop moving so we can start walking towards the group.
          if (player.pathfinding) {
            delete player.pathfinding;
          }
        } else {
          console.log(`Agent ${player.id} rejecting invite to ${conversation.id}`);
          conversation.rejectInvite(game, now, player);
        }
        return;
      }
      if (member.status.kind === 'walkingOver') {
        // Leave a conversation if we've been waiting for too long.
        if (member.invited + INVITE_TIMEOUT < now) {
          console.log(`Giving up on invite to ${conversation.id}`);
          conversation.leave(game, now, player);
          return;
        }
        if (!anchorPlayer) {
          // Nobody to walk toward yet (everyone still walking over). Hold.
          return;
        }
        // Don't keep moving around if we're near enough to the group.
        const playerDistance = distance(player.position, anchorPlayer.position);
        if (playerDistance < CONVERSATION_DISTANCE) {
          return;
        }
        // Keep moving towards the anchor. If we're close enough, walk directly.
        if (!player.pathfinding) {
          let destination;
          if (playerDistance < MIDPOINT_THRESHOLD) {
            destination = {
              x: Math.floor(anchorPlayer.position.x),
              y: Math.floor(anchorPlayer.position.y),
            };
          } else {
            destination = {
              x: Math.floor((player.position.x + anchorPlayer.position.x) / 2),
              y: Math.floor((player.position.y + anchorPlayer.position.y) / 2),
            };
          }
          console.log(`Agent ${player.id} walking towards ${anchorPlayer.id}...`, destination);
          movePlayer(game, now, player, destination);
        }
        return;
      }
      if (member.status.kind === 'participating') {
        const started = member.status.started;
        if (conversation.isTyping && conversation.isTyping.playerId !== player.id) {
          // Someone else holds the floor right now — wait for them to finish.
          return;
        }
        if (!conversation.lastMessage) {
          const isInitiator = conversation.creator === player.id;
          const awkwardDeadline = started + AWKWARD_CONVERSATION_TIMEOUT;
          // Send the first message if we're the initiator or if we've been waiting for too long.
          if (isInitiator || awkwardDeadline < now) {
            console.log(`${player.id} initiating conversation ${conversation.id}.`);
            const messageUuid = crypto.randomUUID();
            conversation.setIsTyping(now, player, messageUuid);
            this.startOperation(game, now, 'agentGenerateMessage', {
              worldId: game.worldId,
              playerId: player.id,
              agentId: this.id,
              conversationId: conversation.id,
              messageUuid,
              type: 'start',
              gameTimeMs: now,
            });
            return;
          } else {
            // Wait on someone else to break the ice up to the awkward deadline.
            return;
          }
        }
        // Scenario goal just achieved: before anyone wraps up, the designated
        // speaker posts a single message summarising HOW the group achieved it.
        // Skipped once the hard caps are hit so a failed summary can't deadlock the
        // wrap-up — the leave logic below still fires.
        const overScenarioCap =
          started + SCENARIO_MAX_CONVO_DURATION < now ||
          conversation.numMessages > SCENARIO_CONVO_MAX_MESSAGES;
        if (
          conversation.scenarioGoalMet &&
          !conversation.goalSummaryPosted &&
          !overScenarioCap &&
          this.isInScenarioConversation(game, conversation)
        ) {
          const justSpoke = conversation.lastMessage.author === player.id;
          const stalled = now > conversation.lastMessage.timestamp + AWKWARD_CONVERSATION_TIMEOUT;
          const myTurn = conversation.nextSpeaker
            ? conversation.nextSpeaker === player.id || (stalled && !justSpoke)
            : !justSpoke;
          if (!myTurn || (justSpoke && !stalled)) {
            // Not our turn (or cooling down) — wait for the designated speaker to
            // post the summary before anyone leaves.
            return;
          }
          if (now >= conversation.lastMessage.timestamp + MESSAGE_COOLDOWN) {
            console.log(`${player.id} summarising the goal for ${conversation.id}.`);
            const messageUuid = crypto.randomUUID();
            conversation.setIsTyping(now, player, messageUuid);
            this.startOperation(game, now, 'agentGenerateMessage', {
              worldId: game.worldId,
              playerId: player.id,
              agentId: this.id,
              conversationId: conversation.id,
              messageUuid,
              type: 'summary',
              gameTimeMs: now,
            });
          }
          return;
        }
        // See if the conversation has been going on too long and decide to leave.
        const participantCount = conversation.participants.size;
        const isGroup = participantCount > 2;
        const justSpokeNow = conversation.lastMessage.author === player.id;
        let shouldLeave: boolean;
        if (this.isInScenarioConversation(game, conversation)) {
          // Scenario conversation: ignore the random drift-off and keep going until
          // the goal-judge marks the goal met (after a per-scenario minimum) or a
          // hard message/time cap is hit, so the scenario's core content gets covered.
          const minMsgs = SCENARIO_CONVO_MIN_MESSAGES + (isGroup ? 2 * (participantCount - 2) : 0);
          const goalDone = !!conversation.scenarioGoalMet && conversation.numMessages >= minMsgs;
          shouldLeave =
            started + SCENARIO_MAX_CONVO_DURATION < now ||
            conversation.numMessages > SCENARIO_CONVO_MAX_MESSAGES ||
            goalDone;
        } else {
          // Ordinary chat. Groups get a slightly higher message budget so everyone
          // gets a few turns, but it's hard-capped so a big huddle can't run forever.
          const maxMessages = isGroup
            ? Math.min(
                MAX_CONVERSATION_MESSAGES + 2 * (participantCount - 2),
                MAX_GROUP_CONVERSATION_MESSAGES,
              )
            : MAX_CONVERSATION_MESSAGES;
          const tooLongDeadline = started + MAX_CONVERSATION_DURATION;
          // In a group, let people drift away naturally before the hard caps: once
          // enough has been said and this agent has had a turn, they may peel off so
          // the huddle thins out one person at a time instead of all staying glued
          // until the budget runs out. The 2-person path keeps its original feel.
          const wantsToDriftOff =
            isGroup &&
            justSpokeNow &&
            conversation.numMessages >= GROUP_LEAVE_MIN_MESSAGES &&
            Math.random() < GROUP_LEAVE_PROBABILITY;
          shouldLeave =
            tooLongDeadline < now ||
            conversation.numMessages > maxMessages ||
            wantsToDriftOff;
        }
        if (shouldLeave) {
          console.log(`${player.id} leaving conversation ${conversation.id}.`);
          const messageUuid = crypto.randomUUID();
          conversation.setIsTyping(now, player, messageUuid);
          this.startOperation(game, now, 'agentGenerateMessage', {
            worldId: game.worldId,
            playerId: player.id,
            agentId: this.id,
            conversationId: conversation.id,
            messageUuid,
            type: 'leave',
            gameTimeMs: now,
          });
          return;
        }
        // --- Multi-party turn-taking, governed by the dialogue orchestrator. ---
        // After each agent message, the orchestrator sets `nextSpeaker`. We only
        // speak when it's our turn, with two safety valves so the conversation
        // never deadlocks:
        //   1. "Open floor" (nextSpeaker unset, e.g. right after a human spoke):
        //      any agent who didn't just speak may jump in. The isTyping lock
        //      guarantees only one actually grabs the turn.
        //   2. "Stalled" (the designated speaker hasn't said anything within the
        //      awkward timeout — maybe they wandered off or are a quiet human):
        //      anyone else may step in.
        const justSpoke = conversation.lastMessage.author === player.id;
        const stalled =
          now > conversation.lastMessage.timestamp + AWKWARD_CONVERSATION_TIMEOUT;
        let myTurn: boolean;
        if (conversation.nextSpeaker) {
          myTurn = conversation.nextSpeaker === player.id || (stalled && !justSpoke);
        } else {
          // Open floor.
          myTurn = !justSpoke;
        }
        if (!myTurn) {
          return;
        }
        // Even when it's our turn, never reply to ourselves before the awkward
        // deadline, and always wait out the read cooldown.
        if (justSpoke && !stalled) {
          return;
        }
        const messageCooldown = conversation.lastMessage.timestamp + MESSAGE_COOLDOWN;
        if (now < messageCooldown) {
          return;
        }
        console.log(`${player.id} continuing conversation ${conversation.id}.`);
        const messageUuid = crypto.randomUUID();
        conversation.setIsTyping(now, player, messageUuid);
        this.startOperation(game, now, 'agentGenerateMessage', {
          worldId: game.worldId,
          playerId: player.id,
          agentId: this.id,
          conversationId: conversation.id,
          messageUuid,
          type: 'continue',
          gameTimeMs: now,
        });
        return;
      }
    }
  }

  // True if this agent is enlisted in an automatic scenario and at least one OTHER
  // currently-participating member of `conversation` shares the same scenario
  // instance — i.e. this conversation is the scenario's gathering, which gets the
  // goal-driven termination rules instead of the ordinary drift-off/caps.
  isInScenarioConversation(game: Game, conversation: Conversation): boolean {
    if (!this.scenarioId) return false;
    for (const [pid, member] of conversation.participants.entries()) {
      if (pid === this.playerId) continue;
      if (member.status.kind !== 'participating') continue;
      for (const other of game.world.agents.values()) {
        if (other.playerId === pid && other.scenarioId === this.scenarioId) {
          return true;
        }
      }
    }
    return false;
  }

  // If we're free and a multi-party conversation is happening nearby with room
  // under the participant cap, join it (walking over). Returns true if we joined.
  maybeJoinNearbyConversation(game: Game, now: number, player: import('./player').Player): boolean {
    if (this.inProgressOperation) return false;
    if (game.world.playerConversation(player)) return false;
    // Respect the post-conversation and invite cooldowns so we don't ping-pong.
    if (this.lastConversation && now < this.lastConversation + CONVERSATION_COOLDOWN) return false;
    if (this.lastInviteAttempt && now < this.lastInviteAttempt + CONVERSATION_COOLDOWN) return false;

    // On shift: only join conversations near our own workplace, so we don't trek
    // off to a chat and abandon our post.
    const step =
      this.schedule && this.currentStepIndex !== undefined
        ? this.schedule[this.currentStepIndex]
        : undefined;
    const leashAnchor = workLeashAnchor(player.name, step);

    let best: Conversation | undefined;
    let bestDistance = Infinity;
    for (const conversation of game.world.conversations.values()) {
      if (conversation.participants.has(player.id)) continue;
      if (conversation.participants.size >= MAX_CONVERSATION_PARTICIPANTS) continue;
      const participating = [...conversation.participants.values()].filter(
        (m) => m.status.kind === 'participating',
      );
      // Only join a conversation that's genuinely underway and not already
      // winding down. Scenario gatherings run longer, so allow joining one up to
      // its higher cap (a late participant should still be able to slot in).
      if (participating.length < 2) continue;
      const joinMsgCap = this.isInScenarioConversation(game, conversation)
        ? SCENARIO_CONVO_MAX_MESSAGES
        : MAX_CONVERSATION_MESSAGES;
      if (conversation.numMessages > joinMsgCap) continue;
      let nearest = Infinity;
      let nearestToWork = Infinity;
      for (const m of participating) {
        const other = game.world.players.get(m.playerId);
        if (other) {
          nearest = Math.min(nearest, distance(player.position, other.position));
          if (leashAnchor) {
            nearestToWork = Math.min(nearestToWork, distance(leashAnchor, other.position));
          }
        }
      }
      // While on shift, skip conversations happening away from the workplace.
      if (leashAnchor && nearestToWork >= WORK_LEASH_RADIUS) continue;
      if (nearest < GROUP_JOIN_RADIUS && nearest < bestDistance) {
        best = conversation;
        bestDistance = nearest;
      }
    }
    if (!best) return false;
    console.log(`Agent ${player.id} joining nearby conversation ${best.id}`);
    best.join(game, now, player);
    this.lastInviteAttempt = now;
    if (player.pathfinding) stopPlayer(player);
    return true;
  }

  // Returns true if the schedule handled this tick (caller should return).
  tickSchedule(game: Game, now: number, player: import('./player').Player): boolean {
    const gt = computeGameTime(now, game.world.worldStartTime);
    const conversation = game.world.playerConversation(player);
    const doingActivity = player.activity && player.activity.until > now;

    // --- Stage 3: probabilistic health ---
    // Catch the illness from a sick conversation partner (rolled once per convo).
    if (
      conversation &&
      this.health !== 'sick' &&
      this.lastContagionConversation !== conversation.id
    ) {
      this.lastContagionConversation = conversation.id;
      let exposed = false;
      for (const pid of conversation.participants.keys()) {
        if (pid === player.id) continue;
        for (const other of game.world.agents.values()) {
          if (other.playerId === pid && other.health === 'sick') {
            exposed = true;
            break;
          }
        }
        if (exposed) break;
      }
      if (exposed && Math.random() < CONTAGION_PROBABILITY) {
        this.health = 'sick';
        this.sickDaysLeft = SICK_DURATION_DAYS;
        this.consecutiveWorkDays = 0;
      }
    }

    // Once-per-day health roll: recover when the illness runs its course, or
    // fall sick on a work day with a burnout-scaled probability.
    if (this.healthCheckedForDay !== gt.dayNumber) {
      this.healthCheckedForDay = gt.dayNumber;
      this.updateHealthForNewDay(gt.dayNumber);
    }

    // If sick and today's rest schedule isn't set up yet, stay home and rest —
    // skip the LLM planner entirely. Don't interrupt an active conversation.
    if (
      this.health === 'sick' &&
      this.scheduleGeneratedForDay !== gt.dayNumber &&
      !conversation
    ) {
      const playerName = player.name ?? 'someone';
      const homeLoc = this.home ?? (homeFor(playerName) ?? getLocationById('hdb'))!;
      const homePoint = this.home ?? { x: homeLoc.x, y: homeLoc.y };
      this.schedule = buildSickSchedule(homePoint);
      this.scheduleGeneratedForDay = gt.dayNumber;
      this.currentStepIndex = 0;
      delete this.scheduleNeedsRefresh;
      if (player.pathfinding) stopPlayer(player);
      return true;
    }

    // Decide if we need a new plan.
    const noSchedule = !this.schedule || this.schedule.length === 0;
    const dayChanged =
      this.scheduleGeneratedForDay !== undefined && this.scheduleGeneratedForDay !== gt.dayNumber;
    // Advance to the latest step whose start time has passed BEFORE computing
    // overdueMinutes. Previously the while loop sat below the disruption check,
    // so currentStepIndex advanced the instant the next step's startMinute arrived
    // — keeping overdueMinutes permanently ≤ 0 and the disruption branch
    // permanently unreachable. Advancing first and measuring from the current
    // step's own startMinute lets stuck agents correctly trigger a replan.
    if (this.schedule && this.currentStepIndex !== undefined) {
      while (
        this.currentStepIndex < this.schedule.length - 1 &&
        gt.minutesIntoDay >= this.schedule[this.currentStepIndex + 1].startMinute
      ) {
        this.currentStepIndex += 1;
      }
    }

    let disrupted = false;
    if (this.schedule && this.currentStepIndex !== undefined && !noSchedule && !dayChanged) {
      const step = this.schedule[this.currentStepIndex];
      if (step) {
        const overdueMinutes = gt.minutesIntoDay - step.startMinute;
        const atDest = distance(player.position, step.destination) < ARRIVAL_RADIUS;
        if (overdueMinutes > SCHEDULE_DISRUPTION_MINUTES && !atDest) {
          disrupted = true;
        }
      }
    }

    const conversationRefresh = !!this.scheduleNeedsRefresh;
    const wantsPlan = (noSchedule || dayChanged || disrupted || conversationRefresh) && !conversation && !doingActivity;
    if (wantsPlan) {
      // Hard cooldown: never re-fire agentPlanDay more than once per 5 minutes
      // real time per agent. Protects against ACTION_TIMEOUT re-fires and any
      // unforeseen tick-loop calling startOperation repeatedly.
      const PLAN_COOLDOWN_MS = 5 * 60 * 1000;
      const onCooldown = !!this.lastPlanAttempt && now - this.lastPlanAttempt < PLAN_COOLDOWN_MS;
      // Stagger: deterministic per-agent offset so 5 agents don't all hit the
      // LLM in the same engine step at bootstrap / day rollover. Spread over
      // 2 minutes real time, keyed by agent id.
      const STAGGER_WINDOW_MS = 2 * 60 * 1000;
      const idHash = [...this.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
      const offset = Math.abs(idHash) % STAGGER_WINDOW_MS;
      // Anchor offset to the start of the current game-day so agents stagger
      // each day, not just at world boot.
      const dayStart = (game.world.worldStartTime ?? now) + (gt.dayNumber - 1) * (10 * 60 * 1000);
      const beforeStagger = now < dayStart + offset;
      // A custom-scenario injection sets `forcePlan` to demand an IMMEDIATE
      // re-plan. Bypass both throttles in that case so every agent reacts to the
      // scenario at once instead of waiting out the cooldown/stagger window.
      const forcePlan = !!this.forcePlan;
      // Only fire a (re)plan when we're not throttled. CRUCIAL: when throttled we
      // deliberately DO NOT `return false` here. Returning false hands control
      // back to tick(), which then drops the agent into the free-roam wander
      // branch — random destination + random activity. Because PLAN_COOLDOWN_MS
      // is 5 real minutes (~12 in-game hours) and `scheduleNeedsRefresh` is set
      // after every conversation, that made agents abandon their schedule and
      // stand around at random tiles for minutes after each chat. Instead, fall
      // through and keep executing the existing schedule (walk to current step).
      if (forcePlan || (!onCooldown && !beforeStagger)) {
        const playerName = player.name ?? 'someone';
        const home = this.home ?? (homeFor(playerName) ?? getLocationById('hdb'))!;
        const homePoint = this.home ?? { x: home.x, y: home.y };
        const homeLoc = homeFor(playerName);
        this.lastPlanAttempt = now;
        delete this.scheduleNeedsRefresh;
        delete this.forcePlan;
        this.startOperation(game, now, 'agentPlanDay', {
          worldId: game.worldId,
          agentId: this.id,
          playerId: this.playerId,
          playerName,
          home: homePoint,
          homeName: homeLoc?.name,
          dayNumber: gt.dayNumber,
          currentTimeStr: gt.timeStr,
          currentMinutesIntoDay: gt.minutesIntoDay,
          existingSchedule: (disrupted || conversationRefresh || forcePlan) ? this.schedule : undefined,
          scenarioInstruction: this.scenarioInstruction,
        });
        return true;
      }
      // Throttled: fall through to execute the existing schedule below.
    }

    if (!this.schedule || this.currentStepIndex === undefined) return false;

    const step = this.schedule[this.currentStepIndex];
    if (!step) return false;

    // It isn't time for the first step yet — let the rest of the tick run.
    if (gt.minutesIntoDay < step.startMinute) return false;

    // Don't yank the agent out of an active conversation. The schedule can wait.
    if (conversation) return false;

    const atDest = distance(player.position, step.destination) < ARRIVAL_RADIUS;

    // Opportunistic conversations. The reach depends on whether we're still
    // walking to the scheduled spot or already settled there:
    //   - In transit: only greet someone we physically pass (within the chat
    //     radius) so a trip to work isn't derailed across the whole map.
    //   - Settled at our destination with idle time: reach out MAP-WIDE and walk
    //     over to meet. Workplaces are far apart (shophouses, MBS, hawker centre,
    //     A*STAR, Temasek Poly), so agents almost never share a 6-tile radius;
    //     limiting invites to that radius is why they'd basically stop talking.
    //     Inviting map-wide and letting the walk-over logic bring them together
    //     is what actually drives emergent conversations (and the conversation-
    //     driven re-planning) in the town — the way the original game worked.
    const onInviteCooldown =
      this.lastInviteAttempt && now < this.lastInviteAttempt + CONVERSATION_COOLDOWN;
    const justChatted =
      this.lastConversation && now < this.lastConversation + CONVERSATION_COOLDOWN;
    // A sick agent keeps to themselves — don't initiate new conversations.
    if (!onInviteCooldown && !justChatted && !this.inProgressOperation && this.health !== 'sick') {
      const freePlayers = [...game.world.players.values()].filter(
        (p) =>
          p.id !== player.id &&
          ![...game.world.conversations.values()].some((c) => c.participants.has(p.id)),
      );
      // On shift we keep social reach close to the workplace so a worker doesn't
      // trek across the map to chat and abandon their post.
      const leashAnchor = workLeashAnchor(player.name, step);
      let pool: typeof freePlayers;
      if (!atDest) {
        // In transit: only greet someone we physically pass.
        pool = freePlayers.filter(
          (p) => distance(p.position, player.position) < SCHEDULE_CHAT_RADIUS,
        );
      } else if (leashAnchor) {
        // Settled on shift: only reach coworkers/customers near the workplace.
        pool = freePlayers.filter((p) => distance(p.position, leashAnchor) < WORK_LEASH_RADIUS);
      } else {
        // Settled off-shift: reach map-wide so emergent conversations still form.
        pool = freePlayers;
      }
      if (pool.length > 0) {
        // Optimistically record the attempt so we don't re-fire every tick when
        // no candidate can actually be invited (e.g. all on the pair cooldown).
        this.lastInviteAttempt = now;
        this.startOperation(game, now, 'agentDoSomething', {
          worldId: game.worldId,
          player: player.serialize(),
          otherFreePlayers: pool.map((p) => p.serialize()),
          agent: this.serialize(),
          map: game.worldMap.serialize(),
          forceInvite: true,
        });
        return true;
      }
    }

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
      // Stage 2: sometimes swap in a short contextual micro-event tied to the
      // current block (office events during work hours, flexible ones
      // otherwise), then fall back to the block's base activity afterwards.
      const event =
        Math.random() < CONTEXTUAL_EVENT_PROBABILITY
          ? pickContextualEvent(step.locationId, gt.minutesIntoDay)
          : null;
      if (event) {
        const eventMinutes = Math.min(minutesLeft, CONTEXTUAL_EVENT_MINUTES);
        player.activity = {
          description: event.description,
          emoji: event.emoji,
          until: now + eventMinutes * realMsPerGameMinute,
        };
      } else {
        player.activity = {
          description: step.activity,
          emoji: step.emoji ?? '💭',
          until: now + minutesLeft * realMsPerGameMinute,
        };
      }
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
      scenarioInstruction: this.scenarioInstruction,
      home: this.home,
      schedule: this.schedule,
      scheduleGeneratedForDay: this.scheduleGeneratedForDay,
      currentStepIndex: this.currentStepIndex,
      lastPlanAttempt: this.lastPlanAttempt,
      scheduleNeedsRefresh: this.scheduleNeedsRefresh,
      forcePlan: this.forcePlan,
      health: this.health,
      sickDaysLeft: this.sickDaysLeft,
      consecutiveWorkDays: this.consecutiveWorkDays,
      healthCheckedForDay: this.healthCheckedForDay,
      lastContagionConversation: this.lastContagionConversation,
      scenarioProfile: this.scenarioProfile,
      scenarioProfileFor: this.scenarioProfileFor,
      scenarioId: this.scenarioId,
      scenarioTopics: this.scenarioTopics,
      scenarioGoal: this.scenarioGoal,
      affinities: this.affinities,
      lastAffinityChange: this.lastAffinityChange,
    };
  }

  // --- Stage 3: once-per-day health bookkeeping ---
  // Advances illness state at a day rollover: recover after the illness runs its
  // course, otherwise (on a work day) roll a burnout-scaled chance of falling
  // sick. Weekends rest and reset the consecutive-work-day streak.
  updateHealthForNewDay(dayNumber: number) {
    if (this.health === 'sick') {
      const left = (this.sickDaysLeft ?? 1) - 1;
      if (left <= 0) {
        this.health = 'well';
        this.sickDaysLeft = 0;
      } else {
        this.sickDaysLeft = left;
      }
      return;
    }
    if (isWeekday(dayNumber)) {
      const streak = this.consecutiveWorkDays ?? 0;
      const p = Math.min(
        SICK_MAX_PROBABILITY,
        SICK_BASE_PROBABILITY + SICK_PER_WORKDAY_PROBABILITY * streak,
      );
      if (Math.random() < p) {
        this.health = 'sick';
        this.sickDaysLeft = SICK_DURATION_DAYS;
        this.consecutiveWorkDays = 0;
        return;
      }
      this.consecutiveWorkDays = streak + 1;
    } else {
      this.consecutiveWorkDays = 0;
    }
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
  scenarioInstruction: v.optional(v.string()),
  home: v.optional(point),
  schedule: v.optional(v.array(scheduleStep)),
  scheduleGeneratedForDay: v.optional(v.number()),
  currentStepIndex: v.optional(v.number()),
  lastPlanAttempt: v.optional(v.number()),
  scheduleNeedsRefresh: v.optional(v.boolean()),
  forcePlan: v.optional(v.boolean()),
  health: v.optional(v.union(v.literal('well'), v.literal('sick'))),
  sickDaysLeft: v.optional(v.number()),
  consecutiveWorkDays: v.optional(v.number()),
  healthCheckedForDay: v.optional(v.number()),
  lastContagionConversation: v.optional(conversationId),
  scenarioProfile: v.optional(v.string()),
  scenarioProfileFor: v.optional(v.string()),
  scenarioId: v.optional(v.string()),
  scenarioTopics: v.optional(v.array(v.string())),
  scenarioGoal: v.optional(v.string()),
  // Directional affinity toward other players, keyed by player id (0–100).
  affinities: v.optional(v.record(v.string(), v.number())),
  // Most recent affinity shift, for the transient map indicator.
  lastAffinityChange: v.optional(v.object({ at: v.number(), net: v.number() })),
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
    case 'agentExtractScenarioProfile':
      reference = internal.aiTown.agentOperations.agentExtractScenarioProfile;
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
    // True for the one-off "how we achieved the goal" wrap-up message.
    isGoalSummary: v.optional(v.boolean()),
    operationId: v.string(),
    // The participant the dialogue orchestrator wants to speak next (omitted when
    // leaving or when the floor should be open, e.g. only humans remain).
    nextSpeaker: v.optional(playerId),
    // For scenario conversations: whether the goal-judge deemed the goal met, and
    // the 0-based indices of scenario topics it judged substantively covered.
    goalMet: v.optional(v.boolean()),
    coveredTopics: v.optional(v.array(v.number())),
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
      isGoalSummary: args.isGoalSummary,
      operationId: args.operationId,
      nextSpeaker: args.nextSpeaker,
      goalMet: args.goalMet,
      coveredTopics: args.coveredTopics,
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
