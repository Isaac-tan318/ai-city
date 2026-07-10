import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { agentTables } from './agent/schema';
import { aiTownTables } from './aiTown/schema';
import { conversationId, playerId } from './aiTown/ids';
import { engineTables } from './engine/schema';

export default defineSchema({
  music: defineTable({
    storageId: v.string(),
    type: v.union(v.literal('background'), v.literal('player')),
  }),

  messages: defineTable({
    conversationId,
    messageUuid: v.string(),
    author: playerId,
    text: v.string(),
    worldId: v.optional(v.id('worlds')),
    // The active-scenario instance id this message was spoken under (if the author
    // was enlisted in a scenario when they spoke). Lets participants read the chat
    // history of their scenario across its separate conversations.
    scenarioId: v.optional(v.string()),
  })
    .index('conversationId', ['worldId', 'conversationId'])
    .index('messageUuid', ['conversationId', 'messageUuid'])
    .index('by_scenario', ['worldId', 'scenarioId']),

  ...agentTables,
  ...aiTownTables,
  ...engineTables,
});
