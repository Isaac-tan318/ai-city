import { Infer, ObjectType, v } from 'convex/values';
import { Conversation, serializedConversation } from './conversation';
import { Player, serializedPlayer } from './player';
import { Agent, serializedAgent } from './agent';
import { GameId, parseGameId, playerId } from './ids';
import { parseMap } from '../util/object';
import { point } from '../util/types';

export const historicalLocations = v.array(
  v.object({
    playerId,
    location: v.bytes(),
  }),
);

// An automatic scenario that is currently active (see data/scenarios.ts and
// convex/aiTown/scenarios.ts). The detail fields are copied from the definition
// at activation so the client can render the info panel without the library.
export const serializedActiveScenario = v.object({
  id: v.string(), // unique instance id (defId + start time)
  defId: v.string(),
  scope: v.union(v.literal('universal'), v.literal('local')),
  name: v.string(),
  emoji: v.string(),
  locationId: v.optional(v.string()),
  // Map-marker tile position for local scenarios.
  x: v.optional(v.number()),
  y: v.optional(v.number()),
  instruction: v.string(),
  whatHappens: v.string(),
  background: v.string(),
  relationships: v.string(),
  context: v.string(),
  goals: v.string(),
  // Concrete discussion beats and the completion goal for the scenario's
  // conversations (see data/scenarios.ts). Optional for backward-compat with
  // worlds serialized before these fields existed.
  topics: v.optional(v.array(v.string())),
  completionGoal: v.optional(v.string()),
  // Live completion tracking, surfaced in the UI. `topicsDone[i]` flips true once
  // the dialogue goal-judge sees topic `i` substantively covered; `goalMet` flips
  // true once the overall goal is judged achieved.
  topicsDone: v.optional(v.array(v.boolean())),
  goalMet: v.optional(v.boolean()),
  participantIds: v.array(playerId),
  participantNames: v.array(v.string()),
  startTime: v.number(),
  // When the scenario's content begins. For local scenarios this is after the
  // gathering phase (participants travel to the spot first); for universal ones
  // it equals startTime. Optional/defaulted for backward-compat.
  contentStartTime: v.optional(v.number()),
  // 'gathering' while participants are still travelling to a local scenario's
  // location; 'active' once they've arrived (or universal scenarios, immediately).
  phase: v.optional(v.union(v.literal('gathering'), v.literal('active'))),
  endTime: v.number(),
});
export type SerializedActiveScenario = Infer<typeof serializedActiveScenario>;

export const serializedWorld = {
  nextId: v.number(),
  conversations: v.array(v.object(serializedConversation)),
  players: v.array(v.object(serializedPlayer)),
  agents: v.array(v.object(serializedAgent)),
  scenarioTarget: v.optional(point),
  scenarioName: v.optional(v.string()),
  scenarioInstruction: v.optional(v.string()),
  // Real-epoch ms when the current custom scenario was injected. Used to auto-
  // expire `scenarioInstruction` after one in-game day so agents stop re-enacting
  // the scenario (their memories of it remain).
  scenarioStartTime: v.optional(v.number()),
  // --- Automatic scenarios ---
  activeScenarios: v.optional(v.array(serializedActiveScenario)),
  // Real-epoch ms of the last scenario-manager evaluation (throttle).
  lastScenarioEval: v.optional(v.number()),
  // Real-epoch ms the next scenario is scheduled to start — drives the on-screen
  // "next scenario" countdown.
  nextScenarioTime: v.optional(v.number()),
  // scopeKey ('universal' | 'local:<locationId>') -> earliest real-ms a new
  // scenario for that scope may start (post-scenario cooldown).
  scenarioCooldowns: v.optional(v.record(v.string(), v.number())),
  historicalLocations: v.optional(historicalLocations),
  worldStartTime: v.optional(v.number()),
};
export type SerializedWorld = ObjectType<typeof serializedWorld>;

export class World {
  nextId: number;
  conversations: Map<GameId<'conversations'>, Conversation>;
  players: Map<GameId<'players'>, Player>;
  agents: Map<GameId<'agents'>, Agent>;
  historicalLocations?: Map<GameId<'players'>, ArrayBuffer>;
  scenarioTarget?: { x: number; y: number };
  scenarioName?: string;
  scenarioInstruction?: string;
  scenarioStartTime?: number;
  activeScenarios?: SerializedActiveScenario[];
  lastScenarioEval?: number;
  nextScenarioTime?: number;
  scenarioCooldowns?: Record<string, number>;
  worldStartTime?: number;

  constructor(serialized: SerializedWorld) {
    const { nextId, historicalLocations, scenarioTarget, scenarioName, scenarioInstruction, scenarioStartTime, worldStartTime } = serialized;

    this.nextId = nextId;
    this.conversations = parseMap(serialized.conversations, Conversation, (c) => c.id);
    this.players = parseMap(serialized.players, Player, (p) => p.id);
    this.agents = parseMap(serialized.agents, Agent, (a) => a.id);
    this.scenarioTarget = scenarioTarget;
    this.scenarioName = scenarioName;
    this.scenarioInstruction = scenarioInstruction;
    this.scenarioStartTime = scenarioStartTime;
    this.activeScenarios = serialized.activeScenarios;
    this.lastScenarioEval = serialized.lastScenarioEval;
    this.nextScenarioTime = serialized.nextScenarioTime;
    this.scenarioCooldowns = serialized.scenarioCooldowns;
    this.worldStartTime = worldStartTime;

    if (historicalLocations) {
      this.historicalLocations = new Map();
      for (const { playerId, location } of historicalLocations) {
        this.historicalLocations.set(parseGameId('players', playerId), location);
      }
    }
  }

  playerConversation(player: Player): Conversation | undefined {
    return [...this.conversations.values()].find((c) => c.participants.has(player.id));
  }

  serialize(): SerializedWorld {
    return {
      nextId: this.nextId,
      conversations: [...this.conversations.values()].map((c) => c.serialize()),
      players: [...this.players.values()].map((p) => p.serialize()),
      agents: [...this.agents.values()].map((a) => a.serialize()),
      scenarioTarget: this.scenarioTarget,
      scenarioName: this.scenarioName,
      scenarioInstruction: this.scenarioInstruction,
      scenarioStartTime: this.scenarioStartTime,
      activeScenarios: this.activeScenarios,
      lastScenarioEval: this.lastScenarioEval,
      nextScenarioTime: this.nextScenarioTime,
      scenarioCooldowns: this.scenarioCooldowns,
      worldStartTime: this.worldStartTime,
      historicalLocations:
        this.historicalLocations &&
        [...this.historicalLocations.entries()].map(([playerId, location]) => ({
          playerId,
          location,
        })),
    };
  }
}
