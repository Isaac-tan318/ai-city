import { ObjectType, v } from 'convex/values';
import { GameId, agentId, parseGameId } from './ids';

export class AgentDescription {
  agentId: GameId<'agents'>;
  identity: string;
  // Structured background as a flat key-value map (field name -> value), e.g.
  // { "Dietary rule": "Halal only; no pork", "Communication style": "Direct" }.
  // This is the full background a character knows about *itself*; the compact
  // scenario-relevant view others see is derived from it by an extraction LLM
  // (see agentExtractScenarioProfile) and cached on the Agent.
  profile?: Record<string, string>;

  constructor(serialized: SerializedAgentDescription) {
    const { agentId, identity, profile } = serialized;
    this.agentId = parseGameId('agents', agentId);
    this.identity = identity;
    this.profile = profile;
  }

  serialize(): SerializedAgentDescription {
    const { agentId, identity, profile } = this;
    return { agentId, identity, profile };
  }
}

export const serializedAgentDescription = {
  agentId,
  identity: v.string(),
  // Structured key-value background. Optional for backwards-compatibility with
  // documents written before structured profiles existed.
  profile: v.optional(v.record(v.string(), v.string())),
  // Kept optional for backwards-compatibility with existing documents written
  // before long-term plans were removed. Not read anywhere in the codebase.
  plan: v.optional(v.string()),
};
export type SerializedAgentDescription = ObjectType<typeof serializedAgentDescription>;
