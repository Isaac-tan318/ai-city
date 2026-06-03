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
};
export type SerializedAgentDescription = ObjectType<typeof serializedAgentDescription>;
