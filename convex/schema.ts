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

  // --- Decider / Focal / Evaluator decision engine -------------------------
  //
  // Three tables, split by who is allowed to read them:
  //   groundTruthProfiles — the hidden answer key. ONLY convex/evaluator.ts.
  //   perceivedKnowledge  — what a focal agent has managed to infer. The focal
  //                         agent's own beliefs, which may simply be wrong.
  //   evaluations         — the scored outcome, kept after the scenario is torn
  //                         down and the world doc forgets it.
  //
  // All three key off `playerId` rather than `agentId`: messages.author and
  // agent.affinities are keyed by player, so player is the id that already joins.
  // Both are reallocated on wipe+init, hence the worldId in every index.

  groundTruthProfiles: defineTable({
    worldId: v.id('worlds'),
    playerId,
    name: v.string(),
    culturalBackground: v.string(),
    religion: v.string(),
    // Absolute constraints (religious / medical / legal). Violating one zeroes
    // that agent's utility for the option outright — see convex/scoring.ts.
    hardTaboos: v.array(v.string()),
    essentialNeeds: v.array(v.string()),
    preferences: v.array(v.string()),
    budgetLimit: v.number(),
    communicationStyle: v.string(),
  })
    .index('by_player', ['worldId', 'playerId'])
    .index('by_name', ['worldId', 'name'])
    .index('by_world', ['worldId']),

  perceivedKnowledge: defineTable({
    worldId: v.id('worlds'),
    focalPlayerId: playerId,
    targetPlayerId: playerId,
    knownTaboos: v.array(v.string()),
    knownPreferences: v.array(v.string()),
    // Open questions the focal agent knows it cannot yet answer. Draining this
    // list is what its clarifying questions are for.
    uncertainties: v.array(v.string()),
    confidenceScore: v.number(), // 0..1
    updatedAt: v.number(),
  })
    .index('by_focal_target', ['worldId', 'focalPlayerId', 'targetPlayerId'])
    .index('by_focal', ['worldId', 'focalPlayerId']),

  // The Decider's reasoning when it framed a decision — why these options, what
  // each trades off, and who it *guessed* each might not suit. Durable because the
  // scenario's deliberation block is deleted from the world doc at teardown, and
  // because the interesting comparison is against the evaluator's ground truth,
  // which only arrives later.
  deciderTraces: defineTable({
    worldId: v.id('worlds'),
    scenarioId: v.string(),
    scenarioName: v.string(),
    participantNames: v.array(v.string()),
    reasoning: v.string(),
    options: v.array(
      v.object({
        optionId: v.string(),
        title: v.string(),
        details: v.string(),
        rationale: v.string(),
        // The Decider's guess at who this would quietly not suit, made WITHOUT
        // ground truth. Checking it against what the evaluator later found is the
        // point of keeping it.
        riskNote: v.string(),
      }),
    ),
    at: v.number(),
  })
    .index('by_world', ['worldId', 'at'])
    .index('by_scenario', ['worldId', 'scenarioId']),

  // Scenarios the Decider invented rather than drew from data/scenarios.ts, kept
  // with the town state that prompted them so a good one can be re-run and a bad
  // one can be traced back to what it misread.
  generatedScenarios: defineTable({
    worldId: v.id('worlds'),
    // Doubles as ScenarioDef.id once fired, so an active scenario instance id
    // ('<defId>-<startTime>') points back at this row.
    defId: v.string(),
    name: v.string(),
    emoji: v.string(),
    instruction: v.string(),
    whatHappens: v.string(),
    background: v.string(),
    relationships: v.string(),
    context: v.string(),
    goals: v.string(),
    conflict: v.optional(v.string()),
    topics: v.array(v.string()),
    completionGoal: v.string(),
    minParticipants: v.number(),
    // Why the Decider thought this situation was worth staging.
    reasoning: v.string(),
    // The specific things about the town it drew on — a discovered constraint, a
    // soured relationship, an unresolved thread. Lets you check whether it built
    // on something real or invented a premise out of nothing.
    groundedIn: v.array(v.string()),
    createdBy: v.union(v.literal('auto'), v.literal('manual')),
    // Set when this scenario actually started, so the panel can distinguish
    // drafts from ones the town really played out.
    usedAt: v.optional(v.number()),
    at: v.number(),
  })
    .index('by_world', ['worldId', 'at'])
    .index('by_defId', ['worldId', 'defId']),

  evaluations: defineTable({
    worldId: v.id('worlds'),
    // The active-scenario INSTANCE id ('defId-startTime'), which messages are
    // already stamped with — so an evaluation joins straight to its transcript
    // through the messages `by_scenario` index.
    scenarioId: v.string(),
    scenarioName: v.string(),
    focalPlayerId: playerId,
    focalName: v.string(),
    selectedOptionId: v.string(),
    selectedOptionTitle: v.string(),
    aggregatedGroupUtility: v.number(),
    // The option the group *should* have picked, by ground truth, and the gap.
    bestOptionId: v.string(),
    bestOptionTitle: v.string(),
    bestGroupUtility: v.number(),
    regret: v.number(),
    questionsAsked: v.number(),
    // True when a safety valve (question budget, message cap, scenario expiry)
    // forced the commitment rather than the stopping criteria being satisfied.
    forcedDecision: v.boolean(),
    optionScores: v.array(
      v.object({
        optionId: v.string(),
        title: v.string(),
        groupUtility: v.number(),
      }),
    ),
    agentScores: v.array(
      v.object({
        playerId,
        name: v.string(),
        hardTabooViolated: v.boolean(),
        violatedTaboo: v.optional(v.string()),
        // The evaluator's one-line account of what drove this person's score,
        // shown beside them in the end-of-scenario scorecard.
        reason: v.optional(v.string()),
        dimensionFactors: v.object({
          essentialNeeds: v.number(),
          preferenceMatch: v.number(),
          costTimeBurden: v.number(),
          fairness: v.number(),
          socialComfort: v.number(),
          relationshipImpact: v.number(),
        }),
        totalIndividualUtility: v.number(),
      }),
    ),
    commentary: v.string(),
    at: v.number(),
  })
    .index('by_world', ['worldId', 'at'])
    .index('by_scenario', ['worldId', 'scenarioId']),

  ...agentTables,
  ...aiTownTables,
  ...engineTables,
});
