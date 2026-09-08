import { v } from 'convex/values';
import { agentId, conversationId, parseGameId, playerId } from './ids';
import { Player, activity } from './player';
import { Conversation, conversationInputs } from './conversation';
import { blockedWithPositions, movePlayer, stopPlayer } from './movement';
import { inputHandler } from './inputHandler';
import { point } from '../util/types';
import { Descriptions } from '../../data/characters';
import { AgentDescription } from './agentDescription';
import { Agent, scheduleStep, subStep } from './agent';
import { affinityToward, clampAffinity } from './affinity';
import { applyFocalTurn, focalTurnDelta, serializedDecisionOption } from './deliberation';
import {
  applyShortTermDeltas,
  clampGauge,
  shortTermOrDefault,
  shortTermSensitivity,
  spend,
  SHORT_TERM_COMPONENTS,
  type ShortTermComponent,
  type ShortTermDelta,
} from './shortTerm';
import { shortTermCause } from './shortTermEvents';
import {
  CONTEXTUAL_EVENT_MINUTES,
  MAX_LEARNED_TRAITS,
  MAX_REACT_REPLANS_PER_DAY,
  SCENARIO_CUSTOM_MIN_PARTICIPANTS,
  SICK_DURATION_DAYS,
} from '../constants';
import { injectCatalogScenario, pickScenarioParticipants, startScenario } from './scenarios';
import { serializedGeneratedScenario, toScenarioDef } from './generatedScenario';
import { scenarioById } from '../../data/scenarios';
import { CITY_LOCATIONS, getLocationById, homeFor } from '../../data/cityLocations';
import { mergeFixedObligations } from '../../data/routines';
import { computeGameTime, CYCLE_MS } from './gameTime';
import { SCENARIO_WORK_MAX_MS, SCENARIO_INTERVAL_MIN_MS, SCENARIO_RETRY_MS } from '../constants';
import type { SerializedActiveScenario } from './world';
import type { Game } from './game';

// Inject a custom scenario: enlist a group, force them to re-plan around it (which
// naturally walks them to wherever it calls them — no special movement code), and
// surface it in the on-screen scenarios panel. Shared by the custom-scenario
// injector and the "meet at the park" button.
//
// `everyone` opts out of the group selection for scenarios that genuinely are
// town-wide (the meet-at-the-park gathering). By default a custom scenario picks a
// cast the same way an automatic one does, so it happens to some residents rather
// than sweeping in all eight every time.
function injectScenario(
  game: Game,
  now: number,
  opts: {
    instruction: string;
    name: string;
    emoji: string;
    background: string;
    everyone?: boolean;
  },
) {
  game.world.scenarioInstruction = opts.instruction;
  game.world.scenarioStartTime = now;
  // End ongoing conversations so agents are immediately free to react.
  for (const conversation of [...game.world.conversations.values()]) {
    conversation.stop(game, now);
  }
  const allAgents = [...game.world.agents.values()];
  // Clear EVERY agent's automatic-scenario state first: we replace
  // `activeScenarios` below, so leaving a non-participant pointed at a removed
  // entry would strand them (Agent.tick's gather branch keeps walking them back to
  // a workplace for a scenario that no longer exists).
  for (const agent of allAgents) {
    delete agent.scenarioId;
    delete agent.scenarioName;
    delete agent.scenarioTopics;
    delete agent.scenarioGoal;
    delete agent.scenarioConflict;
    delete agent.scenarioTarget;
    delete agent.scenarioArrivalTime;
    delete agent.scenarioInstruction;
    // Drop any stale scenario-relevant background; the next tick re-extracts.
    delete agent.scenarioProfile;
    delete agent.scenarioProfileFor;
    delete agent.toRemember;
    delete agent.inProgressOperation;
  }

  const cast = opts.everyone
    ? allAgents
    : pickScenarioParticipants(game, allAgents, SCENARIO_CUSTOM_MIN_PARTICIPANTS);
  for (const agent of cast) {
    agent.scenarioInstruction = opts.instruction;
    // Force an immediate re-plan that incorporates the scenario (bypassing the
    // plan cooldown/stagger) so every participant reacts at once.
    agent.scheduleNeedsRefresh = true;
    agent.forcePlan = true;
    delete agent.lastPlanAttempt;
    const player = game.world.players.get(agent.playerId);
    if (player) {
      delete player.activity;
      if (player.pathfinding) stopPlayer(player);
    }
  }

  // Surface it in the scenarios panel (the automatic manager skips 'manual'
  // entries — they live and die with the global scenarioInstruction above).
  const participantIds = cast.map((a) => a.playerId);
  // Agents adopt the global directive by checking this list, so the scenario stays
  // with its cast instead of spreading to the whole town on the next tick.
  game.world.scenarioParticipantIds = participantIds;
  const participantNames = participantIds.map(
    (pid) => game.playerDescriptions.get(pid)?.name ?? 'Someone',
  );
  const manualEntry: SerializedActiveScenario = {
    id: `manual-${now}`,
    defId: 'manual',
    scope: 'universal',
    name: opts.name,
    emoji: opts.emoji,
    instruction: opts.instruction,
    whatHappens: opts.instruction,
    background: opts.background,
    relationships: opts.everyone
      ? 'Everyone in town is caught up in it.'
      : `The people caught up in it: ${participantNames.join(', ')}.`,
    context: opts.everyone
      ? 'Happening right now, town-wide.'
      : `Happening right now to ${participantNames.join(', ')}.`,
    goals: 'React to the situation in character and let it reshape the rest of your day.',
    participantIds,
    participantNames,
    startTime: now,
    // Manual scenarios have no gathering phase — the cast reacts wherever they are
    // and it ends with the global scenarioInstruction.
    contentStartTime: now,
    phase: 'active',
    endTime: now + CYCLE_MS,
  };
  // A town-wide scenario takes over completely: replace any existing entries
  // (including a half-finished automatic one we just cleared off the agents above).
  game.world.activeScenarios = [manualEntry];
}

export const agentInputs = {
  finishPlanDay: inputHandler({
    args: {
      operationId: v.string(),
      agentId,
      schedule: v.array(scheduleStep),
      dayNumber: v.number(),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} didn't have ${args.operationId} in progress`);
        return null;
      }
      delete agent.inProgressOperation;
      const player = game.world.players.get(agent.playerId);
      const characterName = player?.name ?? '';
      // Overlay deterministic fixed obligations (work shifts, Sunday service) on
      // top of the LLM plan so rigid routines land at exact times — UNLESS a
      // MANUAL scenario is active (scenarioInstruction set but no scenarioId).
      // Those are the town-wide gatherings that should take over the whole day, so
      // we let their re-planned schedule stand instead of having the work shift
      // override (and fight) the gathering during work hours. Automatic scenarios
      // (which carry a scenarioId) keep their obligations — a local work scenario
      // like a lab crunch wants the worker pinned at their workplace.
      const manualScenarioActive = !!agent.scenarioInstruction && !agent.scenarioId;
      agent.schedule = manualScenarioActive
        ? args.schedule
        : mergeFixedObligations(characterName, args.dayNumber, args.schedule);
      agent.scheduleGeneratedForDay = args.dayNumber;
      agent.currentStepIndex = 0;
      return null;
    },
  }),
  finishRememberConversation: inputHandler({
    args: {
      operationId: v.string(),
      agentId,
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} isn't remembering ${args.operationId}`);
      } else {
        delete agent.inProgressOperation;
        delete agent.toRemember;
        // Flag the schedule for refresh so the agent re-plans in light of
        // whatever was discussed during the conversation.
        agent.scheduleNeedsRefresh = true;
      }
      return null;
    },
  }),
  finishDoSomething: inputHandler({
    args: {
      operationId: v.string(),
      agentId: v.id('agents'),
      destination: v.optional(point),
      invitee: v.optional(v.id('players')),
      activity: v.optional(activity),
      // Cost (local dollars) of the chosen free-roam activity, deducted from the
      // agent's balance so discretionary spending feeds financial pressure.
      activityCost: v.optional(v.number()),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} didn't have ${args.operationId} in progress`);
        return null;
      }
      delete agent.inProgressOperation;
      const player = game.world.players.get(agent.playerId)!;
      if (args.invitee) {
        const inviteeId = parseGameId('players', args.invitee);
        const invitee = game.world.players.get(inviteeId);
        if (!invitee) {
          throw new Error(`Couldn't find player: ${inviteeId}`);
        }
        Conversation.start(game, now, player, invitee);
        agent.lastInviteAttempt = now;
      }
      if (args.destination) {
        movePlayer(game, now, player, args.destination);
      }
      if (args.activity) {
        player.activity = args.activity;
        if (args.activityCost && args.activityCost > 0) {
          // pickActivity already filters out options the agent can't cover, but
          // debit through `spend` regardless so the balance can never go negative
          // if the balance moved between choosing and committing.
          agent.balance = spend(agent.balance, args.activityCost).balance;
        }
      }
      return null;
    },
  }),
  agentFinishSendingMessage: inputHandler({
    args: {
      agentId,
      conversationId,
      timestamp: v.number(),
      operationId: v.string(),
      leaveConversation: v.boolean(),
      isGoalSummary: v.optional(v.boolean()),
      nextSpeaker: v.optional(playerId),
      goalMet: v.optional(v.boolean()),
      coveredTopics: v.optional(v.array(v.number())),
      // Present only for a focal agent's deliberation turn (convex/focal.ts).
      focal: v.optional(focalTurnDelta),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      const player = game.world.players.get(agent.playerId);
      if (!player) {
        throw new Error(`Couldn't find player: ${agent.playerId}`);
      }
      const conversationId = parseGameId('conversations', args.conversationId);
      const conversation = game.world.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Couldn't find conversation: ${conversationId}`);
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} wasn't sending a message ${args.operationId}`);
        return null;
      }
      delete agent.inProgressOperation;
      conversationInputs.finishSendingMessage.handler(game, now, {
        playerId: agent.playerId,
        conversationId: args.conversationId,
        timestamp: args.timestamp,
      });
      // finishSendingMessage clears nextSpeaker (open floor); the orchestrator's
      // choice from this turn re-sets it so the designated agent speaks next.
      if (args.nextSpeaker && !args.leaveConversation) {
        conversation.nextSpeaker = parseGameId('players', args.nextSpeaker);
      }
      // Latch the scenario goal as met so the termination logic lets participants
      // wrap up (once the per-scenario minimum message count is reached).
      if (args.goalMet) {
        conversation.scenarioGoalMet = true;
      }
      // Record that the one-off goal summary has been spoken, so no one repeats it.
      if (args.isGoalSummary) {
        conversation.goalSummaryPosted = true;
      }
      // Mirror the goal-judge's progress onto the active-scenario entry so the UI
      // can show which tasks are done and whether the goal is achieved. We also
      // stamp the time each task/goal first completed so the chat can drop an inline
      // completion marker at the right point in the timeline.
      if (agent.scenarioId && (args.goalMet || (args.coveredTopics?.length ?? 0) > 0)) {
        const sc = (game.world.activeScenarios ?? []).find((s) => s.id === agent.scenarioId);
        if (sc) {
          if (args.goalMet) {
            sc.goalMet = true;
            sc.goalMetAt = sc.goalMetAt ?? now;
          }
          if (args.coveredTopics && args.coveredTopics.length > 0) {
            const done = sc.topicsDone ?? (sc.topics ?? []).map(() => false);
            const doneAt = sc.topicsDoneAt ?? (sc.topics ?? []).map(() => 0);
            for (const i of args.coveredTopics) {
              if (i >= 0 && i < done.length) {
                if (!done[i]) doneAt[i] = now; // record the first-completion time
                done[i] = true;
              }
            }
            sc.topicsDone = done;
            sc.topicsDoneAt = doneAt;
          }
        }
      }
      // Record the focal agent's deliberation turn: its fresh estimates, which
      // stopping criteria are still blocking, and — if it committed — the option
      // the group has landed on. tickScenarios picks the resolution up from here
      // and schedules the evaluation.
      if (args.focal && agent.scenarioId) {
        const sc = (game.world.activeScenarios ?? []).find((s) => s.id === agent.scenarioId);
        if (sc?.deliberation) {
          applyFocalTurn(sc.deliberation, args.focal, now);
        }
      }
      if (args.leaveConversation) {
        conversation.leave(game, now, player);
      }
      return null;
    },
  }),
  // Result of the Decider's option-generation op: the concrete candidates the
  // group will choose between. Fired once per decision scenario, lock-free — so
  // there is no operation lock to release here.
  finishGenerateDecisionOptions: inputHandler({
    args: {
      scenarioId: v.string(),
      options: v.array(serializedDecisionOption),
    },
    handler: (game, _now, args) => {
      const sc = (game.world.activeScenarios ?? []).find((s) => s.id === args.scenarioId);
      if (!sc?.deliberation || sc.deliberation.options.length > 0) {
        return null;
      }
      if (args.options.length < 2) {
        // Nothing usable came back. Clear the guard so a later tick can retry;
        // meanwhile maybeTakeFocalTurn stays dormant and the scenario runs as an
        // ordinary conversation rather than stalling.
        delete sc.deliberation.optionsRequested;
        return null;
      }
      sc.deliberation.options = args.options;
      return null;
    },
  }),
  // Result of the local-scenario task-planning op: concrete, delegated tasks. Flips
  // the scenario into its "working" phase and disperses participants to their tasks.
  finishPlanScenarioTasks: inputHandler({
    args: {
      operationId: v.string(),
      agentId,
      scenarioId: v.string(),
      tasks: v.array(
        v.object({
          label: v.string(),
          emoji: v.string(),
          assigneeId: v.string(),
          durationMs: v.number(),
        }),
      ),
    },
    handler: (game, now, args) => {
      const agentGameId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentGameId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentGameId}`);
      }
      // Release the planner's operation lock (mirrors finishDoSomething).
      if (agent.inProgressOperation && agent.inProgressOperation.operationId === args.operationId) {
        delete agent.inProgressOperation;
      }
      const sc = (game.world.activeScenarios ?? []).find((s) => s.id === args.scenarioId);
      // Ignore if the scenario is gone or its tasks were already delegated.
      if (!sc || sc.tasks) {
        return null;
      }
      if (args.tasks.length === 0) {
        // Planning produced nothing usable — abandon the working phase and let the
        // scenario wrap up normally. Clearing the guard also releases the hold.
        delete sc.taskPlanRequested;
        return null;
      }
      sc.tasks = args.tasks.map((t) => {
        const assigneeId = parseGameId('players', t.assigneeId);
        return {
          label: t.label,
          emoji: t.emoji,
          assigneeId,
          assigneeName: game.playerDescriptions.get(assigneeId)?.name,
          durationMs: t.durationMs,
        };
      });
      sc.phase = 'working';
      // The planning conversation's goal (agree who does what) is met, but the
      // scenario itself isn't complete until the tasks are done — reset the goal
      // flag so the panel tracks task completion, not the delegation.
      sc.goalMet = false;
      delete sc.goalMetAt;
      sc.endTime = now + SCENARIO_WORK_MAX_MS;
      // Stop any lingering scenario conversation so participants disperse to work.
      const participantSet = new Set<string>(sc.participantIds);
      for (const conversation of [...game.world.conversations.values()]) {
        let touches = false;
        for (const pid of conversation.participants.keys()) {
          if (participantSet.has(pid)) {
            touches = true;
            break;
          }
        }
        if (touches) conversation.stop(game, now);
      }
      return null;
    },
  }),
  createAgent: inputHandler({
    args: {
      descriptionIndex: v.number(),
    },
    handler: (game, now, args) => {
      const description = Descriptions[args.descriptionIndex];
      const playerId = Player.join(
        game,
        now,
        description.name,
        description.character,
        description.identity,
      );
      const agentId = game.allocId('agents');
      const homeLoc = homeFor(description.name);
      const home = homeLoc ? { x: homeLoc.x, y: homeLoc.y } : undefined;
      game.world.agents.set(
        agentId,
        new Agent({
          id: agentId,
          playerId: playerId,
          inProgressOperation: undefined,
          lastConversation: undefined,
          lastInviteAttempt: undefined,
          toRemember: undefined,
          scenarioTarget: game.world.scenarioTarget,
          scenarioName: game.world.scenarioName,
          // Only inherit a live custom scenario when it's an everyone-scenario;
          // an agent created after a group scenario started isn't in its cast.
          scenarioInstruction: game.world.scenarioParticipantIds
            ? undefined
            : game.world.scenarioInstruction,
          home,
        }),
      );
      game.agentDescriptions.set(
        agentId,
        new AgentDescription({
          agentId: agentId,
          identity: description.identity,
          profile: description.profile,
          family: description.family,
        }),
      );
      if (game.world.scenarioTarget) {
        const target = game.world.scenarioTarget;
        const player = game.world.players.get(playerId);
        if (player && !game.world.playerConversation(player)) {
          delete player.activity;
          movePlayer(game, now, player, target, false, true);
        }
      }
      return { agentId };
    },
  }),
  // Write-back for the conversation-end affinity evaluation (memory op): nudge
  // this agent's directional affinity toward the other participants. Deltas are
  // already clamped per-conversation; here we apply them on top of each pair's
  // current effective affinity (stored value, or the family-aware default).
  agentApplyAffinity: inputHandler({
    args: {
      agentId,
      deltas: v.array(v.object({ playerId, delta: v.number() })),
      conversationId: v.optional(conversationId),
      reason: v.optional(v.string()),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      const family = game.agentDescriptions.get(agentId)?.family;
      const affinities: Record<string, number> = { ...(agent.affinities ?? {}) };
      let net = 0;
      for (const { playerId: otherId, delta } of args.deltas) {
        const otherName = game.playerDescriptions.get(parseGameId('players', otherId))?.name;
        const current = affinityToward({
          affinities,
          otherPlayerId: otherId,
          family,
          otherName,
        });
        const updated = clampAffinity(current + delta);
        net += updated - current;
        affinities[otherId] = updated;
        // Log the applied shift so the Tensions feed and inspector history can
        // show what happened and why (skip no-ops, e.g. clamped at 0/100).
        if (updated !== current) {
          game.emitRelationshipEvent({
            at: now,
            kind: 'affinityShift',
            actor: agent.playerId,
            target: parseGameId('players', otherId),
            delta: updated - current,
            affinityAfter: updated,
            reason: args.reason,
            conversationId: args.conversationId,
            scenarioId: agent.scenarioId,
            scenarioName: agent.scenarioName,
          });
        }
      }
      agent.affinities = affinities;
      // Flash a 💗/💔 on the map only when the net feeling actually moved (the
      // clamp may zero out a delta at the 0/100 boundary, or pluses and minuses
      // in a group may cancel).
      if (net !== 0) {
        agent.lastAffinityChange = { at: now, net };
      }
      return null;
    },
  }),
  // Write-back for the decision evaluator (convex/evaluator.ts): once a group's
  // choice has been scored against everyone's hidden ground truth, each
  // participant's feeling toward the FOCAL agent — the person who made the call —
  // moves according to how well that choice actually served them.
  //
  // Affinity only, and only toward the focal agent. Mood and stress are left
  // entirely to the existing post-scenario memory pass (agentRememberScenario), and
  // peer-to-peer affinity to the post-conversation pass (agentRememberConversation),
  // so nothing here double-counts what those already do.
  applyEvaluationOutcome: inputHandler({
    args: {
      focalPlayerId: playerId,
      scenarioId: v.string(),
      scenarioName: v.string(),
      deltas: v.array(
        v.object({
          playerId,
          delta: v.number(),
          reason: v.string(),
        }),
      ),
    },
    handler: (game, now, args) => {
      const focalPlayerId = parseGameId('players', args.focalPlayerId);
      for (const { playerId: subjectId, delta, reason } of args.deltas) {
        // The focal agent doesn't form an opinion of itself over its own call.
        if (subjectId === args.focalPlayerId || delta === 0) continue;
        const agent = [...game.world.agents.values()].find((a) => a.playerId === subjectId);
        if (!agent) continue;

        const family = game.agentDescriptions.get(agent.id)?.family;
        const affinities: Record<string, number> = { ...(agent.affinities ?? {}) };
        const focalName = game.playerDescriptions.get(focalPlayerId)?.name;
        const current = affinityToward({
          affinities,
          otherPlayerId: focalPlayerId,
          family,
          otherName: focalName,
        });
        const updated = clampAffinity(current + delta);
        if (updated === current) continue; // Clamped at 0/100 — nothing happened.
        affinities[focalPlayerId] = updated;
        agent.affinities = affinities;
        agent.lastAffinityChange = { at: now, net: updated - current };
        game.emitRelationshipEvent({
          at: now,
          kind: 'decisionOutcome',
          actor: agent.playerId,
          target: focalPlayerId,
          delta: updated - current,
          affinityAfter: updated,
          reason,
          scenarioId: args.scenarioId,
          scenarioName: args.scenarioName,
        });
      }
      return null;
    },
  }),
  // Write-back for interaction/scenario outcomes that shift this agent's short-term
  // gauges (mood/stress/fatigue/hunger). Mirrors agentApplyAffinity: applies each
  // delta on top of the current value, scaled by the agent's profile-derived
  // reactivity, clamps to [0,100], and flags a transient map badge. Used by the
  // post-conversation and post-scenario write-backs.
  agentApplyShortTerm: inputHandler({
    args: {
      agentId,
      deltas: v.array(
        v.object({
          component: v.union(
            v.literal('mood'),
            v.literal('stress'),
            v.literal('fatigue'),
            v.literal('hunger'),
          ),
          delta: v.number(),
        }),
      ),
      reason: v.optional(v.string()),
      // What produced these deltas, for the durable transition log. Optional so
      // an older queued input still applies; it is only the log that suffers.
      cause: v.optional(shortTermCause),
      conversationId: v.optional(conversationId),
      scenarioId: v.optional(v.string()),
      goalMet: v.optional(v.boolean()),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      if (args.deltas.length === 0) return null;
      const profile = game.agentDescriptions.get(agentId)?.profile;
      const multipliers = shortTermSensitivity(profile);
      // Captured before the deltas land: the log records both endpoints, and
      // the reactivity multiplier plus the clamp mean the applied change is
      // rarely the requested one.
      const before = shortTermOrDefault(agent.shortTerm, now);
      const { shortTerm, net } = applyShortTermDeltas(
        agent.shortTerm,
        args.deltas as ShortTermDelta[],
        now,
        multipliers,
      );
      agent.shortTerm = shortTerm;
      if (net !== 0) {
        agent.lastShortTermChange = { at: now, net };
      }
      for (const component of SHORT_TERM_COMPONENTS) {
        game.emitShortTermEvent({
          at: now,
          playerId: agent.playerId,
          component,
          delta: shortTerm[component] - before[component],
          valueBefore: before[component],
          valueAfter: shortTerm[component],
          cause: args.cause ?? 'conversationFeelings',
          reason: args.reason,
          conversationId: args.conversationId,
          scenarioId: args.scenarioId,
          goalMet: args.goalMet,
        });
      }
      return null;
    },
  }),
  // Direct, absolute override of an agent's gauges, savings and health, driven by
  // the agents popup (src/components/AgentsPanel.tsx). Deliberately NOT built on
  // agentApplyShortTerm: that one is delta-based and scaled by the agent's
  // profile-derived reactivity, which is right for an in-world event but wrong
  // here — "set mood to 40" has to land on 40, not on 40 nudged by how resilient
  // the character is. Every field is optional; only what's passed is written.
  agentSetState: inputHandler({
    args: {
      agentId,
      mood: v.optional(v.number()),
      stress: v.optional(v.number()),
      fatigue: v.optional(v.number()),
      hunger: v.optional(v.number()),
      balance: v.optional(v.number()),
      health: v.optional(v.union(v.literal('well'), v.literal('sick'))),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      const before = shortTermOrDefault(agent.shortTerm, now);
      const after = { ...before };
      let changed = false;
      let net = 0;
      const components: ShortTermComponent[] = ['mood', 'stress', 'fatigue', 'hunger'];
      for (const component of components) {
        const value = args[component];
        if (value === undefined) continue;
        after[component] = clampGauge(value);
        if (after[component] === before[component]) continue;
        changed = true;
        // Same valence convention as applyShortTermDeltas: mood rising is
        // feeling better, the other three rising is feeling worse.
        net +=
          component === 'mood'
            ? after[component] - before[component]
            : before[component] - after[component];
      }
      if (changed) {
        after.updatedAt = now;
        agent.shortTerm = after;
        if (net !== 0) {
          agent.lastShortTermChange = { at: now, net };
        }
        // Logged as 'manualOverride', which the evaluation rules treat as a
        // legitimate reset with no expected direction — because there isn't
        // one. A human typing 40 into the box is not the mechanism under test.
        for (const component of SHORT_TERM_COMPONENTS) {
          game.emitShortTermEvent({
            at: now,
            playerId: agent.playerId,
            component,
            delta: after[component] - before[component],
            valueBefore: before[component],
            valueAfter: after[component],
            cause: 'manualOverride',
            reason: 'set from the agents panel',
          });
        }
      }
      if (args.balance !== undefined) {
        // The economy floors at zero (see `spend`), so an agent can be broke but
        // never in debt — keep a manual edit inside the same range.
        agent.balance = Math.max(0, Math.round(args.balance));
      }
      if (args.health !== undefined && args.health !== (agent.health ?? 'well')) {
        agent.health = args.health;
        if (args.health === 'sick') {
          agent.sickDaysLeft = SICK_DURATION_DAYS;
          agent.consecutiveWorkDays = 0;
          // tickSchedule only builds the stay-home rest schedule while today's
          // schedule hasn't been generated yet, so clear that marker — otherwise
          // an agent made sick mid-day would carry on working their shift.
          delete agent.scheduleGeneratedForDay;
        } else {
          delete agent.sickDaysLeft;
          // Back on their feet: re-plan so they drop the rest schedule.
          agent.scheduleNeedsRefresh = true;
        }
      }
      return null;
    },
  }),
  // Put a character at one of the named city locations, from the agents popup,
  // and HOLD them there.
  //
  // The hold is the whole trick. `teleportPlayer` (player.ts) already snaps a
  // position, but Agent.tickSchedule runs on the very next tick and walks them
  // straight back to their current schedule step — and rewriting that one step
  // isn't enough either, because in-game time moves fast enough that the agent
  // advances to the next step within seconds of real time. So this sets
  // `agent.pin`, which tickSchedule treats as the destination until it's released
  // or the day rolls over.
  agentSetLocation: inputHandler({
    args: {
      playerId,
      locationId: v.string(),
    },
    handler: (game, now, args) => {
      const playerId = parseGameId('players', args.playerId);
      const player = game.world.players.get(playerId);
      if (!player) {
        throw new Error(`Invalid player ID ${playerId}`);
      }
      const location = getLocationById(args.locationId);
      if (!location) {
        throw new Error(`Unknown location ${args.locationId}`);
      }
      const destination = { x: location.x, y: location.y };
      const reason = blockedWithPositions(destination, [], game.worldMap);
      if (reason !== null) {
        throw new Error(`${location.name} is blocked (${reason}) — pick another place`);
      }
      // Leave any active conversation so neither participant gets stuck.
      const conversation = [...game.world.conversations.values()].find((c) =>
        c.participants.has(player.id),
      );
      if (conversation) {
        conversation.leave(game, now, player);
      }
      stopPlayer(player);
      player.position = destination;
      const { dayNumber } = computeGameTime(now, game.world.worldStartTime);
      for (const agent of game.world.agents.values()) {
        if (agent.playerId !== player.id) continue;
        agent.pin = { destination, locationId: location.id, day: dayNumber };
        // A pending scenario walk would drag them straight back off again.
        delete agent.scenarioTarget;
        delete agent.scenarioArrivalTime;
        break;
      }
      console.log(`Moved ${player.id} (${player.name}) to ${location.name}`);
      return null;
    },
  }),
  // Drop the manual hold and let the agent get on with its day again.
  agentReleaseLocation: inputHandler({
    args: {
      playerId,
    },
    handler: (game, _now, args) => {
      const playerId = parseGameId('players', args.playerId);
      for (const agent of game.world.agents.values()) {
        if (agent.playerId !== playerId) continue;
        delete agent.pin;
        // Re-plan from wherever they've been left rather than sprinting back to a
        // schedule written for somewhere else.
        agent.scheduleNeedsRefresh = true;
        break;
      }
      return null;
    },
  }),
  // Promote a reflected-on insight to a durable "learned trait" (spec point 6).
  // Appended to a bounded, de-duplicated list kept separate from the authored
  // profile so runtime learning never overwrites the hand-authored persona.
  // Write-back for agentDecomposeStep: the finer actions for one schedule block.
  finishDecomposeStep: inputHandler({
    args: {
      operationId: v.string(),
      agentId,
      stepKey: v.string(),
      steps: v.array(subStep),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      if (
        !agent.inProgressOperation ||
        agent.inProgressOperation.operationId !== args.operationId
      ) {
        console.debug(`Agent ${agentId} didn't have ${args.operationId} in progress`);
        return null;
      }
      delete agent.inProgressOperation;
      // Clear the in-flight stamp either way. On an empty result the block keeps
      // its single whole-block activity — the pre-decomposition behaviour — and
      // won't be re-requested, since the stamp only re-arms on a new step key.
      if (args.steps.length > 0) {
        agent.activeSubSteps = { stepKey: args.stepKey, steps: args.steps };
        // Expire the whole-block activity that was set while we waited. It runs
        // to the END of the block, so without this `tickSchedule` would never
        // re-enter its `!doingActivity` branch and the sub-steps we just asked
        // for would sit unused until the block (and their step key) expired.
        const player = game.world.players.get(agent.playerId);
        if (player?.activity && player.activity.ambient) {
          player.activity.until = now;
        }
      }
      return null;
    },
  }),
  // Write-back for agentRegenerateSelfSummary. Writes to the description table
  // (not the Agent), so it must flag descriptionsModified for saveDiff to persist.
  agentSetSelfSummary: inputHandler({
    args: {
      agentId,
      selfSummary: v.string(),
      dayNumber: v.number(),
    },
    handler: (game, _now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const description = game.agentDescriptions.get(agentId);
      if (!description) {
        throw new Error(`Couldn't find agent description: ${agentId}`);
      }
      const summary = args.selfSummary.trim();
      if (!summary) return null;
      description.selfSummary = summary;
      description.selfSummaryDay = args.dayNumber;
      game.descriptionsModified = true;
      return null;
    },
  }),
  // Write-back for agentReact: apply whatever the agent decided to do about what
  // it noticed. Every branch is a no-op if its precondition doesn't hold — a
  // reaction is a nudge, not an override of the rest of the system.
  finishReact: inputHandler({
    args: {
      agentId,
      reaction: v.string(),
      targetPlayerId: v.optional(playerId),
      activity: v.string(),
      emoji: v.optional(v.string()),
      reason: v.optional(v.string()),
    },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      const player = game.world.players.get(agent.playerId);
      if (!player) return null;
      if (args.reaction === 'talk') {
        if (!args.targetPlayerId) return null;
        // A preference for the next invite, consumed once used. The invite path
        // still applies every one of its own rules (cooldowns, the work leash,
        // scenario boundaries), so this can only steer a conversation that was
        // going to be allowed anyway.
        agent.preferredInvitee = parseGameId('players', args.targetPlayerId);
        return null;
      }
      if (args.reaction === 'activity') {
        if (!args.activity) return null;
        // Ambient, or the `interrupting` check in Agent.tick cancels it the
        // moment the agent takes a step.
        player.activity = {
          description: args.activity,
          emoji: args.emoji ?? '💭',
          until: now + CONTEXTUAL_EVENT_MINUTES * (CYCLE_MS / (24 * 60)),
          ambient: true,
        };
        return null;
      }
      if (args.reaction === 'replan') {
        const gt = computeGameTime(now, game.world.worldStartTime);
        if (agent.reactReplansDay !== gt.dayNumber) {
          agent.reactReplansDay = gt.dayNumber;
          agent.reactReplansToday = 0;
        }
        if ((agent.reactReplansToday ?? 0) >= MAX_REACT_REPLANS_PER_DAY) return null;
        agent.reactReplansToday = (agent.reactReplansToday ?? 0) + 1;
        // Deliberately NOT `forcePlan`: that bypasses every throttle and belongs
        // to scenario injection. `reactionReplan` gets its own, much shorter
        // cooldown — plain `scheduleNeedsRefresh` would be honoured only after
        // PLAN_COOLDOWN_MS (5 real minutes ≈ 5 in-game hours), far too late to
        // read as a reaction to something just seen.
        agent.scheduleNeedsRefresh = true;
        agent.reactionReplan = true;
        console.log(`Agent ${agentId} re-planning after noticing something: ${args.reason ?? ''}`);
      }
      return null;
    },
  }),
  // Write-back for agentReflect. Only called when a reflection actually
  // happened, so a below-threshold check never consumes the memories it declined
  // to reflect on.
  finishReflect: inputHandler({
    args: { agentId },
    handler: (game, now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      agent.lastReflectionAt = now;
      agent.eventsSinceReflection = 0;
      return null;
    },
  }),
  agentAddLearnedTrait: inputHandler({
    args: {
      agentId,
      trait: v.string(),
    },
    handler: (game, _now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      const trait = args.trait.trim();
      if (!trait) return null;
      const existing = agent.learnedTraits ?? [];
      const norm = trait.toLowerCase();
      if (existing.some((t) => t.toLowerCase() === norm)) return null;
      agent.learnedTraits = [...existing, trait].slice(-MAX_LEARNED_TRAITS);
      return null;
    },
  }),
  // Write-back for the agentExtractScenarioProfile op: store the compact,
  // scenario-relevant background that others will see for this character.
  agentSetScenarioProfile: inputHandler({
    args: {
      agentId,
      scenarioProfile: v.string(),
      scenarioInstruction: v.string(),
    },
    handler: (game, _now, args) => {
      const agentId = parseGameId('agents', args.agentId);
      const agent = game.world.agents.get(agentId);
      if (!agent) {
        throw new Error(`Couldn't find agent: ${agentId}`);
      }
      // Ignore an extraction that finished after the scenario changed or ended.
      // Check the agent's own current instruction (works for both the manual
      // global scenario and an automatic per-participant one).
      if (agent.scenarioInstruction !== args.scenarioInstruction) {
        return null;
      }
      agent.scenarioProfile = args.scenarioProfile;
      agent.scenarioProfileFor = args.scenarioInstruction;
      return null;
    },
  }),
  startCustomScenario: inputHandler({
    // Optional name/emoji/background let the generator inject a real catalogue
    // scenario (data/scenarios.ts) with its own panel title/emoji; omitted for a
    // free-form custom scenario, which falls back to the generic labels below.
    args: {
      instruction: v.string(),
      name: v.optional(v.string()),
      emoji: v.optional(v.string()),
      background: v.optional(v.string()),
    },
    handler: (game, now, args) => {
      const instruction = args.instruction.trim();
      if (!instruction) return null;
      injectScenario(game, now, {
        instruction,
        name: args.name ?? 'Custom Scenario',
        emoji: args.emoji ?? '🎬',
        background:
          args.background ??
          'A custom scenario you injected. It overrides everyone’s normal routine for the rest of the in-game day.',
      });
      return null;
    },
  }),
  // Start a scenario the Decider invented (convex/scenarioGen.ts) rather than one
  // from the authored catalogue. Same pipeline either way — a generated scenario is
  // just a ScenarioDef built at runtime — so it enlists participants, runs its
  // deliberation and gets scored for regret exactly like a catalogue one.
  //
  // Always clears `scenarioGenRequested`, including when generation failed and
  // `scenario` is absent, so a bad LLM response falls back to the catalogue on the
  // next tick instead of stalling the rotation.
  startGeneratedScenario: inputHandler({
    args: {
      scenario: v.optional(serializedGeneratedScenario),
      // True for the scenario creator's button: override whatever is running and
      // gather the right people, exactly like manually picking from the catalogue.
      manual: v.optional(v.boolean()),
    },
    handler: (game, now, args) => {
      const world = game.world;
      delete world.scenarioGenRequested;
      if (!args.scenario) {
        // Generation failed. Retry shortly through the ordinary path.
        world.nextScenarioTime = now + SCENARIO_RETRY_MS;
        return null;
      }
      const def = toScenarioDef(args.scenario);
      if (args.manual) {
        if (!injectCatalogScenario(game, now, def)) {
          throw new Error(`Couldn't start "${def.name}" — not enough people are free right now.`);
        }
        return null;
      }
      const inst = startScenario(game, now, def);
      if (!inst) {
        // Too few free agents. Try again on the normal retry cadence.
        world.nextScenarioTime = now + SCENARIO_RETRY_MS;
        return null;
      }
      world.activeScenarios = [...(world.activeScenarios ?? []), inst];
      world.nextScenarioTime = now + SCENARIO_INTERVAL_MIN_MS;
      return null;
    },
  }),
  // Manually start a catalogue scenario (data/scenarios.ts) through the automatic
  // pipeline rather than the town-wide injector — so a workplace scenario enlists
  // only that workplace's workers and runs its gathering phase. Used by the
  // generator for local/workplace scenarios.
  startCatalogScenario: inputHandler({
    args: {
      scenarioId: v.string(),
      // Optional edited directive from the generator's textarea.
      instruction: v.optional(v.string()),
    },
    handler: (game, now, args) => {
      const def = scenarioById(args.scenarioId);
      if (!def) {
        throw new Error(`Unknown scenario: ${args.scenarioId}`);
      }
      const started = injectCatalogScenario(game, now, def, args.instruction);
      if (!started) {
        throw new Error(
          `Couldn't start "${def.name}" — not enough of the right people are around right now.`,
        );
      }
      return null;
    },
  }),
  clearScenario: inputHandler({
    args: {},
    handler: (game, _now) => {
      // Full reset: clear the global manual scenario AND any automatic/catalogue
      // ones (including scenarioId/topics/goal), so "Clear" reliably stops whatever
      // is running, however it was started.
      delete game.world.scenarioInstruction;
      delete game.world.scenarioStartTime;
      delete game.world.scenarioParticipantIds;
      delete game.world.scenarioTarget;
      delete game.world.scenarioName;
      for (const agent of game.world.agents.values()) {
        delete agent.scenarioInstruction;
        delete agent.scenarioName;
        delete agent.scenarioId;
        delete agent.scenarioTopics;
        delete agent.scenarioGoal;
        delete agent.scenarioConflict;
        delete agent.scenarioTarget;
        delete agent.scenarioArrivalTime;
        delete agent.scenarioProfile;
        delete agent.scenarioProfileFor;
      }
      game.world.activeScenarios = undefined;
      return null;
    },
  }),
  startScenarioMeetAtPark: inputHandler({
    args: {},
    handler: (game, now) => {
      // Just a normal scenario now: inject a directive to gather at the park and
      // let each agent's re-plan walk them to "gardens" naturally — no bespoke
      // walk-to-center / mill-around movement code.
      injectScenario(game, now, {
        instruction:
          'A spontaneous town gathering is happening at Gardens by the Bay right now. Drop what you are doing and head to the park (location "gardens") to meet everyone, then mingle and enjoy the get-together.',
        name: 'Meet at the Park',
        emoji: '🌳',
        background:
          'A spontaneous town-wide get-together at Gardens by the Bay — everyone heads to the park to mingle.',
        // This one genuinely is the whole town — that's the point of the button.
        everyone: true,
      });
      return null;
    },
  }),
};
