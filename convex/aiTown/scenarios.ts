// Automatic scenario manager (engine-side).
//
// Called once per tick from Game.tick but throttled to SCENARIO_EVAL_INTERVAL.
// On each evaluation it (1) expires finished scenarios and (2) maybe starts one
// eligible scenario from the library in data/scenarios.ts. Participants are
// enlisted by setting their existing per-agent `scenarioInstruction` (which the
// conversation/plan prompts already inject and the profile-extraction op already
// keys off), plus a `scenarioId` so the manager owns their lifecycle.
//
// Determinism note: tick already uses Math.random elsewhere (health rolls, park
// waypoints), so probabilistic scenario selection here is consistent with the
// engine's existing behaviour.

import type { Game } from './game';
import type { Agent } from './agent';
import type { SerializedActiveScenario } from './world';
import { GameId, parseGameId } from './ids';
import {
  UNIVERSAL_SCENARIOS,
  scenarioById,
  type ScenarioDef,
  type ScenarioScope,
} from '../../data/scenarios';
import { CHARACTER_WORKPLACES, getLocationById } from '../../data/cityLocations';
import { computeGameTime } from './gameTime';
import { estimateTravelTimeMs, stopPlayer } from './movement';
import { distance } from '../util/geometry';
import {
  MAX_UNIVERSAL_SCENARIOS,
  SCENARIO_ARRIVAL_RADIUS,
  SCENARIO_COOLDOWN_MS,
  SCENARIO_DEFAULT_DURATION_MS,
  SCENARIO_EVAL_INTERVAL,
  SCENARIO_FIRST_DELAY_MS,
  SCENARIO_GATHER_BUFFER_MS,
  SCENARIO_GATHER_MAX_MS,
  SCENARIO_INTERVAL_MAX_MS,
  SCENARIO_INTERVAL_MIN_MS,
  SCENARIO_RETRY_MS,
  SCENARIO_TASK_PLAN_TIMEOUT_MS,
} from '../constants';

// locationId -> the character names that work there (drives local participants).
const WORKERS_BY_LOCATION: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const [name, { locationId }] of Object.entries(CHARACTER_WORKPLACES)) {
    (m[locationId] ??= []).push(name);
  }
  return m;
})();

function scopeKeyFor(scope: ScenarioScope, locationId?: string): string {
  return scope === 'universal' ? 'universal' : `local:${locationId}`;
}

export function tickScenarios(game: Game, now: number): void {
  const world = game.world;
  if (now - (world.lastScenarioEval ?? 0) < SCENARIO_EVAL_INTERVAL) {
    return;
  }
  world.lastScenarioEval = now;
  if (world.nextScenarioTime === undefined) {
    world.nextScenarioTime = now + SCENARIO_FIRST_DELAY_MS;
  }

  const cooldowns: Record<string, number> = { ...(world.scenarioCooldowns ?? {}) };

  // 1) Expire finished scenarios, freeing their participants and starting a
  // per-scope cooldown so the same place/scope doesn't immediately re-fire.
  const stillActive: SerializedActiveScenario[] = [];
  for (const sc of world.activeScenarios ?? []) {
    // Manual scenarios are owned by the injector (startCustomScenario / clearScenario
    // and the global-scenario expiry); the automatic manager just leaves them be.
    if (sc.defId === 'manual') {
      stillActive.push(sc);
      continue;
    }
    if (sc.endTime <= now) {
      rememberScenarioForParticipants(game, sc);
      clearScenarioParticipants(game, sc.id);
      cooldowns[scopeKeyFor(sc.scope, sc.locationId)] = now + SCENARIO_COOLDOWN_MS;
    } else {
      // While gathering, promote to active once everyone has arrived at the spot
      // (or the gather deadline passes), so the content window runs from the real
      // start rather than being eaten by travel time.
      maybePromoteScenario(game, now, sc);
      // Plan-timeout fallback: if the task-planning op was requested but never came
      // back, release the guard so participants aren't held forever on a stuck op —
      // the scenario then wraps up normally.
      if (
        sc.phase === 'active' &&
        sc.taskPlanRequested &&
        !sc.tasks &&
        now > (sc.goalMetAt ?? sc.startTime) + SCENARIO_TASK_PLAN_TIMEOUT_MS
      ) {
        delete sc.taskPlanRequested;
      }
      // Working phase: drive each assignee through their delegated tasks and their
      // on-screen progress bars; may set endTime = now once all tasks are done.
      if (sc.phase === 'working') {
        tickWorkingScenario(game, now, sc);
      }
      // Re-check expiry — working completion above can retire the scenario early.
      if (sc.endTime <= now) {
        rememberScenarioForParticipants(game, sc);
        clearScenarioParticipants(game, sc.id);
        cooldowns[scopeKeyFor(sc.scope, sc.locationId)] = now + SCENARIO_COOLDOWN_MS;
      } else {
        stillActive.push(sc);
      }
    }
  }

  // 2) When the countdown reaches zero, start one eligible scenario and schedule
  // the next start. If nothing is eligible yet, retry again shortly.
  if (now >= world.nextScenarioTime) {
    const def = pickEligibleScenario(game, now, stillActive, cooldowns);
    let started = false;
    if (def) {
      const inst = startScenario(game, now, def);
      if (inst) {
        stillActive.push(inst);
        started = true;
      }
    }
    world.nextScenarioTime = started
      ? now + randBetween(SCENARIO_INTERVAL_MIN_MS, SCENARIO_INTERVAL_MAX_MS)
      : now + SCENARIO_RETRY_MS;
  }

  world.activeScenarios = stillActive.length > 0 ? stillActive : undefined;
  world.scenarioCooldowns = Object.keys(cooldowns).length > 0 ? cooldowns : undefined;
}

function randBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

// Gather the scenarios that may start right now (time-gated, off cooldown, not
// already running for that scope/location) and pick one at random, or undefined.
function pickEligibleScenario(
  game: Game,
  now: number,
  active: SerializedActiveScenario[],
  cooldowns: Record<string, number>,
): ScenarioDef | undefined {
  const world = game.world;
  const hour =
    world.worldStartTime !== undefined ? computeGameTime(now, world.worldStartTime).hour : 12;
  const occupied = new Set(active.map((s) => scopeKeyFor(s.scope, s.locationId)));
  const universalCount = active.filter((s) => s.scope === 'universal').length;

  const candidates: ScenarioDef[] = [];
  // Universal: only during awake hours (deep night is game-hours 0–6), under the
  // concurrent cap, and off cooldown.
  if (hour >= 6 && universalCount < MAX_UNIVERSAL_SCENARIOS && !occupied.has('universal')) {
    for (const def of UNIVERSAL_SCENARIOS) {
      if ((cooldowns['universal'] ?? 0) <= now) candidates.push(def);
    }
  }
  // Work-related (local) scenarios are intentionally NOT eligible for random
  // firing — they only run when manually triggered from the scenario generator.

  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function nameOf(game: Game, agent: Agent): string | undefined {
  return game.playerDescriptions.get(agent.playerId)?.name;
}

export function startScenario(
  game: Game,
  now: number,
  def: ScenarioDef,
  // Optional override for the injected directive (used by the manual generator so
  // an edited instruction still flows through this pipeline). Topics/goal/gather
  // all stay from the def.
  instructionOverride?: string,
): SerializedActiveScenario | undefined {
  const world = game.world;
  const instruction = instructionOverride?.trim() || def.instruction;
  // Only enlist agents with no scenario directive at all — so we never double-book
  // an agent across two automatic scenarios, nor steal one already enlisted in the
  // manual global scenario (which sets scenarioInstruction without a scenarioId).
  const free = [...world.agents.values()].filter((a) => !a.scenarioId && !a.scenarioInstruction);
  let participants: Agent[];
  if (def.scope === 'universal') {
    participants = free;
  } else {
    const workers = new Set(WORKERS_BY_LOCATION[def.locationId ?? ''] ?? []);
    participants = free.filter((a) => {
      const n = nameOf(game, a);
      return n !== undefined && workers.has(n);
    });
  }
  if (participants.length < def.minParticipants) {
    return undefined;
  }

  const id = `${def.id}-${now}`;
  const loc = def.locationId ? getLocationById(def.locationId) : undefined;
  const participantNames = participants.map((a) => nameOf(game, a) ?? 'Someone');
  const duration = def.durationMs ?? SCENARIO_DEFAULT_DURATION_MS;
  // Local scenarios delegate tasks by default; universal ones just reach a decision.
  const outcome = def.outcome ?? (def.scope === 'local' ? 'tasks' : 'decision');

  // Local scenarios have a fixed spot (the workplace standing tile). Compute how
  // long the slowest participant needs to walk there and run a "gathering" phase
  // first, so the scenario's content only begins once everyone has arrived.
  // Universal scenarios have no spot — agents react wherever they are, so they
  // start active immediately.
  const gatherPoint = def.scope === 'local' && loc ? { x: loc.x, y: loc.y } : undefined;
  let contentStartTime = now;
  let phase: 'gathering' | 'active' = 'active';
  if (gatherPoint) {
    let maxEta = 0;
    for (const a of participants) {
      const p = game.world.players.get(a.playerId);
      if (!p) continue;
      maxEta = Math.max(maxEta, estimateTravelTimeMs(game, now, p, gatherPoint));
    }
    const gatherFor = Math.min(maxEta + SCENARIO_GATHER_BUFFER_MS, SCENARIO_GATHER_MAX_MS);
    contentStartTime = now + gatherFor;
    phase = 'gathering';
  }

  for (const a of participants) {
    a.scenarioInstruction = instruction;
    a.scenarioName = def.name;
    a.scenarioId = id;
    a.scenarioTopics = def.topics;
    a.scenarioGoal = def.completionGoal;
    a.scenarioConflict = def.conflict;
    // Dispatch local-scenario participants to the gathering spot. Agent.tick walks
    // them there deterministically until they arrive (see the gather branch).
    if (gatherPoint) {
      a.scenarioTarget = gatherPoint;
      a.scenarioArrivalTime = contentStartTime;
    }
    // Force re-extraction of the scenario-relevant profile for this scenario.
    delete a.scenarioProfile;
    delete a.scenarioProfileFor;
  }

  return {
    id,
    defId: def.id,
    scope: def.scope,
    name: def.name,
    emoji: def.emoji,
    locationId: def.locationId,
    // Prefer the cosmetic marker tile (inside the building) when set.
    x: loc ? loc.markerX ?? loc.x : undefined,
    y: loc ? loc.markerY ?? loc.y : undefined,
    instruction,
    whatHappens: def.whatHappens,
    background: def.background,
    relationships: def.relationships,
    context: `${def.context} Present: ${participantNames.join(', ')}.`,
    goals: def.goals,
    conflict: def.conflict,
    outcome,
    topics: def.topics,
    completionGoal: def.completionGoal,
    topicsDone: def.topics.map(() => false),
    goalMet: false,
    participantIds: participants.map((a) => a.playerId) as GameId<'players'>[],
    participantNames,
    startTime: now,
    contentStartTime,
    phase,
    endTime: contentStartTime + duration,
  };
}

// Manually start a specific catalogue scenario through the SAME pipeline the
// automatic manager uses — so a workplace (local) scenario enlists only that
// workplace's workers and runs its gathering phase, exactly like a random one,
// instead of the town-wide injectScenario. A manual trigger overrides whatever is
// running: it resets every scenario directive and stops ongoing conversations so
// the right participants are free to gather. Returns false if too few of the right
// people are around to meet the scenario's minParticipants.
export function injectCatalogScenario(
  game: Game,
  now: number,
  def: ScenarioDef,
  instructionOverride?: string,
): boolean {
  const world = game.world;
  // Stop conversations FIRST: this clears each one's isTyping and tears it down.
  // (It also stamps toRemember on participants, which we clear just below.)
  for (const conversation of [...world.conversations.values()]) {
    conversation.stop(game, now);
  }
  delete world.scenarioInstruction;
  delete world.scenarioStartTime;
  delete world.scenarioTarget;
  delete world.scenarioName;
  for (const agent of world.agents.values()) {
    delete agent.scenarioInstruction;
    delete agent.scenarioName;
    delete agent.scenarioId;
    delete agent.scenarioTopics;
    delete agent.scenarioGoal;
    delete agent.scenarioConflict;
    delete agent.scenarioTarget;
    delete agent.scenarioArrivalTime;
    delete agent.scenarioProfile;
    delete agent.scenarioProfileFor;
    // Free transient blockers so an enlisted participant heads straight to the
    // gathering spot instead of standing frozen. A just-stopped conversation can
    // leave an in-flight message op (inProgressOperation) — which Agent.tick would
    // otherwise wait out for ACTION_TIMEOUT — plus a toRemember pointing at the now
    // deleted conversation. Mirrors the town-wide injector (injectScenario).
    delete agent.inProgressOperation;
    delete agent.toRemember;
  }
  for (const player of world.players.values()) {
    delete player.activity;
    if (player.pathfinding) stopPlayer(player);
  }
  world.activeScenarios = undefined;

  const inst = startScenario(game, now, def, instructionOverride);
  if (!inst) {
    return false;
  }
  world.activeScenarios = [inst];
  // We just force-started this scenario by stopping everyone's chats, which put the
  // participants on a post-conversation cooldown. Clear it for them so they can
  // gather and strike up the scenario conversation without waiting it out.
  for (const pid of inst.participantIds) {
    const a = [...world.agents.values()].find((ag) => ag.playerId === pid);
    if (a) {
      delete a.lastConversation;
      delete a.lastInviteAttempt;
    }
  }
  // Hold the random scheduler off briefly so it doesn't stack another scenario on
  // top of the one we just triggered.
  world.nextScenarioTime = now + SCENARIO_INTERVAL_MIN_MS;
  return true;
}

type ScenarioTask = NonNullable<SerializedActiveScenario['tasks']>[number];

// Drive a local scenario's "working" phase: each participant performs their
// delegated tasks one at a time. Setting a task's `startedAt` (and the assignee's
// timed `activity`) starts its progress bar; once its `durationMs` elapses the task
// is marked done and the next one begins. When every task is done, the scenario's
// goal is met and it retires immediately so participants free up.
function tickWorkingScenario(game: Game, now: number, sc: SerializedActiveScenario): void {
  const tasks = sc.tasks;
  if (!tasks || tasks.length === 0) return;

  const byAssignee = new Map<string, ScenarioTask[]>();
  for (const t of tasks) {
    if (!t.assigneeId) continue;
    let list = byAssignee.get(t.assigneeId);
    if (!list) {
      list = [];
      byAssignee.set(t.assigneeId, list);
    }
    list.push(t);
  }

  for (const [assigneeId, list] of byAssignee) {
    const player = game.world.players.get(parseGameId('players', assigneeId));
    const current = list.find((t) => !t.doneAt);
    if (!current) {
      // All of this assignee's tasks are finished — drop the (now-elapsed) activity.
      if (player?.activity && player.activity.startedAt !== undefined) {
        delete player.activity;
      }
      continue;
    }
    if (current.startedAt === undefined) {
      current.startedAt = now;
    } else if (now >= current.startedAt + current.durationMs) {
      current.doneAt = now;
      if (player?.activity) delete player.activity;
      continue;
    }
    // Reflect the current task as the assignee's timed activity (also re-establishes
    // it after a reload where the activity was cleared but the task is mid-flight).
    if (player && (!player.activity || player.activity.startedAt !== current.startedAt)) {
      player.activity = {
        description: current.label,
        emoji: current.emoji,
        startedAt: current.startedAt,
        until: current.startedAt + current.durationMs,
      };
    }
  }

  if (tasks.every((t) => t.doneAt)) {
    sc.goalMet = true;
    sc.goalMetAt = sc.goalMetAt ?? now;
    sc.endTime = now;
  }
}

// Promote a gathering local scenario to active once every participant has reached
// the spot (or the gather deadline passes). Resets the content window to start now
// and releases the gather targets so the normal conversation logic forms the group.
function maybePromoteScenario(game: Game, now: number, sc: SerializedActiveScenario): void {
  if (sc.phase !== 'gathering') return;
  const loc = sc.locationId ? getLocationById(sc.locationId) : undefined;
  const gatherPoint = loc ? { x: loc.x, y: loc.y } : undefined;
  let allArrived = true;
  if (gatherPoint) {
    for (const pid of sc.participantIds) {
      const player = game.world.players.get(parseGameId('players', pid));
      if (!player) continue; // Left the world — don't block the scenario on them.
      if (distance(player.position, gatherPoint) >= SCENARIO_ARRIVAL_RADIUS) {
        allArrived = false;
        break;
      }
    }
  }
  const deadline = sc.contentStartTime ?? sc.startTime;
  if (!allArrived && now < deadline) return;

  sc.phase = 'active';
  sc.contentStartTime = now;
  sc.endTime = now + (scenarioById(sc.defId)?.durationMs ?? SCENARIO_DEFAULT_DURATION_MS);
  for (const agent of game.world.agents.values()) {
    if (agent.scenarioId !== sc.id) continue;
    delete agent.scenarioTarget;
    delete agent.scenarioArrivalTime;
  }
}

// Schedule a lock-free post-scenario memory op for each participant BEFORE the
// scenario is torn down (spec point 6). The scenario's fields are passed in as op
// args because the active-scenario entry is about to be removed. Skipped for a
// gathering that expired without ever running content.
function rememberScenarioForParticipants(game: Game, sc: SerializedActiveScenario): void {
  if (sc.phase === 'gathering') return;
  const plannerId = [...sc.participantIds].sort()[0];
  for (const pid of sc.participantIds) {
    const agent = [...game.world.agents.values()].find(
      (a) => a.playerId === pid && a.scenarioId === sc.id,
    );
    if (!agent) continue;
    game.scheduleOperation('agentRememberScenario', {
      worldId: game.worldId,
      agentId: agent.id,
      playerId: pid,
      name: game.playerDescriptions.get(parseGameId('players', pid))?.name ?? 'Someone',
      scenarioName: sc.name,
      instruction: sc.instruction,
      goal: sc.completionGoal ?? sc.goals,
      goalMet: !!sc.goalMet,
      outcome: sc.outcome ?? 'decision',
      wasPlanner: pid === plannerId,
      conflict: sc.conflict,
    });
  }
}

function clearScenarioParticipants(game: Game, scenarioId: string): void {
  for (const agent of game.world.agents.values()) {
    if (agent.scenarioId !== scenarioId) continue;
    delete agent.scenarioInstruction;
    delete agent.scenarioName;
    delete agent.scenarioId;
    delete agent.scenarioTopics;
    delete agent.scenarioGoal;
    delete agent.scenarioConflict;
    delete agent.scenarioTarget;
    delete agent.scenarioArrivalTime;
    delete agent.scenarioProfile;
    delete agent.scenarioProfileFor;
    // Drop any lingering timed task activity so a freed participant doesn't keep
    // "working" on-screen (e.g. if the scenario hit its safety cap mid-task).
    const player = game.world.players.get(agent.playerId);
    if (player?.activity && player.activity.startedAt !== undefined) {
      delete player.activity;
    }
  }
}
