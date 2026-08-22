import { Infer, ObjectType, v } from 'convex/values';
import { Conversation, serializedConversation } from './conversation';
import { Player, serializedPlayer } from './player';
import { Agent, serializedAgent } from './agent';
import { GameId, parseGameId, playerId } from './ids';
import { parseMap } from '../util/object';
import { point } from '../util/types';
import { serializedDeliberation } from './deliberation';

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
  // Authored point of disagreement (copied from the ScenarioDef), shown in the
  // detail panel. Optional — omitted for friction-free scenarios.
  conflict: v.optional(v.string()),
  // What the scenario drives toward: 'tasks' (planning chat -> delegated work /
  // "working" phase) or 'decision' (chat until the group reaches a joint decision;
  // no tasks). Resolved in startScenario; optional for backward-compat.
  outcome: v.optional(v.union(v.literal('tasks'), v.literal('decision'))),
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
  // Engine-time (≈ epoch ms) each topic was first marked done / the goal was met,
  // so the chat can drop a completion marker at the right point in the timeline.
  topicsDoneAt: v.optional(v.array(v.number())),
  goalMetAt: v.optional(v.number()),
  participantIds: v.array(playerId),
  participantNames: v.array(v.string()),
  startTime: v.number(),
  // How long the content window runs once the scenario goes active (real ms).
  // Recorded here rather than re-derived from the def each time, because a
  // manually-started scenario runs longer than the def's default and promotion out
  // of the gathering phase recomputes endTime. Optional for backward-compat.
  durationMs: v.optional(v.number()),
  // When the scenario's content begins. For local scenarios this is after the
  // gathering phase (participants travel to the spot first); for universal ones
  // it equals startTime. Optional/defaulted for backward-compat.
  contentStartTime: v.optional(v.number()),
  // 'waiting' while the cast isn't free yet (asleep, or pinned to a work shift) —
  // the scenario is queued and begins once they are; 'gathering' while participants
  // are travelling to the meeting spot; 'active' once they've arrived; 'working'
  // for a local scenario after its planning conversation has delegated concrete
  // tasks — participants disperse and each performs their assigned task.
  phase: v.optional(
    v.union(
      v.literal('waiting'),
      v.literal('gathering'),
      v.literal('active'),
      v.literal('working'),
    ),
  ),
  // Where the cast meets to talk. Local scenarios use their workplace tile; a
  // universal one has no locationId, so the spot is computed from where the cast
  // actually is and recorded here (maybePromoteScenario needs it to test arrival).
  gatherX: v.optional(v.number()),
  gatherY: v.optional(v.number()),
  // While phase === 'waiting', the real-ms deadline past which the scenario starts
  // anyway rather than waiting out a cast that never all comes free at once.
  waitUntil: v.optional(v.number()),
  // Concrete, LLM-generated tasks for the "working" phase of a local scenario, each
  // delegated to a participant. Absent for universal scenarios (which stay on the
  // talk-based topics model) and before delegation.
  tasks: v.optional(
    v.array(
      v.object({
        label: v.string(),
        emoji: v.string(),
        assigneeId: v.optional(playerId),
        assigneeName: v.optional(v.string()),
        // Engine-time (≈ epoch ms) this task became the assignee's active task, and
        // the moment it finished. `startedAt`..`until` (= startedAt + durationMs)
        // drives the on-screen progress bar.
        startedAt: v.optional(v.number()),
        durationMs: v.number(),
        doneAt: v.optional(v.number()),
      }),
    ),
  ),
  // Set true once the (single) task-planning op has been requested for this
  // scenario, so only one participant fires it. Cleared implies not yet delegated.
  taskPlanRequested: v.optional(v.boolean()),
  // Decision-scenario deliberation state (outcome === 'decision' only). Absent for
  // 'tasks' scenarios and for worlds serialized before the decision engine existed.
  deliberation: v.optional(serializedDeliberation),
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
  // Who the custom scenario actually enlisted. Agents adopt `scenarioInstruction`
  // by looking themselves up here, so a custom scenario involves a group rather
  // than the entire town. Absent means "everyone" — the legacy broadcast, kept for
  // worlds serialized before the list existed and for the meet-at-the-park button.
  scenarioParticipantIds: v.optional(v.array(playerId)),
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
  // Real-epoch ms when the manager asked the Decider to invent a scenario
  // (convex/scenarioGen.ts). Set while that op is in flight so only one is ever
  // requested; cleared when it lands, or timed out so a failed generation falls
  // back to the authored catalogue instead of stalling the rotation.
  scenarioGenRequested: v.optional(v.number()),
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
  scenarioParticipantIds?: GameId<'players'>[];
  scenarioStartTime?: number;
  activeScenarios?: SerializedActiveScenario[];
  lastScenarioEval?: number;
  nextScenarioTime?: number;
  scenarioCooldowns?: Record<string, number>;
  scenarioGenRequested?: number;
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
    this.scenarioParticipantIds = serialized.scenarioParticipantIds?.map((id) =>
      parseGameId('players', id),
    );
    this.scenarioStartTime = scenarioStartTime;
    this.activeScenarios = serialized.activeScenarios;
    this.lastScenarioEval = serialized.lastScenarioEval;
    this.nextScenarioTime = serialized.nextScenarioTime;
    this.scenarioCooldowns = serialized.scenarioCooldowns;
    this.scenarioGenRequested = serialized.scenarioGenRequested;
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
      scenarioParticipantIds: this.scenarioParticipantIds,
      scenarioStartTime: this.scenarioStartTime,
      activeScenarios: this.activeScenarios,
      lastScenarioEval: this.lastScenarioEval,
      nextScenarioTime: this.nextScenarioTime,
      scenarioCooldowns: this.scenarioCooldowns,
      scenarioGenRequested: this.scenarioGenRequested,
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
