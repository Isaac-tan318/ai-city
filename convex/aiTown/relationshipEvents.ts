// Validators for the durable relationship-event log: discrete records of
// conflicts and their consequences (affinity shifts, snubbed invites, early
// group exits) that the engine buffers during a step and flushes in saveDiff.
// Kept dependency-light (imports only convex/values and ./ids) so it can be
// shared by the engine, queries, and the frontend without risking the
// circular-import tangle around convex/aiTown/inputs.ts.
import { Infer, ObjectType, v } from 'convex/values';
import { conversationId, playerId } from './ids';

export const relationshipEventKind = v.union(
  // A conversation-end LLM affinity delta was applied.
  v.literal('affinityShift'),
  // A low-affinity acceptance roll failed and the inviter took it personally.
  v.literal('inviteDeclined'),
  // An agent drifted out of a group conversation early because they disliked
  // the company.
  v.literal('groupExit'),
);
export type RelationshipEventKind = Infer<typeof relationshipEventKind>;

export const serializedRelationshipEvent = {
  // Engine time (`now`) when the event was emitted.
  at: v.number(),
  kind: relationshipEventKind,
  // Whose feeling changed / who acted (e.g. the snubbed inviter, the leaver).
  actor: playerId,
  // Toward whom, when there is a single counterpart.
  target: v.optional(playerId),
  // Net applied affinity change (post-clamp), signed.
  delta: v.optional(v.number()),
  // The actor's affinity toward the target after the event.
  affinityAfter: v.optional(v.number()),
  // Short human-readable snippet for the feed and inspector.
  reason: v.optional(v.string()),
  conversationId: v.optional(conversationId),
  scenarioId: v.optional(v.string()),
  scenarioName: v.optional(v.string()),
};
export type SerializedRelationshipEvent = ObjectType<typeof serializedRelationshipEvent>;
