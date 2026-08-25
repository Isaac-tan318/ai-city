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
import {
  CHARACTER_HOMES,
  CHARACTER_WORKPLACES,
  CITY_LOCATIONS,
  getLocationById,
  workLeashAnchor,
} from '../../data/cityLocations';
import { computeGameTime } from './gameTime';
import { isSleepStep } from '../../data/routines';
import { Conversation } from './conversation';
import { estimateTravelTimeMs, stopPlayer } from './movement';
import { distance } from '../util/geometry';
import {
  FOCAL_REASSIGN_MS,
  MAX_UNIVERSAL_SCENARIOS,
  SCENARIO_ARRIVAL_RADIUS,
  SCENARIO_FAMILY_BONUS,
  SCENARIO_NEIGHBOUR_BONUS,
  SCENARIO_PARTICIPANT_MAX,
  SCENARIO_PICK_NOISE,
  SCENARIO_PROXIMITY_BONUS,
  SCENARIO_PROXIMITY_FALLOFF_TILES,
  SCENARIO_WORKPLACE_BONUS,
  SCENARIO_COOLDOWN_MS,
  SCENARIO_DEFAULT_DURATION_MS,
  SCENARIO_EVAL_INTERVAL,
  SCENARIO_FIRST_DELAY_MS,
  SCENARIO_GATHER_BUFFER_MS,
  SCENARIO_GATHER_MAX_MS,
  SCENARIO_INTERVAL_MAX_MS,
  SCENARIO_INTERVAL_MIN_MS,
  SCENARIO_MANUAL_DURATION_MS,
  SCENARIO_READY_FRACTION,
  SCENARIO_RETRY_MS,
  SCENARIO_WAIT_MAX_MS,
  SCENARIO_TASK_PLAN_TIMEOUT_MS,
  SCENARIO_GENERATION_PROBABILITY,
  SCENARIO_GENERATION_TIMEOUT_MS,
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
      maybeScheduleEvaluation(game, sc, true);
      rememberScenarioForParticipants(game, sc);
      clearScenarioParticipants(game, sc.id);
      cooldowns[scopeKeyFor(sc.scope, sc.locationId)] = now + SCENARIO_COOLDOWN_MS;
    } else {
      // Queued because the cast was asleep or on shift: start it the moment enough
      // of them are free (or when the wait deadline runs out).
      maybeBeginWaitingScenario(game, now, sc);
      // While gathering, promote to active once everyone has arrived at the spot
      // (or the gather deadline passes), so the content window runs from the real
      // start rather than being eaten by travel time.
      maybePromoteScenario(game, now, sc);
      // Decision scenario: hand the focal role to someone who is actually in the
      // room if the designated focal agent never turned up.
      maybeReassignFocalAgent(game, now, sc);
      // Decision scenario: the focal agent has committed to an option, so score
      // the outcome against everyone's hidden ground truth. Fired here rather
      // than from the input handler so the expiry path below shares the code.
      maybeScheduleEvaluation(game, sc, false);
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
        maybeScheduleEvaluation(game, sc, true);
        rememberScenarioForParticipants(game, sc);
        clearScenarioParticipants(game, sc.id);
        cooldowns[scopeKeyFor(sc.scope, sc.locationId)] = now + SCENARIO_COOLDOWN_MS;
      } else {
        stillActive.push(sc);
      }
    }
  }

  // A requested generation that never came back must not stall the rotation.
  if (
    world.scenarioGenRequested !== undefined &&
    now > world.scenarioGenRequested + SCENARIO_GENERATION_TIMEOUT_MS
  ) {
    delete world.scenarioGenRequested;
  }

  // 2) When the countdown reaches zero, start one eligible scenario and schedule
  // the next start. If nothing is eligible yet, retry again shortly.
  if (now >= world.nextScenarioTime && world.scenarioGenRequested === undefined) {
    // Sometimes ask the Decider to invent a fresh situation from what has actually
    // happened here instead of replaying the catalogue. Generation needs an LLM,
    // which the engine can't call, so this only *requests* it — the op comes back
    // through the startGeneratedScenario input a few seconds later.
    const universalSlotFree =
      !stillActive.some((s) => s.scope === 'universal') &&
      (cooldowns['universal'] ?? 0) <= now &&
      hourOfDay(game, now) >= 6;
    if (universalSlotFree && Math.random() < SCENARIO_GENERATION_PROBABILITY) {
      world.scenarioGenRequested = now;
      game.scheduleOperation('generateAndStartScenario', { worldId: game.worldId });
      // Hold the countdown while the Decider writes it. The input handler sets the
      // real next-scenario time once it lands (or on failure, so we retry).
      world.nextScenarioTime = now + SCENARIO_GENERATION_TIMEOUT_MS;
    } else {
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
  }

  world.activeScenarios = stillActive.length > 0 ? stillActive : undefined;
  world.scenarioCooldowns = Object.keys(cooldowns).length > 0 ? cooldowns : undefined;
}

function randBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

// In-game hour, defaulting to midday for a world with no recorded start.
function hourOfDay(game: Game, now: number): number {
  const startTime = game.world.worldStartTime;
  return startTime !== undefined ? computeGameTime(now, startTime).hour : 12;
}

// Gather the scenarios that may start right now (time-gated, off cooldown, not
// already running for that scope/location) and pick one at random, or undefined.
function pickEligibleScenario(
  game: Game,
  now: number,
  active: SerializedActiveScenario[],
  cooldowns: Record<string, number>,
): ScenarioDef | undefined {
  const hour = hourOfDay(game, now);
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

// How plausible it is that these two would end up doing something together right
// now. Affinity says who LIKES whom; on its own that produces casts scattered
// across the map with no reason to have run into each other. These extra terms are
// the reasons two residents actually share a situation: they're related, they work
// the same place, they live in the same block, or they're simply standing near
// each other at this moment.
function togethernessScore(game: Game, a: Agent, b: Agent): number {
  let score = a.affinityFor(game, b.playerId); // 0..100

  const aName = nameOf(game, a);
  const bName = nameOf(game, b);

  // Family: the strongest standing reason to be doing something together.
  const family = game.agentDescriptions.get(a.id)?.family;
  if (bName && family?.some((tie) => tie.name === bName)) {
    score += SCENARIO_FAMILY_BONUS;
  }
  if (aName && bName) {
    // Colleagues share a workplace, so they're together most of the working day.
    const aWork = CHARACTER_WORKPLACES[aName]?.locationId;
    const bWork = CHARACTER_WORKPLACES[bName]?.locationId;
    if (aWork && bWork && aWork === bWork) score += SCENARIO_WORKPLACE_BONUS;
    // Neighbours run into each other at the void deck and on the stairs.
    const aHome = CHARACTER_HOMES[aName]?.locationId;
    const bHome = CHARACTER_HOMES[bName]?.locationId;
    if (aHome && bHome && aHome === bHome) score += SCENARIO_NEIGHBOUR_BONUS;
  }

  // Physical proximity right now, tapering to nothing at the falloff distance.
  // This is what stops a scenario pulling someone from the far side of the map.
  const aPlayer = game.world.players.get(a.playerId);
  const bPlayer = game.world.players.get(b.playerId);
  if (aPlayer && bPlayer) {
    const tiles = distance(aPlayer.position, bPlayer.position);
    const closeness = Math.max(0, 1 - tiles / SCENARIO_PROXIMITY_FALLOFF_TILES);
    score += SCENARIO_PROXIMITY_BONUS * closeness;
  }
  return score;
}

// Choose who actually takes part in a town-wide scenario.
//
// Universal scenarios used to enlist EVERY free agent, so every dinner argument,
// movie-night pick and downpour involved all eight residents at once. That reads
// as a town-wide announcement rather than something happening to some people, and
// it makes deliberations unwieldy (eight sets of hidden constraints to satisfy).
//
// Instead: a random group size in [min, SCENARIO_PARTICIPANT_MAX], seeded on a
// random candidate and grown by repeatedly adding whoever the group has the most
// reason to be with (see togethernessScore) — with enough noise that the same
// clique doesn't form every time.
export function pickScenarioParticipants(
  game: Game,
  candidates: Agent[],
  minParticipants: number,
): Agent[] {
  const min = Math.max(1, minParticipants);
  const max = Math.max(min, Math.min(candidates.length, SCENARIO_PARTICIPANT_MAX));
  if (candidates.length <= min) return candidates;
  const targetSize = min + Math.floor(Math.random() * (max - min + 1));

  const pool = [...candidates];
  const chosen: Agent[] = [];
  // Seed uniformly so the group isn't always anchored on the same sociable agent.
  chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);

  while (chosen.length < targetSize && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      // Averaged over the group so we grow a cluster rather than a chain of
      // pairwise-closest strangers.
      let sum = 0;
      for (const member of chosen) {
        sum += togethernessScore(game, member, candidate);
      }
      const score = sum / chosen.length + Math.random() * SCENARIO_PICK_NOISE;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    chosen.push(pool.splice(bestIndex, 1)[0]);
  }
  return chosen;
}

// Is this agent in a position to drop what they're doing and go and talk?
//
// Two things make it unreasonable: they're asleep, or they're on shift at their
// own workplace — a hawker mid-service can't wander off to argue about dinner. The
// schedule step is the single source of truth for both, so no extra state.
function isFreeForScenario(game: Game, agent: Agent): boolean {
  const player = game.world.players.get(agent.playerId);
  if (!player) return false;
  const step =
    agent.schedule && agent.currentStepIndex !== undefined
      ? agent.schedule[agent.currentStepIndex]
      : undefined;
  // No plan yet (fresh world, mid-replan) — treat them as available rather than
  // stalling every scenario until the LLM planner has caught up.
  if (!step) return true;
  if (isSleepStep(step)) return false;
  if (workLeashAnchor(player.name, step)) return false;
  return true;
}

// Are enough of the cast free for the scenario to be worth starting? Requires a
// clear majority rather than a bare quorum: starting the moment two of five are
// off shift means the other three get yanked out of work to attend, which is the
// thing waiting is meant to avoid.
function enoughAreFree(game: Game, participants: Agent[], minParticipants: number): boolean {
  const freeNow = participants.filter((a) => isFreeForScenario(game, a)).length;
  const needed = Math.max(
    minParticipants,
    Math.ceil(participants.length * SCENARIO_READY_FRACTION),
  );
  return freeNow >= needed;
}

// Is this agent awake — i.e. is the reason they can't gather that they're BUSY
// rather than unconscious?
function isAwakeForScenario(game: Game, agent: Agent): boolean {
  const step =
    agent.schedule && agent.currentStepIndex !== undefined
      ? agent.schedule[agent.currentStepIndex]
      : undefined;
  return !step || !isSleepStep(step);
}

// Texting is the answer to "they're at work", not to "they're asleep". A cast in
// bed should still queue until morning — nobody settles the dinner plan at 3am,
// and a thread nobody is awake to read would just burn through its message budget
// against a wall. Requires the same clear majority as enoughAreFree.
function enoughAreAwake(game: Game, participants: Agent[], minParticipants: number): boolean {
  const awake = participants.filter((a) => isAwakeForScenario(game, a)).length;
  const needed = Math.max(
    minParticipants,
    Math.ceil(participants.length * SCENARIO_READY_FRACTION),
  );
  return awake >= needed;
}

// Where a cast without a fixed venue should meet: the named landmark closest to
// the middle of the group. Using a real location (rather than the bare centroid)
// means they gather somewhere that reads as a place — and because the cast is
// picked for proximity, that landmark is normally already near all of them.
function meetingPointFor(game: Game, participants: Agent[]): { x: number; y: number } | undefined {
  const positions = participants
    .map((a) => game.world.players.get(a.playerId)?.position)
    .filter((p): p is { x: number; y: number } => !!p);
  if (positions.length === 0) return undefined;
  const centroid = {
    x: positions.reduce((sum, p) => sum + p.x, 0) / positions.length,
    y: positions.reduce((sum, p) => sum + p.y, 0) / positions.length,
  };
  let best: { x: number; y: number } | undefined;
  let bestDistance = Infinity;
  for (const loc of CITY_LOCATIONS) {
    const d = distance(centroid, { x: loc.x, y: loc.y });
    if (d < bestDistance) {
      bestDistance = d;
      best = { x: loc.x, y: loc.y };
    }
  }
  return best;
}

// Stamp the scenario onto its cast and open the content window: send them to the
// meeting spot (phase 'gathering') or, with no spot, start talking where they are.
//
// Split out of startScenario because a scenario may sit in 'waiting' for a while
// first — the directive and the walk order must not land until the scenario really
// begins, otherwise the cast re-plans around a situation that hasn't started.
function beginScenarioContent(game: Game, now: number, sc: SerializedActiveScenario): void {
  const participants = [...game.world.agents.values()].filter((a) => a.scenarioId === sc.id);
  // A text scenario never has a meeting spot — the whole point is that nobody
  // leaves their post.
  const gatherPoint =
    !sc.viaText && sc.gatherX !== undefined && sc.gatherY !== undefined
      ? { x: sc.gatherX, y: sc.gatherY }
      : undefined;

  let contentStartTime = now;
  if (gatherPoint) {
    let maxEta = 0;
    for (const a of participants) {
      const p = game.world.players.get(a.playerId);
      if (!p) continue;
      maxEta = Math.max(maxEta, estimateTravelTimeMs(game, now, p, gatherPoint));
    }
    contentStartTime = now + Math.min(maxEta + SCENARIO_GATHER_BUFFER_MS, SCENARIO_GATHER_MAX_MS);
  }

  for (const a of participants) {
    a.scenarioInstruction = sc.instruction;
    if (gatherPoint) {
      // Agent.tick walks them here deterministically until they arrive — no
      // re-plan needed, and none forced: the gather branch runs ahead of the
      // schedule, so a forced plan would just fight the walk.
      a.scenarioTarget = gatherPoint;
      a.scenarioArrivalTime = contentStartTime;
    }
    // Force re-extraction of the scenario-relevant profile for this scenario.
    delete a.scenarioProfile;
    delete a.scenarioProfileFor;
  }

  sc.phase = gatherPoint ? 'gathering' : 'active';
  sc.contentStartTime = contentStartTime;
  sc.endTime = contentStartTime + (sc.durationMs ?? SCENARIO_DEFAULT_DURATION_MS);
  delete sc.waitUntil;

  // Texting: open ONE group thread containing the whole cast, right now. Doing it
  // here rather than letting the pairwise invite logic find its way there is what
  // makes this work at all — the ordinary path would have them walk to each other.
  // It also guarantees the focal agent of a decision scenario is in the room, so
  // the deliberation can't stall on someone who never showed up.
  if (sc.viaText) {
    const players = participants
      .map((a) => game.world.players.get(a.playerId))
      .filter((p): p is NonNullable<typeof p> => !!p);
    Conversation.startText(game, now, players);
  }
}

export function startScenario(
  game: Game,
  now: number,
  def: ScenarioDef,
  // Optional override for the injected directive (used by the manual generator so
  // an edited instruction still flows through this pipeline). Topics/goal/gather
  // all stay from the def.
  instructionOverride?: string,
  // Optional lifetime override (real ms). Manual starts run longer than automatic
  // ones — see SCENARIO_MANUAL_DURATION_MS.
  durationOverride?: number,
): SerializedActiveScenario | undefined {
  const world = game.world;
  const instruction = instructionOverride?.trim() || def.instruction;
  // Only enlist agents with no scenario directive at all — so we never double-book
  // an agent across two automatic scenarios, nor steal one already enlisted in the
  // manual global scenario (which sets scenarioInstruction without a scenarioId).
  const free = [...world.agents.values()].filter((a) => !a.scenarioId && !a.scenarioInstruction);
  let participants: Agent[];
  if (def.scope === 'universal') {
    // A town-wide scenario happens to SOME people, not the entire cast at once.
    participants = pickScenarioParticipants(game, free, def.minParticipants);
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
  const duration = durationOverride ?? def.durationMs ?? SCENARIO_DEFAULT_DURATION_MS;
  // Local scenarios delegate tasks by default; universal ones just reach a decision.
  const outcome = def.outcome ?? (def.scope === 'local' ? 'tasks' : 'decision');

  // Only start now if the cast can reasonably drop what they're doing. If they're
  // asleep or on shift the scenario queues in 'waiting' and begins when they come
  // free — a dinner argument at 4am, or dragging a hawker off mid-service, is worse
  // than a scenario that starts a bit later.
  const readyNow = enoughAreFree(game, participants, def.minParticipants);
  // ...unless it's the kind of thing you'd settle by group chat. A `textable`
  // scenario that catches its cast AT WORK doesn't have to wait at all: they text
  // about it between customers. Only ever a fallback — when the cast IS free they
  // still meet in person, which is the better scene, and when they're asleep it
  // queues as before.
  const viaText =
    !readyNow && !!def.textable && enoughAreAwake(game, participants, def.minParticipants);

  // Every in-person scenario has a spot to meet at, so the group physically
  // converges to talk instead of shouting across the map. Local scenarios use
  // their workplace tile; a universal one meets at the landmark nearest the middle
  // of its cast. A text scenario has no spot at all — nobody leaves their post.
  const gatherPoint = viaText
    ? undefined
    : def.scope === 'local' && loc
      ? { x: loc.x, y: loc.y }
      : meetingPointFor(game, participants);

  // Reserve the cast either way (scenarioId is what marks them as spoken for), but
  // hold back the directive and the walk order until the scenario actually begins.
  for (const a of participants) {
    a.scenarioName = def.name;
    a.scenarioId = id;
    a.scenarioTopics = def.topics;
    a.scenarioGoal = def.completionGoal;
    a.scenarioConflict = def.conflict;
    delete a.scenarioProfile;
    delete a.scenarioProfileFor;
  }

  const entry: SerializedActiveScenario = {
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
    // A decision scenario runs a deliberation: one focal participant estimates
    // the options and decides when the group may commit (convex/focal.ts). The
    // focal agent is the lowest-sorting participant id — the same deterministic
    // rule the task planner uses, so every agent independently agrees on who it
    // is and two of them can never both act as focal.
    deliberation:
      outcome === 'decision'
        ? {
            focalPlayerId: [...participants.map((a) => a.playerId)].sort()[0] as GameId<'players'>,
            options: [],
            questionsAsked: 0,
          }
        : undefined,
    startTime: now,
    durationMs: duration,
    gatherX: gatherPoint?.x,
    gatherY: gatherPoint?.y,
    viaText: viaText || undefined,
    // A waiting scenario hasn't opened its content window yet. contentStartTime /
    // endTime are provisional (sized so it can't expire while queued) and are
    // rewritten by beginScenarioContent the moment it actually starts.
    contentStartTime: now,
    phase: 'waiting',
    waitUntil: now + SCENARIO_WAIT_MAX_MS,
    endTime: now + SCENARIO_WAIT_MAX_MS + duration,
  };
  // Start immediately when the cast is already free, or when it can be handled
  // over the phone. Otherwise it sits in 'waiting' and tickScenarios begins it as
  // soon as enough of them come free.
  if (readyNow || viaText) {
    beginScenarioContent(game, now, entry);
  }
  return entry;
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
  delete world.scenarioParticipantIds;
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

  // A manual start has to cover participants converging AND (for a decision
  // scenario) a full deliberation, so it runs longer than an automatic firing.
  const inst = startScenario(game, now, def, instructionOverride, SCENARIO_MANUAL_DURATION_MS);
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

// A scenario queued because its cast wasn't free. Recheck each evaluation and
// begin the moment enough of them are (or when the wait deadline expires, so a
// cast that never lines up doesn't queue forever). The meeting spot is recomputed
// at that point, since the cast has moved since the scenario was created.
function maybeBeginWaitingScenario(game: Game, now: number, sc: SerializedActiveScenario): void {
  if (sc.phase !== 'waiting') return;
  const participants = [...game.world.agents.values()].filter((a) => a.scenarioId === sc.id);
  if (participants.length === 0) return;
  const enough = enoughAreFree(game, participants, 2);
  const outOfTime = now >= (sc.waitUntil ?? now);
  // Queued overnight and now they're up but on shift: switch to texting rather
  // than waiting out the whole working day for a gap that may never come.
  if (!enough && !outOfTime) {
    const def = scenarioById(sc.defId);
    if (def?.textable && enoughAreAwake(game, participants, 2)) {
      sc.viaText = true;
      delete sc.gatherX;
      delete sc.gatherY;
      beginScenarioContent(game, now, sc);
    }
    return;
  }
  // They've moved since the scenario was queued, so meet where they are NOW.
  const meetingPoint = sc.locationId
    ? undefined // Local scenarios keep their workplace spot from startScenario.
    : meetingPointFor(game, participants);
  if (meetingPoint) {
    sc.gatherX = meetingPoint.x;
    sc.gatherY = meetingPoint.y;
  }
  beginScenarioContent(game, now, sc);
}

// Promote a gathering scenario to active once every participant has reached the
// spot (or the gather deadline passes). Resets the content window to start now and
// releases the gather targets so the normal conversation logic forms the group.
function maybePromoteScenario(game: Game, now: number, sc: SerializedActiveScenario): void {
  if (sc.phase !== 'gathering') return;
  // Prefer the recorded meeting spot (universal scenarios have no locationId).
  const loc = sc.locationId ? getLocationById(sc.locationId) : undefined;
  const gatherPoint =
    sc.gatherX !== undefined && sc.gatherY !== undefined
      ? { x: sc.gatherX, y: sc.gatherY }
      : loc
        ? { x: loc.x, y: loc.y }
        : undefined;
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
  // Prefer the duration the scenario was started with (a manual start runs longer
  // than the catalogue default) over re-deriving it from the def.
  sc.endTime =
    now + (sc.durationMs ?? scenarioById(sc.defId)?.durationMs ?? SCENARIO_DEFAULT_DURATION_MS);
  for (const agent of game.world.agents.values()) {
    if (agent.scenarioId !== sc.id) continue;
    delete agent.scenarioTarget;
    delete agent.scenarioArrivalTime;
  }
}

// Every participant of `sc` currently sharing a conversation with at least one
// other participant — i.e. the people who can actually take a deliberation turn.
function participantsInScenarioConversation(
  game: Game,
  sc: SerializedActiveScenario,
): Set<string> {
  const participants = new Set<string>(sc.participantIds);
  const inRoom = new Set<string>();
  for (const conversation of game.world.conversations.values()) {
    const present = [...conversation.participants.entries()]
      .filter(([pid, m]) => m.status.kind === 'participating' && participants.has(pid))
      .map(([pid]) => pid);
    if (present.length < 2) continue; // Needs someone to deliberate WITH.
    for (const pid of present) inRoom.add(pid);
  }
  return inRoom;
}

// The focal agent only ever acts from inside a scenario conversation
// (Agent.maybeTakeFocalTurn), and startScenario picks it purely by sorting player
// ids — so the role can land on someone who never joins one. That happened
// routinely to a lone worker leashed to a workplace nobody else shares (James at
// Marina Bay Sands): the deliberation then sat untouched for the scenario's whole
// life and expired with no estimates, so the evaluator had nothing to score either.
//
// Once the content window has been open for FOCAL_REASSIGN_MS, hand the role to the
// lowest-sorting participant who IS in a scenario conversation. Reassigning here in
// the manager — a single writer, once per evaluation — keeps every agent's view of
// who is focal consistent, the same reason the task planner's id is deterministic.
function maybeReassignFocalAgent(
  game: Game,
  now: number,
  sc: SerializedActiveScenario,
): void {
  const deliberation = sc.deliberation;
  if (!deliberation || deliberation.resolvedOptionId) return;
  if (sc.phase !== 'active') return;
  if (now < (sc.contentStartTime ?? sc.startTime) + FOCAL_REASSIGN_MS) return;

  const inRoom = participantsInScenarioConversation(game, sc);
  if (inRoom.size === 0) return; // Nobody is talking yet — nothing better to pick.
  if (inRoom.has(deliberation.focalPlayerId)) return; // Already where it needs to be.

  const replacement = [...inRoom].sort()[0] as GameId<'players'>;
  console.log(
    `Reassigning focal agent for ${sc.id}: ${deliberation.focalPlayerId} never joined a scenario conversation, handing to ${replacement}.`,
  );
  deliberation.focalPlayerId = replacement;
  // If the options op was requested by the old focal agent but never landed, let
  // the new one re-request it; otherwise the scenario keeps its generated options.
  if (deliberation.options.length === 0) {
    delete deliberation.optionsRequested;
  }
}

// Score a decision scenario's outcome against the participants' hidden ground
// truth (convex/evaluator.ts). Scheduled LOCK-FREE, and with the whole
// deliberation passed in as op args rather than read back later, because the
// active-scenario entry is about to be deleted from the world doc.
//
// `onExpiry` covers the case where the focal agent never committed — the
// conversation died, it wandered off, its LLM calls kept failing. We still score
// its leading estimate so a deliberation always produces a data point, flagged as
// forced so the analysis can tell a real decision from a defaulted one.
function maybeScheduleEvaluation(
  game: Game,
  sc: SerializedActiveScenario,
  onExpiry: boolean,
): void {
  const deliberation = sc.deliberation;
  if (!deliberation || deliberation.evaluationRequested) return;
  if (deliberation.options.length < 2) return;
  // Never scored a single option — there is nothing to evaluate.
  if (sc.phase === 'waiting' || sc.phase === 'gathering') return;

  let selectedOptionId = deliberation.resolvedOptionId;
  let forced = !!deliberation.forcedDecision;
  if (!selectedOptionId) {
    if (!onExpiry) return; // Still deliberating — come back next tick.
    const ranked = [...(deliberation.estimates ?? [])].sort(
      (a, b) => b.estimatedScore - a.estimatedScore,
    );
    if (ranked.length === 0) return; // Never got as far as an estimate.
    selectedOptionId = ranked[0].optionId;
    forced = true;
  }

  deliberation.evaluationRequested = true;
  game.scheduleOperation('evaluateFinalDecision', {
    worldId: game.worldId,
    scenarioId: sc.id,
    scenarioName: sc.name,
    focalPlayerId: deliberation.focalPlayerId,
    focalName:
      game.playerDescriptions.get(parseGameId('players', deliberation.focalPlayerId))?.name ??
      'Someone',
    options: deliberation.options,
    selectedOptionId,
    participantIds: sc.participantIds,
    questionsAsked: deliberation.questionsAsked ?? 0,
    forcedDecision: forced,
  });
}

// Schedule a lock-free post-scenario memory op for each participant BEFORE the
// scenario is torn down (spec point 6). The scenario's fields are passed in as op
// args because the active-scenario entry is about to be removed. Skipped for a
// scenario that expired before its content ever ran (still queued or gathering).
function rememberScenarioForParticipants(game: Game, sc: SerializedActiveScenario): void {
  if (sc.phase === 'waiting' || sc.phase === 'gathering') return;
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
