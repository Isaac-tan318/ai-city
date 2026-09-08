import { ObjectType, v } from 'convex/values';
import { GameId, parseGameId } from './ids';
import { agentId, conversationId, playerId } from './ids';
import { Player, serializedPlayer } from './player';
import { Conversation } from './conversation';
import { focalTurnDelta } from './deliberation';
import { Game } from './game';
// Type-only (erased at runtime) — world.ts imports agent.ts, so a value import
// here would be a circular dependency.
import type { SerializedActiveScenario } from './world';
import {
  ACTION_TIMEOUT,
  AWKWARD_CONVERSATION_TIMEOUT,
  CONVERSATION_COOLDOWN,
  CONVERSATION_DISTANCE,
  GROUP_JOIN_RADIUS,
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
import { FunctionArgs, FunctionReference } from 'convex/server';
import type { Id } from '../_generated/dataModel';
import { MutationCtx, internalMutation, internalQuery } from '../_generated/server';
import { distance, pointsEqual } from '../util/geometry';
import { internal } from '../_generated/api';
import { movePlayer, pickParkWaypoint, stopPlayer } from './movement';
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
  SUBSTEP_MIN_BLOCK_MINUTES,
  OBSERVATION_INTERVAL_MS,
  MAX_OBSERVED_SUBJECTS,
  REFLECTION_CHECK_INTERVAL_MS,
  REFLECTION_MIN_EVENTS,
  REFLECTION_MIN_INTERVAL_MS,
  REACTION_INTERVAL_MS,
  REACTION_MIN_IMPORTANCE,
  REACTION_REPLAN_COOLDOWN_MS,
  SELF_SUMMARY_ENABLED,
  SELF_SUMMARY_FIRST_DAY,
  SELF_SUMMARY_INTERVAL_DAYS,
  SICK_BASE_PROBABILITY,
  SICK_PER_WORKDAY_PROBABILITY,
  SICK_MAX_PROBABILITY,
  SICK_DURATION_DAYS,
  CONTAGION_PROBABILITY,
  SCENARIO_CONVO_MIN_MESSAGES,
  SCENARIO_CONVO_MAX_MESSAGES,
  SCENARIO_MAX_CONVO_DURATION,
  MAX_AFFINITY,
  DEFAULT_AFFINITY,
  CANDIDATE_AFFINITY_WEIGHT,
  INVITE_ACCEPT_MIN_PROBABILITY,
  INVITE_ACCEPT_MAX_PROBABILITY,
  GROUP_LEAVE_AFFINITY_WEIGHT,
  REJECTED_INVITE_AFFINITY_PENALTY,
  GROUP_EXIT_LOW_AFFINITY_THRESHOLD,
} from '../constants';
import { affinityToward, clampAffinity, FamilyTie } from './affinity';
import {
  buildShortTermSnapshot,
  canAfford,
  clampGauge,
  decayTowardBaseline,
  defaultShortTerm,
  shortTermSelfDescription,
  shortTermSensitivity,
  spend,
  SHORT_TERM_COMPONENTS,
  type ShortTerm,
  type ShortTermComponent,
} from './shortTerm';
import {
  SHORT_TERM_DAILY_DECAY,
  DAILY_INCOME,
  DAILY_EXPENSES,
  DEFAULT_BALANCE,
  SICK_STRESS_PER_DAY,
  SICK_MOOD_PENALTY_PER_DAY,
  MEAL_COST,
  AWAY_STEP_FATIGUE,
  FATIGUE_PER_WORK_BLOCK,
  HUNGER_PER_GAME_HOUR,
  FATIGUE_BASELINE,
  STRESS_BASELINE,
  HUNGER_BASELINE,
  CANDIDATE_FATIGUE_DISTANCE_WEIGHT,
  STEP_WANDER_RADIUS,
  STEP_SETTLED_RADIUS,
  STEP_WANDER_INTERVAL_MS,
} from '../constants';
import {
  getLocationById,
  homeFor,
  nearestLocation,
  workLeashAnchor,
} from '../../data/cityLocations';
import {
  affinityMean,
  conversationObservationText,
  fingerprint,
  observationImportance,
  observationText,
  observedFingerprint,
} from './observation';
import { pickContextualEvent, buildSickSchedule, isSleepStep } from '../../data/routines';

export type ScheduleStep = {
  startMinute: number;
  locationId: string;
  destination: Point;
  activity: string;
  emoji?: string;
  description: string;
};

// One finer-grained action within a schedule block, produced by decomposing that
// block (see Agent.maybeDecomposeStep). Inherits the parent step's location — a
// sub-step changes what the agent is doing, not where they are.
export type SubStep = {
  startMinute: number;
  activity: string;
  emoji?: string;
};


export class Agent {
  id: GameId<'agents'>;
  playerId: GameId<'players'>;
  toRemember?: GameId<'conversations'>;
  lastConversation?: number;
  lastInviteAttempt?: number;
  // When this agent last drifted to a new tile around their schedule spot, so the
  // milling-about wander fires on an interval rather than every tick.
  lastWanderAt?: number;
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
  // Authored point of disagreement for the current scenario (copied from the
  // ScenarioDef). Injected into the prompt so the agent takes a side and argues.
  scenarioConflict?: string;
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
  // --- Short-term memory ---
  // Mutable affective/physiological gauges (mood/stress/fatigue/hunger, each
  // 0–100; see convex/aiTown/shortTerm.ts). Lazily created: absent means "at
  // baseline". Distinct from the durable authored `profile` on AgentDescription.
  shortTerm?: ShortTerm;
  // Savings balance (local dollars) for the economic model. Income is credited on
  // work days and activities/tasks cost money; financial pressure is derived from
  // this (shortTerm.financialPressure). Absent means DEFAULT_BALANCE.
  balance?: number;
  // The game-day the once-per-day short-term bookkeeping (decay/income) last ran.
  shortTermCheckedForDay?: number;
  // The game-day hunger was last reset by a meal (so we accrue from the right base).
  lastMealDay?: number;
  // Guard so per-step fatigue/hunger accrual fires once per schedule step (a step
  // can re-set its activity after a contextual micro-event expires). Keyed by
  // `${dayNumber}:${currentStepIndex}`.
  shortTermStepKey?: string;
  // Transient marker of the most recent short-term shift, for a brief map badge.
  lastShortTermChange?: { at: number; net: number };
  // --- Long-term promotion ---
  // Durable traits the agent has learned about itself by reflecting across many
  // memories/scenarios (spec point 6). Kept SEPARATE from the authored `profile`
  // so runtime learning augments, never overwrites, the hand-authored persona.
  learnedTraits?: string[];

  // Operator override from the agents popup: hold this character at a chosen
  // place, overriding their schedule the way a running scenario does. Cleared at
  // the day rollover (`day` is the game-day it was set on) so a forgotten hold
  // can never freeze someone out of their routine permanently.
  pin?: { destination: Point; locationId: string; day: number };

  // --- Hierarchical plan decomposition ---
  // Finer-grained actions for the CURRENT schedule block only, keyed by the step
  // instance they decompose (`${day}:${stepIndex}:${startMinute}` — the same key
  // `shortTermStepKey` uses). A re-plan changes the key, so stale sub-steps are
  // discarded rather than silently re-pointed at a different block.
  activeSubSteps?: { stepKey: string; steps: SubStep[] };
  // The step key a decomposition request is in flight for, so a slow op isn't
  // re-requested on every tick.
  subStepsRequestedFor?: string;

  // --- Perception ---
  // Dedupe state for the observation stream: the last state fingerprint recorded
  // for each subject in range. Persisted (not in-memory) because the Game is
  // rebuilt from the DB every ~30s. Hashes rather than text to keep the world
  // document small — it is rewritten every step.
  observed?: { k: string; h: number }[];
  lastObservationAt?: number;

  // --- Reflection ---
  // Start of the current reflection window: only material formed after this is
  // new. Advanced ONLY when a reflection actually happens, so a below-threshold
  // check doesn't consume the memories it declined to reflect on.
  lastReflectionAt?: number;
  // When we last CHECKED whether to reflect. Separate from the window above and
  // stamped optimistically at schedule time — the reflect op is lock-free, so it
  // has no operationId and nothing clears an in-flight marker on return.
  lastReflectionCheck?: number;
  // Memorable things that have happened since the last reflection (observations
  // emitted, conversations finished). A free engine-side gate, so the check
  // itself costs nothing until there is something to reflect on.
  eventsSinceReflection?: number;

  // --- Reacting loop ---
  lastReactionAt?: number;
  // Salient observations emitted since the last reaction check. Counted in the
  // engine so the gate is free: without it the loop pays for a completion every
  // REACTION_INTERVAL_MS per agent just to be told nothing has changed.
  salientSinceReaction?: number;
  // A reaction decided the day's plan no longer fits. Separate from `forcePlan`,
  // which is scenario injection's escape hatch past every throttle.
  reactionReplan?: boolean;
  lastReactionReplanAt?: number;
  reactReplansToday?: number;
  reactReplansDay?: number;
  // Someone a reaction wants this agent to approach; consumed on the next invite.
  preferredInvitee?: GameId<'players'>;

  // Day-rollover guard for the self-summary rewrite (see §5).
  selfSummaryCheckedForDay?: number;

  constructor(serialized: SerializedAgent) {
    const {
      id,
      lastConversation,
      lastInviteAttempt,
      lastWanderAt,
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
      scenarioConflict,
      affinities,
      lastAffinityChange,
      shortTerm,
      balance,
      shortTermCheckedForDay,
      lastMealDay,
      shortTermStepKey,
      lastShortTermChange,
      learnedTraits,
      pin,
      activeSubSteps,
      subStepsRequestedFor,
      observed,
      lastObservationAt,
      lastReflectionAt,
      lastReflectionCheck,
      eventsSinceReflection,
      lastReactionAt,
      salientSinceReaction,
      reactionReplan,
      lastReactionReplanAt,
      reactReplansToday,
      reactReplansDay,
      preferredInvitee,
      selfSummaryCheckedForDay,
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
    this.lastWanderAt = lastWanderAt;
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
    this.scenarioConflict = scenarioConflict;
    this.affinities = affinities;
    this.lastAffinityChange = lastAffinityChange;
    this.shortTerm = shortTerm;
    this.balance = balance;
    this.shortTermCheckedForDay = shortTermCheckedForDay;
    this.lastMealDay = lastMealDay;
    this.shortTermStepKey = shortTermStepKey;
    this.lastShortTermChange = lastShortTermChange;
    this.learnedTraits = learnedTraits;
    this.pin = pin;
    this.activeSubSteps = activeSubSteps;
    this.subStepsRequestedFor = subStepsRequestedFor;
    this.observed = observed;
    this.lastObservationAt = lastObservationAt;
    this.lastReflectionAt = lastReflectionAt;
    this.lastReflectionCheck = lastReflectionCheck;
    this.eventsSinceReflection = eventsSinceReflection;
    this.lastReactionAt = lastReactionAt;
    this.salientSinceReaction = salientSinceReaction;
    this.reactionReplan = reactionReplan;
    this.lastReactionReplanAt = lastReactionReplanAt;
    this.reactReplansToday = reactReplansToday;
    this.reactReplansDay = reactReplansDay;
    this.preferredInvitee =
      preferredInvitee !== undefined ? parseGameId('players', preferredInvitee) : undefined;
    this.selfSummaryCheckedForDay = selfSummaryCheckedForDay;
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
        delete game.world.scenarioParticipantIds;
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
    // Adopt the live custom scenario, but only if we're one of its cast. A custom
    // scenario enlists a group (see injectScenario); without this check every agent
    // would pick the directive up off the world doc on their next tick and the
    // scenario would silently become town-wide again. A missing participant list
    // means the legacy broadcast — everyone.
    if (this.scenarioInstruction === undefined && game.world.scenarioInstruction) {
      const cast = game.world.scenarioParticipantIds;
      if (!cast || cast.includes(this.playerId)) {
        this.scenarioInstruction = game.world.scenarioInstruction;
      }
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
    // Local-scenario delegation: once the planning conversation's goal is met, the
    // designated planner fires ONE op to turn the agreed plan into concrete,
    // delegated tasks (which flips the scenario into its "working" phase).
    this.maybeRequestScenarioTasks(game, now);
    // Decision-scenario deliberation: the focal participant asks the Decider for
    // the candidate options. Lock-free and placed before the in-flight-op guard
    // so it can be requested while this agent is busy doing something else.
    this.maybeRequestDecisionOptions(game);
    // Perception. In the prelude on purpose — see tickObservations. Writes no
    // movement state and starts no operation, so it is safe to run lock-free
    // while the agent is busy, mid-conversation, or held by a scenario.
    this.tickObservations(game, now, player);
    this.maybeReflect(game, now);
    this.maybeReact(game, now, player);
    if (this.inProgressOperation) {
      if (now < this.inProgressOperation.started + ACTION_TIMEOUT) {
        // Wait on the operation to finish.
        return;
      }
      console.log(`Timing out ${JSON.stringify(this.inProgressOperation)}`);
      delete this.inProgressOperation;
    }
    // Local-scenario "working" phase (and the short planning-op window before it):
    // hold at the workplace and let the scenario manager drive our assigned-task
    // activity + progress bar — don't wander or start/join new conversations. We
    // only hold once we're OUT of the planning conversation, so its wrap-up (goal
    // summary / goodbyes) still runs first.
    if (this.isHeldByScenario(game) && !game.world.playerConversation(player)) {
      if (player.pathfinding) stopPlayer(player);
      return;
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
    // Only a free-roam activity is abandoned when the agent starts moving or
    // talking. A scheduled (ambient) one keeps running: it's what they're doing
    // with this whole block, so it should follow them around the workplace and be
    // something they can mention in conversation. Texting never interrupts an
    // activity at all — glancing at your phone mid-task is the entire point.
    const interrupting = (conversation && !conversation.isText) || player.pathfinding;
    if (doingActivity && !player.activity!.ambient && interrupting) {
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
          // Don't cross scenario boundaries: a non-scenario agent ignores scenario
          // participants (so it can't pull one out of a gathering), and a scenario
          // agent only considers fellow participants of its own scenario.
          .filter((p) => {
            const other = [...game.world.agents.values()].find((a) => a.playerId === p.id);
            return this.scenarioId
              ? other?.scenarioId === this.scenarioId
              : !other?.scenarioId;
          })
          .map((p) => p.serialize()),
        agent: this.serialize(),
        map: game.worldMap.serialize(),
        preferredInvitee: this.preferredInvitee,
      });
      delete this.preferredInvitee;
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
        // A fellow participant of our own scenario is never "off post" — the
        // scenario is the point, and declining them is how a decision scenario
        // ends up with a focal agent who never joins the conversation.
        const inviterAgent = inviter
          ? [...game.world.agents.values()].find((a) => a.playerId === inviter.id)
          : undefined;
        const sameScenario =
          !!this.scenarioId && !!inviterAgent && inviterAgent.scenarioId === this.scenarioId;
        const onShiftAnchor = sameScenario
          ? undefined
          : workLeashAnchor(player.name, shiftStep);
        const pullsOffPost =
          !!onShiftAnchor &&
          !!inviter &&
          !inviter.human &&
          distance(onShiftAnchor, inviter.position) >= WORK_LEASH_RADIUS;
        // Scale acceptance by how this agent feels about the inviter: family and
        // close friends almost always say yes; someone they're cool toward usually
        // gets a polite no. Humans (handled below) are always accepted.
        const inviterAffinity = inviter ? this.affinityFor(game, inviter.id) : MAX_AFFINITY;
        const acceptProbability =
          INVITE_ACCEPT_MIN_PROBABILITY +
          (INVITE_ACCEPT_MAX_PROBABILITY - INVITE_ACCEPT_MIN_PROBABILITY) *
            (inviterAffinity / MAX_AFFINITY);
        if (pullsOffPost) {
          console.log(`Agent ${player.id} declining off-post invite to ${conversation.id}`);
          conversation.rejectInvite(game, now, player);
        } else if (!inviter || inviter.human || Math.random() < acceptProbability) {
          console.log(`Agent ${player.id} accepting invite to ${conversation.id}`);
          conversation.acceptInvite(game, player);
          // Stop moving so we can start walking towards the group.
          if (player.pathfinding) {
            delete player.pathfinding;
          }
        } else {
          console.log(`Agent ${player.id} rejecting invite to ${conversation.id}`);
          // The inviter takes the snub personally: their affinity toward the
          // decliner drops a little, so repeated brush-offs build into a grudge.
          // Only for affinity-driven declines — the work-leash decline above
          // isn't personal. (This branch implies a non-human inviter.)
          if (inviterAgent) {
            const current = inviterAgent.affinityFor(game, player.id);
            const updated = clampAffinity(current - REJECTED_INVITE_AFFINITY_PENALTY);
            if (updated !== current) {
              inviterAgent.affinities = {
                ...(inviterAgent.affinities ?? {}),
                [player.id]: updated,
              };
              inviterAgent.lastAffinityChange = { at: now, net: updated - current };
              const declinerName = game.playerDescriptions.get(player.id)?.name ?? 'Someone';
              game.emitRelationshipEvent({
                at: now,
                kind: 'inviteDeclined',
                actor: inviter.id,
                target: player.id,
                delta: updated - current,
                affinityAfter: updated,
                reason: `${declinerName} turned down their invite`,
                conversationId: conversation.id,
              });
            }
          }
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
              scenarioId: this.scenarioId,
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
              scenarioId: this.scenarioId,
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
          // Drift off sooner from a group you dislike; linger with friends/family.
          const groupStats = isGroup
            ? this.groupAffinityStats(game, conversation, player.id)
            : undefined;
          const groupLeaveProbability = isGroup
            ? this.groupLeaveProbability(groupStats)
            : GROUP_LEAVE_PROBABILITY;
          const wantsToDriftOff =
            isGroup &&
            justSpokeNow &&
            conversation.numMessages >= GROUP_LEAVE_MIN_MESSAGES &&
            Math.random() < groupLeaveProbability;
          // A drift-off from company this agent dislikes is a visible consequence
          // of the bad blood — record it for the Tensions feed.
          if (wantsToDriftOff && groupStats && groupStats.avg < GROUP_EXIT_LOW_AFFINITY_THRESHOLD) {
            game.emitRelationshipEvent({
              at: now,
              kind: 'groupExit',
              actor: player.id,
              target: groupStats.lowestId,
              reason: 'slipped away from the group early',
              conversationId: conversation.id,
              scenarioId: this.scenarioId,
              scenarioName: this.scenarioName,
            });
          }
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
            scenarioId: this.scenarioId,
          });
          return;
        }
        // Decision scenario: if this agent is the focal one, its turns run the
        // deliberation (estimate the options, then ask or commit) instead of
        // producing an ordinary reply. Everyone else talks normally, so their
        // answers to its questions come back through the usual path.
        if (this.maybeTakeFocalTurn(game, now, conversation, player)) {
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
          scenarioId: this.scenarioId,
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

  // The active-scenario entry this agent is enlisted in, if any.
  activeScenario(game: Game): SerializedActiveScenario | undefined {
    if (!this.scenarioId) return undefined;
    return (game.world.activeScenarios ?? []).find((s) => s.id === this.scenarioId);
  }

  // True while a local scenario is delegating or performing its tasks: either the
  // planning op is in flight (tasks requested, not yet back) or the scenario is in
  // its 'working' phase. During this the agent holds at the workplace.
  isHeldByScenario(game: Game): boolean {
    const sc = this.activeScenario(game);
    if (!sc || sc.scope !== 'local') return false;
    if (sc.phase === 'working') return true;
    return !!sc.taskPlanRequested && !sc.tasks;
  }

  // Once a local scenario's planning conversation has met its goal, the single
  // designated planner (participant whose id sorts first) fires one op to turn the
  // agreed plan into concrete, delegated tasks. Guarded so it fires exactly once.
  maybeRequestScenarioTasks(game: Game, now: number): void {
    if (this.inProgressOperation) return;
    const sc = this.activeScenario(game);
    if (!sc || sc.scope !== 'local') return;
    // Decision scenarios (no tasks) never enter the working phase — the goal-met
    // wrap-up ends them. Only 'tasks' scenarios delegate concrete work.
    if ((sc.outcome ?? 'tasks') !== 'tasks') return;
    if (sc.phase !== 'active' || !sc.goalMet || sc.tasks || sc.taskPlanRequested) return;
    const planner = [...sc.participantIds].sort()[0];
    if (this.playerId !== planner) return;
    sc.taskPlanRequested = true;
    this.startOperation(game, now, 'agentPlanScenarioTasks', {
      worldId: game.worldId,
      agentId: this.id,
      playerId: this.playerId,
      scenarioId: sc.id,
    });
  }

  // Ask the Decider to generate the candidate options for a decision scenario.
  // Fired once per scenario by the focal participant, LOCK-FREE (via
  // game.scheduleOperation rather than startOperation) so the group's
  // conversation starts and runs normally while the options are being written.
  // Until they land, maybeTakeFocalTurn stays dormant and the scenario behaves
  // exactly as it did before the decision engine existed.
  maybeRequestDecisionOptions(game: Game): void {
    const sc = this.activeScenario(game);
    if (!sc || (sc.outcome ?? 'tasks') !== 'decision') return;
    if (sc.phase && sc.phase !== 'active') return;
    const deliberation = sc.deliberation;
    if (!deliberation) return;
    if (deliberation.optionsRequested || deliberation.options.length > 0) return;
    if (this.playerId !== deliberation.focalPlayerId) return;
    deliberation.optionsRequested = true;
    game.scheduleOperation('generateDecisionOptions', {
      worldId: game.worldId,
      scenarioId: sc.id,
    });
  }

  // The focal agent's deliberation turn. Returns true if it took the turn, so the
  // caller skips the ordinary message path.
  //
  // Gated by the same turn rules as a normal reply (designated speaker or open
  // floor, not replying to itself, past the read cooldown) so the focal agent
  // doesn't get to talk out of turn just because it has a job to do.
  maybeTakeFocalTurn(
    game: Game,
    now: number,
    conversation: Conversation,
    player: Player,
  ): boolean {
    const sc = this.activeScenario(game);
    if (!sc || (sc.outcome ?? 'tasks') !== 'decision') return false;
    const deliberation = sc.deliberation;
    if (!deliberation) return false;
    if (this.playerId !== deliberation.focalPlayerId) return false;
    // Options not generated yet, or already committed — nothing to deliberate.
    if (deliberation.options.length < 2 || deliberation.resolvedOptionId) return false;
    if (!this.isInScenarioConversation(game, conversation)) return false;
    if (!conversation.lastMessage) return false;

    const justSpoke = conversation.lastMessage.author === player.id;
    const stalled = now > conversation.lastMessage.timestamp + AWKWARD_CONVERSATION_TIMEOUT;
    const myTurn = conversation.nextSpeaker
      ? conversation.nextSpeaker === player.id || (stalled && !justSpoke)
      : !justSpoke;
    if (!myTurn) return false;
    if (justSpoke && !stalled) return false;
    if (now < conversation.lastMessage.timestamp + MESSAGE_COOLDOWN) return false;

    console.log(`${player.id} taking a focal turn in ${conversation.id}.`);
    const messageUuid = crypto.randomUUID();
    conversation.setIsTyping(now, player, messageUuid);
    this.startOperation(game, now, 'runFocalAgentTurn', {
      worldId: game.worldId,
      playerId: player.id,
      agentId: this.id,
      conversationId: conversation.id,
      messageUuid,
      gameTimeMs: now,
      scenarioId: sc.id,
    });
    return true;
  }

  // This agent's current affinity (0–100) toward another player: the stored value
  // or the family-aware default. The single lookup that lets relationships shape
  // behaviour (whom to approach, whether to accept an invite, when to drift off).
  affinityFor(game: Game, otherPlayerId: GameId<'players'>): number {
    const family: FamilyTie[] | undefined = game.agentDescriptions.get(this.id)?.family;
    const otherName = game.playerDescriptions.get(otherPlayerId)?.name;
    return affinityToward({ affinities: this.affinities, otherPlayerId, family, otherName });
  }

  // How this agent feels about the rest of a group conversation: average affinity
  // toward the other currently-participating members, plus the member they like
  // least (used to attribute a low-affinity exit). Undefined when alone.
  groupAffinityStats(
    game: Game,
    conversation: Conversation,
    selfId: GameId<'players'>,
  ): { avg: number; lowestId: GameId<'players'> } | undefined {
    const others = [...conversation.participants.entries()]
      .filter(([id, m]) => id !== selfId && m.status.kind === 'participating')
      .map(([id]) => id);
    if (others.length === 0) return undefined;
    let sum = 0;
    let lowestId = others[0];
    let lowest = Infinity;
    for (const id of others) {
      const affinity = this.affinityFor(game, id);
      sum += affinity;
      if (affinity < lowest) {
        lowest = affinity;
        lowestId = id;
      }
    }
    return { avg: sum / others.length, lowestId };
  }

  // Per-turn probability of drifting away from a group conversation, scaled by how
  // this agent feels about the other currently-participating members: dislike the
  // room → leave sooner; among friends/family → linger.
  groupLeaveProbability(stats: { avg: number } | undefined): number {
    if (!stats) return GROUP_LEAVE_PROBABILITY;
    // avg == DEFAULT_AFFINITY → unchanged; warmer → ×(1 - weight); colder → ×(1 + weight).
    const factor =
      1 + GROUP_LEAVE_AFFINITY_WEIGHT * ((DEFAULT_AFFINITY - stats.avg) / DEFAULT_AFFINITY);
    return Math.max(0.05, Math.min(0.9, GROUP_LEAVE_PROBABILITY * factor));
  }

  // If we're free and a multi-party conversation is happening nearby with room
  // under the participant cap, join it (walking over). Returns true if we joined.
  maybeJoinNearbyConversation(game: Game, now: number, player: import('./player').Player): boolean {
    if (this.inProgressOperation) return false;
    if (game.world.playerConversation(player)) return false;
    // While heading to a scenario gathering, don't get absorbed into some unrelated
    // conversation on the way — keep walking to the spot.
    if (this.scenarioTarget) return false;
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
      // You can't walk into a phone thread. Text conversations are joined by the
      // scenario manager when it opens them, never by strolling past someone.
      if (conversation.isText) continue;
      // If we're enlisted in a scenario, only ever join that scenario's own
      // conversation — never wander into an unrelated chat that's nearby.
      if (this.scenarioId && !this.isInScenarioConversation(game, conversation)) continue;
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
    // A manual hold from the agents popup doesn't survive the night, so a
    // forgotten pin can't freeze someone out of their routine for good.
    if (this.pin && this.pin.day !== gt.dayNumber) {
      delete this.pin;
    }
    const pinPoint = this.pin?.destination;
    const conversation = game.world.playerConversation(player);
    // A text thread does NOT take the agent off their schedule: they keep walking
    // their shift, keep their activity running, and reply between tasks. So we do
    // all the usual schedule work but never CLAIM the tick — returning false lets
    // Agent.tick fall through to the message logic below. We also skip every
    // branch that would start an operation (the re-plan and the invite), since
    // startOperation throws if one is already in flight and the messaging path
    // needs that slot.
    const texting = !!conversation?.isText;
    const doingActivity = player.activity && player.activity.until > now;
    // An ambient (schedule-driven) activity now runs for the whole block and
    // survives conversations, so it must NOT hold off a re-plan — otherwise
    // `scheduleNeedsRefresh`, set after every conversation, could never be acted
    // on. Only a one-off free-roam activity defers planning.
    const busyWithOneOffActivity = doingActivity && !player.activity!.ambient;

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

    // Once-per-day identity refresh: rewrite who this character has become from
    // their own reflections and memories. Lock-free — it writes a description,
    // never movement — and staggered by the day rollover it already rides.
    const lastSummaryDay = game.agentDescriptions.get(this.id)?.selfSummaryDay;
    if (
      SELF_SUMMARY_ENABLED &&
      this.selfSummaryCheckedForDay !== gt.dayNumber &&
      gt.dayNumber >= SELF_SUMMARY_FIRST_DAY &&
      (lastSummaryDay === undefined ||
        gt.dayNumber - lastSummaryDay >= SELF_SUMMARY_INTERVAL_DAYS)
    ) {
      this.selfSummaryCheckedForDay = gt.dayNumber;
      game.scheduleOperation('agentRegenerateSelfSummary', {
        worldId: game.worldId,
        agentId: this.id,
        playerId: this.playerId,
        playerName: player.name ?? 'someone',
        dayNumber: gt.dayNumber,
      });
    }

    // Once-per-day short-term bookkeeping: decay the gauges back toward baseline,
    // couple in any sickness, and pay a working day's income. Runs after the health
    // roll so sickness set today is reflected in the same day's mood/stress.
    if (this.shortTermCheckedForDay !== gt.dayNumber) {
      this.shortTermCheckedForDay = gt.dayNumber;
      this.updateShortTermForNewDay(game, gt.dayNumber, now);
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
    // Being away from the schedule's spot BECAUSE a scenario is holding the agent
    // somewhere else isn't a disruption — it's the point. Re-planning here would
    // just churn the LLM for the length of every scenario.
    const inScenarioMeeting = !!this.scenarioMeetingPoint(game);
    if (
      this.schedule &&
      this.currentStepIndex !== undefined &&
      !noSchedule &&
      !dayChanged &&
      !inScenarioMeeting &&
      !pinPoint
    ) {
      const step = this.schedule[this.currentStepIndex];
      if (step) {
        const overdueMinutes = gt.minutesIntoDay - step.startMinute;
        // Measured against the milling-about radius, not the strict arrival one:
        // an agent drifting around their workplace has reached the step, and
        // flagging that as a disruption would fire a re-plan on every wander.
        const reached = distance(player.position, step.destination) < STEP_SETTLED_RADIUS;
        if (overdueMinutes > SCHEDULE_DISRUPTION_MINUTES && !reached) {
          disrupted = true;
        }
      }
    }

    const conversationRefresh = !!this.scheduleNeedsRefresh;
    // A reaction-driven replan. It rides its own short cooldown rather than the
    // 5-minute plan cooldown below (≈5 in-game hours — long enough that the thing
    // reacted to would be ancient history) and rather than `forcePlan`, which
    // bypasses every throttle and belongs to scenario injection.
    const reactionReplan =
      !!this.reactionReplan &&
      now - (this.lastReactionReplanAt ?? 0) > REACTION_REPLAN_COOLDOWN_MS;
    const wantsPlan =
      (noSchedule || dayChanged || disrupted || conversationRefresh || reactionReplan) &&
      !conversation &&
      !busyWithOneOffActivity;
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
      const dayStart = (game.world.worldStartTime ?? now) + (gt.dayNumber - 1) * CYCLE_MS;
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
      if (forcePlan || reactionReplan || (!onCooldown && !beforeStagger)) {
        const playerName = player.name ?? 'someone';
        const home = this.home ?? (homeFor(playerName) ?? getLocationById('hdb'))!;
        const homePoint = this.home ?? { x: home.x, y: home.y };
        const homeLoc = homeFor(playerName);
        this.lastPlanAttempt = now;
        delete this.scheduleNeedsRefresh;
        delete this.forcePlan;
        if (this.reactionReplan) {
          this.lastReactionReplanAt = now;
          delete this.reactionReplan;
        }
        // Precompute the short-term self-state note so the planner can factor it in
        // (rest when exhausted, cheaper choices when money is tight).
        const shortTermNote = shortTermSelfDescription(
          buildShortTermSnapshot({
            shortTerm: this.shortTerm,
            balance: this.balance,
            health: this.health,
            now,
          }),
        );
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
          existingSchedule:
            disrupted || conversationRefresh || forcePlan || reactionReplan
              ? this.schedule
              : undefined,
          scenarioInstruction: this.scenarioInstruction,
          shortTermNote,
        });
        return true;
      }
      // Throttled: fall through to execute the existing schedule below.
    }

    if (!this.schedule || this.currentStepIndex === undefined) return false;

    const step = this.schedule[this.currentStepIndex];
    if (!step) return false;

    // Before the day's first scheduled step (early morning, before the ~7am wake):
    // head to that first location (home) and wait there. Without this we'd return
    // false and tick() would drop the agent into its free-roam branch — random
    // destination + activity. An agent freed up in this window (e.g. right after a
    // scenario ends at 6am) would then walk off to a random tile across the map and
    // look "stuck" far from anywhere it should be.
    // A running scenario outranks the pre-dawn "wait at home" hold, or the cast
    // would be walked home out from under a scenario that's still going.
    if (gt.minutesIntoDay < step.startMinute && !inScenarioMeeting && !pinPoint) {
      if (conversation && !texting) return false;
      const atStart = distance(player.position, step.destination) < ARRIVAL_RADIUS;
      if (!atStart) {
        if (
          !player.pathfinding ||
          !pointsEqual(player.pathfinding.destination, step.destination)
        ) {
          try {
            movePlayer(game, now, player, step.destination);
          } catch (err) {
            console.warn(`Pre-dawn move home failed for ${player.id}: ${(err as Error).message}`);
          }
        }
      } else if (player.pathfinding) {
        stopPlayer(player);
      }
      return !texting;
    }

    // Don't yank the agent out of an active conversation. The schedule can wait —
    // unless it's a text thread, which they carry on through.
    if (conversation && !texting) return false;

    // While a scenario is running, its meeting spot REPLACES the schedule's
    // destination. The gathering phase walks everyone here, but promotion clears
    // `scenarioTarget` (it has to — the gather branch returns before the logic that
    // starts conversations), and without this the schedule immediately marched
    // everyone back off to their own plans before anyone got a word out. Anchoring
    // here keeps the group in one place long enough to actually talk, while the
    // milling-about wander below stops them looking frozen.
    const scenarioAnchor = this.scenarioMeetingPoint(game);
    // A manual pin outranks everything else, the scenario anchor included. It's an
    // explicit instruction from the agents popup, and scenarios run often enough
    // that letting them win would make "Move here" look broken for most of the
    // cast most of the time. The pin is cleared at the day rollover, or by hand.
    const destination = pinPoint ?? scenarioAnchor ?? step.destination;
    const distanceToStep = distance(player.position, destination);
    // Two tiers. `atDest` is the strict "have I actually arrived" gate that stops
    // the walk-to-the-spot logic. `settled` is the looser "I'm here, just milling
    // about" test — an agent drifting within STEP_WANDER_RADIUS of the spot is
    // still at work, so they keep the settled invite reach rather than snapping
    // back to the narrow in-transit one every time they take a step.
    const atDest = distanceToStep < ARRIVAL_RADIUS;
    const settled = distanceToStep < STEP_SETTLED_RADIUS;

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
    // A sick agent keeps to themselves — don't initiate new conversations. Nor
    // does someone already mid-text-thread: they're occupied, and the op slot is
    // needed for their reply.
    if (
      !conversation &&
      !onInviteCooldown &&
      !justChatted &&
      !this.inProgressOperation &&
      this.health !== 'sick'
    ) {
      const freePlayers = [...game.world.players.values()].filter(
        (p) =>
          p.id !== player.id &&
          ![...game.world.conversations.values()].some((c) => c.participants.has(p.id)),
      );
      // On shift we keep social reach close to the workplace so a worker doesn't
      // trek across the map to chat and abandon their post. An agent enlisted in a
      // scenario that MEETS is exempt: a universal scenario has no gathering spot,
      // so leashed participants would never reach each other, and a lone worker
      // (James at Marina Bay Sands, the only person who works there) has a
      // permanently empty pool and would sit out the scenario entirely.
      //
      // A TEXT scenario is the opposite case — the entire premise is that they
      // stay at work — so it keeps its leash.
      const activeScenario = this.activeScenario(game);
      const scenarioMeetsInPerson = !!activeScenario && !activeScenario.viaText;
      const leashAnchor = scenarioMeetsInPerson
        ? undefined
        : workLeashAnchor(player.name, step);
      let pool: typeof freePlayers;
      if (!settled) {
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
      // Don't cross scenario boundaries — the same rule tick() applies to the
      // free-roam invite. A participant should be talking to the rest of its cast,
      // not striking up an unrelated chat with whoever wanders past the spot (and
      // an outsider mustn't be pulled into the scenario's conversation).
      pool = pool.filter((p) => {
        const other = [...game.world.agents.values()].find((a) => a.playerId === p.id);
        return this.scenarioId ? other?.scenarioId === this.scenarioId : !other?.scenarioId;
      });
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
          preferredInvitee: this.preferredInvitee,
        });
        // Consumed whether or not the invite lands: a reaction is about the
        // moment, and a stale preference would steer conversations long after
        // whatever prompted it.
        delete this.preferredInvitee;
        return !texting;
      }
    }

    // Still travelling to the spot — but only re-target if we've drifted out of the
    // milling-about zone entirely. Using the strict `atDest` here would fight the
    // wander below, dragging the agent back to the exact tile after every step.
    if (!settled) {
      // Walk to the scheduled location (or the scenario's meeting spot).
      if (!player.pathfinding || !pointsEqual(player.pathfinding.destination, destination)) {
        try {
          movePlayer(game, now, player, destination);
        } catch (err) {
          // Movement can throw if in a conversation; ignore and re-try next tick.
          console.warn(`Schedule move failed for ${player.id}: ${(err as Error).message}`);
        }
      }
      return !texting;
    }

    // At the destination — set the activity for the duration of this step.
    if (!doingActivity) {
      const nextStep = this.schedule[this.currentStepIndex + 1];
      const stepEndMinutes = nextStep ? nextStep.startMinute : 24 * 60;
      const minutesLeft = Math.max(1, stepEndMinutes - gt.minutesIntoDay);
      // Short-term accrual for settling into this step, guarded to once per step
      // (the block re-runs after a contextual micro-event expires): fatigue/hunger
      // creep up on an "away" step, or reset on a meal/sleep step. The key includes
      // the step's start time so a mid-day re-plan (which resets currentStepIndex to
      // 0) doesn't collide with an already-accrued "day:0" and skip accrual.
      const stepKey = `${gt.dayNumber}:${this.currentStepIndex}:${step.startMinute}`;
      if (this.shortTermStepKey !== stepKey) {
        this.shortTermStepKey = stepKey;
        // A step at the agent's OWN workplace is work, not a meal — even the hawker
        // workers whose workplace is the 'restaurant' and whose text mentions food.
        const isOwnWorkplace = !!workLeashAnchor(player.name, step);
        // Profile-derived fatigue reactivity (fit → tires slower, frail → faster).
        const fatigueMultiplier =
          shortTermSensitivity(game.agentDescriptions.get(this.id)?.profile).fatigue ?? 1;
        this.accrueStepShortTerm(
          game,
          step,
          minutesLeft,
          gt.dayNumber,
          now,
          isOwnWorkplace,
          fatigueMultiplier,
        );
      }
      // Game-minute → real-ms: each in-game minute lasts CYCLE_MS / (24*60).
      const realMsPerGameMinute = CYCLE_MS / (24 * 60);
      // Hierarchical plan decomposition: a coarse block ("at work, 09:00–17:00")
      // is broken into 3–5 finer actions the first time we settle into it, so the
      // agent visibly moves through their block instead of doing one thing for
      // eight hours. Purely presentational — sub-steps drive `player.activity`
      // and nothing else, never the currentStepIndex advance loop above.
      const subStep = this.currentSubStep(stepKey, gt.minutesIntoDay);
      if (subStep) {
        const subEnd = this.subStepEndMinute(stepKey, gt.minutesIntoDay, stepEndMinutes);
        player.activity = {
          description: subStep.activity,
          emoji: subStep.emoji ?? step.emoji ?? '💭',
          until: now + Math.max(1, subEnd - gt.minutesIntoDay) * realMsPerGameMinute,
          ambient: true,
        };
      } else {
        // Stage 2: sometimes swap in a short contextual micro-event tied to the
        // current block (office events during work hours, flexible ones
        // otherwise), then fall back to the block's base activity afterwards.
        // Only reachable when the block has no sub-steps — the two mechanisms
        // both exist to break up a long block, so running both would fight.
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
            ambient: true,
          };
        } else {
          player.activity = {
            description: step.activity,
            emoji: step.emoji ?? '💭',
            until: now + minutesLeft * realMsPerGameMinute,
            ambient: true,
          };
        }
        // Ask for a decomposition of this block if it's long enough to be worth
        // one and we haven't already. Fires at most once per step instance: the
        // request is stamped with the same key the result is stored under.
        this.maybeDecomposeStep(game, now, player, step, stepKey, stepEndMinutes);
      }
    }

    // Mill about rather than standing on one tile for the whole block. Without
    // this the map froze solid the moment everyone reached their schedule spot.
    // The activity keeps running throughout (it's flagged ambient above), so the
    // agent is still visibly "wiping down the counter" while they cross the shop.
    this.maybeWanderAtStep(game, now, player, step, destination);
    return !texting;
  }

  // Bookkeeping for the two gates an observation feeds: reflection (any
  // observation counts) and reacting (only salient ones are worth a completion).
  noteObserved(importance: number) {
    this.eventsSinceReflection = (this.eventsSinceReflection ?? 0) + 1;
    if (importance >= REACTION_MIN_IMPORTANCE) {
      this.salientSinceReaction = (this.salientSinceReaction ?? 0) + 1;
    }
  }

  // --- Reacting loop ---------------------------------------------------------
  //
  // Gated hard on having actually seen something salient. Unlike reflection this
  // one is about acting on the moment, so it also requires the agent to be free:
  // reacting to a passer-by while mid-conversation or held by a scenario would
  // fight whatever they're already committed to.
  maybeReact(game: Game, now: number, player: import('./player').Player) {
    if ((this.salientSinceReaction ?? 0) === 0) return;
    if (now - (this.lastReactionAt ?? 0) < REACTION_INTERVAL_MS) return;
    if (this.inProgressOperation) return;
    if (game.world.playerConversation(player)) return;
    if (this.isHeldByScenario(game) || this.scenarioTarget) return;
    // Optimistic stamp: the op is lock-free, so nothing else prevents a re-fire
    // during the action's latency.
    this.lastReactionAt = now;
    this.salientSinceReaction = 0;
    const step =
      this.schedule && this.currentStepIndex !== undefined
        ? this.schedule[this.currentStepIndex]
        : undefined;
    const activity =
      player.activity && player.activity.until > now ? player.activity.description : undefined;
    const nearbyNames = [...game.world.players.values()]
      .filter((p) => p.id !== player.id)
      .filter((p) => distance(p.position, player.position) < SCHEDULE_CHAT_RADIUS)
      .map((p) => p.name ?? game.playerDescriptions.get(p.id)?.name ?? 'someone');
    game.scheduleOperation('agentReact', {
      worldId: game.worldId,
      agentId: this.id,
      playerId: this.playerId,
      playerName: player.name ?? 'someone',
      currentActivity: activity,
      currentPlace: step ? getLocationById(step.locationId)?.name : undefined,
      shortTermNote: shortTermSelfDescription(
        buildShortTermSnapshot({
          shortTerm: this.shortTerm,
          balance: this.balance,
          health: this.health,
          now,
        }),
      ),
      nearbyNames,
    });
  }

  // --- Reflection ------------------------------------------------------------
  //
  // Also in the prelude, and lock-free for the same reason as perception: an
  // agent should be able to reflect while it is mid-conversation or waiting on
  // another operation. Gating reflection on the operation lock and on the end of
  // a conversation is part of why it previously almost never ran.
  maybeReflect(game: Game, now: number) {
    if (now - (this.lastReflectionCheck ?? 0) < REFLECTION_CHECK_INTERVAL_MS) return;
    if ((this.eventsSinceReflection ?? 0) < REFLECTION_MIN_EVENTS) return;
    // Floor on the gap between actual reflections, so an eventful stretch
    // produces one reflection rather than a run of them.
    const lastReflection = this.lastReflectionAt ?? game.world.worldStartTime ?? 0;
    if (now - lastReflection < REFLECTION_MIN_INTERVAL_MS) return;
    // Stamp the check optimistically: the op is lock-free, so nothing else stops
    // this from re-firing every tick for the multi-second life of the action.
    this.lastReflectionCheck = now;
    game.scheduleOperation('agentReflect', {
      worldId: game.worldId,
      agentId: this.id,
      playerId: this.playerId,
      since: this.lastReflectionAt,
    });
  }

  // --- Perception ------------------------------------------------------------
  //
  // Runs from the tick PRELUDE, before the `inProgressOperation` guard and
  // before tickSchedule claims the tick. That placement is load-bearing:
  // tickSchedule returns truthy on essentially every tick once an agent has a
  // schedule, and the states that early-return (busy on an op, held by a
  // scenario, mid-conversation) are exactly the ones worth perceiving during.
  //
  // Emits only on CHANGE, against fingerprints persisted on the Agent. They have
  // to be persisted: the Game is rebuilt from the world doc every ~30s
  // (ENGINE_ACTION_DURATION), so in-memory dedupe state would be wiped that
  // often and every subject would be re-observed from scratch.
  tickObservations(game: Game, now: number, player: import('./player').Player) {
    if (now - (this.lastObservationAt ?? 0) < OBSERVATION_INTERVAL_MS) return;
    this.lastObservationAt = now;

    const previous = new Map((this.observed ?? []).map((o) => [o.k, o.h]));
    // Computed once per pass, not per subject.
    const meanAffinity = affinityMean(this.affinities);
    // Rebuilt from scratch each pass, so subjects that leave perception range
    // are dropped — and re-emit when they come back, which is the arrival signal.
    const seen: { k: string; h: number }[] = [];
    const description = game.agentDescriptions.get(this.id);

    for (const other of game.world.players.values()) {
      if (other.id === player.id) continue;
      // Distance only: there is no line-of-sight or occlusion model anywhere in
      // this codebase, so agents perceive through walls. Keeping the radius at
      // the conversation radius keeps that from being conspicuous.
      if (distance(other.position, player.position) >= SCHEDULE_CHAT_RADIUS) continue;
      const activity =
        other.activity && other.activity.until > now ? other.activity.description : undefined;
      const location = nearestLocation(other.position);
      const key = `player:${other.id}`;
      const h = fingerprint(activity, location.id);
      seen.push({ k: key, h });
      if (previous.get(key) === h) continue;

      const name = other.name ?? game.playerDescriptions.get(other.id)?.name ?? 'someone';
      const otherAgent = [...game.world.agents.values()].find((a) => a.playerId === other.id);
      const otherStep =
        otherAgent?.schedule && otherAgent.currentStepIndex !== undefined
          ? otherAgent.schedule[otherAgent.currentStepIndex]
          : undefined;
      const atWork = !!workLeashAnchor(name, otherStep);
      const atHome = homeFor(name)?.id === location.id;
      const importance = observationImportance({
        family: description?.family,
        subjectName: name,
        affinity: this.affinityFor(game, other.id as GameId<'players'>),
        affinityMean: meanAffinity,
        outOfPlace: !atWork && !atHome,
        subjectSick: otherAgent?.health === 'sick',
      });
      const kept = game.emitObservation({
        playerId: this.playerId,
        at: now,
        description: observationText({ name, activity, locationName: location.name }),
        importance,
        subjectPlayerIds: [other.id],
        locationId: location.id,
        processed: false,
        promoted: false,
      });
      // Dropped by the per-step cap: leave the fingerprint un-advanced so we
      // re-emit next pass rather than silently losing the change.
      if (!kept) seen.pop();
      else this.noteObserved(importance);
    }

    // Conversations happening in range that we're not part of. This is what lets
    // an agent know who is spending time with whom without being told.
    for (const conversation of game.world.conversations.values()) {
      if (conversation.participants.has(player.id)) continue;
      const participants = [...conversation.participants.keys()]
        .map((pid) => game.world.players.get(pid))
        .filter((p): p is import('./player').Player => !!p);
      if (participants.length < 2) continue;
      if (!participants.some((p) => distance(p.position, player.position) < SCHEDULE_CHAT_RADIUS)) {
        continue;
      }
      const key = `conv:${conversation.id}`;
      const names = participants.map(
        (p) => p.name ?? game.playerDescriptions.get(p.id)?.name ?? 'someone',
      );
      const location = nearestLocation(participants[0].position);
      const h = fingerprint(names.join(','), location.id);
      seen.push({ k: key, h });
      if (previous.get(key) === h) continue;
      const importance = observationImportance({
        family: description?.family,
        subjectName: names[0],
        affinity: this.affinityFor(game, participants[0].id as GameId<'players'>),
        affinityMean: meanAffinity,
        groupSize: participants.length,
      });
      const kept = game.emitObservation({
        playerId: this.playerId,
        at: now,
        description: conversationObservationText(names, location.name),
        importance,
        subjectPlayerIds: participants.map((p) => p.id),
        locationId: location.id,
        processed: false,
        promoted: false,
      });
      if (!kept) seen.pop();
      else this.noteObserved(importance);
    }

    this.observed = seen.slice(0, MAX_OBSERVED_SUBJECTS);
  }

  // --- Hierarchical plan decomposition -------------------------------------
  //
  // Sub-steps hang off the Agent rather than off ScheduleStep on purpose. On the
  // step they would enter the `scheduleStep` validator (and so the world doc for
  // every step of every agent), `mergeFixedObligations` would duplicate them
  // when it splits a block around a work shift, and `existingSchedule` feeds the
  // schedule back to the day planner as context — which would then see and echo
  // its own sub-steps. One slot, keyed by step instance, avoids all three.

  // The sub-step covering `minutesIntoDay`, or undefined when this block has no
  // decomposition (stale key, never requested, or the request failed).
  currentSubStep(stepKey: string, minutesIntoDay: number): SubStep | undefined {
    if (!this.activeSubSteps || this.activeSubSteps.stepKey !== stepKey) return undefined;
    const steps = this.activeSubSteps.steps;
    let current: SubStep | undefined;
    for (const s of steps) {
      if (s.startMinute <= minutesIntoDay) current = s;
      else break;
    }
    return current;
  }

  // When the current sub-step gives way to the next one, bounded by the parent
  // block's end so a sub-step can never outlive the block it decomposes.
  subStepEndMinute(stepKey: string, minutesIntoDay: number, stepEndMinutes: number): number {
    if (!this.activeSubSteps || this.activeSubSteps.stepKey !== stepKey) return stepEndMinutes;
    const next = this.activeSubSteps.steps.find((s) => s.startMinute > minutesIntoDay);
    return Math.min(next ? next.startMinute : stepEndMinutes, stepEndMinutes);
  }

  maybeDecomposeStep(
    game: Game,
    now: number,
    player: import('./player').Player,
    step: ScheduleStep,
    stepKey: string,
    stepEndMinutes: number,
  ) {
    if (this.inProgressOperation) return;
    // Already decomposed, or a request for this exact step instance is in flight.
    if (this.activeSubSteps?.stepKey === stepKey) return;
    if (this.subStepsRequestedFor === stepKey) return;
    // A scenario owns the agent's activity while it runs — don't fight it.
    if (this.scenarioId || this.scenarioInstruction) return;
    const blockMinutes = stepEndMinutes - step.startMinute;
    if (blockMinutes < SUBSTEP_MIN_BLOCK_MINUTES) return;
    // Stamp the request optimistically so a slow op can't be re-requested every
    // tick while it's in flight.
    this.subStepsRequestedFor = stepKey;
    this.startOperation(game, now, 'agentDecomposeStep', {
      worldId: game.worldId,
      agentId: this.id,
      playerName: player.name ?? 'someone',
      stepKey,
      activity: step.activity,
      description: step.description,
      locationId: step.locationId,
      startMinute: step.startMinute,
      endMinute: stepEndMinutes,
    });
  }

  // The spot this agent's running scenario meets at, while it's actually running.
  // Acts as a temporary stand-in for the schedule's destination so the cast stays
  // together for the length of the scenario instead of dispersing the instant the
  // gathering phase ends. Undefined once the scenario is over, freeing them to
  // resume their day.
  scenarioMeetingPoint(game: Game): Point | undefined {
    const sc = this.activeScenario(game);
    if (!sc || sc.phase !== 'active') return undefined;
    if (sc.gatherX === undefined || sc.gatherY === undefined) return undefined;
    return { x: sc.gatherX, y: sc.gatherY };
  }

  // Pick a fresh tile near where the agent is meant to be every so often, so a
  // settled agent drifts around their workplace (or the scenario's meeting spot)
  // instead of freezing. Deliberately does nothing while asleep (staying in bed is
  // correct), while already walking, or while a scenario is holding them in place.
  maybeWanderAtStep(
    game: Game,
    now: number,
    player: import('./player').Player,
    step: ScheduleStep,
    center: Point,
  ): void {
    if (player.pathfinding) return;
    if (this.isHeldByScenario(game)) return;
    // Standing and talking to someone stops the drift; texting doesn't — they're
    // still going about their shift with a phone in hand.
    const convo = game.world.playerConversation(player);
    if (convo && !convo.isText) return;
    if (isSleepStep(step)) return;
    if (this.lastWanderAt && now < this.lastWanderAt + STEP_WANDER_INTERVAL_MS) return;
    // Jitter the next one so a room full of agents doesn't step in lockstep.
    this.lastWanderAt = now + Math.floor(Math.random() * STEP_WANDER_INTERVAL_MS);
    const waypoint = pickParkWaypoint(center, STEP_WANDER_RADIUS, game.worldMap);
    if (!waypoint || pointsEqual(waypoint, player.position)) return;
    try {
      movePlayer(game, now, player, waypoint);
    } catch (err) {
      console.warn(`Wander move failed for ${player.id}: ${(err as Error).message}`);
    }
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
      lastWanderAt: this.lastWanderAt,
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
      scenarioConflict: this.scenarioConflict,
      affinities: this.affinities,
      lastAffinityChange: this.lastAffinityChange,
      shortTerm: this.shortTerm,
      balance: this.balance,
      shortTermCheckedForDay: this.shortTermCheckedForDay,
      lastMealDay: this.lastMealDay,
      shortTermStepKey: this.shortTermStepKey,
      lastShortTermChange: this.lastShortTermChange,
      learnedTraits: this.learnedTraits,
      pin: this.pin,
      activeSubSteps: this.activeSubSteps,
      subStepsRequestedFor: this.subStepsRequestedFor,
      observed: this.observed,
      lastObservationAt: this.lastObservationAt,
      lastReflectionAt: this.lastReflectionAt,
      lastReflectionCheck: this.lastReflectionCheck,
      eventsSinceReflection: this.eventsSinceReflection,
      lastReactionAt: this.lastReactionAt,
      salientSinceReaction: this.salientSinceReaction,
      reactionReplan: this.reactionReplan,
      lastReactionReplanAt: this.lastReactionReplanAt,
      reactReplansToday: this.reactReplansToday,
      reactReplansDay: this.reactReplansDay,
      preferredInvitee: this.preferredInvitee,
      selfSummaryCheckedForDay: this.selfSummaryCheckedForDay,
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

  // --- Short-term memory: once-per-day bookkeeping ---
  // Decay each gauge toward its baseline, bleed any sickness into mood/stress, and
  // credit a working day's income. Called once per game-day from tickSchedule.
  updateShortTermForNewDay(game: Game, dayNumber: number, now: number) {
    const before = this.shortTerm ?? defaultShortTerm(now);
    let st = decayTowardBaseline(before, SHORT_TERM_DAILY_DECAY, now);
    // Logged as two separate transitions rather than one net change: decay and
    // the illness penalty pull mood in opposite directions, and a single event
    // showing their sum would make both of them look wrong.
    for (const component of SHORT_TERM_COMPONENTS) {
      game.emitShortTermEvent({
        at: now,
        playerId: this.playerId,
        component,
        delta: st[component] - before[component],
        valueBefore: before[component],
        valueAfter: st[component],
        cause: 'dailyDecay',
        reason: `day ${dayNumber} rollover`,
        scenarioId: this.scenarioId,
      });
    }
    if (this.health === 'sick') {
      const beforeSickness = st;
      st = {
        ...st,
        stress: clampGauge(st.stress + SICK_STRESS_PER_DAY),
        mood: clampGauge(st.mood - SICK_MOOD_PENALTY_PER_DAY),
      };
      for (const component of ['stress', 'mood'] as ShortTermComponent[]) {
        game.emitShortTermEvent({
          at: now,
          playerId: this.playerId,
          component,
          delta: st[component] - beforeSickness[component],
          valueBefore: beforeSickness[component],
          valueAfter: st[component],
          cause: 'sickness',
          reason: 'unwell',
          scenarioId: this.scenarioId,
        });
      }
    }
    this.shortTerm = st;
    // Economics: a working weekday pays income (weekends and sick days earn
    // nothing), while living expenses come out every day. The net over a week is
    // near-neutral, so financial pressure only builds after a shock (e.g. illness)
    // or a run of costly choices — a live signal, not a runaway drain.
    //
    // Pay lands FIRST, then expenses are drawn through `spend`, which floors the
    // balance at zero. Clamping the stored balance up front also heals worlds that
    // were already running when the ledger was insolvent, so an existing save
    // recovers on its next day rollover instead of needing a wipe.
    const income = isWeekday(dayNumber) && this.health !== 'sick' ? DAILY_INCOME : 0;
    const afterPay = Math.max(0, this.balance ?? DEFAULT_BALANCE) + income;
    this.balance = spend(afterPay, DAILY_EXPENSES).balance;
  }

  // Short-term accrual when the agent settles into a schedule step: reset hunger on
  // a meal (and pay for it) or fatigue on sleep; otherwise fatigue/hunger creep up,
  // more for a demanding "work" block. `gameMinutesInStep` sizes the hunger creep.
  // `isOwnWorkplace` marks a shift at the agent's OWN workplace (so a hawker worker
  // at the 'restaurant' counts as work, never a meal); `fatigueMultiplier` is the
  // profile-derived reactivity (fit tires slower, frail faster).
  accrueStepShortTerm(
    game: Game,
    step: ScheduleStep,
    gameMinutesInStep: number,
    dayNumber: number,
    now: number,
    isOwnWorkplace: boolean,
    fatigueMultiplier: number,
  ) {
    const before = this.shortTerm ?? defaultShortTerm(now);
    const st = { ...before };
    // The two gauges this step can move carry different causes — sleeping is
    // rest, eating is a meal, everything else is activity — so they are tracked
    // separately rather than logged under one label for the whole step.
    let fatigueCause: 'rest' | 'activity' = 'activity';
    let hungerCause: 'meal' | 'activity' = 'activity';
    const text = `${step.activity} ${step.description}`.toLowerCase();
    const isHome = step.locationId === 'home' || step.locationId === 'hdb';
    const isSleep = isSleepStep(step);
    // A shift at the agent's own workplace is work — never a meal — even if it's the
    // hawker stall (locationId 'restaurant') or the text mentions food/kopi.
    const isMeal =
      !isOwnWorkplace &&
      /\b(lunch|dinner|breakfast|brunch|supper|eat|eating|meal|makan|hawker|food court|chicken rice|kopi|coffee|tea|prata|noodle|curry|snack)\b/.test(
        text,
      );
    let resetHunger = false;
    if (isSleep) {
      st.fatigue = FATIGUE_BASELINE;
      fatigueCause = 'rest';
    } else if (isMeal) {
      // Eating OUT: resets hunger and costs money — but only if they can actually
      // cover it. An agent who can't afford the stall eats at home instead: hunger
      // still resets (they aren't left starving on top of being broke) and nothing
      // is charged, rather than driving the balance further down.
      st.hunger = HUNGER_BASELINE;
      resetHunger = true;
      hungerCause = 'meal';
      this.lastMealDay = dayNumber;
      if (canAfford(this.balance, MEAL_COST)) {
        this.balance = spend(this.balance, MEAL_COST).balance;
      }
    } else if (isHome && !isOwnWorkplace) {
      // Settling in at home (morning, evening) means eating at home — free, and it
      // resets hunger. Without this, agents only ever eat at explicitly-detected
      // meal steps (which the LLM rarely schedules), so hunger saturated at 100.
      st.hunger = HUNGER_BASELINE;
      resetHunger = true;
      hungerCause = 'meal';
      this.lastMealDay = dayNumber;
    } else {
      const isWork =
        isOwnWorkplace ||
        (!isHome &&
          /\b(work|working|shift|office|lab|counter|kitchen|driving|deadline|meeting)\b/.test(text));
      const baseGain = isWork ? FATIGUE_PER_WORK_BLOCK : isHome ? 0 : AWAY_STEP_FATIGUE;
      st.fatigue = clampGauge(st.fatigue + baseGain * fatigueMultiplier);
    }
    // Hunger creeps with the in-game time spent this step (skipped right after a meal).
    if (!resetHunger) {
      const hours = Math.max(0, gameMinutesInStep) / 60;
      st.hunger = clampGauge(st.hunger + HUNGER_PER_GAME_HOUR * hours);
    }
    st.updatedAt = now;
    this.shortTerm = st;
    game.emitShortTermEvent({
      at: now,
      playerId: this.playerId,
      component: 'fatigue',
      delta: st.fatigue - before.fatigue,
      valueBefore: before.fatigue,
      valueAfter: st.fatigue,
      cause: fatigueCause,
      reason: step.activity,
      scenarioId: this.scenarioId,
    });
    game.emitShortTermEvent({
      at: now,
      playerId: this.playerId,
      component: 'hunger',
      delta: st.hunger - before.hunger,
      valueBefore: before.hunger,
      valueAfter: st.hunger,
      cause: hungerCause,
      reason: step.activity,
      scenarioId: this.scenarioId,
    });
  }
}

export const subStep = v.object({
  startMinute: v.number(),
  activity: v.string(),
  emoji: v.optional(v.string()),
});

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
  // Throttle for the milling-about wander around a schedule spot.
  lastWanderAt: v.optional(v.number()),
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
  scenarioConflict: v.optional(v.string()),
  // Directional affinity toward other players, keyed by player id (0–100).
  affinities: v.optional(v.record(v.string(), v.number())),
  // Most recent affinity shift, for the transient map indicator.
  lastAffinityChange: v.optional(v.object({ at: v.number(), net: v.number() })),
  // --- Short-term memory (see convex/aiTown/shortTerm.ts) ---
  shortTerm: v.optional(
    v.object({
      mood: v.number(),
      stress: v.number(),
      fatigue: v.number(),
      hunger: v.number(),
      updatedAt: v.number(),
    }),
  ),
  // Savings balance for the economic model (financial pressure is derived).
  balance: v.optional(v.number()),
  // Day-scoped guards for once-per-day decay/income and meal-driven hunger reset.
  shortTermCheckedForDay: v.optional(v.number()),
  lastMealDay: v.optional(v.number()),
  // Per-step accrual guard (`${dayNumber}:${currentStepIndex}`).
  shortTermStepKey: v.optional(v.string()),
  // Most recent short-term shift, for a transient map indicator.
  lastShortTermChange: v.optional(v.object({ at: v.number(), net: v.number() })),
  // Durable self-learned traits promoted from reflection (separate from profile).
  learnedTraits: v.optional(v.array(v.string())),
  // Manual "hold this character here" override set from the agents popup.
  pin: v.optional(v.object({ destination: point, locationId: v.string(), day: v.number() })),
  // Sub-steps for the current schedule block only (see Agent.maybeDecomposeStep).
  activeSubSteps: v.optional(v.object({ stepKey: v.string(), steps: v.array(subStep) })),
  subStepsRequestedFor: v.optional(v.string()),
  // Perception dedupe state (see Agent.tickObservations).
  observed: v.optional(v.array(observedFingerprint)),
  lastObservationAt: v.optional(v.number()),
  // Reflection cadence (see Agent.maybeReflect).
  lastReflectionAt: v.optional(v.number()),
  lastReflectionCheck: v.optional(v.number()),
  eventsSinceReflection: v.optional(v.number()),
  // Reacting loop (see Agent.maybeReact).
  lastReactionAt: v.optional(v.number()),
  salientSinceReaction: v.optional(v.number()),
  reactionReplan: v.optional(v.boolean()),
  lastReactionReplanAt: v.optional(v.number()),
  reactReplansToday: v.optional(v.number()),
  reactReplansDay: v.optional(v.number()),
  preferredInvitee: v.optional(playerId),
  selfSummaryCheckedForDay: v.optional(v.number()),
};
export type SerializedAgent = ObjectType<typeof serializedAgent>;

// Operations an agent can start under its `inProgressOperation` lock. Mostly the
// agentOperations module, plus the focal turn, which lives in convex/focal.ts
// because it belongs to the decision engine rather than to generic agent
// behaviour. The lock-free decision ops (generateDecisionOptions,
// evaluateFinalDecision) go through game.scheduleOperation directly and so don't
// need to appear here.
//
// The focal entry spells its args out rather than writing
// `typeof internal.focal.runFocalAgentTurn`. Referring to another module's api
// type from inside a generic constraint makes the api type graph circular
// (focal.ts -> agent/conversation.ts -> ... -> agent.ts), at which point
// TypeScript quietly degrades half the repo's inferred query types to `any`.
// This is the same circular-import hazard the `import type` on
// SerializedActiveScenario above exists to avoid.
type FocalTurnOperation = FunctionReference<
  'action',
  'internal',
  {
    worldId: Id<'worlds'>;
    agentId: string;
    playerId: string;
    conversationId: string;
    operationId: string;
    messageUuid: string;
    gameTimeMs: number;
    scenarioId: string;
  }
>;
type AgentOperations = typeof internal.aiTown.agentOperations & {
  runFocalAgentTurn: FocalTurnOperation;
};

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
    case 'agentDecomposeStep':
      reference = internal.aiTown.agentOperations.agentDecomposeStep;
      break;
    case 'agentReflect':
      reference = internal.aiTown.agentOperations.agentReflect;
      break;
    case 'agentReact':
      reference = internal.aiTown.agentOperations.agentReact;
      break;
    case 'agentRegenerateSelfSummary':
      reference = internal.aiTown.agentOperations.agentRegenerateSelfSummary;
      break;
    case 'agentExtractScenarioProfile':
      reference = internal.aiTown.agentOperations.agentExtractScenarioProfile;
      break;
    case 'agentRememberScenario':
      reference = internal.aiTown.agentOperations.agentRememberScenario;
      break;
    case 'agentPlanScenarioTasks':
      reference = internal.aiTown.agentOperations.agentPlanScenarioTasks;
      break;
    // Decision-scenario engine (convex/decider.ts, focal.ts, evaluator.ts). These
    // live outside aiTown/ because they are self-contained modules rather than
    // agent behaviours; this switch is just a name -> reference map, so it doesn't
    // care where they are.
    case 'generateDecisionOptions':
      reference = internal.decider.generateDecisionOptions;
      break;
    case 'runFocalAgentTurn':
      reference = internal.focal.runFocalAgentTurn;
      break;
    case 'evaluateFinalDecision':
      reference = internal.evaluator.evaluateFinalDecision;
      break;
    case 'generateAndStartScenario':
      reference = internal.scenarioGen.generateAndStartScenario;
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
    // The active-scenario instance id the speaker was enlisted in (if any), stamped
    // onto the message so scenario participants can read its cross-conversation history.
    scenarioId: v.optional(v.string()),
    operationId: v.string(),
    // The participant the dialogue orchestrator wants to speak next (omitted when
    // leaving or when the floor should be open, e.g. only humans remain).
    nextSpeaker: v.optional(playerId),
    // For scenario conversations: whether the goal-judge deemed the goal met, and
    // the 0-based indices of scenario topics it judged substantively covered.
    goalMet: v.optional(v.boolean()),
    coveredTopics: v.optional(v.array(v.number())),
    // Present only for a focal agent's deliberation turn (convex/focal.ts): the
    // estimates it just produced and whether it committed to an option.
    focal: v.optional(focalTurnDelta),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      text: args.text,
      messageUuid: args.messageUuid,
      worldId: args.worldId,
      scenarioId: args.scenarioId,
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
      focal: args.focal,
    });
  },
});

export const findConversationCandidate = internalQuery({
  args: {
    now: v.number(),
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    // Set by the reacting loop when the agent decided to go and talk to someone
    // specific. A preference, not an override: if they're on the pair cooldown or
    // no longer free, we fall through to the usual affinity-vs-distance pick
    // rather than forcing a conversation that the rest of the system would refuse.
    preferredInvitee: v.optional(playerId),
  },
  handler: async (ctx, { now, worldId, player, otherFreePlayers, preferredInvitee }) => {
    const { position } = player;

    // Load our affinities + family so relationships bias who we approach: we'll
    // happily cross the room for a friend and skip someone nearby we dislike.
    const world = await ctx.db.get(worldId);
    const selfAgent = world?.agents.find((a) => a.playerId === player.id);
    const affinities = selfAgent?.affinities;
    let family: FamilyTie[] | undefined;
    if (selfAgent) {
      const desc = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', worldId).eq('agentId', selfAgent.id))
        .first();
      family = desc?.family;
    }

    // Weight distance more heavily when this agent is tired or stressed, so a
    // worn-out character prefers nearby, low-effort company over trekking across
    // the map for someone they merely like (spec point 5).
    const selfSnap = buildShortTermSnapshot({
      shortTerm: selfAgent?.shortTerm,
      balance: selfAgent?.balance,
      health: selfAgent?.health,
      now,
    });
    // Measure weariness ABOVE the resting baseline so a fresh agent behaves exactly
    // as before (no distance penalty at rest); only genuine tiredness/stress adds one.
    const weariness = Math.max(
      0,
      (selfSnap.fatigue - FATIGUE_BASELINE + (selfSnap.stress - STRESS_BASELINE)) / 2,
    );
    const distanceWeight = CANDIDATE_AFFINITY_WEIGHT + CANDIDATE_FATIGUE_DISTANCE_WEIGHT * weariness;

    // Pick the candidate with the best affinity-vs-distance score (off cooldown).
    let best: { id: GameId<'players'>; score: number } | undefined;
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
      const affinity = affinityToward({
        affinities,
        otherPlayerId: otherPlayer.id,
        family,
        otherName: otherPlayer.name,
      });
      // Past the pair cooldown above, so this really is someone we may approach.
      if (preferredInvitee && otherPlayer.id === preferredInvitee) {
        return otherPlayer.id as GameId<'players'>;
      }
      const score = affinity - distanceWeight * distance(position, otherPlayer.position);
      if (!best || score > best.score) {
        best = { id: otherPlayer.id as GameId<'players'>, score };
      }
    }
    return best?.id;
  },
});
