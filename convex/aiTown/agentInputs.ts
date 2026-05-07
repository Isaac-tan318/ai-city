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
const PARK_TARGET_SEARCH_RADIUS = 6;

function getParkTarget(worldMap: WorldMap): Point {
  const fountains = worldMap.animatedSprites.filter((sprite) => sprite.sheet === PARK_FOUNTAIN_SHEET);
  let target: Point | null = null;
  if (fountains.length > 0) {
    const sum = fountains.reduce(
      (acc, sprite) => ({ x: acc.x + sprite.x, y: acc.y + sprite.y }),
      { x: 0, y: 0 },
    );
    const average = {
      x: sum.x / fountains.length,
      y: sum.y / fountains.length,
    };
    target = {
      x: Math.round(average.x / worldMap.tileDim),
      y: Math.round(average.y / worldMap.tileDim),
    };
  }
  if (!target) {
    target = {
      x: Math.floor(worldMap.width / 2),
      y: Math.floor(worldMap.height / 2),
    };
  }
  return findNearestOpenTile(target, worldMap);
}

function findNearestOpenTile(target: Point, worldMap: WorldMap): Point {
  for (let radius = 0; radius <= PARK_TARGET_SEARCH_RADIUS; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) {
          continue;
        }
        const candidate = { x: target.x + dx, y: target.y + dy };
        if (candidate.x < 0 || candidate.y < 0) {
          continue;
        }
        if (candidate.x >= worldMap.width || candidate.y >= worldMap.height) {
          continue;
        }
        if (blockedWithPositions(candidate, [], worldMap) === null) {
          return candidate;
        }
      }
    }
  }
  return {
    x: Math.min(Math.max(target.x, 0), worldMap.width - 1),
    y: Math.min(Math.max(target.y, 0), worldMap.height - 1),
  };
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
      for (const agent of game.world.agents.values()) {
        agent.scenarioTarget = target;
        agent.scenarioName = 'meetAtPark';
        const player = game.world.players.get(agent.playerId);
        if (!player) {
          continue;
        }
        if (game.world.playerConversation(player)) {
          continue;
        }
        delete player.activity;
        movePlayer(game, now, player, target, false, true);
      }
      return { target };
    },
  }),
};
