import { v } from 'convex/values';
import { agentId, conversationId, parseGameId, playerId } from './ids';
import { Player, activity } from './player';
import { Conversation, conversationInputs } from './conversation';
import { movePlayer, stopPlayer } from './movement';
import { inputHandler } from './inputHandler';
import { point } from '../util/types';
import { Descriptions } from '../../data/characters';
import { AgentDescription } from './agentDescription';
import { Agent, scheduleStep } from './agent';
import { affinityToward, clampAffinity } from './affinity';
import { injectCatalogScenario } from './scenarios';
import { scenarioById } from '../../data/scenarios';
import { CITY_LOCATIONS, homeFor } from '../../data/cityLocations';
import { mergeFixedObligations } from '../../data/routines';
import { CYCLE_MS } from './gameTime';
import type { SerializedActiveScenario } from './world';
import type { Game } from './game';

// Inject a town-wide scenario: set the global directive, force every agent to
// re-plan around it (which naturally walks them to wherever it calls them — no
// special movement code), and surface it in the on-screen scenarios panel. Shared
// by the custom-scenario injector and the "meet at the park" button.
function injectScenario(
  game: Game,
  now: number,
  opts: { instruction: string; name: string; emoji: string; background: string },
) {
  game.world.scenarioInstruction = opts.instruction;
  game.world.scenarioStartTime = now;
  // End ongoing conversations so agents are immediately free to react.
  for (const conversation of [...game.world.conversations.values()]) {
    conversation.stop(game, now);
  }
  for (const agent of game.world.agents.values()) {
    agent.scenarioInstruction = opts.instruction;
    // Drop any stale scenario-relevant background; the next tick re-extracts.
    delete agent.scenarioProfile;
    delete agent.scenarioProfileFor;
    delete agent.toRemember;
    delete agent.inProgressOperation;
    // Force an immediate re-plan that incorporates the scenario (bypassing the
    // plan cooldown/stagger) so every agent reacts at once.
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
  const participantIds = [...game.world.agents.values()].map((a) => a.playerId);
  const manualEntry: SerializedActiveScenario = {
    id: `manual-${now}`,
    defId: 'manual',
    scope: 'universal',
    name: opts.name,
    emoji: opts.emoji,
    instruction: opts.instruction,
    whatHappens: opts.instruction,
    background: opts.background,
    relationships: 'Everyone in town is caught up in it.',
    context: 'Happening right now, town-wide.',
    goals: 'React to the situation in character and let it reshape the rest of your day.',
    participantIds,
    participantNames: participantIds.map(
      (pid) => game.playerDescriptions.get(pid)?.name ?? 'Someone',
    ),
    startTime: now,
    // Manual scenarios have no gathering phase — they take over the whole town
    // immediately and end with the global scenarioInstruction.
    contentStartTime: now,
    phase: 'active',
    endTime: now + CYCLE_MS,
  };
  const others = (game.world.activeScenarios ?? []).filter((s) => s.defId !== 'manual');
  game.world.activeScenarios = [...others, manualEntry];
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
      // can show which tasks are done and whether the goal is achieved.
      if (agent.scenarioId && (args.goalMet || (args.coveredTopics?.length ?? 0) > 0)) {
        const sc = (game.world.activeScenarios ?? []).find((s) => s.id === agent.scenarioId);
        if (sc) {
          if (args.goalMet) sc.goalMet = true;
          if (args.coveredTopics && args.coveredTopics.length > 0) {
            const done = sc.topicsDone ?? (sc.topics ?? []).map(() => false);
            for (const i of args.coveredTopics) {
              if (i >= 0 && i < done.length) done[i] = true;
            }
            sc.topicsDone = done;
          }
        }
      }
      if (args.leaveConversation) {
        conversation.leave(game, now, player);
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
          scenarioInstruction: game.world.scenarioInstruction,
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
      delete game.world.scenarioTarget;
      delete game.world.scenarioName;
      for (const agent of game.world.agents.values()) {
        delete agent.scenarioInstruction;
        delete agent.scenarioName;
        delete agent.scenarioId;
        delete agent.scenarioTopics;
        delete agent.scenarioGoal;
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
      });
      return null;
    },
  }),
};
