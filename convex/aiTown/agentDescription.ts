import { ObjectType, v } from 'convex/values';
import { GameId, agentId, parseGameId } from './ids';

export class AgentDescription {
  agentId: GameId<'agents'>;
  identity: string;

  constructor(serialized: SerializedAgentDescription) {
    const { agentId, identity } = serialized;
    this.agentId = parseGameId('agents', agentId);
    this.identity = identity;
  }

  serialize(): SerializedAgentDescription {
    const { agentId, identity } = this;
    return { agentId, identity };
  }
}

export const serializedAgentDescription = {
  agentId,
  identity: v.string(),
  // Kept optional for backwards-compatibility with existing documents written
  // before long-term plans were removed. Not read anywhere in the codebase.
  plan: v.optional(v.string()),
};
export type SerializedAgentDescription = ObjectType<typeof serializedAgentDescription>;
