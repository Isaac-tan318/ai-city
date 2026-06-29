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

  constructor(serialized: SerializedAgentDescription) {
    const { agentId, identity, profile, family } = serialized;
    this.agentId = parseGameId('agents', agentId);
    this.identity = identity;
    this.profile = profile;
    this.family = family;
  }

  serialize(): SerializedAgentDescription {
    const { agentId, identity, profile, family } = this;
    return { agentId, identity, profile, family };
  }
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
};
export type SerializedAgentDescription = ObjectType<typeof serializedAgentDescription>;
