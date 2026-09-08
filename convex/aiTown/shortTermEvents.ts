// Validators for the durable short-term state log: one record per gauge change,
// with what caused it and what the gauge read before and after.
//
// The gauges themselves live on the Agent and are mutated in place, which is
// right for the simulation — nothing in the town needs yesterday's stress level.
// It is wrong for evaluating the simulation: "did mood move the direction the
// update rules say it should" cannot be answered from a single current value,
// and neither can "did state survive the gap between two scenarios". Both need
// the transitions, not the state.
//
// Modelled on relationshipEvents.ts, which does the same job for affinity, and
// kept dependency-light (convex/values and ./ids only) for the same reason: the
// engine, the input handlers, the queries and the frontend all touch it, and a
// heavier import here would drag them into the circular-import tangle around
// convex/aiTown/inputs.ts.
import { Infer, ObjectType, v } from 'convex/values';
import { conversationId, playerId } from './ids';

// Why a gauge moved. This is the join key between an observed transition and the
// rule that predicted it, so the values are the causes the update rules actually
// distinguish rather than a free-text label.
export const shortTermCause = v.union(
  // Fatigue from a work block or time spent away from home; hunger from time
  // passing. See Agent.accrueShortTermForStep.
  v.literal('activity'),
  // Eating: the only thing that brings hunger down.
  v.literal('meal'),
  // Sleeping: resets fatigue to its baseline.
  v.literal('rest'),
  // The daily illness penalty (SICK_STRESS_PER_DAY, SICK_MOOD_PENALTY_PER_DAY).
  v.literal('sickness'),
  // decayTowardBaseline on the daily tick.
  v.literal('dailyDecay'),
  // The Feelings line at the end of a conversation.
  v.literal('conversationFeelings'),
  // A scenario wrapping up, with its outcome.
  v.literal('scenarioOutcome'),
  // A human editing gauges from the agents panel. Has no expected direction.
  v.literal('manualOverride'),
);
export type ShortTermCause = Infer<typeof shortTermCause>;

export const serializedShortTermEvent = {
  // Engine time (`now`) when the change was applied.
  at: v.number(),
  playerId,
  // Which gauge moved. Not a union with the ShortTermComponent literals because
  // this table should keep recording if a fifth gauge is added later.
  component: v.string(),
  // Signed change actually applied, after the per-agent reactivity multiplier
  // and after clamping — so `valueBefore + delta === valueAfter` always holds,
  // which is what makes a direction check meaningful.
  delta: v.number(),
  valueBefore: v.number(),
  valueAfter: v.number(),
  cause: shortTermCause,
  // Short human-readable note, for the same reason relationshipEvents keeps one.
  reason: v.optional(v.string()),
  conversationId: v.optional(conversationId),
  scenarioId: v.optional(v.string()),
  // Only meaningful for 'scenarioOutcome': the expected direction of the mood
  // and stress change depends on whether the goal was met.
  goalMet: v.optional(v.boolean()),
};
export type SerializedShortTermEvent = ObjectType<typeof serializedShortTermEvent>;
