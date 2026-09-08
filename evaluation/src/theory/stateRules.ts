// The Short-Term State Update Rules, restated as expected directions.
//
// Component 5 asks whether a state moved the way the mechanism says it should.
// That only means something if the expectation is written down independently of
// the code that produces the movement, so this file transcribes the rules from
// their implementations rather than importing the logic:
//
//   convex/aiTown/agent.ts        per-step fatigue and hunger accrual, the daily
//                                 tick (decay toward baseline, sickness)
//   convex/aiTown/agentInputs.ts  agentApplyShortTerm, agentSetState
//   convex/agent/memory.ts        heuristicScenarioFeelings, the Feelings line
//
// The baselines and the decay step ARE imported, because those are tuning
// numbers rather than behaviour, and a copy of them here would silently go stale
// the first time somebody retunes the simulation.
import {
  FATIGUE_BASELINE,
  HUNGER_BASELINE,
  MOOD_BASELINE,
  SHORT_TERM_DAILY_DECAY,
  STRESS_BASELINE,
} from '../../../convex/constants';
import type { ExpectedMove } from '../metrics';

export const BASELINES: Record<string, number> = {
  mood: MOOD_BASELINE,
  stress: STRESS_BASELINE,
  fatigue: FATIGUE_BASELINE,
  hunger: HUNGER_BASELINE,
};

export function baselineFor(component: string): number {
  return BASELINES[component] ?? 0;
}

// A gauge that jumps further than one day's worth of decay back toward its
// baseline has been reset, not nudged. Using the simulation's own decay step as
// the threshold means "large" is defined by the mechanism rather than picked.
export const RESET_THRESHOLD = SHORT_TERM_DAILY_DECAY;

// Causes for which a big move back to baseline is the intended behaviour. Any
// other cause producing one is an unexpected reset.
export const VALID_RESET_CAUSES = ['dailyDecay', 'meal', 'rest', 'manualOverride'];

// Extra facts about an event that the direction can depend on. `valence` is the
// only one that cannot be read off the log — whether a conversation went well is
// a judgement, made by judges/valence.ts.
export type EventContext = {
  valence?: 'positive' | 'negative' | 'neutral';
  goalMet?: boolean;
};

// The expected direction for one (cause, component) pair. Returns undefined when
// the rules say nothing about that pair — an unknown cause, or a gauge this
// cause does not touch — so it can be excluded rather than guessed at.
export function expectedMove(
  cause: string,
  component: string,
  context: EventContext = {},
): ExpectedMove | undefined {
  switch (cause) {
    // Work blocks and time spent away from home accrue fatigue; time passing
    // accrues hunger. Neither ever moves the other way.
    case 'activity':
      if (component === 'fatigue' || component === 'hunger') return 'up';
      return undefined;

    // Eating is the only thing that brings hunger down.
    case 'meal':
      if (component === 'hunger') return 'down';
      return undefined;

    // Sleeping resets fatigue to its baseline. A legitimate reset, so a large
    // jump here is expected rather than state being discarded between scenarios.
    case 'rest':
      if (component === 'fatigue') return 'down';
      return undefined;

    // SICK_STRESS_PER_DAY and SICK_MOOD_PENALTY_PER_DAY, applied on the daily
    // tick while an agent is unwell.
    case 'sickness':
      if (component === 'stress') return 'up';
      if (component === 'mood') return 'down';
      return undefined;

    // decayTowardBaseline moves every gauge a step toward its resting value,
    // from whichever side it currently sits on.
    case 'dailyDecay':
      return 'toward-baseline';

    // The Feelings line at the end of a conversation. Direction follows how the
    // conversation actually went, which is why this one needs a judgement.
    case 'conversationFeelings': {
      if (context.valence === 'neutral' || context.valence === undefined) return undefined;
      const good = context.valence === 'positive';
      if (component === 'mood') return good ? 'up' : 'down';
      if (component === 'stress') return good ? 'down' : 'up';
      return undefined;
    }

    // heuristicScenarioFeelings: goal met lifts mood and drops stress; goal
    // missed does the reverse, more so when the scenario carried a conflict.
    case 'scenarioOutcome': {
      if (context.goalMet === undefined) return undefined;
      if (component === 'mood') return context.goalMet ? 'up' : 'down';
      if (component === 'stress') return context.goalMet ? 'down' : 'up';
      return undefined;
    }

    // A human editing gauges from the agents panel. Deliberately outside the
    // accuracy denominator: "set mood to 40" has no expected direction.
    case 'manualOverride':
      return 'unconstrained';

    default:
      return undefined;
  }
}

// Causes that need a judgement before their direction is known. The analyzer
// only pays for a valence call when one of these is actually present.
export const CAUSES_NEEDING_JUDGEMENT = ['conversationFeelings'];
