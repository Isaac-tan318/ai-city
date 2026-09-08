// What this program will accept as input.
//
// Two shapes, both validated before anything else touches them, because a
// half-parsed corpus produces metrics that look plausible and are wrong:
//
//   1. Chat-history JSON — exactly what the "Export JSON" button in the chat
//      history viewer already downloads (convex/messages.ts exportAllConversations).
//      Needs no setup at all, and supports Components 1 and 4.
//
//   2. Bundle JSON — the richer admin export (convex/evaluationExport.ts). Adds
//      ground truth, candidate options, evaluations and the short-term state log,
//      which is what Components 3 and 5 and the aggregation comparison need.
//
// Fields the exports may or may not carry are optional here rather than
// defaulted, so `normalize` can tell "absent" from "empty" and the report can
// say which components the input could not support.
import { z } from 'zod';

// --- 1. Chat-history export ----------------------------------------------------

export const chatHistoryMessage = z.object({
  // Resolved to a display name by the export, not a raw player id.
  author: z.string(),
  text: z.string(),
  timestamp: z.string(),
  // Present only once convex/messages.ts stamps it (see the Part 2 change).
  scenarioId: z.string().optional(),
});

export const chatHistoryConversation = z.object({
  id: z.string(),
  created: z.string(),
  ended: z.string(),
  participants: z.array(z.object({ id: z.string(), name: z.string() })),
  numMessages: z.number().optional(),
  messages: z.array(chatHistoryMessage),
});

export const chatHistoryExport = z.array(chatHistoryConversation);
export type ChatHistoryExport = z.infer<typeof chatHistoryExport>;

// --- 2. Bundle export ----------------------------------------------------------

export const bundleGroundTruth = z.object({
  playerId: z.string(),
  name: z.string(),
  culturalBackground: z.string(),
  religion: z.string(),
  hardTaboos: z.array(z.string()),
  essentialNeeds: z.array(z.string()),
  preferences: z.array(z.string()),
  budgetLimit: z.number(),
  communicationStyle: z.string(),
});

export const bundleDecision = z.object({
  scenarioId: z.string(),
  scenarioName: z.string(),
  focalPlayerId: z.string(),
  focalName: z.string(),
  selectedOptionId: z.string(),
  selectedOptionTitle: z.string(),
  aggregatedGroupUtility: z.number(),
  bestOptionId: z.string(),
  bestOptionTitle: z.string(),
  bestGroupUtility: z.number(),
  regret: z.number(),
  questionsAsked: z.number(),
  forcedDecision: z.boolean(),
  optionScores: z.array(
    z.object({ optionId: z.string(), title: z.string(), groupUtility: z.number() }),
  ),
  agentScores: z.array(
    z.object({
      playerId: z.string(),
      name: z.string(),
      hardTabooViolated: z.boolean(),
      violatedTaboo: z.string().optional(),
      reason: z.string().optional(),
      totalIndividualUtility: z.number(),
    }),
  ),
  at: z.number(),
  // Joined in from deciderTraces: the full candidate menu, not just the winner.
  // Without this the aggregation comparison has only one option to compare.
  options: z
    .array(
      z.object({
        optionId: z.string(),
        title: z.string(),
        details: z.string().default(''),
        rationale: z.string().default(''),
        riskNote: z.string().default(''),
      }),
    )
    .default([]),
  // Per-option, per-agent utilities. The evaluations row keeps per-agent scores
  // only for the option that won, so this is filled from a re-run when present
  // and left empty otherwise.
  perOptionUtilities: z
    .array(
      z.object({
        optionId: z.string(),
        utilities: z.array(z.object({ name: z.string(), utility: z.number() })),
      }),
    )
    .default([]),
});

export const bundleStateEvent = z.object({
  at: z.number(),
  playerId: z.string(),
  name: z.string().optional(),
  component: z.string(),
  delta: z.number(),
  valueBefore: z.number(),
  valueAfter: z.number(),
  cause: z.string(),
  reason: z.string().optional(),
  conversationId: z.string().optional(),
  scenarioId: z.string().optional(),
  // Only meaningful for cause 'scenarioOutcome': the direction the feelings
  // rules expect depends on whether the scenario goal was met.
  goalMet: z.boolean().optional(),
});

export const bundleExport = z.object({
  kind: z.literal('ai-town-evaluation-bundle'),
  world: z.object({ worldId: z.string(), exportedAt: z.number().optional() }),
  players: z.array(
    z.object({ playerId: z.string(), name: z.string(), character: z.string().optional() }),
  ),
  groundTruth: z.array(bundleGroundTruth).default([]),
  conversations: z
    .array(
      chatHistoryConversation.extend({
        scenarioIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  decisions: z.array(bundleDecision).default([]),
  perceivedKnowledge: z
    .array(
      z.object({
        focalPlayerId: z.string(),
        targetPlayerId: z.string(),
        knownTaboos: z.array(z.string()),
        knownPreferences: z.array(z.string()),
        uncertainties: z.array(z.string()),
        confidenceScore: z.number(),
        updatedAt: z.number(),
      }),
    )
    .default([]),
  shortTermEvents: z.array(bundleStateEvent).default([]),
});
export type BundleExport = z.infer<typeof bundleExport>;
