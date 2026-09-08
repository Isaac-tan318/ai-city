import { v } from 'convex/values';
import { defineTable } from 'convex/server';
import { serializedPlayer } from './player';
import { serializedPlayerDescription } from './playerDescription';
import { serializedAgent } from './agent';
import { serializedAgentDescription } from './agentDescription';
import { serializedWorld } from './world';
import { serializedWorldMap } from './worldMap';
import { serializedConversation } from './conversation';
import { conversationId, playerId } from './ids';
import { serializedRelationshipEvent } from './relationshipEvents';
import { serializedShortTermEvent } from './shortTermEvents';
import { serializedObservation } from './observation';

export const aiTownTables = {
  // This table has a single document that stores all players, conversations, and agents. This
  // data is small and changes regularly over time.
  worlds: defineTable({ ...serializedWorld }),

  // Worlds can be started or stopped by the developer or paused for inactivity, and this
  // infrequently changing document tracks this world state.
  worldStatus: defineTable({
    worldId: v.id('worlds'),
    isDefault: v.boolean(),
    engineId: v.id('engines'),
    lastViewed: v.number(),
    status: v.union(v.literal('running'), v.literal('stoppedByDeveloper'), v.literal('inactive')),
  }).index('worldId', ['worldId']),

  // This table contains the map data for a given world. Since it's a bit larger than the player
  // state and infrequently changes, we store it in a separate table.
  maps: defineTable({
    worldId: v.id('worlds'),
    ...serializedWorldMap,
  }).index('worldId', ['worldId']),

  // Human readable text describing players and agents that's stored in separate tables, just like `maps`.
  playerDescriptions: defineTable({
    worldId: v.id('worlds'),
    ...serializedPlayerDescription,
  }).index('worldId', ['worldId', 'playerId']),
  agentDescriptions: defineTable({
    worldId: v.id('worlds'),
    ...serializedAgentDescription,
  }).index('worldId', ['worldId', 'agentId']),

  //The game engine doesn't want to track players that have left or conversations that are over, since
  // it wants to keep its managed state small. However, we may want to look at old conversations in the
  // UI or from the agent code. So, whenever we delete an entry from within the world's document, we
  // "archive" it within these tables.
  archivedPlayers: defineTable({ worldId: v.id('worlds'), ...serializedPlayer }).index('worldId', [
    'worldId',
    'id',
  ]),
  archivedConversations: defineTable({
    worldId: v.id('worlds'),
    id: conversationId,
    creator: playerId,
    created: v.number(),
    ended: v.number(),
    lastMessage: serializedConversation.lastMessage,
    numMessages: serializedConversation.numMessages,
    participants: v.array(playerId),
    // Whether this was a group text rather than a face-to-face chat, so the
    // chat-history viewer can still tell them apart after the fact.
    isText: v.optional(v.boolean()),
  }).index('worldId', ['worldId', 'id']),
  archivedAgents: defineTable({ worldId: v.id('worlds'), ...serializedAgent }).index('worldId', [
    'worldId',
    'id',
  ]),

  // The agent layer wants to know what the last (completed) conversation was between two players,
  // so this table represents a labelled graph indicating which players have talked to each other.
  participatedTogether: defineTable({
    worldId: v.id('worlds'),
    conversationId,
    player1: playerId,
    player2: playerId,
    ended: v.number(),
  })
    .index('edge', ['worldId', 'player1', 'player2', 'ended'])
    .index('conversation', ['worldId', 'player1', 'conversationId'])
    .index('playerHistory', ['worldId', 'player1', 'ended']),

  // Durable log of conflicts and their consequences (affinity shifts, snubbed
  // invites, early group exits), buffered on the Game during a step and
  // inserted in saveDiff. Read by the Tensions feed and the inspector's
  // relationship history.
  relationshipEvents: defineTable({
    worldId: v.id('worlds'),
    ...serializedRelationshipEvent,
  })
    .index('world', ['worldId', 'at'])
    .index('actor', ['worldId', 'actor', 'at']),

  // Per-gauge short-term state transitions (convex/aiTown/shortTermEvents.ts).
  // The Agent keeps only the current value of each gauge; this keeps the
  // movement, which is what checking the update rules actually needs. Same
  // buffer-and-flush path as relationshipEvents above, vacuumed alongside it.
  shortTermEvents: defineTable({
    worldId: v.id('worlds'),
    ...serializedShortTermEvent,
  })
    .index('world', ['worldId', 'at'])
    .index('player', ['worldId', 'playerId', 'at']),

  // The perception stream (convex/aiTown/observation.ts): what each agent saw,
  // buffered by the engine during a step and flushed in saveDiff.
  //
  // Deliberately NOT the `memories` table. Observations outnumber conversation
  // memories by an order of magnitude, and both `memoriesForPlayer` (60 rows,
  // no type filter — the agents-popup debugging surface) and the reflection
  // window (100 rows) read `memories` unfiltered, so mixing them in would drown
  // both. The salient minority is promoted into `memories` with an embedding;
  // the rest stays here, queryable by recency and by the reacting loop.
  observations: defineTable({
    worldId: v.id('worlds'),
    ...serializedObservation,
  })
    .index('player', ['worldId', 'playerId', 'at'])
    .index('unprocessed', ['worldId', 'playerId', 'processed', 'at']),
};
