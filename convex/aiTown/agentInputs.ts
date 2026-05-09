import { v } from 'convex/values';
import { agentId, conversationId, parseGameId } from './ids';
import { Player, activity } from './player';
import { Conversation, conversationInputs } from './conversation';
import { blockedWithPositions, movePlayer } from './movement';
import { inputHandler } from './inputHandler';
import { Point, point } from '../util/types';
import { Descriptions } from '../../data/characters';
import { AgentDescription } from './agentDescription';
import { Agent } from './agent';
import { WorldMap } from './worldMap';

const PARK_FOUNTAIN_SHEET = '__city_fountain__';

// Returns the nearest open tile to the fountain centroid.
function getParkTarget(worldMap: WorldMap): Point {
  const fountains = worldMap.animatedSprites.filter((s) => s.sheet === PARK_FOUNTAIN_SHEET);
  let center: Point;
  if (fountains.length > 0) {
    const sum = fountains.reduce(
      (acc, s) => ({ x: acc.x + s.x, y: acc.y + s.y }),
      { x: 0, y: 0 },
    );
    center = {
      x: Math.round(sum.x / fountains.length / worldMap.tileDim),
      y: Math.round(sum.y / fountains.length / worldMap.tileDim),
    };
  } else {
    center = { x: Math.floor(worldMap.width / 2), y: Math.floor(worldMap.height / 2) };
  }
  for (let radius = 0; radius <= 15; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
        const candidate = { x: center.x + dx, y: center.y + dy };
        if (
          candidate.x >= 0 &&
          candidate.y >= 0 &&
          candidate.x < worldMap.width &&
          candidate.y < worldMap.height &&
          blockedWithPositions(candidate, [], worldMap) === null
        )
          return candidate;
      }
    }
  }
  return center;
}

export const agentInputs = {
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
        }),
      );
      game.agentDescriptions.set(
        agentId,
        new AgentDescription({
          agentId: agentId,
          identity: description.identity,
          plan: description.plan,
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
  startScenarioMeetAtPark: inputHandler({
    args: {},
    handler: (game, now) => {
      const target = getParkTarget(game.worldMap);
      game.world.scenarioTarget = target;
      game.world.scenarioName = 'meetAtPark';
      // Preempt all ongoing conversations so agents are immediately free to move.
      for (const conversation of [...game.world.conversations.values()]) {
        conversation.stop(game, now);
      }
      for (const agent of game.world.agents.values()) {
        agent.scenarioTarget = target;
        agent.scenarioName = 'meetAtPark';
        // Drop any pending conversation memory from the just-stopped convos.
        delete agent.toRemember;
        // Orphan any in-flight LLM operation — finishDoSomething will see an
        // operationId mismatch and bail out, preventing destination overrides.
        delete agent.inProgressOperation;
        // Reset arrival timer so the 30-second stay clock starts fresh.
        delete agent.scenarioArrivalTime;
        const player = game.world.players.get(agent.playerId);
        if (!player) continue;
        delete player.activity;
        movePlayer(game, now, player, target, false, false);
      }
      return { target };
    },
  }),
};
