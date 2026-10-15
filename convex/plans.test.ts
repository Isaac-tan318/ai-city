import { Agent, type ScheduleStep } from './aiTown/agent';
import type { Game } from './aiTown/game';
import type { Player } from './aiTown/player';
import { cycleProgressForHour } from './aiTown/gameTime';
import { homeFor, workplaceFor } from '../data/cityLocations';
import { mergeFixedObligations } from '../data/routines';
import { STEP_SETTLED_RADIUS } from './constants';

// `Agent.pendingStep` is the predicate behind "the plan comes first": it answers
// whether this agent is on their way somewhere they are already due. Four
// separate behaviours read it — starting a conversation, joining a nearby one,
// accepting an invitation, and (for obligations only) excusing themselves from
// one already under way — so it is worth testing on its own rather than through
// any of them.
//
// It touches almost nothing on the world: the day's clock and the active
// scenario list. Those are stubbed rather than built, so this stays a unit test.
const WORK = { x: 13, y: 8 };
const HOME = { x: 40, y: 30 };

function gameAt(hour: number, now = Date.now()): Game {
  return {
    world: { worldStartTime: now - cycleProgressForHour(hour), activeScenarios: [] },
  } as unknown as Game;
}

const playerAt = (x: number, y: number) => ({ position: { x, y } }) as unknown as Player;

const step = (over: Partial<ScheduleStep> = {}): ScheduleStep => ({
  startMinute: 9 * 60,
  locationId: 'astar',
  destination: WORK,
  activity: 'running experiments in the lab',
  description: 'on shift at work',
  fixed: true,
  ...over,
});

function agentWith(schedule: ScheduleStep[], over: Record<string, unknown> = {}): Agent {
  return new Agent({
    id: 'a:1',
    playerId: 'p:1',
    schedule,
    currentStepIndex: 0,
    ...over,
  } as any);
}

describe('is this agent on their way somewhere they are due?', () => {
  test('walking to a step that has started counts as pending', () => {
    const agent = agentWith([step()]);
    const now = Date.now();
    expect(agent.pendingStep(gameAt(9.5, now), now, playerAt(HOME.x, HOME.y))).toBeDefined();
  });

  test('settled at the step does not', () => {
    const agent = agentWith([step()]);
    const now = Date.now();
    expect(agent.pendingStep(gameAt(9.5, now), now, playerAt(WORK.x, WORK.y))).toBeUndefined();
  });

  test('milling about near the step still counts as being there', () => {
    // An agent drifting around their workplace has arrived. Measuring against
    // the strict arrival radius instead would leave a settled worker counted as
    // permanently in transit, and they would never talk to anyone again.
    const agent = agentWith([step()]);
    const now = Date.now();
    const nearby = playerAt(WORK.x + STEP_SETTLED_RADIUS - 0.5, WORK.y);
    expect(agent.pendingStep(gameAt(9.5, now), now, nearby)).toBeUndefined();
  });

  test('being early is not being late', () => {
    // 08:00, for a step that starts at 09:00. They are free until it does.
    const agent = agentWith([step()]);
    const now = Date.now();
    expect(agent.pendingStep(gameAt(8, now), now, playerAt(HOME.x, HOME.y))).toBeUndefined();
  });

  test('a manual pin suspends it — the pin replaces the destination', () => {
    const agent = agentWith([step()], {
      pin: { day: 1, locationId: 'gardens', destination: { x: 36, y: 6 } },
    });
    const now = Date.now();
    expect(agent.pendingStep(gameAt(9.5, now), now, playerAt(HOME.x, HOME.y))).toBeUndefined();
  });

  test('so does walking to a scenario gathering', () => {
    // A scenario participant on their way to the meeting spot must stay free to
    // start the conversation the scenario exists for.
    const agent = agentWith([step()], { scenarioTarget: { x: 36, y: 6 } });
    const now = Date.now();
    expect(agent.pendingStep(gameAt(9.5, now), now, playerAt(HOME.x, HOME.y))).toBeUndefined();
  });

  test('an agent with no schedule owes nothing', () => {
    const now = Date.now();
    const agent = new Agent({ id: 'a:1', playerId: 'p:1' } as any);
    expect(agent.pendingStep(gameAt(9.5, now), now, playerAt(HOME.x, HOME.y))).toBeUndefined();
  });
});

describe('which plans may interrupt a conversation', () => {
  test('an obligation may', () => {
    const agent = agentWith([step({ fixed: true })]);
    const now = Date.now();
    expect(agent.owesFixedObligation(gameAt(9.5, now), now, playerAt(HOME.x, HOME.y))).toBe(true);
  });

  test('a block the planner invented may not', () => {
    // Being due at the park is a reason not to start a conversation; it is not a
    // reason to walk out of one mid-sentence.
    const agent = agentWith([
      step({ fixed: undefined, locationId: 'gardens', activity: 'reading in the park' }),
    ]);
    const now = Date.now();
    const game = gameAt(9.5, now);
    const player = playerAt(HOME.x, HOME.y);
    expect(agent.pendingStep(game, now, player)).toBeDefined();
    expect(agent.owesFixedObligation(game, now, player)).toBe(false);
  });
});

describe('over a real merged day', () => {
  // The same schedule the engine runs, rather than a hand-made one: if the
  // commute stops being an obligation, or stops being where the workplace is,
  // this is what notices.
  const home = homeFor('Yvonne')!;
  const schedule = mergeFixedObligations('Yvonne', 1, [
    {
      startMinute: 0,
      locationId: 'home',
      destination: { x: home.x, y: home.y },
      activity: 'pottering about',
      description: 'at home',
    },
  ]);
  const indexAt = (minute: number) =>
    schedule.reduce((best, s, i) => (s.startMinute <= minute ? i : best), 0);

  test('at 08:30 she is due at work and still at home', () => {
    const now = Date.now();
    const agent = agentWith(schedule as ScheduleStep[], {
      currentStepIndex: indexAt(8 * 60 + 30),
    });
    const game = gameAt(8.5, now);
    const player = playerAt(home.x, home.y);
    const pending = agent.pendingStep(game, now, player);
    expect(pending?.activity).toBe('heading to work');
    expect(pending?.destination).toEqual({
      x: workplaceFor('Yvonne')!.location.x,
      y: workplaceFor('Yvonne')!.location.y,
    });
    // Which is an obligation, so it outranks a conversation she is already in.
    expect(agent.owesFixedObligation(game, now, player)).toBe(true);
  });

  test('once she is at her desk she is free again', () => {
    const now = Date.now();
    const work = workplaceFor('Yvonne')!.location;
    const agent = agentWith(schedule as ScheduleStep[], { currentStepIndex: indexAt(10 * 60) });
    const game = gameAt(10, now);
    const player = playerAt(work.x, work.y);
    expect(agent.pendingStep(game, now, player)).toBeUndefined();
    expect(agent.owesFixedObligation(game, now, player)).toBe(false);
  });
});
