// A scenario the Decider invented, in transit between the generating action and
// the engine.
//
// data/scenarios.ts holds the authored catalogue as plain TypeScript. A generated
// scenario is the same shape, but it has to cross a Convex input boundary to
// reach the engine, so it needs a validator. Kept in its own leaf module (imports
// only convex/values and the ScenarioDef *type*) because both agentInputs.ts and
// the top-level scenarioGen.ts need it, and those two must not import each other.

import { Infer, v } from 'convex/values';
import type { ScenarioDef } from '../../data/scenarios';

export const serializedGeneratedScenario = v.object({
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
});
export type SerializedGeneratedScenario = Infer<typeof serializedGeneratedScenario>;

// Generated scenarios are always town-wide decisions: 'universal' so participants
// are simply whoever is free (a local scenario would need a workplace whose roster
// the generator has no reliable way to respect), and 'decision' so it runs the
// full Decider -> Focal -> Evaluator pipeline and gets scored like any other.
export function toScenarioDef(generated: SerializedGeneratedScenario): ScenarioDef {
  return {
    id: generated.defId,
    name: generated.name,
    emoji: generated.emoji,
    scope: 'universal',
    outcome: 'decision',
    minParticipants: Math.max(2, generated.minParticipants),
    instruction: generated.instruction,
    whatHappens: generated.whatHappens,
    background: generated.background,
    relationships: generated.relationships,
    context: generated.context,
    goals: generated.goals,
    conflict: generated.conflict,
    topics: generated.topics,
    completionGoal: generated.completionGoal,
  };
}
