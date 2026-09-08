import { ObjectType, v } from 'convex/values';
import { GameId, agentId, parseGameId } from './ids';
import { FamilyTie } from './affinity';

export class AgentDescription {
  agentId: GameId<'agents'>;
  identity: string;
  // Structured background as a flat key-value map (field name -> value), e.g.
  // { "Dietary rule": "Halal only; no pork", "Communication style": "Direct" }.
  // This is the full background a character knows about *itself*; the compact
  // scenario-relevant view others see is derived from it by an extraction LLM
  // (see agentExtractScenarioProfile) and cached on the Agent.
  profile?: Record<string, string>;
  // Immutable family ties, authored by character name in data/characters.ts.
  // Directional relation labels (this character's view of each relative).
  family?: FamilyTie[];
  // Who this character has BECOME: rewritten once per in-game day from their own
  // reflections and memories (see agentRegenerateSelfSummary). `identity` above
  // stays exactly as authored — it's the day-0 seed, so drift is always visible
  // as the difference between the two, and always recoverable.
  selfSummary?: string;
  selfSummaryDay?: number;

  constructor(serialized: SerializedAgentDescription) {
    const { agentId, identity, profile, family, selfSummary, selfSummaryDay } = serialized;
    this.agentId = parseGameId('agents', agentId);
    this.identity = identity;
    this.profile = profile;
    this.family = family;
    this.selfSummary = selfSummary;
    this.selfSummaryDay = selfSummaryDay;
  }

  serialize(): SerializedAgentDescription {
    const { agentId, identity, profile, family, selfSummary, selfSummaryDay } = this;
    return { agentId, identity, profile, family, selfSummary, selfSummaryDay };
  }
}

// The identity every prompt should use: who the character has become if they've
// lived long enough to have a summary, otherwise who they were authored to be.
//
// Route ALL identity reads through this. Swapping it in only some places gives
// an agent who talks like the person they've grown into but plans like the
// person they started as.
export function effectiveIdentity(
  desc: { identity: string; selfSummary?: string } | null | undefined,
): string | undefined {
  if (!desc) return undefined;
  return desc.selfSummary ?? desc.identity;
}

export const serializedAgentDescription = {
  agentId,
  identity: v.string(),
  // Structured key-value background. Optional for backwards-compatibility with
  // documents written before structured profiles existed.
  profile: v.optional(v.record(v.string(), v.string())),
  // Immutable family relationships (name + directional relation label). Optional
  // for backwards-compatibility and because most characters have none.
  family: v.optional(v.array(v.object({ name: v.string(), relation: v.string() }))),
  // Kept optional for backwards-compatibility with existing documents written
  // before long-term plans were removed. Not read anywhere in the codebase.
  plan: v.optional(v.string()),
  // The evolving self-summary and the in-game day it was last written.
  selfSummary: v.optional(v.string()),
  selfSummaryDay: v.optional(v.number()),
};
export type SerializedAgentDescription = ObjectType<typeof serializedAgentDescription>;
