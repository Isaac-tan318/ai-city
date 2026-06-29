import { ObjectType, v } from 'convex/values';
import { GameId, parseGameId } from './ids';
import { conversationId, playerId } from './ids';
import { Player } from './player';
import { inputHandler } from './inputHandler';

import {
  TYPING_TIMEOUT,
  CONVERSATION_DISTANCE,
  GROUP_JOIN_DISTANCE,
  MAX_CONVERSATION_PARTICIPANTS,
  SCENARIO_MAX_PARTICIPANTS,
} from '../constants';
import { distance, normalize, vector } from '../util/geometry';
import { Game } from './game';
import { stopPlayer } from './movement';
import { ConversationMembership, serializedConversationMembership } from './conversationMembership';
import { parseMap, serializeMap } from '../util/object';

export class Conversation {
  id: GameId<'conversations'>;
  creator: GameId<'players'>;
  created: number;
  isTyping?: {
    playerId: GameId<'players'>;
    messageUuid: string;
    since: number;
  };
  lastMessage?: {
    author: GameId<'players'>;
    timestamp: number;
  };
  numMessages: number;
  participants: Map<GameId<'players'>, ConversationMembership>;
  // True for conversations seeded by an enforced gathering scenario (dinner,
  // shopping). Scenario conversations use the higher participant cap and are
  // never preempted by the scenario approach logic.
  scenario?: boolean;
  // Set by the dialogue orchestrator after each agent message: the participant
  // who should speak next, decided by an LLM from the conversation history.
  // Agents defer to the designated speaker (with an awkward-timeout fallback).
  nextSpeaker?: GameId<'players'>;
  // Latched true once the scenario goal-judge (decideNextSpeaker) deems this
  // scenario conversation's goal achieved, so participants may wrap up rather
  // than running to the hard message/duration cap. Only meaningful for scenario
  // conversations; ignored by ordinary ones.
  scenarioGoalMet?: boolean;
  // Latched true once an agent has posted the one-time "how we achieved the goal"
  // wrap-up summary, so only a single summary is spoken before the chat winds down.
  goalSummaryPosted?: boolean;
  // Every player who has ever actively participated in this conversation, even
  // after they leave. `participants` only holds the people *currently* present,
  // so in a group chat where members peel off one at a time it would shrink to
  // the last person by teardown. We accumulate the full roster here so the
  // archived history records who was actually in the group chat.
  allParticipants: Set<GameId<'players'>>;

  constructor(serialized: SerializedConversation) {
    const { id, creator, created, isTyping, lastMessage, numMessages, participants, scenario, scenarioGoalMet, goalSummaryPosted } =
      serialized;
    this.id = parseGameId('conversations', id);
    this.creator = parseGameId('players', creator);
    this.created = created;
    this.isTyping = isTyping && {
      playerId: parseGameId('players', isTyping.playerId),
      messageUuid: isTyping.messageUuid,
      since: isTyping.since,
    };
    this.lastMessage = lastMessage && {
      author: parseGameId('players', lastMessage.author),
      timestamp: lastMessage.timestamp,
    };
    this.numMessages = numMessages;
    this.participants = parseMap(participants, ConversationMembership, (m) => m.playerId);
    this.scenario = scenario;
    this.scenarioGoalMet = scenarioGoalMet;
    this.goalSummaryPosted = goalSummaryPosted;
    this.nextSpeaker =
      serialized.nextSpeaker !== undefined
        ? parseGameId('players', serialized.nextSpeaker)
        : undefined;
    this.allParticipants = new Set(
      (serialized.allParticipants ?? []).map((p) => parseGameId('players', p)),
    );
    // Seed from anyone currently participating so existing conversations (and
    // worlds archived before this field existed) still capture present members.
    for (const [pid, member] of this.participants.entries()) {
      if (member.status.kind === 'participating') this.allParticipants.add(pid);
    }
  }

  tick(game: Game, now: number) {
    if (this.isTyping && this.isTyping.since + TYPING_TIMEOUT < now) {
      delete this.isTyping;
    }
    // A conversation needs at least two people. If everyone but one has left,
    // tear it down so the last participant is freed.
    if (this.participants.size < 2) {
      this.stop(game, now);
      return;
    }

    type Entry = { playerId: GameId<'players'>; member: ConversationMembership; player: Player };
    const entries: Entry[] = [];
    for (const [pid, member] of this.participants.entries()) {
      const player = game.world.players.get(pid);
      // A participant's player may have been removed; drop them next tick via leave.
      if (player) entries.push({ playerId: pid, member, player });
    }

    const participating = entries.filter((e) => e.member.status.kind === 'participating');
    const walkingOver = entries.filter((e) => e.member.status.kind === 'walkingOver');

    const startParticipating = (e: Entry) => {
      console.log(`${e.player.id} joining conversation ${this.id}`);
      stopPlayer(e.player);
      e.member.status = { kind: 'participating', started: now };
      this.allParticipants.add(e.playerId);
      participating.push(e);
    };

    if (participating.length > 0) {
      // Late joiners slot into an existing huddle once they're close to anyone
      // already participating (a bit looser than CONVERSATION_DISTANCE).
      for (const e of walkingOver) {
        const closeEnough = participating.some(
          (p) => distance(e.player.position, p.player.position) < GROUP_JOIN_DISTANCE,
        );
        if (closeEnough) startParticipating(e);
      }
    } else if (walkingOver.length >= 2) {
      // Bootstrap: the first two walkers within talking distance start the
      // conversation; any other walkers close to them are pulled in too.
      let seeded = false;
      for (let i = 0; i < walkingOver.length && !seeded; i++) {
        for (let j = i + 1; j < walkingOver.length && !seeded; j++) {
          if (
            distance(walkingOver[i].player.position, walkingOver[j].player.position) <
            CONVERSATION_DISTANCE
          ) {
            startParticipating(walkingOver[i]);
            startParticipating(walkingOver[j]);
            seeded = true;
          }
        }
      }
      if (seeded) {
        for (const e of walkingOver) {
          if (e.member.status.kind !== 'walkingOver') continue;
          const closeEnough = participating.some(
            (p) => distance(e.player.position, p.player.position) < GROUP_JOIN_DISTANCE,
          );
          if (closeEnough) startParticipating(e);
        }
      }
    }

    // Orient each settled participant toward the centroid of the others so the
    // group faces inward.
    if (participating.length >= 2) {
      for (const e of participating) {
        if (e.player.pathfinding) continue;
        const others = participating.filter((o) => o.playerId !== e.playerId);
        const centroid = others.reduce(
          (acc, o) => ({ x: acc.x + o.player.position.x, y: acc.y + o.player.position.y }),
          { x: 0, y: 0 },
        );
        centroid.x /= others.length;
        centroid.y /= others.length;
        const v = normalize(vector(e.player.position, centroid));
        if (v) e.player.facing = v;
      }
    }
  }

  // Add a new participant who will walk over and join the huddle. The caller is
  // responsible for enforcing the participant cap.
  join(game: Game, now: number, player: Player) {
    if (this.participants.has(player.id)) return;
    this.participants.set(
      player.id,
      new ConversationMembership({
        playerId: player.id,
        invited: now,
        status: { kind: 'walkingOver' },
      }),
    );
  }

  static start(game: Game, now: number, player: Player, invitee: Player) {
    if (player.id === invitee.id) {
      throw new Error(`Can't invite yourself to a conversation`);
    }
    // Ensure the players still exist.
    if ([...game.world.conversations.values()].find((c) => c.participants.has(player.id))) {
      const reason = `Player ${player.id} is already in a conversation`;
      console.log(reason);
      return { error: reason };
    }
    if ([...game.world.conversations.values()].find((c) => c.participants.has(invitee.id))) {
      const reason = `Player ${player.id} is already in a conversation`;
      console.log(reason);
      return { error: reason };
    }
    const conversationId = game.allocId('conversations');
    console.log(`Creating conversation ${conversationId}`);
    game.world.conversations.set(
      conversationId,
      new Conversation({
        id: conversationId,
        created: now,
        creator: player.id,
        numMessages: 0,
        participants: [
          { playerId: player.id, invited: now, status: { kind: 'walkingOver' } },
          { playerId: invitee.id, invited: now, status: { kind: 'invited' } },
        ],
      }),
    );
    return { conversationId };
  }

  setIsTyping(now: number, player: Player, messageUuid: string) {
    if (this.isTyping) {
      if (this.isTyping.playerId !== player.id) {
        throw new Error(`Player ${this.isTyping.playerId} is already typing in ${this.id}`);
      }
      return;
    }
    this.isTyping = { playerId: player.id, messageUuid, since: now };
  }

  acceptInvite(game: Game, player: Player) {
    const member = this.participants.get(player.id);
    if (!member) {
      throw new Error(`Player ${player.id} not in conversation ${this.id}`);
    }
    if (member.status.kind !== 'invited') {
      throw new Error(
        `Invalid membership status for ${player.id}:${this.id}: ${JSON.stringify(member)}`,
      );
    }
    member.status = { kind: 'walkingOver' };
  }

  rejectInvite(game: Game, now: number, player: Player) {
    const member = this.participants.get(player.id);
    if (!member) {
      throw new Error(`Player ${player.id} not in conversation ${this.id}`);
    }
    if (member.status.kind !== 'invited') {
      throw new Error(
        `Rejecting invite in wrong membership state: ${this.id}:${player.id}: ${JSON.stringify(
          member,
        )}`,
      );
    }
    this.stop(game, now);
  }

  stop(game: Game, now: number) {
    delete this.isTyping;
    for (const [playerId, member] of this.participants.entries()) {
      const agent = [...game.world.agents.values()].find((a) => a.playerId === playerId);
      if (agent) {
        agent.lastConversation = now;
        // Only remember conversations that actually happened. An abandoned invite
        // (rejected, or timed out at the invite stage) has no messages and is
        // deleted here WITHOUT being archived, so agentRememberConversation would
        // throw "Conversation not found" and brick the agent. Skip those.
        if (this.numMessages > 0) {
          agent.toRemember = this.id;
        }
      }
    }
    game.world.conversations.delete(this.id);
  }

  leave(game: Game, now: number, player: Player) {
    const member = this.participants.get(player.id);
    if (!member) {
      throw new Error(`Couldn't find membership for ${this.id}:${player.id}`);
    }
    // Record just this participant leaving so they remember the conversation and
    // respect the post-conversation cooldown.
    const agent = [...game.world.agents.values()].find((a) => a.playerId === player.id);
    if (agent) {
      agent.lastConversation = now;
      if (this.numMessages > 0) {
        agent.toRemember = this.id;
      }
    }
    this.participants.delete(player.id);
    if (this.isTyping && this.isTyping.playerId === player.id) {
      delete this.isTyping;
    }
    if (this.nextSpeaker === player.id) {
      delete this.nextSpeaker;
    }
    // Once fewer than two people remain, tear down the whole conversation (which
    // also lets the last person remember it).
    if (this.participants.size < 2) {
      this.stop(game, now);
    }
  }

  serialize(): SerializedConversation {
    const { id, creator, created, isTyping, lastMessage, numMessages, scenario, scenarioGoalMet, goalSummaryPosted, nextSpeaker } = this;
    return {
      id,
      creator,
      created,
      isTyping,
      lastMessage,
      numMessages,
      participants: serializeMap(this.participants),
      scenario,
      scenarioGoalMet,
      goalSummaryPosted,
      nextSpeaker,
      allParticipants: [...this.allParticipants],
    };
  }
}

export const serializedConversation = {
  id: conversationId,
  creator: playerId,
  created: v.number(),
  isTyping: v.optional(
    v.object({
      playerId,
      messageUuid: v.string(),
      since: v.number(),
    }),
  ),
  lastMessage: v.optional(
    v.object({
      author: playerId,
      timestamp: v.number(),
    }),
  ),
  numMessages: v.number(),
  participants: v.array(v.object(serializedConversationMembership)),
  scenario: v.optional(v.boolean()),
  scenarioGoalMet: v.optional(v.boolean()),
  goalSummaryPosted: v.optional(v.boolean()),
  nextSpeaker: v.optional(playerId),
  // Full roster of everyone who ever participated (see Conversation.allParticipants).
  // Optional for backward-compat with worlds serialized before this field existed.
  allParticipants: v.optional(v.array(playerId)),
};
export type SerializedConversation = ObjectType<typeof serializedConversation>;

export const conversationInputs = {
  // Start a conversation, inviting the specified player.
  // Conversations can only have two participants for now,
  // so we don't have a separate "invite" input.
  startConversation: inputHandler({
    args: {
      playerId,
      invitee: playerId,
    },
    handler: (game: Game, now: number, args): GameId<'conversations'> => {
      const playerId = parseGameId('players', args.playerId);
      const player = game.world.players.get(playerId);
      if (!player) {
        throw new Error(`Invalid player ID: ${playerId}`);
      }
      const inviteeId = parseGameId('players', args.invitee);
      const invitee = game.world.players.get(inviteeId);
      if (!invitee) {
        throw new Error(`Invalid player ID: ${inviteeId}`);
      }
      console.log(`Starting ${playerId} ${inviteeId}...`);
      const { conversationId, error } = Conversation.start(game, now, player, invitee);
      if (!conversationId) {
        // TODO: pass it back to the client for them to show an error.
        throw new Error(error);
      }
      return conversationId;
    },
  }),

  startTyping: inputHandler({
    args: {
      playerId,
      conversationId,
      messageUuid: v.string(),
    },
    handler: (game: Game, now: number, args): null => {
      const playerId = parseGameId('players', args.playerId);
      const player = game.world.players.get(playerId);
      if (!player) {
        throw new Error(`Invalid player ID: ${playerId}`);
      }
      const conversationId = parseGameId('conversations', args.conversationId);
      const conversation = game.world.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Invalid conversation ID: ${conversationId}`);
      }
      if (conversation.isTyping && conversation.isTyping.playerId !== playerId) {
        throw new Error(
          `Player ${conversation.isTyping.playerId} is already typing in ${conversationId}`,
        );
      }
      conversation.isTyping = { playerId, messageUuid: args.messageUuid, since: now };
      return null;
    },
  }),

  finishSendingMessage: inputHandler({
    args: {
      playerId,
      conversationId,
      timestamp: v.number(),
    },
    handler: (game: Game, now: number, args): null => {
      const playerId = parseGameId('players', args.playerId);
      const conversationId = parseGameId('conversations', args.conversationId);
      const conversation = game.world.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Invalid conversation ID: ${conversationId}`);
      }
      if (conversation.isTyping && conversation.isTyping.playerId === playerId) {
        delete conversation.isTyping;
      }
      conversation.lastMessage = { author: playerId, timestamp: args.timestamp };
      conversation.numMessages++;
      // Make sure every author is in the permanent roster, even if they leave
      // before the conversation is archived.
      conversation.allParticipants.add(playerId);
      // Clear the orchestrator's designated speaker. For agent messages, the
      // dialogue manager re-sets it via agentFinishSendingMessage right after
      // this runs. For a human message, leaving it cleared opens the floor so an
      // agent jumps in to respond.
      delete conversation.nextSpeaker;
      return null;
    },
  }),

  // Accept an invite to a conversation, which puts the
  // player in the "walkingOver" state until they're close
  // enough to the other participant.
  acceptInvite: inputHandler({
    args: {
      playerId,
      conversationId,
    },
    handler: (game: Game, now: number, args): null => {
      const playerId = parseGameId('players', args.playerId);
      const player = game.world.players.get(playerId);
      if (!player) {
        throw new Error(`Invalid player ID ${playerId}`);
      }
      const conversationId = parseGameId('conversations', args.conversationId);
      const conversation = game.world.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Invalid conversation ID ${conversationId}`);
      }
      conversation.acceptInvite(game, player);
      return null;
    },
  }),

  // Reject the invite. Eventually we might add a message
  // that explains why!
  rejectInvite: inputHandler({
    args: {
      playerId,
      conversationId,
    },
    handler: (game: Game, now: number, args): null => {
      const playerId = parseGameId('players', args.playerId);
      const player = game.world.players.get(playerId);
      if (!player) {
        throw new Error(`Invalid player ID ${playerId}`);
      }
      const conversationId = parseGameId('conversations', args.conversationId);
      const conversation = game.world.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Invalid conversation ID ${conversationId}`);
      }
      conversation.rejectInvite(game, now, player);
      return null;
    },
  }),
  // Leave a conversation.
  leaveConversation: inputHandler({
    args: {
      playerId,
      conversationId,
    },
    handler: (game: Game, now: number, args): null => {
      const playerId = parseGameId('players', args.playerId);
      const player = game.world.players.get(playerId);
      if (!player) {
        throw new Error(`Invalid player ID ${playerId}`);
      }
      const conversationId = parseGameId('conversations', args.conversationId);
      const conversation = game.world.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Invalid conversation ID ${conversationId}`);
      }
      conversation.leave(game, now, player);
      return null;
    },
  }),
};
