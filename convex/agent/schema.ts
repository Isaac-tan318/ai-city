import { v } from 'convex/values';
import { playerId, conversationId } from '../aiTown/ids';
import { defineTable } from 'convex/server';
import { EMBEDDING_DIMENSION } from '../util/llm';

export const memoryFields = {
  playerId,
  description: v.string(),
  embeddingId: v.id('memoryEmbeddings'),
  importance: v.number(),
  lastAccess: v.number(),
  data: v.union(
    // Setting up dynamics between players
    v.object({
      type: v.literal('relationship'),
      // The player this memory is about, from the perspective of the player
      // whose memory this is.
      playerId,
    }),
    v.object({
      type: v.literal('conversation'),
      conversationId,
      // The other player(s) in the conversation.
      playerIds: v.array(playerId),
    }),
    v.object({
      type: v.literal('reflection'),
      relatedMemoryIds: v.array(v.id('memories')),
    }),
    // A salient perception promoted out of the `observations` table (see
    // convex/aiTown/observation.ts). Only observations above an importance floor
    // get here; the ambient majority never becomes a memory.
    v.object({
      type: v.literal('observation'),
      subjectPlayerIds: v.array(playerId),
    }),
    // The lasting takeaway an agent forms when a scenario wraps up. Kept
    // distinct from 'reflection' on purpose: `lastReflectionTs` is derived from
    // the newest reflection-typed memory, so storing these as reflections reset
    // the reflection accumulator on every scenario and kept it from ever
    // reaching its threshold.
    v.object({
      type: v.literal('scenarioOutcome'),
      scenarioName: v.optional(v.string()),
      goalMet: v.optional(v.boolean()),
    }),
  ),
};
export const memoryTables = {
  memories: defineTable(memoryFields)
    .index('embeddingId', ['embeddingId'])
    .index('playerId_type', ['playerId', 'data.type'])
    .index('playerId', ['playerId']),
  memoryEmbeddings: defineTable({
    playerId,
    embedding: v.array(v.float64()),
  }).vectorIndex('embedding', {
    vectorField: 'embedding',
    filterFields: ['playerId'],
    dimensions: EMBEDDING_DIMENSION,
  }),
};

export const agentTables = {
  ...memoryTables,
  embeddingsCache: defineTable({
    textHash: v.bytes(),
    embedding: v.array(v.float64()),
  }).index('text', ['textHash']),
};
