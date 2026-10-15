# AI City — Functional Specification and Porting Guide

**Goal:** recreate every function of AI City (this repo, `ai-town`) inside the **agent-society** project
(AgentSociety 2 + AgentSociety Studio), with two deliberate changes:

1. **Map:** the 70×44 tile town is replaced by a **whole-of-Singapore map** of the kind agent-society
   already builds: an OpenStreetMap-derived MOSS `.pb` map with real buildings (AOIs), points of
   interest (POIs), roads and footpaths, routed travel, and a Leaflet/OpenStreetMap view.
2. **Storage:** **SQLite** replaces Convex. There is no Convex dependency anywhere in the new build.

**Audience:** an AI coding agent that will do the implementation. It is written to be read top to
bottom once, then used as a reference per subsystem.

| | |
|---|---|
| Written | 2026-10-14 |
| Source of truth (old) (GitHub `Isaac-tan318/ai-city`), commit `a4231c6` 
| Target repo | `C:\Users\isaac\OneDrive\Desktop\agent society` (GitHub `Isaac-tan318/agent-society`): `agentsociety2` 2.8.2 in `.venv`, Studio = FastAPI `ui/server.py` + React/Vite/Leaflet `ui/web`, maps in `paper_experiments/maps/<id>/`, Python router `paper_experiments/custom/routing/py_router.py`. |
| Related | `C:\Users\isaac\OneDrive\Desktop\agentsociety1` (Docker map builder image `agentsociety-singapore-mapbuilder`, `scripts/build_singapore_map.py`). |

---

## Contents

- [0. How to use this document](#0-how-to-use-this-document)
- [1. What AI City is](#1-what-ai-city-is)
- [2. Target architecture](#2-target-architecture)
- [3. Engine core: world, clock, inputs, operations, lifecycle](#3-engine-core)
- [4. Singapore map, places and movement](#4-singapore-map-places-and-movement)
- [5. Characters and data](#5-characters-and-data)
- [6. The agent behaviour loop](#6-the-agent-behaviour-loop)
- [7. Daily schedules and fixed routines](#7-daily-schedules-and-fixed-routines)
- [8. Conversations](#8-conversations)
- [9. Memory stream, retrieval, reflection, identity](#9-memory-stream-retrieval-reflection-identity)
- [10. Perception and the reacting loop](#10-perception-and-the-reacting-loop)
- [11. Relationships: family and affinity](#11-relationships-family-and-affinity)
- [12. Short-term state, sleep, sickness, economy](#12-short-term-state-sleep-sickness-economy)
- [13. Scenarios](#13-scenarios)
- [14. Decision engine: Decider, Focal agent, Evaluator](#14-decision-engine-decider-focal-agent-evaluator)
- [15. Interview mode](#15-interview-mode)
- [16. User interface](#16-user-interface)
- [17. LLM layer and usage accounting](#17-llm-layer-and-usage-accounting)
- [18. SQLite schema](#18-sqlite-schema)
- [19. HTTP API](#19-http-api)
- [20. Exports and the offline evaluation program](#20-exports-and-the-offline-evaluation-program)
- [21. Constants reference](#21-constants-reference)
- [22. Invariants and acceptance tests](#22-invariants-and-acceptance-tests)
- [23. Pitfalls and lessons already paid for](#23-pitfalls-and-lessons-already-paid-for)
- [24. Build plan](#24-build-plan)
- [Appendix A. Prompt templates](#appendix-a-prompt-templates)
- [Appendix B. Roster (all 50 residents)](#appendix-b-roster-all-50-residents)
- [Appendix C. Scenario catalogue](#appendix-c-scenario-catalogue)
- [Appendix D. Source map (old file → subsystem → new module)](#appendix-d-source-map)

---

## 0. How to use this document

- **Tags.** `[PORT]` keep behaviour identical to AI City. `[ADAPT]` behaviour changes because of the
  Singapore map or SQLite; the section says how. `[NEW]` not in AI City but needed by the new
  architecture. `[OPTIONAL]` nice to have; not required for parity.
- **MUST / SHOULD / MAY** are used in the RFC sense.
- **Exact text lives in the old repo.** Prompts are reproduced in Appendix A faithfully enough to
  implement from, but the canonical wording is in the ai-town files named in each section. Data
  (character profiles, ground truth, scenario catalogue, activity menus) MUST be exported from the
  ai-town TypeScript files rather than retyped (§5.6).
- **Engine time vs game time.** "Real ms" / "engine ms" means wall-clock milliseconds on the engine.
  "Game minutes" means the accelerated in-world clock (§3.2). Every throttle in AI City is in real
  ms; every schedule is in game minutes. Keep them separate.
- **Ids.** AI City uses string ids with a type prefix allocated from a per-world counter:
  `p:12` (player), `a:13` (agent), `c:40` (conversation), `o:7` (operation). They are reallocated
  when a world is wiped, which is why all authored data is keyed by character **name**. Keep this.
- **Rounding.** Every `round(...)` in this document means JavaScript `Math.round`: halves round
  toward +∞ (`round(0.5) = 1`, `round(-2.5) = -2`). Python's built-in `round` rounds halves to even
  and would silently change snap levels, `round2`, affinity and gauge deltas, and break the ported
  unit tests. Use one helper everywhere: `def js_round(x): return math.floor(x + 0.5)`, and
  `round2(x) = js_round(x * 100) / 100`.

---

## 1. What AI City is

A real-time "generative agents" simulation (after Park et al., *Generative Agents*, 2023) of **50
residents of a Singapore-themed town**. It started from the a16z `ai-town` starter (Convex + PixiJS)
and grew far past it. The world runs continuously: while the town is awake **one real second is one
game minute**, and a full game day takes **19 real minutes**. Agents walk around, keep LLM-planned
schedules, talk to each other in 1:1 and group conversations, remember and reflect, form and lose
regard for each other, get tired, hungry, sick and broke, and get swept into scenarios — including
group decisions that are scored against hidden ground truth.

Feature inventory (every item below is specified later):

**World and time**
- Continuous engine: 16 ms ticks batched into 1 s steps; inputs from humans and agents processed in
  order; asynchronous LLM "operations" whose results come back as inputs.
- Accelerated clock: 06:00–24:00 in 18 real minutes, 00:00–06:00 in 1 real minute; day 1 is a Monday.
- Pause/resume, skip to dawn/dusk/+1 hour; worlds auto-stop when nobody is watching (cost control).

**Residents**
- 50 characters with a sprite, an identity paragraph, a structured key-value profile (diet,
  religion, observance, allergies, conflict style, payment norm, sleep rhythm, …), optional family
  ties, a home and (mostly) a workplace, a free-time activity menu, and a hidden ground-truth
  profile used only for scoring decisions.
- Roster can be topped up without wiping the world (idempotent creation by name).

**Daily life**
- LLM day plan (4–7 blocks) merged with deterministic **fixed obligations**: sleep window from the
  profile, getting-up block, commute, weekday 09:00–18:00 shift with 12:00–13:00 lunch, a small
  night-shift roster, Friday prayer (Muslims) and Sunday service (Christians) at home.
- Re-planning after every conversation, when disrupted, after a reaction, or when a scenario is
  injected; throttled and staggered.
- Long blocks decomposed into 3–5 sub-activities; random contextual micro-events per location.
- Free-roam activities chosen by score against money and fatigue.

**Social**
- Invitations with affinity-weighted acceptance, walking over, group conversations up to 5 (8 in
  scenarios), group texts over phones, an LLM "moderator" choosing the next speaker, goal-judged
  scenario conversations, goal wrap-up summaries, human player participation.

**Memory and cognition**
- Memory stream with embeddings: conversation summaries, observations, reflections, scenario
  takeaways. Retrieval by relevance + importance + recency; two-part retrieval (situation +
  relationship). Reflection on an importance threshold; top insights become "learned traits".
- Perception pass every 5 s (deterministic, no LLM) with salience scoring; reacting loop
  (ignore/talk/activity/replan); periodic self-summary rewrite ("who they have become") with fixed
  anchors.

**Relationships**
- Immutable family ties; directional affinity 0–100 changed by conversation verdicts, snubs and
  decision outcomes; affinity changes behaviour (who to approach, invite acceptance, leaving
  groups). Relationship event log ("Tensions").

**Body and money**
- Mood, stress, fatigue, hunger gauges with baselines and daily decay; nightly sleep pressure;
  probabilistic sickness with contagion; savings with income, expenses, meals and activity costs;
  financial pressure; transition log for evaluation.

**Scenarios**
- Catalogue of 18 authored scenarios (universal and workplace-local; talk, tasks or decision),
  plus Decider-generated scenarios built from what has happened in town. Automatic rotation,
  manual injection, cast selection by "togetherness", phases waiting → gathering → active →
  working, texting fallback when the cast is on shift, delegated tasks with progress bars,
  topic/goal tracking, scenario-relevant profile extraction, past-scenario recall.

**Decision engine**
- Decider generates 4 options; one Focal participant asks clarifying questions and commits only
  when code-enforced stopping criteria allow; Evaluator scores every option per person against
  hidden ground truth (six weighted dimensions, hard-taboo zeroing) and reports **regret**;
  affinity toward the decider shifts with how well they were served.

**Operator tools and observability**
- Inspector, agents control panel (edit gauges, money, health; pin someone somewhere; read memories;
  identity drift), scenario creator, interview mode (read-only Q&A), decider viewer, scorecard,
  conversation analysis graph, decisions history, LLM usage page, chat history export
  (Markdown/JSON/CSV), evaluation bundle export, offline fidelity evaluator.

**What AI City is not:** it is not a stepwise experiment runner. That is the main difference from
agentsociety2 and it drives the architecture below.

---

## 2. Target architecture

### 2.1 Requirements

1. Replace the tile map with a Singapore-wide map "similar to agent society 2" (§4).
2. Use SQLite; no Convex.
3. Combine with the agent-society project (shared map store, cast, LLM settings and Studio UI).

### 2.2 Decision: a real-time City engine inside agent-society, not an agentsociety2 experiment

agentsociety2 runs **discrete steps** (typically minutes to an hour of simulated time per step);
in each step every `PersonAgent` reasons through a ReAct loop of tool calls that the environment
router answers with LLM-generated code. The Studio's measurements: 8–23 LLM calls per person per
step and minutes of wall time per step for 25 people. AI City's functions depend on things that model
cannot express: a continuous clock, conversations with turn-taking measured in seconds, invite →
accept → walk-over handshakes, wall-clock-throttled perception and reflection, scenario phases
timed in real seconds.

So the recommended design is a **dedicated City engine** — a Python package `city/` in the
agent-society repo — that re-implements AI City's engine semantics and **reuses** agent-society's
pieces:

| Reused from agent-society | For |
|---|---|
| `paper_experiments/maps/<id>/map.pb` + `places.json` + `preview.json` (built/imported on the Studio *Maps* page, `ui/maps.py`) | the Singapore map, reachable buildings, drawing |
| `paper_experiments/custom/routing/py_router.py` `RoutingGraph` | walking/driving routes and ETAs, reachability |
| `agentsociety2.contrib.env.mobility_space.map.Map` | spatial indices: `query_pois`, `query_aois`, `get_aoi`, `get_poi`, projector |
| `ui/social.py`, `ui/maps.py place_people` | household/team grouping and home/work placement ideas |
| `ui/presets/import_ai_city.cjs`, `ai_city_agents.json`, `ai_city_faces.json`, `ui/static/ai_city_folk.png` | cast import and faces for the map |
| `.env` (`AGENTSOCIETY_LLM_API_BASE/KEY/MODEL`) and the Studio *LLM settings* page | LLM credentials |
| FastAPI `ui/server.py`, React app `ui/web` (TanStack Query, Leaflet 1.9, `src/lib/maps.js`) | API and pages |

Python (not TypeScript) is recommended because the map, router, Studio server and agentsociety2
are all Python; AI City's pure TypeScript modules (`scoring.ts`, `factMerge.ts`, `gameTime.ts`,
`routines.ts`, `shortTerm.ts`, `observation.ts`) are small and fully specified here.

[OPTIONAL] bridges to agentsociety2 proper: export a City world's residents (with their assigned
homes/workplaces as AOI ids and their profiles) as an agentsociety2 experiment (`init_config.json`
with `MobilitySpace` persons), or import an experiment's people as a City cast. Not required for
parity.

### 2.3 Process model

```
Browser — Studio React app (new "City" pages)
   │  HTTP JSON (poll ~1 s with TanStack Query; SSE optional)
   ▼
Studio server (ui/server.py, FastAPI) ── read-only SQLite connections for queries
   │  writes ONLY: INSERT INTO inputs, heartbeats, usage clears
   ▼
city.db  (SQLite, WAL mode)  ◄── the engine is the ONLY writer of world-owned tables
   ▲
   │
City engine process:  python -m city run --world <id>
   ├─ Simulation loop (asyncio): poll inputs → ticks → persist (one transaction per step)
   ├─ Operation runner: asyncio tasks (bounded concurrency) → LLM → enqueue result inputs
   ├─ Map service: Map + RoutingGraph loaded once from map.pb
   └─ Maintenance: vacuum, idle stop, lease renewal
```

- One engine process per running world. Start/stop it from the Studio (like `run_study.py` runs)
  or the CLI. Keep a pid in the `engines` row so a restarted Studio recognises a live engine (the
  Studio already does this for runs).
- Inputs cross processes through the `inputs` table, exactly like Convex did. Inside the engine,
  operations MAY enqueue result inputs into an in-memory queue instead of the table, but SHOULD also
  log them to `inputs` for debuggability.
- **Put `city.db` outside OneDrive** (e.g. `%LOCALAPPDATA%\AgentSocietyCity\city.db`) or exclude the
  folder from sync. Both repos live under `C:\Users\isaac\OneDrive\Desktop`; the agent-society
  `sitecustomize.py` already has to retry `os.replace` because OneDrive locks files mid-sync, and a
  syncing client can corrupt or lock an SQLite WAL database.

### 2.4 Convex concept → new implementation

| AI City on Convex | New |
|---|---|
| `worlds` document holding all players/agents/conversations, replaced every step (1 MiB cap) | In-memory `World` object in the engine; per-step transactional upsert of changed rows (`players`, `agents`, `conversations`, `world_state`) — no document size cap, but keep payloads lean anyway |
| `engines` row + **generation number** to guarantee one stepping loop | `engines` row with `lease_owner`/`lease_expires` renewed every step; a second engine refuses to start while the lease is valid |
| `inputs` table, `insertInput`, `loadInputs`, `inputStatus` | same table in SQLite; engine polls `number > processed_input_number`; return value written back |
| `runStep` internal action that runs ~30 s then reschedules itself | a long-lived asyncio loop |
| `ctx.scheduler.runAfter(0, op, args)` for agent operations | `OperationRunner.submit(name, args)` (asyncio task + semaphore) |
| internalQuery/internalMutation inside operations | plain functions with their own SQLite connection |
| `vectorIndex` on `memoryEmbeddings` (768-d) | `memories.embedding` BLOB (float32) + numpy cosine per player (or `sqlite-vec`) |
| `HistoricalObject` position history packed per step for smooth client motion | trip records (route polyline + depart/arrive times) the client interpolates (§4.4) |
| crons (`stop inactive worlds`, `restart dead worlds`, vacuums) | engine maintenance loop + Studio supervisor |
| reactive `useQuery` subscriptions | polling with TanStack Query (`refetchInterval`), optionally SSE |
| `npx convex run init / testing:stop / testing:resume / testing:wipeAllTables / groundTruth:reseed / dryRun:runDryRunScenario / evaluationExport:bundle` | `python -m city init / stop / resume / wipe / reseed-ground-truth / dry-run / export-bundle` |
| `npx convex env set …` | `.env` |

### 2.5 Proposed layout

```
agent society/
  city/
    __main__.py           CLI: init, run, stop, resume, wipe, reseed-ground-truth, dry-run, export-bundle
    config.py             every constant in §21 (one place, documented)
    db.py, schema.sql     connection helpers, migrations (PRAGMA user_version)
    clock.py              game time (§3.2)
    engine.py             step loop, input queue, persistence, lease (§3)
    inputs.py             input handlers (§3.4)
    ops/                  one module per operation (§3.5)
    model/                World, Player, Agent, Conversation, ActiveScenario dataclasses
    geo/                  map service, named locations, homes/works, routing, trips (§4)
    agent_tick.py         behaviour loop (§6)
    routines.py           fixed obligations, sleep windows, contextual events (§7)
    conversation.py       prompt assembly, moderator, goal judge (§8)
    memory.py             memory stream, retrieval, reflection, self-summary (§9)
    perception.py         observations, reacting (§10)
    relationships.py      affinity helpers (§11)
    short_term.py         gauges, sleep pressure, sickness, economy (§12)
    scenarios/            catalogue loader, manager, generator (§13)
    decision/             decider, focal, evaluator, scoring, fact_merge (§14)
    interview.py          (§15)
    llm.py, usage.py      provider calls, JSON parsing, usage rows (§17)
    export.py             chat-history and evaluation-bundle exports (§20)
    data/                 characters.json, profiles.json, ground_truth.json, scenarios.json,
                          activities.json, locations.json, routines.json (exported from ai-town)
    tests/
  ui/server.py            + /api/city/* routes (§19)
  ui/web/src/pages/       City.tsx, CityAgents.tsx, CityAnalysis.tsx, CityUsage.tsx, … (§16)
```

---

## 3. Engine core

Source: `convex/engine/abstractGame.ts`, `convex/aiTown/{game,main,world,player,agent,conversation,inputs,insertInput,ids,worldInputs}.ts`, `convex/world.ts`, `convex/crons.ts`, `convex/testing.ts`, `convex/aiTown/gameTime.ts`.

### 3.1 Entities

The world-owned state the engine mutates. Field names follow AI City; types are given in Python-ish
notation. All of it MUST survive an engine restart (AI City's engine object was rebuilt from the
database every ~30 s, so all throttles and dedupe state already live on these records — keep that
property).

**World** (`convex/aiTown/world.ts`)
```
next_id: int                                  # id allocator for p:/a:/c:/o:
world_start_time: int | None                  # engine ms of the first tick; the game clock's epoch
# Manual ("custom") scenario — one global directive:
scenario_instruction: str | None
scenario_start_time: int | None               # expires after one game day (CYCLE_MS)
scenario_participant_ids: list[str] | None    # cast; None = legacy broadcast to everyone
scenario_target, scenario_name                # legacy, still cleared by clearScenario
# Automatic scenarios (§13):
active_scenarios: list[ActiveScenario] | None
last_scenario_eval: int | None                # 3 s throttle
next_scenario_time: int | None                # drives the on-screen countdown
scenario_cooldowns: dict[str, int] | None     # 'universal' | 'local:<locationId>' -> earliest start
scenario_gen_requested: int | None            # a Decider generation op is in flight since
```

**Player** (`convex/aiTown/player.ts`) — anything that appears on the map (agents and humans).
```
id: 'p:N'; name: str | None; human: str | None (token of a human player)
last_input: int
position, trip                                # [ADAPT] see §4.4 (was position{x,y}, facing, speed, pathfinding)
activity: { description, emoji?, until: engine_ms, started_at?: engine_ms, ambient?: bool } | None
```
`ambient=True` marks a schedule-driven activity that survives walking and talking; a free-roam
activity (ambient false) is cancelled when the agent moves or starts a face-to-face conversation.
`started_at` turns the activity into a timed task with a progress bar (scenario work tasks).

**Agent** (`convex/aiTown/agent.ts`, `serializedAgent`) — the AI layer attached to a player.
All persisted. Grouped by subsystem:
```
id 'a:N', player_id 'p:N'
# operation lock and conversation bookkeeping
in_progress_operation: {name, operation_id, started} | None
to_remember: conversation_id | None           # remember this conversation next
last_conversation, last_invite_attempt: int | None
preferred_invitee: player_id | None           # set by the reacting loop, consumed on next invite
# schedule
home (legacy point), schedule: list[ScheduleStep] | None, schedule_generated_for_day: int | None
current_step_index: int | None, last_plan_attempt, schedule_needs_refresh: bool, force_plan: bool
active_sub_steps: {step_key, steps: list[SubStep]} | None, sub_steps_requested_for: str | None
last_wander_at, pin: {destination, location_id, day} | None
short_term_step_key: str | None               # once-per-step accrual guard "day:index:startMinute"
# scenario membership
scenario_id, scenario_name, scenario_instruction, scenario_topics, scenario_goal, scenario_conflict
scenario_target, scenario_arrival_time        # walking to the gathering spot
scenario_profile, scenario_profile_for        # compact view of THIS agent that others see
# relationships
affinities: dict[player_id, int] | None       # directional 0..100, lazily created
last_affinity_change: {at, net} | None        # for the 💗/💔 map cue
# body, health, money
short_term: {mood, stress, fatigue, hunger, updated_at} | None
balance: int | None, short_term_checked_for_day, last_meal_day
asleep: bool | None, last_sleep_pressure_at, last_short_term_change: {at, net} | None
health: 'well'|'sick' | None, sick_days_left, consecutive_work_days, health_checked_for_day
last_contagion_conversation
# cognition
learned_traits: list[str] | None              # ≤ 6, from reflection
observed: list[{k: str, h: int}] | None       # perception dedupe fingerprints, ≤ 32
last_observation_at
last_reflection_at, last_reflection_check, events_since_reflection
last_reaction_at, salient_since_reaction, reaction_replan, last_reaction_replan_at
react_replans_today, react_replans_day
self_summary_checked_for_day
```

**Conversation** (`convex/aiTown/conversation.ts`)
```
id 'c:N', creator, created
is_typing: {player_id, message_uuid, since} | None    # one speaker at a time
last_message: {author, timestamp} | None
num_messages: int
participants: dict[player_id, Membership]
    Membership = {invited: int, status: invited | walkingOver | participating(started)}
all_participants: set[player_id]              # everyone who ever participated (for archiving)
next_speaker: player_id | None                # set by the moderator after each agent message
scenario: bool | None                         # seeded by a scenario
is_text: bool | None                          # a group text over phones (§8.7)
scenario_goal_met: bool | None                # latched by the goal judge
goal_summary_posted: bool | None
```

**Descriptions** (separate rows, rarely written)
```
PlayerDescription: player_id, name, description (identity text), character (sprite f1..f8)
AgentDescription:  agent_id, identity (authored, never edited), profile: dict[str,str],
                   family: list[{name, relation}], self_summary: str | None, self_summary_day
```

**Ids:** `allocId(type)` returns `f"{prefix}:{world.next_id}"` and increments `next_id`. Prefixes
`p a c o`.

### 3.2 The game clock `[PORT]`

Source: `convex/aiTown/gameTime.ts`. Identical in the new build.

```
AWAKE_MS      = 18 * 60_000     # 06:00 → 24:00 (1 game minute = 1 real second)
DEEP_NIGHT_MS = 1 * 60_000      # 00:00 → 06:00 (1 game hour ≈ 10 real seconds)
CYCLE_MS      = 19 * 60_000     # one game day
MINUTES_PER_DAY = 1440

compute_game_time(now, world_start_time):
    if world_start_time is None: return Day 1, 06:00
    elapsed  = now - world_start_time
    progress = elapsed mod CYCLE_MS                    # always non-negative
    day      = floor(elapsed / CYCLE_MS) + 1
    hours    = 6 + progress/AWAKE_MS*18           if progress < AWAKE_MS
             = (progress - AWAKE_MS)/DEEP_NIGHT_MS*6  otherwise
    hour = hours mod 24; minutes_into_day = floor(hour*60)
    is_day = 6 <= hour < 18; time_str = "h:mm AM/PM"
```

Consequences that matter everywhere:
- A game day **starts at 06:00**. `minutes_into_day` climbs 360 → 1439 and then **wraps to
  0 → 359 within the same `day`**. A schedule is a flat array indexed 00:00→24:00, so code walking
  a schedule must treat the day as a ring (§6.6).
- `cycle_progress_for_hour(h)` maps a game hour to its real-ms offset from 06:00;
  `real_ms_between_hours(from, to)` is the real ms from one game hour to another, wrapping to the
  next day if `to <= from`. Use it for every "how long in real time until game time X" — a flat
  rate is wrong across midnight because night runs ~6× faster.
- `format_game_timestamp(ts)` → `"Day 49, 2:08 AM"` (used in memories and prompts instead of
  calendar time). `format_time_of_day(min)` → `"HH:MM"`; `parse_time_of_day("HH:MM" | "H:MM" | with AM/PM)`;
  `game_minutes_until(target, current)` wraps; `day_of_week_index(day)` with **day 1 = Monday**;
  `is_weekday` = Monday–Friday.
- `skipTime(skip_ms)` input: `world_start_time -= skip_ms` (moves the clock forward). UI offers
  "next 06:00", "next 18:00", "+1 game hour" (computed with `cycle_progress_for_hour`).
- `[ADAPT]` add `game_seconds_to_real_ms(now, game_seconds)` that integrates across the day/night
  boundary, to convert map travel times (§4.5) into real time.

### 3.3 The step loop `[ADAPT]`

AI City (`abstractGame.runStep`): load inputs (max 32/step) → for each 16 ms tick up to `now`
(max 600 ticks): apply inputs whose `received <= tick time`, call `game.tick(t)` → commit engine
state, completed inputs and a world diff in one mutation → start scheduled operations.

`Game.tick(now)` order (keep it):
1. `world_start_time ??= now`
2. `tick_scenarios(game, now)` (self-throttled to 3 s, §13)
3. every player: `player.tick` (kick idle humans after 5 min), then pathfinding, then position
4. every conversation: `conversation.tick`
5. every agent: `agent.tick` (§6)
6. record positions (AI City: history buffers; new: nothing — trips are interpolated)

New loop:
```
while running:
    step_start = now()
    inputs = SELECT … FROM inputs WHERE world_id=? AND number > processed ORDER BY number LIMIT MAX_INPUTS_PER_STEP
    t = engine.current_time + TICK_MS   (or now on first step)
    while t <= now() and ticks < MAX_TICKS_PER_STEP:
        apply every input with received <= t  (try/except → return {ok, value} | {error, message})
        world.tick(t)
        t += TICK_MS
    persist(): one transaction — engine row, inputs results, changed players/agents/conversations,
               world_state, archives (ended conversations), descriptions if modified, buffered
               relationship/short-term events, observations (capped), then COMMIT
    after commit: submit buffered operations; submit observation promotion for importance >= 3
    renew lease; sleep until step_start + STEP_INTERVAL_MS
```
- `TICK_MS`: AI City used 16 ms for pixel-smooth movement. With route-interpolated movement (§4.4)
  **250 ms is enough**; all agent throttles are wall-clock based so they are unaffected.
  Keep it configurable (≤ 1000 ms). Note the per-tick random rolls in §23 (group drift-off).
- `STEP_INTERVAL_MS = 1000`. Persist only rows that changed (dirty flag or JSON hash compare).
- Operations scheduled during the step are only submitted **after** the commit, so an operation
  never reads state older than the step that requested it.
- Buffered events: relationship events (uncapped), short-term events (uncapped; no-op changes
  dropped), observations (**capped at 32 per step**; a dropped one must leave the observer's
  fingerprint un-advanced so it is re-emitted later).
- Crash recovery: on boot load everything from SQLite. An operation in flight when the process died
  never reports back; the agent's lock times out after `ACTION_TIMEOUT` (120 s). `[NEW]`
  RECOMMENDED: on boot, clear every `in_progress_operation` and `is_typing` immediately.
- Input numbering: `number = max(max(number in inputs), processed_input_number) + 1`, so numbering
  stays monotonic after old inputs are vacuumed (AI City hit a freeze when a vacuum emptied the
  table and numbering restarted at 0 below the engine's processed counter).

### 3.4 Inputs (the command catalogue) `[PORT]` unless noted

Every state change from outside the tick — humans, the UI, and operation results — is an input.
Handlers run inside the tick, mutate in-memory state and may raise (the error becomes the input's
return value and is toasted in the UI).

**Write-back validation rule:** a write-back from a *locked* operation MUST check
`agent.in_progress_operation.operation_id == args.operation_id`; if not, ignore it (log at debug) —
the operation was timed out or superseded. Then clear the lock.

| Input | Args | Effect |
|---|---|---|
| `join` | name, character, description, token? | Human joins (max 8 humans, one per token). `[ADAPT]` placed at a chosen named location or random reachable AOI. Creates player + description. |
| `leave` | player_id | Stops their conversation; removes the player (archived). |
| `moveTo` | player_id, destination \| null | `[ADAPT]` destination = location id / AOI id / lng,lat snapped to nearest reachable AOI; null stops. Refused while participating in a face-to-face conversation (texting is fine). |
| `teleportPlayer` | player_id, destination | Snap position; leaves any conversation. Debug/rescue. |
| `startConversation` | player_id, invitee | Returns conversation id; error if either is already in one. |
| `startTyping` | player_id, conversation_id, message_uuid | Human typing lock. |
| `finishSendingMessage` | player_id, conversation_id, timestamp | Clears typing, sets `last_message`, `num_messages += 1`, adds author to `all_participants`, **clears `next_speaker`** (open floor). |
| `acceptInvite` / `rejectInvite` / `leaveConversation` | player_id, conversation_id | Membership transitions (§8.1). Reject stops the conversation. |
| `createAgent` | description_index | **Idempotent by name**: skip if a live player already has that name. Creates player (`Player.join`), agent, agent description (identity, profile, family). Inherits a running *broadcast* custom scenario (only when `scenario_participant_ids` is None). |
| `finishPlanDay` | operation_id, agent_id, schedule, day | Validates op. `schedule = merge_fixed_obligations(name, day, schedule)` **unless** a manual scenario is active for the agent (`scenario_instruction` set and no `scenario_id`), in which case the LLM schedule stands as-is. Sets `schedule_generated_for_day = day`, `current_step_index = 0`. |
| `finishRememberConversation` | operation_id, agent_id | Clears lock and `to_remember`; sets `schedule_needs_refresh = True`. |
| `finishDoSomething` | operation_id, agent_id, destination?, invitee?, activity?, activity_cost? | Starts a conversation with the invitee (sets `last_invite_attempt`), starts a trip, sets an activity and debits `activity_cost` through `spend` (§12.5). |
| `agentFinishSendingMessage` | agent_id, conversation_id, timestamp, operation_id, leave_conversation, is_goal_summary?, next_speaker?, goal_met?, covered_topics?, focal? | Validates op; runs `finishSendingMessage`; then sets `next_speaker` (unless leaving); latches `scenario_goal_met`; sets `goal_summary_posted`; mirrors progress onto the agent's active scenario (`topics_done[i]`, `topics_done_at[i]` first time, `goal_met`, `goal_met_at`); applies a focal delta to the scenario's deliberation (§14.4); leaves if `leave_conversation`. |
| `finishGenerateDecisionOptions` | scenario_id, options | Lock-free result. If < 2 options: clear `options_requested` so a later tick retries. Else store options (only if none yet). |
| `finishPlanScenarioTasks` | operation_id, agent_id, scenario_id, tasks[] | Releases the planner's lock if matching. Ignore if scenario gone or tasks already set. Empty list → clear `task_plan_requested` (scenario wraps up normally). Else store tasks (assignee names resolved), `phase='working'`, `goal_met=False`, `end_time = now + SCENARIO_WORK_MAX_MS`, and stop every conversation touching a participant. |
| `agentApplyAffinity` | agent_id, deltas[{player_id, delta}], conversation_id?, reason? | For each: `updated = clamp(current_effective + delta)`; store; relationship event `affinityShift` when changed; `last_affinity_change = {now, net}` if net ≠ 0. |
| `applyEvaluationOutcome` | focal_player_id, scenario_id, scenario_name, deltas[{player_id, delta, reason}] | Each participant's affinity **toward the focal agent** moves by delta (skip the focal agent itself and zero deltas); event `decisionOutcome`. |
| `agentApplyShortTerm` | agent_id, deltas[{component, delta}], reason?, cause?, conversation_id?, scenario_id?, goal_met? | Apply with profile multipliers and clamp (§12.1); one short-term event per changed gauge with the given cause (default `conversationFeelings`). |
| `agentSetState` | agent_id, mood?, stress?, fatigue?, hunger?, balance?, health? | **Absolute** operator override (no multipliers). Events with cause `manualOverride`. Balance floored at 0 and rounded. Making someone sick sets `sick_days_left = 2`, `consecutive_work_days = 0` and clears `schedule_generated_for_day` so the rest schedule applies today; making them well sets `schedule_needs_refresh`. |
| `agentSetLocation` | player_id, location_id | Operator "Move here": validate the location, leave any conversation, stop, teleport, and set `pin = {destination, location_id, day}` which overrides the schedule until the next day rollover; clears `scenario_target`. |
| `agentReleaseLocation` | player_id | Delete pin; `schedule_needs_refresh = True`. |
| `finishDecomposeStep` | operation_id, agent_id, step_key, steps[] | Validates op. Non-empty → `active_sub_steps = {step_key, steps}` and expire the current ambient activity (`until = now`) so sub-steps take effect immediately. |
| `agentSetSelfSummary` | agent_id, self_summary, day | Writes the description (`descriptions_modified = True`). Ignores blank. |
| `finishReact` | agent_id, reaction, target_player_id?, activity, emoji?, reason? | `talk` → `preferred_invitee`. `activity` → ambient activity for 20 game minutes. `replan` → at most 2 per game day: `schedule_needs_refresh = True`, `reaction_replan = True`. |
| `finishReflect` | agent_id | `last_reflection_at = now`, `events_since_reflection = 0`. |
| `agentAddLearnedTrait` | agent_id, trait | Append if not already present (case-insensitive); keep the last 6. |
| `agentSetScenarioProfile` | agent_id, scenario_profile, scenario_instruction | Ignore if the agent's current instruction differs (stale). Else store profile and `scenario_profile_for`. |
| `startCustomScenario` | instruction, name?, emoji?, background? | Town-wide injector (§13.7). |
| `startGeneratedScenario` | scenario?, manual? | Start a Decider-generated scenario (§13.8). Always clears `scenario_gen_requested`. |
| `startCatalogScenario` | scenario_id, instruction? | Manual start of a catalogue scenario through the automatic pipeline (§13.7). Raises if too few of the right people are free. |
| `clearScenario` | — | Full reset of manual and automatic scenarios (world fields, every agent's scenario fields, `active_scenarios = None`). |
| `startScenarioMeetAtPark` | — | Custom scenario for **everyone**: gather at Gardens by the Bay. |
| `skipTime` | skip_ms | `world_start_time -= skip_ms`. |

### 3.5 Operations (asynchronous LLM work) `[PORT]`

Two kinds:

- **Locked** (`agent.start_operation(name, args)`): allocates `o:N`, sets
  `in_progress_operation = {name, operation_id, started: now}`; raises if one is already in
  flight. While locked the agent's main loop does nothing except the lock-free prelude (§6.1). The
  result comes back as an input carrying `operation_id`. After `ACTION_TIMEOUT = 120 s` the lock is
  dropped (logged "Timing out …").
- **Lock-free** (`game.schedule_operation(name, args)`): no lock; duplicates are prevented by
  stamping a field **optimistically at schedule time** (a lock-free op has no operation id to clear
  anything with on return).

| Operation | Kind | Trigger (§) | LLM calls | Writes / result input |
|---|---|---|---|---|
| `agentPlanDay` | locked | wants a plan (§7.1) | 1 chat (+ memory read) | `finishPlanDay` |
| `agentDoSomething` | locked | free roam / settled invite (§6.7) | none (rule-based; one DB query for candidates) | `finishDoSomething` |
| `agentGenerateMessage` (start/continue/leave/summary) | locked | conversation turn (§8.4) | 1 message + embeddings (cached) + vector searches + 1 moderator call for start/continue (fast path skips it) | inserts the message row, then `agentFinishSendingMessage` |
| `runFocalAgentTurn` | locked | focal agent's turn (§14.4) | 2 (extraction + focal) | message row + `agentFinishSendingMessage` with `focal` delta |
| `agentRememberConversation` | locked | `to_remember` set (§9.3) | summary + importance + 1 embedding | memory row; `agentApplyAffinity`, `agentApplyShortTerm`, `finishRememberConversation` |
| `agentDecomposeStep` | locked | settled into a long block (§7.6) | 1 | `finishDecomposeStep` |
| `agentPlanScenarioTasks` | locked | planner after a tasks scenario's goal (§13.6) | 1 | `finishPlanScenarioTasks` |
| `agentExtractScenarioProfile` | lock-free (stamp `scenario_profile_for`) | new scenario instruction (§13.10) | 1 | `agentSetScenarioProfile` |
| `agentReflect` | lock-free (stamp `last_reflection_check`) | §9.5 | 1 + importance and embedding per insight | reflection memories; `finishReflect`, `agentAddLearnedTrait` |
| `agentReact` | lock-free (stamp `last_reaction_at`) | §10.3 | 1 | `finishReact`; marks observations processed |
| `agentRegenerateSelfSummary` | lock-free (stamp `self_summary_checked_for_day`) | day rollover cadence (§9.6) | 1 | `agentSetSelfSummary` |
| `agentRememberScenario` | lock-free | scenario teardown, per participant (§13.9) | 1 + importance + embedding | scenarioOutcome memory; `agentApplyShortTerm` |
| `generateDecisionOptions` | lock-free (stamp `options_requested`) | focal agent at decision start (§14.3) | 1 | `decider_traces` row; `finishGenerateDecisionOptions` |
| `evaluateFinalDecision` | lock-free (stamp `evaluation_requested`) | commit or expiry (§14.6) | 1 per option | `evaluations` row; `applyEvaluationOutcome` |
| `generateAndStartScenario` | lock-free (stamp `scenario_gen_requested`) | scenario manager (§13.8) | 1 | `generated_scenarios` row; `startGeneratedScenario` |
| `promoteObservations` | after persist | observations with importance ≥ 3 (§10.2) | batched embeddings | memory rows |

Rules every operation MUST follow (each was a production bug in AI City):
1. **A locked operation always sends its result input**, even on failure (empty schedule → fallback,
   empty tasks, empty steps, `'...'` message). Otherwise the agent stands frozen for 120 s and, in a
   conversation, holds `is_typing` for 15 s. AI City's `agentGenerateMessage` does not guard this —
   the new build MUST wrap it.
2. A failed `rememberConversation` (e.g. the conversation was never archived) must be swallowed and
   still send `finishRememberConversation`.
3. Lock-free operations must be cheap and inert on failure (no half-applied state).
4. Bounded concurrency: one semaphore for LLM calls (e.g. 16), separate from the step loop.
5. Operations read with their own connection and never mutate engine-owned tables directly; the
   only direct writes allowed are append-only durable logs (`messages`, `memories`, `observations`
   flags, `perceived_knowledge`, `decider_traces`, `generated_scenarios`, `evaluations`,
   `llm_calls`) — exactly the set AI City wrote from actions.

### 3.6 World lifecycle and cost controls `[PORT]`

`worlds.status ∈ {running, inactive, stoppedByDeveloper}`.
- A running world costs a step every second **plus every agent's LLM calls**, whether or not anyone
  watches (~86k steps/day). In AI City the Convex deployment was disabled for exceeding plan limits
  because a forgotten browser tab kept a world running for days.
- Client heartbeat every 60 s **only while the tab is visible** → refresh `last_viewed`; restart an
  `inactive` world; never restart `stoppedByDeveloper`.
- Client calls `release` 10 s after the tab becomes hidden, and immediately on `pagehide` →
  status `inactive`, engine stops.
- Backstop: stop running worlds whose `last_viewed` is older than 2 min (check every 2 min).
- Dead-engine restart: if a running world's engine has not stepped for 60 s, restart it (Studio
  supervisor checks every 60 s).
- Pause/Resume button = `stop`/`resume` (`stoppedByDeveloper` ↔ `running`). The CLI MUST have
  `python -m city stop` (the analogue of `npm run stop`, which the ai-town CLAUDE.md requires after
  every test session).
- `[NEW][OPTIONAL]` a daily LLM token budget per world that pauses the world when exceeded.

### 3.7 Retention `[PORT]`

- Every 24 h: delete rows older than 14 days from `inputs`, `memories` (and their embeddings),
  `relationship_events`, `short_term_events`, `llm_calls`.
- Every 15 min: delete `observations` older than 12 game days of real time (12 × 19 min ≈ 3.8 h),
  in batches of 64, repeating while a full batch was deleted.
- `embeddings_cache` is never vacuumed and survives `wipe`.

---

## 4. Singapore map, places and movement

AI City sources replaced here: `data/city.js` (70×44 tile map), `data/cityLocations.ts` (named
places, homes, workplaces), `convex/aiTown/movement.ts` (A\* on tiles, collisions),
`convex/aiTown/location.ts` + `convex/engine/historicalObject.ts` (position history),
`src/components/PixiGame.tsx`, `PixiStaticMap.tsx`, `MiniMap.tsx`, `src/cityTileset.ts`.

Agent-society sources reused: `ui/maps.py`, `ui/mapbuilder/build_osm_map.py`, `ui/social.py`,
`paper_experiments/custom/routing/py_router.py`, `paper_experiments/custom/envs/mobility_space_windows.py`,
`ui/web/src/lib/maps.js`, `.venv/Lib/site-packages/agentsociety2/contrib/env/mobility_space/map.py`.

### 4.1 The map `[ADAPT]`

- Use the agent-society map store. In the Studio *Maps* page build the preset **"Singapore — whole
  island"** (`bbox [1.20, 103.60, 1.48, 104.09]`; the builder warns it takes tens of minutes and
  several GB of RAM) — or import an island `.pb` from the agentsociety1 project
  (`scripts/build_singapore_map.py --extent island`). The result is
  `paper_experiments/maps/<map_id>/` containing:
  - `map.pb` — MOSS/pycityproto `Map`: `header.projection` (transverse Mercator centred on the
    area), `lanes` (driving/walking, centre lines, max speed, successors/predecessors), `roads`,
    `junctions`, `aois` (building/site polygons with `name`, `urban_land_use`,
    `driving_positions`/`walking_positions` gates, `area`), `pois` (`name`, `category` like
    `restaurant|food_court`, `position`, `aoi_id`).
  - `places.json` — `{homes, works, any}` lists of **reachable** AOIs (`id, lng, lat, label, use`).
    Reachable = driving gate in the largest strongly connected road component **and** walking gate
    in the largest footpath component, so every trip between two of them succeeds.
    `use` is the land-use group: Residential (R…), Business & industry (B/M/W…), Public &
    institutions (A…), Other.
  - `preview.json` — simplified AOI polygons by land-use group and road polylines in lng/lat, for
    drawing.
  - `meta.json` — counts and bbox. The existing *central* map has 10,152 AOIs, 9,796 POIs, 2,004
    roads, 17,338 lanes, 9,030 reachable AOIs (2,618 homes, 1,574 works). The island map is several
    times larger — **measure** load time and memory of `Map` + `RoutingGraph` before committing to
    loading both in the engine process.
- The engine loads, once at startup:
  - `Map(map.pb)` from agentsociety2 for spatial queries: `query_pois(center_xy, radius_m, category, limit)`,
    `query_aois(center_xy, radius_m, urban_land_uses, limit)`, `get_aoi`, `get_poi`,
    `lnglat2xy`/`xy2lnglat`, `projector`. POI categories are two-level (`restaurant`, `food_court`,
    `cafe`, `park`, `hospital`, `place_of_worship`, …; see `find_nearby_pois` docstring).
  - `RoutingGraph(pb)` from `py_router.py` (or `py_router.load_graph(path)`):
    `graph.route({"type": ROUTE_TYPE_DRIVING | ROUTE_TYPE_WALKING, "start": {"aoi_position": {"aoi_id": a}}, "end": {"aoi_position": {"aoi_id": b}}})`
    returns `{"journeys": [{"driving": {"road_ids", "eta"}}]}` or `{"journeys": [{"walking": {"route": [{lane_id, moving_direction}], "eta"}}]}`
    (ETA in seconds; walking at 1.34 m/s) and raises `NoRoute`; `drive(start, end)` / `walk(start, end)`
    are the same searches taking pycityproto `Position` messages; `reachable_aois()` gives the set
    used for `places.json`. Call it in-process; there is no need to run it as an HTTP server
    (MobilitySpace does that only because agentsociety2 expects one). Calling it directly also
    avoids the upstream MobilitySpace quirk that swaps the walking/driving codes.
  - Route geometry for drawing: turn the route into a polyline with agentsociety2's
    `Map._route_to_xys` (what MobilitySpace uses), simplify to 4 m, cap at 200 points and project to
    lng/lat — exactly what `mobility_space_windows._record_route` does for the Studio's replays.

### 4.2 Named locations `[ADAPT]`

AI City has nine named places (`CITY_LOCATIONS`) used for homes, workplaces, the LLM planner's
location menu, scenario gathering, prompts ("You are at …") and the UI. Keep the **same ids** — they
are referenced by the scenario catalogue (`locationId`), workplaces, routines and contextual event
pools — and bind each to real Singapore geography.

| id | AI City name | Who uses it (AI City data) | Recommended anchor | Approx. lng, lat | Found on existing central map? | Alternatives |
|---|---|---|---|---|---|---|
| `mbs` | Marina Bay Sands | work: James (taxi stand), Naomi, Faisal, Somchai, Hafiz | "Marina Bay Sands Tower 1" AOI | 103.8602, 1.2827 | yes (AOI 500000179) | — |
| `gardens` | Gardens by the Bay | work: Mateo, Tavita; town gatherings | "Gardens by the Bay" AOI | 103.8650, 1.2815 | yes (AOI 500008719) | — |
| `astar` | A\*STAR | work: Lukas, Isabel, Clara, Haoran, Meera | Biopolis, one-north | 103.7920, 1.3028 | yes ("Biopolis") | Connexis/Fusionopolis Way (A\*STAR HQ) |
| `fusionopolis` | Fusionopolis | work: Yvonne, Nikhil, Kerem, Katrin, Camille | Fusionopolis One, one-north | ≈103.7876, 1.2992 | no (edge of bbox) | — |
| `university` | Temasek Polytechnic | home: 8 students/staff; work: 11 | Temasek Polytechnic, Tampines Ave 1 | ≈103.9326, 1.3454 | no (outside bbox) | — |
| `hdb` | HDB Estate | home: 32 residents; work: Ratna, Emeka, Aroha, Danuta | an HDB town centre — default **Toa Payoh** (central, balanced commutes) | ≈103.8476, 1.3326 | no | Tampines (≈103.9446, 1.3535) to cluster with TP and CGH; The Pinnacle@Duxton (103.8412, 1.2770, on central map) for a compact town |
| `shophouses` | Peranakan Shophouses | home: 10; work: Cedric, Tiago, Ravi, Pilar, Siti, Gordon | Joo Chiat / Koon Seng Road | ≈103.9010, 1.3130 | no | Emerald Hill / Peranakan Place (103.8389, 1.3018, on central map) |
| `restaurant` | Hawker Centre | work: Sarah, Rahman, Lucia, Meihua, Arun; meals | Old Airport Road Food Centre | ≈103.8857, 1.3081 | nearby open space only | Maxwell Food Centre (≈103.8447, 1.2804); Tanjong Pagar Market & Food Centre (103.8432, 1.2766, on central map) |
| `changi_hospital` | Changi General Hospital | work: Nurul, Sharifah, Hanna, Dylan, Nadia, Sofia | Changi General Hospital, Simei | ≈103.9496, 1.3404 | no (outside bbox) | — |

"≈" coordinates are from general knowledge, not from the map. The anchors are **data**
(`city/data/locations.json`), so the choice can change without code changes.

Binding procedure (run at world init and persisted in the `locations` table):
```
bind(location):
    names = location.anchor_names                       # e.g. ["Marina Bay Sands", "MBS"]
    cand  = reachable AOIs whose name/label contains any name (case-insensitive)
          ∪ { poi.aoi_id for POIs whose name matches, if that AOI is reachable }
    if cand: pick the candidate nearest location.approx_lnglat (else the largest by area)
    else:    nearest reachable AOI to approx_lnglat (query_aois radius 800 m, widen if empty)
    store: aoi_id, poi_id?, lng/lat (AOI centroid, or the POI point), kind, radius_m,
           marker lng/lat (cosmetic beacon position; AI City had markerX/Y inside the roof)
radius_m by kind: venue 150 m (mbs, restaurant, gardens entrance), campus 500 m (university,
astar, fusionopolis, changi_hospital), neighbourhood 1200 m (hdb), street 400 m (shophouses)
```
Keep the AI City descriptions verbatim — the planner and Decider show them to the LLM:

```
mbs          Marina Bay Sands — Iconic three-tower hotel with the rooftop skypark and reflecting pool. Tourists, business meetings, expensive drinks.
fusionopolis Fusionopolis — Glassy research and tech complex in one-north. Startups, biotech labs, AI offices.
astar        A*STAR — Singapore's national research agency campus. Scientists, postdocs, gleaming labs.
gardens      Gardens by the Bay — Huge public park with the supertree grove and winding paths. Joggers, families, picnics.
university   Temasek Polytechnic — Large tertiary campus with lecture halls, dorms, and a sprawling library.
hdb          HDB Estate — Public housing block where most residents live. Void decks, playgrounds, neighbours chatting.
shophouses   Peranakan Shophouses — Row of colourful shophouses — small cafes, boutiques, tailor shops, hidden bars.
restaurant   Hawker Centre — Open-air kopitiam with food stalls and shared tables. Always busy at meal times, gossip central.
changi_hospital Changi General Hospital — Large general hospital with the blue cross emblem.
```

`[OPTIONAL]` generic place types for the planner (§7.1): `food`, `cafe`, `park`, `mall`, `clinic`,
`worship` resolved per agent to the nearest reachable POI of that category near their current
position or home (`query_pois`). This makes the whole-island map matter for leisure, not just work.
Parity does not require it.

### 4.3 Homes and workplaces `[ADAPT]`

AI City keyed both by character name (`CHARACTER_HOMES`, `CHARACTER_WORKPLACES`):
- Workplace = a named location id + an in-character activity string (e.g. Cedric `shophouses`
  "working the espresso bar at his cafe"). **Bernard has none on purpose** (retired; free to roam).
  All workers of a place share that place's AOI. Several characters work where they live
  (`hdb`: Ratna live-in helper, Emeka site supervisor, Aroha youth worker, Danuta carer;
  `university`: students and campus staff; `shophouses`: shop owners).
- Home = one of three **home areas** (`hdb` 32 people, `shophouses` 10, `university` 8) plus a
  distinct unit tile each. Family members do **not** necessarily share a home (James and his
  daughter Sarah have different HDB units; his son Xavier lives at the shophouses).

New assignment (deterministic with a seed; persisted in `character_places`):
```
for area in (hdb, shophouses, university):
    anchor = locations[area]
    pool   = reachable AOIs within anchor.radius_m of the anchor
             (hdb: land use Residential only; shophouses/university: any use)
    sort pool by distance to anchor
    assign residents of this area to AOIs, at most HOMES_PER_AOI (hdb 4, shophouses 2,
    university 4) per AOI, filling nearest-first with a seeded shuffle within distance bands;
    family members in the same area go into the same AOI (same block) when there is room
home record = {location_id: area, aoi_id, lng, lat, label}
work record = {location_id, aoi_id = locations[location_id].aoi_id, activity}
also store commute_minutes (see §4.5) per resident
```
Agent-society's `maps.place_people` / `social.groups` implement a similar idea (households share a
home, teams share a workplace, same-neighbourhood people live within ~1 km) and MAY be reused, but
note its households merge close family into **one** home, which differs from AI City.

The sentinel location id **`'home'`** in a schedule step means "this character's own home"; its
destination is the home record. It is deliberately not the area id, because three things compare a
step's `location_id` with the character's workplace id (`work_leash_anchor`, the own-workplace flag
in fatigue accrual, the contextual-event pool) and would misfire for people who live where they
work.

The old `homes.test.ts` constraints (homes ≥ 2 tiles apart, reachable with 49 sleepers blocking
tiles) existed only because sleeping agents blocked tiles. **There are no collisions on the new map;
drop those constraints.**

### 4.4 Position model `[ADAPT]`

Replace `position {x, y}`, `facing`, `speed`, `pathfinding` and the per-step position history with:
```
Position:
  status: 'idle' | 'moving'
  aoi_id: int | None          # idle: where they are. moving: where they set off from
  poi_id: int | None
  lng, lat: float             # idle: the AOI/POI point. moving: last computed point (for queries)
Trip (only while moving):
  dest: {aoi_id, poi_id?, lng, lat, location_id?}
  mode: 'walk' | 'drive'
  path: [[lng, lat], …]       # ≤ 200 points, simplified
  length_m: float
  depart_at, arrive_at: engine ms   # real time, from the game-time ETA (§4.5)
```
- Point at time `t`: fraction `(t − depart_at) / (arrive_at − depart_at)` of `length_m` along the
  cumulative path length (exactly `motion().pointAt` in `ui/web/src/lib/maps.js`). On `t ≥
  arrive_at` the engine sets the player idle at `dest`.
- Bearing of the current segment MAY be kept as "facing" for sprites.
- The client receives each trip once (with the state snapshot) and animates it locally; nothing
  like AI City's packed history buffers is needed.
- `stop_player` = end the trip where they are: idle at the nearest reachable AOI to the current
  point (or keep `aoi_id = None` and the raw point while standing in the street).

### 4.5 Trips and routing `[ADAPT]`

`move_player(dest)` replaces `movePlayer` + A\*:
```
if already idle at dest.aoi_id: no-op
if participating in a face-to-face conversation: raise (texting is allowed)
player.pathfinding_state = 'needsPath'           # keep the queue semantics
per tick, while routes_this_step < MAX_ROUTES_PER_STEP (32):
    mode = 'walk' if straight_line_m(from, dest) <= WALK_MAX_M (1200) else 'drive'
    route = graph.route(mode, from_aoi, dest_aoi)              # LRU cache by (from, to, mode)
    on NoRoute: retry with mode flipped; then snap dest to nearest reachable AOI;
                last resort a straight line at 1.34 m/s
    eta_game_s = the journey's eta (seconds of game time)
    trip = {…, depart_at: now, arrive_at: now + game_seconds_to_real_ms(now, eta_game_s)}
```
- Speed reference: while the town is awake one game minute is one real second, so a 20-minute drive
  takes 20 real seconds and a 1 km walk (~12.5 min) takes ~12.5 real seconds.
- `estimate_travel_time_ms(player, dest)` (used to time scenario gatherings) = the same conversion
  of the route ETA, falling back to straight-line distance at walking speed.
- `[OPTIONAL]` a `transit` mode (drive ETA × 1.3 + 8 min wait) for realism.
- Remove AI City's `PATHFINDING_TIMEOUT` (60 s) semantics; instead time a trip out at
  `arrive_at + 30 s` (snap to destination).
- **Commute block length.** AI City used a fixed 45 game minutes before each shift, sized for the
  tiny map. Use per-character `commute_minutes = clamp(ceil(eta_game_min(home→work) × 1.3) + 10, 15, 120)`
  (computed at placement), still clamped to start no earlier than the character is up (§7.3).

### 4.6 Translating tile distances `[ADAPT]`

Every distance rule in AI City is in tiles. Use these replacements (all in `city/config.py`):

| AI City constant (tiles) | Meaning | New rule | Suggested value |
|---|---|---|---|
| `CONVERSATION_DISTANCE` 1.3 | close enough to start talking | same AOI, or both points within `CONVERSATION_RADIUS_M` | 40 m |
| `GROUP_JOIN_DISTANCE` 2.5 | late joiner slots into the huddle | same AOI as any participant, or within | 60 m |
| `MIDPOINT_THRESHOLD` 4 | walk to midpoint vs straight to the other person | dropped: the invitee travels to the inviter's AOI (§4.7) | — |
| `GROUP_JOIN_RADIUS` 6 | a free agent near a group joins it | `GROUP_JOIN_RADIUS_M` | 300 m |
| `SCHEDULE_CHAT_RADIUS` 6 | perception radius; in-transit greeting radius | `PERCEPTION_RADIUS_M` (same AOI always counts) | 150 m |
| `WORK_LEASH_RADIUS` 8 | stay near the workplace while on shift | `WORK_LEASH_RADIUS_M` around the workplace anchor (same AOI always counts) | 300 m |
| `STEP_WANDER_RADIUS` 4 / `STEP_SETTLED_RADIUS` 5 | mill about at a step's spot | "settled" = idle at the step's AOI or within the location's `radius_m`; milling = client-side jitter only | — |
| `ARRIVAL_RADIUS` 1.5 | arrived at a step | trip completed at the step's AOI (or within 50 m) | 50 m |
| `SCENARIO_ARRIVAL_RADIUS` 3 | arrived at a gathering | idle at the gathering AOI or within | 80 m |
| `SCENARIO_PROXIMITY_FALLOFF_TILES` 25 | cast-selection proximity bonus falls to 0 | `SCENARIO_PROXIMITY_FALLOFF_M` (straight line) | 3000 m |
| `CANDIDATE_AFFINITY_WEIGHT` 2 pts/tile | invitee score = affinity − weight × distance | `affinity − 2 × est_travel_game_minutes` (straight line ÷ 30 km/h drive, or ÷ 4.8 km/h ≤ 1.2 km) | 2 pts/min |
| settled off-shift agents invite **map-wide** | emergent conversations | cap candidates at `INVITE_MAX_TRAVEL_MIN` estimated travel | 30 game min |
| `COLLISION_THRESHOLD` 0.75 | agents block each other | dropped | — |
| `movementSpeed` 1.25 tiles/s | walking speed | routed: walk 1.34 m/s, drive lane speed limits (game time) | — |
| `MAX_PATHFINDS_PER_STEP` 32 | routing budget per step | `MAX_ROUTES_PER_STEP` | 32 |
| `COMMUTE_MINUTES` 45 | commute block | per-character `commute_minutes` (§4.5) | — |
| nearest location ≤ 3 tiles "at X", ≤ 8 "near X" | prompt place phrase | §4.7 `describe_place` | — |

### 4.7 Co-presence, walking over, place descriptions `[ADAPT]`

- **Starting a conversation** (invite): the creator is `walkingOver`, the invitee `invited`. The
  meeting point is the creator's AOI if the creator is idle (the creator stops and holds), else the
  creator's trip destination. On accept the invitee travels there. A member becomes `participating`
  when idle at the meeting AOI, or within `CONVERSATION_RADIUS_M` of a participating member. Two
  walkers bootstrap a conversation when they are together the same way.
- **Joining a group** (`maybeJoinNearbyConversation`): the joiner travels to the AOI of the nearest
  participating member; promotion as above with `GROUP_JOIN_DISTANCE` → same AOI or 60 m.
- **Invite timeout** stays 60 s real (= 60 game minutes while awake), which comfortably covers the
  30-minute travel cap.
- **Text conversations** ignore geometry entirely (§8.7).
- **Perception and "nearby"**: another player is perceived if idle in the same AOI or within
  `PERCEPTION_RADIUS_M` of the observer's current point (moving players included).
- **`describe_place(player)`** replaces AI City's `currentTimeAndPlacePrompt` distance bands and
  `nearestLocation(...).name`:
  - idle at a named location's AOI or within its radius → "You are at {location name}."
  - idle at their own home → "You are at home ({area name})."
  - idle elsewhere → "You are at {AOI name}" or "You are near {nearest named POI within 250 m}"
    (the labelling rule from `ui/maps.py`/`MobilitySpace._place_name`)
  - moving → "You are on your way to {destination label}."
  - otherwise "You are somewhere in Singapore."
- **`nearest_location(point)`** (used for observation fingerprints, the reacting prompt and the
  interview) returns the named location whose radius contains the point, else the nearest named
  location by distance — and for prompts prefer `describe_place`.
- **Out of place** (perception salience): the subject is idle somewhere that is neither their own
  home AOI nor, when their current step is at their workplace, their work AOI.

### 4.8 Dropped or replaced

- Dropped: tile layers, tileset canvas generation (`src/cityTileset.ts`, `__city__` tileset URL),
  `objectTiles` collisions, A\*, `pickParkWaypoint` milling, `blockedWithPositions`,
  `historicalLocations` packing (`FastIntegerCompression`, `xxhash`, `HistoricalObject`), the
  `homes.test.ts` connectivity constraints, the level/sprite editors (`src/editor/`), the pre-rendered
  minimap image, `converted-map.js`, `data/convertMap.js`, and the Replicate background-music
  feature (`convex/music.ts`, `MusicButton`).
- Replaced: the PIXI canvas with Leaflet (§16.2); the minimap with Leaflet's own zoom/pan
  (`[OPTIONAL]` an overview inset); the day/night lighting overlay with a translucent night tint
  over the tiles (`[OPTIONAL]`).

### 4.9 What the map view must show

Reuse the patterns in agent-society's `ui/web/src/lib/maps.js` (Leaflet, OSM tiles,
`preview.json` land-use polygons, `peopleLayer` grouping, route animation). Specified in §16.2.

---

## 5. Characters and data

Source: `data/characters.ts`, `data/characterProfiles.ts`, `data/cityLocations.ts`,
`data/groundTruth.ts`, `data/routines.ts`, `CHARACTER_ACTIVITIES` in `convex/constants.ts`,
`data/spritesheets/f1..f8.ts`, `public/assets/32x32folk.png`, `convex/init.ts`,
`convex/groundTruth.ts`, tests `convex/roster.test.ts`, `convex/sleep.test.ts`.

### 5.1 Character description `[PORT]`

```
Description:
  name: str                 # unique; THE join key for every other data file
  character: 'f1'..'f8'     # sprite in 32x32folk.png (8 designs reused ~5–9 times each; f2 is the
                            #  only dark-skinned design — profiles were matched to sprite appearance)
  identity: str             # prose paragraph ending "…personality is best described as X, Y and Z."
  background: {occupation: str, religion: 'none' | 'muslim' | 'christian'}
                            # religion drives Friday prayer / Sunday service obligations (§7.3)
  profile: dict[str, str]   # structured self-knowledge (flat key → value)
  family: list[{name, relation}] | None   # directional labels, e.g. James → Sarah "daughter"
```
- The first 8 characters (Lukas, Cedric, James, Sarah, Rahman, Isabel, Xavier, Clara) have
  hand-authored profiles. The other 42 spread a row of the persona library
  (`characterProfiles.A01`…`A42`; A01–A25 transcribed from the user's "Agent Setting" spreadsheet,
  A26–A42 authored later) and override only what relocating them to Singapore changes
  (Nationality, Hometown, Cultural subgroup, Grew up/education, Current status, languages).
- The only family in the cast: **James** is the father of **Sarah** and **Xavier**
  (Sarah and Xavier are siblings). Older notes that call them three siblings are stale.

### 5.2 Profile fields `[PORT]`

Keys in use (34): Occupation, Nationality, Cultural subgroup, Religion / worldview, Dietary rule,
Food likes, Food dislikes, Alcohol attitude, Hobby, Personality, Communication style, Conflict
style, Payment/gift norm, Privacy/modesty norm, Observance level, Religious schedule constraint,
Age, Gender, Mobility level, Sleep/work rhythm, Region, Hometown, Grew up / education, Current
status, Native language, Other languages, Language confidence, Festival / holiday constraint,
Social power, Income/resource position, Other social taboo / constraint, Health condition,
Sensory sensitivity, Allergy.

Code that reads profile fields:
- **Sleep window** from `Sleep/work rhythm` (§7.3).
- **Constraint split** for prompts (`convex/agent/profileConstraints.ts`): a field is a *fixed
  fact* if its **key** matches
  `/diet|allerg|health condition|mobility|sensory|religious schedule|festival|holiday constraint|observance|taboo|constraint|sleep\/work|rhythm/i`
  and its **value** does not match `/^(no restrictions?|no limitations?|none|not applicable|n\/a)\b/i`.
  Fixed facts are shown to the character in their own block (§8.5); everything else is
  "background details". Taste, personality and occupation deliberately stay out of the fixed block.
- **Reactivity multipliers** (`shortTermSensitivity`, §12.1) scan all profile values for keywords.
- **Self-summary anchors** (§9.6): Occupation, Nationality, Religion / worldview, Dietary rule.
- **Theory probes** in the evaluation program classify characters by profile attributes (§20).

### 5.3 The cast

50 residents in a fixed order (index matters only as the `createAgent` argument; everything else
is by name): the original 8, then 17 added on 2026-08-29, then 25 added on 2026-09-22. Full table
in **Appendix B**. Summary:

| Home area | Residents | | Workplace | Workers |
|---|---|---|---|---|
| `hdb` | 32 | | `university` | 11 |
| `shophouses` | 10 | | `shophouses` | 6 |
| `university` | 8 | | `changi_hospital` | 6 |
| | | | `astar`, `mbs`, `restaurant`, `fusionopolis` | 5 each |
| | | | `hdb` | 4 |
| | | | `gardens` | 2 |
| | | | none (Bernard, retired) | 1 |

### 5.4 Free-time activity menus `[PORT]`

`CHARACTER_ACTIVITIES[name]` = three `{description, emoji, duration: 20_000 ms real, cost?: S$, energy?: 0–100}`
per character (e.g. James: waiting for a fare 🚗 energy 5; checking the Grab app 📱; grabbing a kopi
☕ cost 3). Characters without a list fall back to `ACTIVITIES` = reading a book 📖, daydreaming 🤔,
people-watching 👀. Chosen by `pick_activity` (§6.7). Export verbatim.

### 5.5 Hidden ground truth `[PORT]`

`data/groundTruth.ts`, keyed by name, one entry for each of the 50:
```
GroundTruthProfile:
  culturalBackground: str
  religion: str
  hardTaboos: list[str]       # ABSOLUTE: religious, medical/allergy, legal. Violating one zeroes utility.
  essentialNeeds: list[str]   # practical requirements; feed the 35-weight dimension
  preferences: list[str]      # likes/dislikes/strong dislikes/diets of choice
  budgetLimit: int            # rough S$ ceiling per outing; 0 = effectively unconstrained
  communicationStyle: str
```
- **Information barrier:** only the Evaluator (§14.6) and the offline evaluation program read it.
  The Decider, Focal agent, scenario generator and every agent-facing prompt MUST NOT. In SQLite
  keep it in its own table and only query it from `decision/evaluator.py` and `export.py`.
- 26 of 50 have at least one hard taboo (halal ×10, no beef, no pork, vegetarian, kosher-style,
  shellfish/peanut allergies, lactose intolerance, Orthodox fasting periods, public-sector
  "no improper benefit", Sunday church; see Appendix B).
- **Three entries were invented** for the 8-person cast and are marked `[ADDED]` in the file,
  awaiting the user's review: James (doctor-ordered low salt/low sugar, a hard taboo), Isabel
  (shellfish allergy, a hard taboo), Xavier (S$15 budget ceiling, as an essential need). Keep them
  but keep the markers: an `added` list on the entry naming the invented items (stored in
  `ground_truth_profiles.added`).
- Seeding: rows are materialised per world, joined by name to player ids. Seeding is idempotent and
  lazy: `ensure_ground_truth(world)` before any evaluation; `reseed-ground-truth` overwrites after
  editing the file. Characters without an entry (humans) are skipped and reported.

### 5.6 Exporting the data from ai-town `[NEW]`

The data files are TypeScript with template literals and object spreads, so they MUST be evaluated,
not parsed. Pattern (already proven in agent-society `ui/presets/import_ai_city.cjs`): transpile each
file with ai-town's own `node_modules/typescript` (`ts.transpileModule`, CommonJS), run it in a `vm`
context with a `require` shim that resolves sibling `.ts` files, and read the exports. Write a
`city/tools/export_ai_city_data.cjs` that emits:

| Output | From | Notes |
|---|---|---|
| `characters.json` | `Descriptions` | order preserved; profiles with spreads resolved |
| `profiles_library.json` | `characterProfiles` | optional (reference) |
| `ground_truth.json` | `groundTruth` | add an `added` list for the three `[ADDED]` items by hand (comments are lost in export) |
| `scenarios.json` | `UNIVERSAL_SCENARIOS`, `LOCAL_SCENARIOS` | 18 defs, fields per §13.1 |
| `activities.json` | `CHARACTER_ACTIVITIES`, `ACTIVITIES` | from `convex/constants.ts` |
| `locations.json` | `CITY_LOCATIONS` | add anchor names, approx lng/lat, kind, radius (§4.2) |
| `homes_workplaces.json` | `CHARACTER_HOMES` (area id only; tiles dropped), `CHARACTER_WORKPLACES` | |
| `routines.json` | module-private constants of `data/routines.ts` | `NIGHT_SHIFT_ROSTER`, `LOCATION_EVENTS`, `FLEXIBLE_EVENTS` are not exported — copy them from §7 or patch exports in |
| `faces.json` + sprite sheet | `characters` sprite frames | already produced by `import_ai_city.cjs` (`ai_city_faces.json`, `ai_city_folk.png`) |

Validate after export: 50 characters with unique names; every name present in homes, ground truth
and activities; every workplace except Bernard's present; 18 scenarios with unique ids; 9 locations;
sprite names ⊂ {f1..f8}.

### 5.7 Creating and topping up a world `[PORT]` `[ADAPT]`

`python -m city init [--num-agents N]`:
1. Get or create the default world (`is_default = 1`, status running, engine row, world_state with
   `next_id = 0`), bind locations (§4.2).
2. If the world is not `running`, warn ("run `python -m city resume`") and stop.
3. **Missing = characters whose name has no live player** (descriptions outlive archived players, so
   check live players only). Optionally cap with `--num-agents`. This lets the roster grow without a
   wipe: a world grown from 25 to 50 is missing exactly the 25 appended.
4. Place homes/workplaces for the missing (§4.3), then queue one `createAgent {description_index}`
   input per missing character. `createAgent` is **idempotent by name** (a second `init` before the
   queue drains must not create duplicates).
5. Seed ground truth (no-op until descriptions exist; the lazy path covers it).
- `[ADAPT]` a new agent spawns idle at its **home AOI** (AI City spawned at a random free tile), with
  no schedule; it plans within the first 2 real minutes (stagger, §7.2).
- A wipe + init is still required when an **existing** character's profile, family or ground truth
  changes (descriptions are written at creation and not refreshed).
- Human player: `join` with name `Me`, a random sprite, description "Me is a human player", token
  `Me` (Clerk auth was commented out in AI City). Max 8 humans. Humans idle > 5 min are removed.

---

## 6. The agent behaviour loop

Source: `convex/aiTown/agent.ts` (`Agent.tick`, `tickSchedule`, helpers),
`convex/aiTown/agentOperations.ts` (`agentDoSomething`, `pickActivity`, `wanderDestination`),
`findConversationCandidate` in `agent.ts`, tests `convex/plans.test.ts`.

`agent_tick(game, agent, now)` runs for every agent on every tick, in this exact order. The order is
load-bearing; §23 explains why several items sit where they do.

### 6.1 Prelude — always runs (even while locked, talking or held)

```
player = game.players[agent.player_id]

# (a) Manual ("custom") scenario: expire after one game day; adopt if in the cast
if world.scenario_instruction:
    if world.scenario_start_time is None: world.scenario_start_time = now
    elif now - world.scenario_start_time >= CYCLE_MS:
        clear world.scenario_instruction / scenario_start_time / scenario_participant_ids
        for a in agents if a.scenario_id is None: clear a.scenario_instruction, a.scenario_profile(_for)
        remove active_scenarios entries with def_id == 'manual'
if agent.scenario_instruction is None and world.scenario_instruction:
    cast = world.scenario_participant_ids
    if cast is None or agent.player_id in cast: agent.scenario_instruction = world.scenario_instruction

# (b) Scenario-relevant profile (what OTHERS see of this agent), once per instruction
if agent.scenario_instruction and agent.scenario_profile_for != agent.scenario_instruction
   and agent_description.profile:
    agent.scenario_profile_for = agent.scenario_instruction          # optimistic stamp
    schedule_operation('agentExtractScenarioProfile', agent, instruction)   # lock-free

maybe_request_scenario_tasks(now)      # §13.6 — locked op, but checked here
maybe_request_decision_options()       # §14.3 — lock-free
tick_observations(now, player)         # §10.1
maybe_reflect(now)                     # §9.5
maybe_react(now, player)               # §10.3
apply_sleep_pressure(now)              # §12.2
```

### 6.2 Operation guard
```
if agent.in_progress_operation:
    if now < op.started + ACTION_TIMEOUT (120 s): return      # wait for the result input
    log "Timing out …"; agent.in_progress_operation = None
```

### 6.3 Held by a working scenario
```
if is_held_by_scenario() and not in_conversation(player): stop moving; return
# is_held_by_scenario: my active scenario is LOCAL and (phase == 'working'
#                      or (task_plan_requested and tasks not yet assigned))
```

### 6.4 Join a nearby group conversation (`maybe_join_nearby_conversation`)
Return False (do nothing) if any: an op is in flight; already in a conversation; too tired to talk;
walking to a scenario gathering (`scenario_target`); **not in a scenario and `pending_step()` is set**
(on the way somewhere they are due); within 15 s of the last conversation or the last invite attempt.

Otherwise consider every conversation that: does not include me; is not a text thread; if I am in a
scenario, is my scenario's conversation (`is_in_scenario_conversation`); has < 5 participants;
has ≥ 2 participating members; has `num_messages ≤ 24` if it is my scenario's conversation else
`≤ 8`; and, **if I am on shift**, has a participating member within the work leash of my workplace.
Pick the one whose nearest participating member is closest, if that is within `GROUP_JOIN_RADIUS`.
Join it as `walkingOver`, set `last_invite_attempt = now`, stop moving (`[ADAPT]` then start a trip
to that member's AOI), return True.

### 6.5 Walk to a scenario gathering
```
if agent.scenario_target and not in_conversation(player):
    if not arrived(scenario_target, SCENARIO_ARRIVAL_RADIUS):
        if not already heading there: move_player(scenario_target)   # errors logged, retried next tick
    elif moving: stop
    return            # HOLD at the spot; do not fall through to the schedule (it would tug them away)
```

### 6.6 Execute the schedule (`tick_schedule` → True means "handled this tick, return")

```
gt = game_time(now)
if agent.pin and agent.pin.day != gt.day: agent.pin = None          # holds expire at day rollover
pin_point = agent.pin.destination if agent.pin else None
conv = conversation of player; texting = conv and conv.is_text
doing_activity = player.activity and player.activity.until > now
busy_with_one_off = doing_activity and not player.activity.ambient

# Contagion: roll once per conversation with any sick participant
if conv and agent.health != 'sick' and agent.last_contagion_conversation != conv.id:
    agent.last_contagion_conversation = conv.id
    if any participant's agent is sick and random() < CONTAGION_PROBABILITY (0.0625):
        health='sick'; sick_days_left=2; consecutive_work_days=0

# Once per game day, on the first tick of a new day number:
if agent.health_checked_for_day != gt.day:  stamp; update_health_for_new_day(gt.day)        # §12.3
if SELF_SUMMARY_ENABLED and agent.self_summary_checked_for_day != gt.day and gt.day >= 2
   and (desc.self_summary_day is None or gt.day - desc.self_summary_day >= 4):
    stamp; schedule_operation('agentRegenerateSelfSummary', …)                              # §9.6
if agent.short_term_checked_for_day != gt.day: stamp; update_short_term_for_new_day(gt.day) # §12

# Sick: deterministic rest-at-home schedule, no LLM
if agent.health == 'sick' and agent.schedule_generated_for_day != gt.day and not conv:
    schedule = build_sick_schedule(home); generated_for_day = gt.day; index = 0
    schedule_needs_refresh = False; stop moving; return True

no_schedule = not schedule
day_changed = schedule_generated_for_day is not None and schedule_generated_for_day != gt.day

# Advance the step index BEFORE measuring lateness; the day is a ring starting 06:00
if schedule and index is not None:
    if gt.minutes_into_day < schedule[index].start_minute: index = 0        # clock wrapped past midnight
    while index < len(schedule)-1 and gt.minutes_into_day >= schedule[index+1].start_minute: index += 1

in_scenario_meeting = scenario_meeting_point() is not None
current = schedule[index] if schedule and index is not None else None
disrupted = (current and not day_changed and not in_scenario_meeting and not pin_point
             and gt.minutes_into_day - current.start_minute > SCHEDULE_DISRUPTION_MINUTES (60)
             and not settled_at(current.destination))
conversation_refresh = agent.schedule_needs_refresh
reaction_replan = agent.reaction_replan and now - (agent.last_reaction_replan_at or 0) > 60 s
owes_fixed = owes_fixed_obligation()
wants_plan = (no_schedule or day_changed or disrupted
              or ((conversation_refresh or reaction_replan) and not owes_fixed))
             and not conv and not busy_with_one_off
if wants_plan:
    on_cooldown = last_plan_attempt and now - last_plan_attempt < 5 min
    offset = abs(java_hash(agent.id)) % 120_000          # java_hash: h = (h*31 + ord(c)) as int32
    day_start = (world_start_time or now) + (gt.day - 1) * CYCLE_MS
    before_stagger = now < day_start + offset
    if agent.force_plan or reaction_replan or (not on_cooldown and not before_stagger):
        last_plan_attempt = now; schedule_needs_refresh = False; force_plan = False
        if agent.reaction_replan: last_reaction_replan_at = now; reaction_replan = False
        start_operation('agentPlanDay', name, home, home_name, gt.day, gt.time_str,
                        gt.minutes_into_day,
                        existing_schedule = schedule if (disrupted or conversation_refresh
                                                         or force_plan or reaction_replan) else None,
                        scenario_instruction, short_term_note)            # §7.1
        return True
    # Throttled: DO NOT return False here. Fall through and keep executing the old schedule —
    # returning False drops the agent into free roam and it wanders off after every chat.

if not schedule or index is None: return False
step = schedule[index]

# Pre-dawn hold: before the day's first step (e.g. 05:30 with a 06:30 wake), go to that step's
# place (home) and wait — unless a scenario meeting or a pin applies
if gt.minutes_into_day < step.start_minute and not in_scenario_meeting and not pin_point:
    if conv and not texting: return False
    if not at(step.destination): move there (if not already)  else stop
    return not texting

if conv and not texting: return False      # never pull an agent out of a face-to-face chat

destination = pin_point or scenario_meeting_point() or step.destination
settled = settled_at(destination)    # within the milling-about radius ([ADAPT] at the AOI / location radius)

# Opportunistic invite (where most conversations come from)
still_travelling = agent.scenario_id is None and pending_step() is not None
if (not conv and not invite_cooldown(15 s) and not just_chatted(15 s) and not op_in_flight
    and not still_travelling and agent.health != 'sick' and not too_tired_to_talk()):
    free = players other than me that are in no conversation
    sc = active_scenario(); meets_in_person = sc and not sc.via_text
    leash = None if meets_in_person else work_leash_anchor(name, step)
    pool = (free within PERCEPTION radius)         if not settled        # in transit
      else (free within leash radius of workplace) if leash               # settled, on shift
      else free                                    # settled, off shift: map-wide [ADAPT: ≤ 30 min travel]
    pool = scenario-relative(pool)   # non-scenario agent skips anyone with a scenario_id;
                                     # scenario agent keeps only same-scenario players
    if pool:
        last_invite_attempt = now    # optimistic: no re-fire every tick if nobody can be invited
        start_operation('agentDoSomething', player, pool, agent, map, force_invite=True,
                        preferred_invitee); preferred_invitee = None
        return not texting

if not settled:
    if not heading to destination: move_player(destination)
    return not texting

# Settled: (re)start this block's activity when none is running
if not doing_activity:
    step_end = schedule[index+1].start_minute if index+1 < len else 1440
    minutes_left = max(1, step_end - gt.minutes_into_day)
    step_key = f"{gt.day}:{index}:{step.start_minute}"
    if agent.short_term_step_key != step_key:
        agent.short_term_step_key = step_key
        accrue_step_short_term(step, minutes_left, gt.day, now,
                               is_own_workplace = work_leash_anchor(name, step) is not None,
                               fatigue_multiplier = profile_fatigue_multiplier())        # §12.1
    until_minute = lambda m: now + clamp(real_ms_between_hours(gt.hour, m/60), 1, CYCLE_MS)
    sub = current_sub_step(step_key, gt.minutes_into_day)                               # §7.6
    if sub:
        activity = {sub.activity, sub.emoji or step.emoji or '💭',
                    until: until_minute(sub_step_end), ambient: True}
    else:
        event = pick_contextual_event(step.location_id, gt.minutes_into_day) \
                if not is_sleep_step(step) and random() < 0.4 else None                 # §7.5
        if event: activity = {event.description, event.emoji,
                              until: until_minute(gt.minutes_into_day + min(minutes_left, 20)), ambient}
        else:     activity = {step.activity, step.emoji or '💭', until: until_minute(step_end), ambient}
        maybe_decompose_step(step, step_key, step_end)                                  # §7.6
maybe_wander_at_step()    # AI City: drift to a tile within 4 every ~12 s ± jitter. [ADAPT] no-op in the
                          # engine; the client jitters the marker inside the AOI instead
return not texting
```
Helpers:
```
pending_step():   # "on their way somewhere they are due" — the predicate behind "the plan comes first"
    step = current step; None if no schedule/step
    None if pin or scenario_target or scenario_meeting_point()   # those REPLACE the destination
    None if gt.minutes_into_day < step.start_minute              # early is not late
    None if settled_at(step.destination)                         # milling about counts as there
    else step
owes_fixed_obligation() = pending_step() is not None and pending_step().fixed
is_in_scenario_conversation(conv) = agent.scenario_id and another PARTICIPATING member's agent
                                    has the same scenario_id
scenario_meeting_point() = (gather_x, gather_y) of my active scenario while phase == 'active'
                           ([ADAPT] the gathering AOI)
too_tired_to_talk() = current step is a sleep step or fatigue >= FATIGUE_SOCIAL_CUTOFF (80)
affinity_for(other) = stored affinity, else 75 if other's name is in my family, else 50
group_leave_probability(avg) = clamp(0.35 * (1 + 0.6 * (50 - avg) / 50), 0.05, 0.9)
```

### 6.7 Free roam (only reached when the schedule did not claim the tick)

```
conv = conversation; member = my membership
recently_attempted_invite = last_invite_attempt within 15 s
doing_activity = activity.until > now
interrupting = (conv and not conv.is_text) or moving
if doing_activity and not activity.ambient and interrupting: activity.until = now
if not conv and not doing_activity and (not moving or not recently_attempted_invite):
    pool = [] if too_tired_to_talk() else
           [players not in any conversation, excluding me, scenario-relative]
    start_operation('agentDoSomething', player, pool, agent, map, preferred_invitee)
    preferred_invitee = None; return
if agent.to_remember:
    start_operation('agentRememberConversation', conversation_id=to_remember); to_remember = None; return
if conv and member: handle_membership(…)        # §8.2–§8.4
```
**Timing caveat — when remembering actually happens.** Everything in this section runs only when
`tick_schedule` returns False, i.e. when the agent has no schedule, is in a face-to-face
conversation, or is texting. For an agent with a schedule that is not in a conversation,
`tick_schedule` returns True on essentially every tick, so the `to_remember` branch is unreachable
until the agent's **next** conversation (or text thread) begins; only then does it remember the
previous one (and only then do that conversation's affinity deltas, mood/stress deltas and
`schedule_needs_refresh` land). The comments and the user's notes describe these effects as
happening "at conversation end", so this looks like an unintended consequence of adding
`tick_schedule` in front of the original a16z ordering. RECOMMENDED for the port: check
`to_remember` immediately after the operation guard (§6.2), before the scenario hold, group join,
gathering walk and schedule, so it fires as soon as the agent is free after a conversation. Flag it
as a deliberate behaviour change.
`agentDoSomething` (rule-based, no LLM):
```
leash = None if agent.scenario_id else work_leash_anchor(name, current step)
just_left = last_conversation within 15 s;  recently_invited = last_invite_attempt within 15 s
recent_activity = activity and now < activity.until + ACTIVITY_COOLDOWN (10 s)
if not force_invite and not moving:
    if recent_activity or just_left: → finishDoSomething(destination = wander_destination(leash))
    else: a = pick_activity(menu(name), agent)
          → finishDoSomething(activity = {a.description, a.emoji, until: now + a.duration},
                              activity_cost = a.cost)
    return
invitee = None if (not force_invite and (just_left or recently_invited)) \
          else find_conversation_candidate(player, pool, preferred_invitee)
→ finishDoSomething(invitee)
```
`pick_activity`: keep options the agent can afford (`balance ≥ cost`); if none, the zero-cost ones;
if still none, "taking a breather 😮‍💨" for 20 s. Score each:
`U(0,20) − 0.6 × cost × financial_pressure/100 − 0.5 × energy × fatigue/100`; take the max.

`wander_destination(leash)`: AI City picked a random tile within ±8 of the workplace when leashed,
else anywhere on the map. `[ADAPT]` pick a random reachable AOI within `WORK_LEASH_RADIUS_M` of the
workplace when leashed, else within ~800 m of the current position, preferring parks, cafés and food
POIs.

`find_conversation_candidate(player, pool, preferred)`:
```
for other in pool:
    if last participated_together(me, other).ended > now - PLAYER_CONVERSATION_COOLDOWN (60 s): skip
    if other == preferred: return other            # a reaction's choice wins once past the cooldown
    weariness = max(0, ((fatigue - 10) + (stress - 15)) / 2)
    score = affinity_for(other) - (2 + 0.03 * weariness) * distance(me, other)
            # [ADAPT] distance → estimated travel minutes (§4.6)
return argmax score (None if empty)
```

---

## 7. Daily schedules and fixed routines

Source: `agentPlanDay`, `parseSchedule`, `fallbackSchedule`, `agentDecomposeStep`, `parseSubSteps` in
`convex/aiTown/agentOperations.ts`; `data/routines.ts`; tests `convex/sleep.test.ts`,
`convex/roster.test.ts`, `convex/plans.test.ts`.

```
ScheduleStep: {start_minute: 0..1439, location_id: str ('home' | a named location id),
               destination: point/AOI, activity: str, emoji?: str, description: str, fixed?: bool}
SubStep:      {start_minute, activity, emoji?}
```

### 7.1 The LLM day plan (`agentPlanDay`) `[PORT]`

Inputs: the agent's **effective identity** (self-summary if any, else authored identity — §9.6),
home name, workplace (`workplace_for(name)` → location + activity), day number and weekday name,
current game time, a short-term self-description (§12.6), the active scenario instruction (if
any), and up to 5 conversation memories from the 8 most recent memories ("read these carefully for
any commitments you made").

Prompt: Appendix A.1. Rules it states: 4–7 entries; each with `start_time` "HH:MM", `location_id`
(verbatim from the list, or `home`), `activity`, one `emoji`, one-sentence `description`; realistic
timings; regular meals; **do not schedule sleep/bed/waking** (added for you; stay inside waking
hours; be home winding down before bedtime); a work rule (night shift / weekday 09:00–17:00 block at
the workplace id / weekend free); honour plans from memories; for a re-plan, "keep entries whose
start_time has already passed, and revise the rest" and **add an entry for anything agreed in
conversation**; for an injected scenario, an urgent block asking for a top-level `"reaction"`
object (what they do *right now*, no start_time) plus the aftermath schedule. JSON mode, 800 tokens.

Parsing (`parse_schedule`): take the JSON object (tolerate ```json fences and leading prose: slice
first `{` to last `}`); require an array `schedule`; each entry needs `start_time` (string, parsed
with `parse_time_of_day`) or `start_minute` (number); `location_id` (or `location`) must be `home`
(→ the home destination) or a known location id — **otherwise the entry is dropped**; `activity`
defaults to "hanging around", `description` to the activity; sort by start; empty → failure.
Scenario reaction: parse `reaction` the same way, stamp `start_minute = now`, and the schedule
becomes `[reaction] + [entries with start_minute > now]`.

Fallback when the call or parse fails (`fallbackSchedule`):
```
07:00 home        "waking up at home" 🛏️       "morning at home, getting ready"
09:00 <workplace> "<work activity>" 💼          "at <workplace> for the morning"    (weekday + has workplace)
12:30 restaurant  "eating at the hawker centre" 🍜 "lunch break"
13:30 <workplace> "<work activity>" 💼          "at <workplace> for the afternoon"  (weekday + has workplace)
19:00 home        "winding down at home" 🏠     "back home for the evening"
```
The result goes back through `finishPlanDay`, which merges fixed obligations (§7.3) unless a
*manual* scenario is active for the agent.

`[ADAPT]` The location menu is the nine named locations plus `home` (§4.2). `[OPTIONAL]` add generic
place types (`food`, `cafe`, `park`, …) resolved near the agent; if added, the step's destination is
resolved at plan time and stored.

### 7.2 When plans are made

From §6.6: no schedule; a new day; disrupted (more than 60 game minutes into a step without having
reached it); `schedule_needs_refresh` (set after **every** remembered conversation, after release of
a pin, after recovering from sickness); a reaction asked to replan (≤ 2 per day, own 60 s cooldown);
`force_plan` (manual scenario injection; bypasses all throttles). Never during a conversation or a
one-off activity. Discretionary re-plans (conversation refresh, reaction) wait while the agent
**owes a fixed obligation** (they would otherwise stand frozen re-planning while late for work).
Throttles: 5 real minutes between plans per agent; on each new day a deterministic stagger of
0–120 s by agent id so 50 agents don't all call the LLM in the same second.

### 7.3 Fixed obligations (`mergeFixedObligations`) `[PORT]`

Deterministic blocks laid **over** the LLM plan; obligations always win. Every block built here has
`fixed = True` (only fixed blocks may interrupt a conversation, §8.4).

Times (game minutes into the day):
```
SHIFT 09:00–18:00 (Mon–Fri, anyone with a workplace, unless the day touches a night shift)
LUNCH 12:00–13:00 at the workplace: "taking a lunch break" 🍜 "lunch break"
COMMUTE before a shift: AI City 45 min fixed → [ADAPT] per-character commute_minutes (§4.5):
        "heading to work" 🚇 "on the way to work", destination = workplace
SERVICE Sunday 10:00–11:30 at home (religion 'christian'): "observing Sunday service at home" ⛪
FRIDAY PRAYER 12:30–14:00 at home (religion 'muslim'): "observing Friday prayer at home" 🕌
NIGHT SHIFT 22:00 → 06:00 (both halves belong to the SAME game day, which runs 06:00→06:00):
        "<work activity>" 🌙 "on the night shift"
POST-NIGHT: 06:00–07:00 "heading home after the night shift" 🏠; 07:00–13:00
        "sleeping off the night shift" 😴 "asleep after a night on shift"
WAKE ROUTINE: 45 min after waking: "waking up and getting ready" 🛏️ "up and about at home"
IN BED: "sleeping at home" 😴 "asleep in bed"
```
All home blocks use `location_id = 'home'` (§4.3).

Sleep window from the profile's `Sleep/work rhythm` (lower-cased substring tests, first match wins):
```
'night owl' or 'late-night'          → bed 01:00, wake 09:00
'student'                            → bed 00:30, wake 08:00
'early sleeper' or 'early work start'→ bed 21:00, wake 06:00
'late dinner'                        → bed 23:30, wake 07:00
otherwise                            → bed 22:30, wake 06:30
```
Night-shift roster (day-of-week of the evening they **go on** shift; 0 = Monday):
`Nurul [Tue, Wed]`, `Dylan [Thu, Fri]`, `Somchai [Wed, Sat]`, `Hafiz [Tue, Fri]`.
Invariant: **no night shift on a Monday or Sunday night** (day 1 must be an ordinary Monday for
everyone). `works_night_shift(name, day)` = tonight is a rostered night;
`has_night_shift_duty(name, day)` = tonight or last night.

Construction for (name, day):
```
up_and_about = (13:00 if came off a shift this morning else wake) + 45
commute(shift_start) = [max(0, shift_start - commute_minutes, up_and_about), shift_start) or none
sleep intervals:
    if not on shift tonight:
        if bed > wake:  [00:00, wake) in bed  (the tail of last night)   (skip if wake == 0)
        else:           [bed, wake) in bed    (night owl / student, all after midnight)
    if came off shift:  [06:00,07:00) heading home; [07:00,13:00) sleeping off; [13:00,13:45) wake routine
    else:               [wake, wake+45) wake routine
    if not on shift tonight and bed > wake: [bed, 24:00) in bed
night shift (if has_night_shift_duty and works_night_shift tonight):
    commute(22:00); [22:00, 24:00) on duty; [00:00, 06:00) on duty
weekday shift (Mon–Fri, has workplace, no night duty): commute(09:00); [09:00,18:00); [12:00,13:00) lunch
Sunday service (christian); Friday prayer (muslim)
```
Merge algorithm:
```
to_intervals(llm): sort by start; if first.start > 0: prepend [0, first.start) carrying the LAST
                   step (the day is a ring); then each step lasts until the next step's start (last → 1440)
for ob in obligations sorted by (start, end):
    intervals = overlay(intervals, ob)   # drop the covered part of any base interval, keep the
                                         # fragments before and after, append ob, sort
flatten: [ {**iv.step, start_minute: iv.start} for iv in sorted intervals if iv.end > iv.start ]
```
`is_sleep_step(step)` = regex `\b(asleep|sleep|sleeping|bed|turning in|going to sleep|rest for the night)\b`
on `f"{activity} {description}".lower()`. It is the single source of truth for "asleep" (engine,
scenario manager, fatigue).

### 7.4 Sick days

When sick and today's schedule is not built yet (and not mid-conversation), skip the LLM and use:
```
00:00 "resting in bed, feeling unwell" 🤒 · 08:00 "dozing in and out, feeling lousy" 🤒 ·
12:00 "sipping soup, still under the weather" 🍵 · 16:00 "resting on the couch" 🤒 ·
20:00 "trying to sleep it off" 😴        all at 'home', description "sick at home, resting"
```
Sick agents never initiate conversations and their prompts include a "feeling under the weather"
line (§8.5).

### 7.5 Contextual micro-events

When a settled agent's block activity is (re)set and the block has no sub-steps and is not a sleep
block, with probability 0.4 the activity is instead a micro-event lasting
`min(20, minutes_left)` game minutes, after which the block's own activity resumes. During 09:00–18:00
at a location with a pool, draw from that pool; otherwise from the flexible pool:
```
astar:        in a team stand-up meeting 📊 · grabbing a coffee from the pantry ☕ · running an experiment 🧪 ·
              reviewing a colleague's paper 📄 · debugging the lab rig 🔧
fusionopolis: in a sprint planning meeting 🗓️ · whiteboarding with the team 🧑‍🏫 · grabbing a coffee ☕ ·
              on a video call with a client 💻
mbs:          waiting in the taxi queue for a fare 🚕 · chatting with a tourist 🗺️ · wiping down the cab 🧽 ·
              grabbing a quick kopi ☕
restaurant:   taking a customer's order 📝 · firing up the wok 🔥 · clearing and wiping tables 🧽 ·
              restocking the chili sauce 🌶️
shophouses:   pulling an espresso shot ☕ · steaming milk for a latte 🥛 · chatting up a regular 💬 ·
              grinding fresh beans ⚙️
university:   sitting in a lecture 🎓 · cramming in the library 📚 · in a group project huddle 👥 ·
              queuing for an iced Milo 🥤
changi_hospital: doing the ward round 🩺 · writing up patient notes 📋 · restocking the trolley 💊 ·
              handing over to the next shift 🔄
hdb:          checking the works at the void deck 🦺 · hanging out the washing 🧺 ·
              sitting with a resident who needs help 🤝 · running a form down to the office 📄
gardens:      sweeping the path 🧹 · clearing an overflowing bin 🗑️ · watering the beds 💧 ·
              taking five in the shade 🌳
flexible:     scrolling on the phone 📱 · people-watching 👀 · taking a slow stroll 🚶 ·
              grabbing a snack 🍪 · listening to music 🎧 · relaxing for a bit 😌
```

### 7.6 Sub-step decomposition (`agentDecomposeStep`)

Triggered (locked op) when an agent settles into a block that: is not a sleep block; has no
decomposition for this `step_key` and none requested (`sub_steps_requested_for` stamped optimistically);
the agent is not in any scenario; and lasts **≥ 90 game minutes**.
`max_steps = min(5, max(2, floor(block_minutes / 15)))`. Prompt: Appendix A.2 (spread sub-steps
evenly across the whole block; first exactly at the block start; ≥ 15 min apart; "-ing" phrases;
same place). Parsing (`parse_sub_steps`): keep entries with a non-empty activity and a parseable
`start_time` inside `[start, end)`; cap 5; sort; drop any closer than 15 min to its predecessor;
anchor the first to the block start; **fewer than 2 → []** (the block keeps its single activity).
`finishDecomposeStep` stores `{step_key, steps}` and ends the current whole-block activity so the
sub-steps start immediately. A sub-step's activity lasts until the next sub-step or the block end.
Sub-steps live on the agent, not on the schedule (so re-plans and obligation merges never duplicate
or echo them); a re-plan changes `step_key`, which discards them.

---

## 8. Conversations

Source: `convex/aiTown/conversation.ts`, `conversationMembership.ts`, `agent.ts` (membership
handling), `agentOperations.agentGenerateMessage`, `agent.agentSendMessage`,
`convex/agent/conversation.ts` (prompts, moderator), `convex/messages.ts`, `src/components/Messages.tsx`.

### 8.1 Lifecycle `[PORT]` (`[ADAPT]` geometry per §4.7)

- **Start** (`Conversation.start(player, invitee)`): both must be in no conversation; creator
  `walkingOver`, invitee `invited`; `num_messages = 0`.
- **Accept** → invitee `walkingOver`. **Reject** → the whole conversation stops.
- **Tick**: drop `is_typing` after `TYPING_TIMEOUT` 15 s; fewer than 2 participants → stop. Text
  threads skip geometry. Otherwise promote walkers to `participating{started: now}` (stop them,
  add to `all_participants`) when close enough to a participating member; with nobody participating
  yet, the first two walkers that are together bootstrap it and others close to them join.
  (AI City also turned each participant to face the group's centroid; optional on the new map.)
- **Join** (group): add a member as `walkingOver`. Caps: 5 participants (8 for scenario
  conversations, `SCENARIO_MAX_PARTICIPANTS`).
- **Leave(player)**: that agent gets `last_conversation = now`; if the conversation had messages,
  `to_remember = id` and `events_since_reflection += 1`; remove member; clear `is_typing` and
  `next_speaker` if theirs; fewer than 2 left → stop.
- **Stop**: clear typing; every member agent gets `last_conversation = now` and, if there were
  messages, `to_remember` and `events_since_reflection += 1`; delete the conversation. Abandoned
  invites (0 messages) are **not remembered and not archived** (remembering them used to throw and
  freeze the agent).
- **Archive** (at persist time): every ended conversation with ≥ 1 message → `archived_conversations`
  row with `participants = all_participants ∪ current participants`, `is_text`, `created`, `ended`,
  `num_messages`, `last_message`; plus a `participated_together` row for **every ordered pair** of
  participants (`player1`, `player2`, `conversation_id`, `ended`). That edge table powers the
  60 s pair cooldown, "last time you chatted", the inspector's previous conversation and the
  analysis graph.

### 8.2 Being invited (agent side)

```
anchor = a participating member (else the creator, else any other member)
inviter_agent = agent of the inviter (None for a human)
same_scenario = my scenario_id and inviter_agent.scenario_id == my scenario_id
on_shift_anchor = None if same_scenario else work_leash_anchor(my name, my current step)
pulls_off_post = on_shift_anchor and inviter is not human and inviter is ≥ leash radius from my workplace
too_tired      = inviter is not human and too_tired_to_talk()
due_elsewhere  = inviter is not human and not same_scenario and pending_step() is not None
p_accept = 0.30 + (0.97 - 0.30) * affinity_for(inviter) / 100
if pulls_off_post or too_tired or due_elsewhere:  reject (no penalty — not a snub)
elif inviter is None or inviter is human or random() < p_accept:  accept; stop moving
else:  reject AND the inviter's affinity toward me drops by 2 (REJECTED_INVITE_AFFINITY_PENALTY);
       inviter.last_affinity_change = {now, delta}; relationship event
       {kind: 'inviteDeclined', actor: inviter, target: me, delta, affinity_after,
        reason: "<my name> turned down their invite", conversation_id}
```

### 8.3 Walking over

Give up and leave after `INVITE_TIMEOUT` (60 s real) since invited. No anchor yet (everyone still
walking) → hold. Close enough → hold. Otherwise travel toward the anchor (`[ADAPT]` the meeting AOI,
§4.7).

### 8.4 Participating

```
if conv.is_typing and conv.is_typing.player != me: return            # someone holds the floor
if not conv.last_message:
    if I am the creator or now > started + AWKWARD_CONVERSATION_TIMEOUT (60 s):
        set typing; start_operation('agentGenerateMessage', type='start', game_time_ms=now, scenario_id)
    return

over_cap = now > started + SCENARIO_MAX_CONVO_DURATION (15 min) or num_messages > 24
# Goal wrap-up: once the goal judge latched success, ONE summary message before anyone leaves
if conv.scenario_goal_met and not conv.goal_summary_posted and not over_cap
   and is_in_scenario_conversation(conv):
    my_turn = (next_speaker == me or (stalled and not just_spoke)) if next_speaker else not just_spoke
    if not my_turn or (just_spoke and not stalled): return
    if now >= last_message.timestamp + MESSAGE_COOLDOWN (2 s):
        set typing; start_operation('agentGenerateMessage', type='summary', …)
    return

# Should I leave?
n = number of participants; is_group = n > 2; just_spoke = last_message.author == me
if is_in_scenario_conversation(conv):
    min_msgs = 8 + (2 * (n - 2) if is_group else 0)
    should_leave = now > started + 15 min or num_messages > 24
                   or (conv.scenario_goal_met and num_messages >= min_msgs)
else:
    max_msgs = min(8 + 2 * (n - 2), 16) if is_group else 8
    stats = group affinity stats (avg toward other participants, least-liked member)
    p_leave = group_leave_probability(stats.avg) if is_group else 0.35
    drift = is_group and just_spoke and num_messages >= 6 and random() < p_leave
    if drift and stats.avg < 40: relationship event {kind 'groupExit', actor me,
                                  target least-liked, reason "slipped away from the group early"}
    should_leave = now > started + MAX_CONVERSATION_DURATION (10 min) or num_messages > max_msgs or drift
if too_tired_to_talk() and num_messages >= 2: should_leave = True            # a goodnight
if not is_in_scenario_conversation(conv) and num_messages >= 4 and owes_fixed_obligation():
    should_leave = True                                                      # late for work/prayer/bed
if should_leave: set typing; start_operation('agentGenerateMessage', type='leave', …); return

if maybe_take_focal_turn(conv): return                                       # §14.4

# Turn-taking under the moderator
stalled = now > last_message.timestamp + 60 s
my_turn = (next_speaker == me or (stalled and not just_spoke)) if next_speaker else not just_spoke
if not my_turn or (just_spoke and not stalled): return
if now < last_message.timestamp + 2 s: return
set typing; start_operation('agentGenerateMessage', type='continue', …)
```
Rules this encodes:
- Open floor (`next_speaker` unset, e.g. right after a human spoke): any agent who did not just
  speak may take it; the typing lock lets only one win.
- Stalled (designated speaker silent for 60 s): anyone else may step in.
- Scenario conversations ignore the random drift-off and run until the goal judge says the goal is
  met (after a minimum length) or a hard cap.
- Fatigue and fixed obligations end ordinary conversations; scenario conversations are exempt from
  the obligation rule (the scenario *is* the commitment) but not from exhaustion.

### 8.5 Message generation (`agentGenerateMessage`) `[PORT]`

Flow: build the prompt (below) → one chat completion → for `start`/`continue`, call the moderator
(§8.6) → insert the message row (`world_id, conversation_id, author, text, message_uuid,
scenario_id`) → input `agentFinishSendingMessage` with `next_speaker`, `goal_met`, `covered_topics`,
`leave_conversation = (type == 'leave')`, `is_goal_summary = (type == 'summary')`.

Prompt data (`queryPromptData`): me (name, position, activity), the conversation, my agent record
with effective identity + full profile + family + affinities, and for each other participant: name,
effective identity (agents only), their `scenario_profile` (if set, it **replaces** the identity
— "others-filtered" view), human flag, live activity, my family relation to them, my affinity toward
them; plus the archived previous conversation with the first other participant.

Building blocks, in order (exact wording in Appendix A.3):
1. Opener: "You are {me}, and you just started a conversation with {audience}." / "…just joined a
   group conversation with …" (start) · "…you're currently in a (group) conversation with …"
   (continue, followed by "The conversation started at {Day N, h:mm}.") · leave · summary.
2. **Time and place:** "It is currently Day N, h:mm AM (daytime|nighttime) in Singapore."; the place
   phrase (`[ADAPT]` §4.7 `describe_place`); "Your current plan: {current step description}."; and
   if a live activity: "Right now you are {activity} — you're carrying on with it while you talk.
   Mention or work it into what you say when it fits naturally; don't force it."
3. **Group-text register** if `is_text` (§8.7).
4. **Self and others** (`selfAndOthersPrompt`):
   - "About you: {effective identity}"
   - "Your background details:" + non-constraint profile lines
   - "Fixed facts about your life — these are not preferences you can trade away:" + constraint
     lines + "Nobody else here knows any of this unless you have said it out loud in this conversation."
   - "Things you've come to realise about yourself over time:" + learned traits
   - if sick: "You're feeling under the weather today — you've come down with a cold. …"
   - short-term self-description (§12.6) + "Let this temporary state colour your tone and choices
     in the moment, but stay in character."
   - if exhausted (fatigue ≥ 80): "You are dead on your feet and about to turn in for the night. Do
     NOT start a topic, … Absolutely no more than two short sentences."
   - per other: "About {name}: {scenario_profile or identity}"; "Your relationship with {name}: they
     are your {relation}, you feel {label} toward them." (affinity clause only if family, or
     affinity ≥ 65, or < 45); "{name} is {activity} as you talk."
   - group (> 2 people): "This is a group conversation with N people present (…). Address the group
     or a specific person naturally, keep your turn short, and don't try to speak for anyone else."
   - scenario: "SCENARIO DIRECTIVE (follow this right now): …" + "Weave this directive naturally …";
     if conflict: "POINT OF DISAGREEMENT: …" + "You genuinely disagree … don't just cave …"; topics
     ("Work through these specific points …"); goal ("The goal of this conversation is: … once it's
     reached, you can wrap up naturally.")
5. (start only) "Last time you chatted with {other} it was {Day…}. It's now {Day…}."
6. **Related memories** (situational retrieval, §9.4): start query
   `"{me} is talking to {audience}"`, k = 3; continue query `"What do you think about {other}?"` (1:1)
   or `"What do you think about your conversation with {audience}?"`, k = 3:
   "Here are some related memories in decreasing relevance order:" + list.
7. **Relationship memories** (second retrieval): focus = the other person (1:1) or, in a group, the
   person whose affinity is furthest from 50; query `"What is {me}'s relationship with {focus}?"`,
   k = 2, de-duplicated against block 6: "What you remember about {focus}:" + list.
8. **Scenario history** (if I have a `scenario_id`): up to 60 most recent messages stamped with my
   scenario id from *other* conversations: "Earlier in this same scenario, others said the following
   in conversations you weren't part of. Stay consistent with it — especially any plan already made
   or tasks already claimed or assigned; don't contradict or re-litigate it:" + "- Name: text".
9. **Past scenarios** (if I have a scenario instruction): query
   `"A past situation like this: {scenario name}: {instruction}"`, k = 3, de-duplicated:
   "You also recall these past situations like this one, which you can draw on:" + list.
10. (start, if a memory of a conversation with the other exists) "You may briefly reference your last
   conversation with {other} in one short clause, but keep it light."
11. Length rule: start — "Keep your greeting to one or two short sentences, like real spoken dialogue —
   under 200 characters. Don't monologue or give a speech." (text: "Open the thread with one short
   line — a text, not a speech. Under 200 characters."); continue — "Below is the current chat
   history." + "DO NOT greet them again. Do NOT use the word "Hey" too often. Your response should
   be brief and within 200 characters."; leave — polite exit, or "Give them a short goodnight — ONE
   line … under 100 characters …" when exhausted; summary — "In one or two short sentences (under 200
   characters), tell the others — in character, first person — HOW you pulled it off …".

Which blocks each type uses: `start` 1–11; `continue` 1–4 and 6–9 plus its ending; `leave` and
`summary` only 1–4 plus their ending (no memory retrieval).

Message layout: `start` = one user message with everything + the speaker label. `continue`, `leave`,
`summary` = one **system** message with the blocks, then every previous message as a **user**
message `"{author}: {text}"`, then a user message with the speaker label. Speaker label:
`"{me} to {other}:"` in 1:1, `"{me}:"` in a group; strip it if the model echoes it.
Stop sequences: for each other participant `"{name}:"` (and `"{name} to {me}:"` in 1:1), **max 4**
(OpenAI limit). Max tokens: start 120, continue 300, leave 300, summary 200.

### 8.6 The moderator and the goal judge (`decideNextSpeaker`) `[PORT]`

Runs after every `start`/`continue` agent message:
```
candidates = other participants who are agents (humans speak when they like; never wait on them)
if no candidates: return {next: None (open floor), goal_met: False, covered: []}
goal = my scenario_goal if I have a scenario instruction; topics, conflict likewise
check_goal = goal and number of messages >= SCENARIO_GOAL_CHECK_MIN_MESSAGES (6)
if len(candidates) == 1 and not check_goal: return that candidate          # fast path, no LLM
recent = last 8 messages as "Name: text"
LLM (Appendix A.4): without goal → reply with ONLY the next speaker's name (max 10 tokens);
                    with goal   → JSON {"next": name, "covered": [task numbers], "goalMet": bool}
                                  (max 60 tokens); with a conflict, the goal only counts once the
                                  disagreement was actually argued out
parse: tolerant JSON; covered = 1-based numbers → 0-based indices within range;
       goalMet true if JSON true/"true", or regex /goalmet"?\s*[:=]\s*true/i on unparseable text
match name exactly (case-insensitive), else substring; fallback: lone candidate, else the
candidate who has gone longest without speaking (never spoke = top priority), else random
```
`agentFinishSendingMessage` then sets `next_speaker`, latches `scenario_goal_met`, and records topic
and goal completion times on the active scenario (§3.4).

### 8.7 Group texts (`is_text`) `[PORT]`

A scenario that is `textable` and fires while its cast is **awake but on shift** opens one group
thread containing the whole cast (`Conversation.start_text`): everyone starts `participating`
immediately (no invites, no walking, no timeouts), and nobody moves because of it. Rules that differ:
- Texting never pins an agent: `move_player` is allowed, `tick_schedule` keeps running the schedule
  and returns `not texting` so the message logic still runs in the same tick; ambient activities
  continue; texting does not cancel even a one-off activity.
- No milling stop, no facing.
- Prompts add: "IMPORTANT — this is a GROUP TEXT on your phone, not a face-to-face conversation. The
  others are somewhere else entirely and most of you are in the middle of work or errands. Type like
  you would in a real group chat: short, casual, lowercase is fine, contractions and the odd emoji or
  "lah"/"leh" are fine. Never describe gestures, glances, body language or the room (…). It's normal
  to be brief because you're busy, and to mention that you're snatching a moment between tasks."
- A text thread can't be "walked into" (`maybe_join_nearby_conversation` skips them).
- The work leash still applies to texters' invites (the premise is that they stay at work).
- Map cues: 📱 while in a thread, typing dots while composing.

### 8.8 Humans in conversations

A human (the "Interact" button) appears on the map, can click an agent → "Start conversation"
(input `startConversation`), accept/reject an agent's invite, type messages (client sends
`startTyping` while composing, then writes the message row and `finishSendingMessage`), and leave.
After a human message `next_speaker` is cleared, so an agent takes the open floor. Agents always
accept a human's invite and never decline one for being tired, off post or due elsewhere.

### 8.9 Chat timeline markers

While a scenario is live, the conversation view correlates the conversation with its scenario via
the participants' `scenario_id` and interleaves, by timestamp, "✅ Task completed: {topic}" chips at
`topics_done_at[i]` and a "🎯 Goal achieved!" banner at `goal_met_at` (live only; archived chats
show none).

---

## 9. Memory stream, retrieval, reflection, identity

Source: `convex/agent/memory.ts`, `convex/agent/embeddingsCache.ts`, `convex/agent/schema.ts`,
`agentRegenerateSelfSummary` / `getSelfSummarySource` / `agentReflect` in
`convex/aiTown/agentOperations.ts`, `convex/aiTown/agentDescription.ts`.

### 9.1 Memory records `[PORT]` (`[ADAPT]` add `world_id`)

```
Memory: id, world_id, player_id, description: str, importance: float (0–9; observations 1–6),
        last_access: engine ms, created_at, embedding: float32[dim]
        type + data:
          'conversation'    {conversation_id, player_ids: other authors}
          'reflection'      {related_memory_ids: [memory id]}
          'observation'     {subject_player_ids}
          'scenarioOutcome' {scenario_name?, goal_met?}
          'relationship'    {player_id}      # in the schema and UI, but nothing writes it
```
AI City's `memories` table had no world id (keyed by player id only); include it.
`scenarioOutcome` is deliberately **not** a `reflection`: reflection windows used to be derived from
the newest reflection-typed memory, so scenario takeaways stored as reflections kept resetting the
reflection accumulator.

### 9.2 Importance `[PORT]`

LLM rating 0–9 of "poignancy" (Appendix A.5), temperature 0, `max_tokens 1`. Parse a float, else the
first digit run, else default **5**. Used for every conversation, scenario and reflection memory
(observations use the rule table in §10.4 instead — no LLM).

### 9.3 Remembering a conversation (`agentRememberConversation`) `[PORT]`

Locked op, triggered when `to_remember` is set (§6.7 — read its timing caveat: in AI City this
effectively runs when the agent's next conversation starts).
1. Load the archived conversation, the "other player" (the first `participated_together` edge from
   me in this conversation), the full roster of other participants (archived participants minus me;
   fall back to the one other), and all messages. No messages → nothing to do.
2. One completion (Appendix A.6), 500 tokens: a first-person summary that says whether I liked the
   interaction; a line `Commitments: …` (or `Commitments: none`); a line `Affinity: {"Name": -10..10, …}`
   for each other participant; a line `Feelings: {"mood": -10..10, "stress": -10..10}`. The chat is
   passed as user messages `"{author} to {recipient}: {text}"`, then `"Summary:"`.
3. Strip the `Affinity:` line (parse JSON by participant **name**; round; clamp ±10
   `MAX_AFFINITY_CHANGE_PER_CONVERSATION`; drop zeros and unknown names) and the `Feelings:` line
   (mood/stress; round; clamp ±20 `MAX_SHORT_TERM_CHANGE_PER_EVENT`; drop zeros). Unparseable lines
   change nothing. **The `Commitments:` line stays in the memory** — the day planner reads it.
4. `description = "Conversation with {other} at {Day N, h:mm AM}: {summary}"`; importance (§9.2);
   embedding; insert (`type 'conversation'`, `last_access` = last message time).
5. Inputs: `agentApplyAffinity` (reason = first sentence of the summary with the "Conversation with
   … at …:" prefix removed, ≤ 120 chars), `agentApplyShortTerm` (cause `conversationFeelings`),
   then `finishRememberConversation` (always — even after an error; see §3.5). That last input sets
   `schedule_needs_refresh`, so **every conversation can re-plan the rest of the day**.

Reflection is not triggered from here (it has its own cadence, §9.5).

### 9.4 Retrieval (`searchMemories`) `[PORT]` `[ADAPT]`

```
search(player, query_embedding, n):
    cand = top n*10 memories of this player by cosine similarity          # overfetch ×10
    relevance_i  = cosine score
    importance_i = memory.importance
    recency_i    = 0.99 ** floor(hours since memory.last_access)
    score_i = minmax(relevance)_i + minmax(importance)_i + minmax(recency)_i
    top = n highest by score
    for m in top: if m.last_access < now - 5 min: m.last_access = now      # retrieval "touches" memories
    return top
```
- Recency hours are **real** hours (engine ms, §0), not game hours: with a 19-minute game day one
  decay step spans ~3 game days, so recency barely separates memories within a run. That is AI
  City's behaviour; switching to game hours is a deliberate tuning change, not a port.
- Min–max normalisation is *within the candidate set*; guard the all-equal case (AI City divides by
  zero → NaN; treat a zero range as 0 for every candidate).
- Scores from two separate searches are not comparable; when two retrievals feed one prompt they are
  de-duplicated by id only, never merged and re-ranked.
- `[ADAPT]` Vector search: keep each player's embeddings as a normalised float32 numpy matrix cached
  in memory (rebuilt on insert); cosine = dot product. 50 agents × a few thousand memories is
  trivially fast. `sqlite-vec` is an alternative.
- Embeddings cache: key = sha256(text) (`[ADAPT]` plus model name); hits skip the provider; only
  misses are logged in `llm_calls`. Never vacuumed or wiped.
- Store the embedding dimension with each row; refuse mixed dimensions in one search (re-embed if
  the model changes). AI City ran 768-d embeddings through an OpenAI-compatible custom provider.

### 9.5 Reflection (`maybeReflect` → `agentReflect`) `[PORT]`

Engine-side gate (prelude, lock-free):
```
if now - last_reflection_check < 30 s: return            # REFLECTION_CHECK_INTERVAL_MS
if events_since_reflection < 5: return                   # REFLECTION_MIN_EVENTS (observations + finished conversations)
if now - (last_reflection_at or world_start_time) < 4 min: return     # REFLECTION_MIN_INTERVAL_MS
last_reflection_check = now                              # optimistic stamp
schedule_operation('agentReflect', since = last_reflection_at)
```
Operation:
```
memories     = ≤100 newest memories created after `since`
observations = 60 newest observations after `since`, keep the 20 most important
total = Σ memory.importance + Σ min(observation.importance, 2)    # observations discounted
if len(memories) + len(observations) < 5 or total <= 40: return (no reflection; window unchanged)
LLM (Appendix A.7): "Statement i: …" for memories, then "Things you noticed around you recently:"
     → JSON [{insight, statementIds}] — 3 insights
for each insight: importance + embedding; related ids = valid statement indices (bad ones dropped)
insert 'reflection' memories
top insight (first non-empty) → agentAddLearnedTrait (deduped, keep last 6)
send finishReflect → last_reflection_at = now, events_since_reflection = 0
```
An unparseable answer still counts as a reflection (`finishReflect` is sent, nothing stored) so the
same statements are not paid for twice. A below-threshold check must **not** advance the window.

### 9.6 Self-summary — who they have become `[PORT]`

- Trigger (in `tick_schedule`, once per game day): day ≥ 2, and no summary yet or ≥ 4 days since the
  last (`SELF_SUMMARY_INTERVAL_DAYS`; daily rewrites made the cast converge on the same phrasing
  within ~20 real minutes). Master switch `SELF_SUMMARY_ENABLED`.
- Source: authored identity (or the current summary), the 6 newest reflections, and from the 40
  newest non-reflection memories the 8 most important; skip if there are no reflections and no
  memories.
- **Anchors** restated every time so they cannot drift away: Occupation, Nationality, Religion /
  worldview, Dietary rule (when present) and Family.
- Prompt Appendix A.8 (2–4 sentences, third person, same voice; every fixed fact still true; no
  invented events). 250 tokens. Reject answers shorter than 40 characters.
- Stored in `agent_descriptions.self_summary` (+ `self_summary_day`); the authored `identity` is never
  edited, so drift is inspectable (agents panel shows both) and reversible.
- **`effective_identity(desc) = desc.self_summary or desc.identity`** MUST be used everywhere an
  identity reaches a prompt: conversation prompts (self and others), day planner, decomposition,
  reacting, interview. (Mixing them gives an agent who talks like who they became but plans like
  who they were.) Exception kept from AI City: the scenario generator's town snapshot uses the first
  sentence of the authored identity.

---

## 10. Perception and the reacting loop

Source: `Agent.tickObservations`, `Agent.maybeReact`, `Agent.noteObserved` in `agent.ts`;
`convex/aiTown/observation.ts`; `agentReact`, `getUnprocessedObservations`,
`markObservationsProcessed` in `agentOperations.ts`; `promoteObservations` in `memory.ts`;
test `convex/observation.test.ts`.

### 10.1 Perception pass (deterministic, no LLM) `[PORT]` `[ADAPT]` radius

Every `OBSERVATION_INTERVAL_MS` (5 s real ≈ 5 game minutes) per agent, from the prelude (so it runs
while busy, talking or held):
```
previous = {k: h for k, h in agent.observed}; seen = []; mean = mean(agent.affinities.values()) or None
for other in players (not me) within perception (§4.7):
    activity = other's live activity description or None
    loc = nearest_location(other)                         # [ADAPT] named location / AOI label
    key = f"player:{other.id}"; h = fingerprint(activity, loc.id); seen.append((key, h))
    if previous.get(key) == h: continue                   # emit only on CHANGE
    importance = observation_importance(family, name, affinity_for(other), mean,
                     out_of_place = not at their home and not at their workplace-on-shift,
                     subject_sick = other's agent is sick)
    kept = emit_observation({player_id: me, at: now, description: observation_text(name, activity, loc.name),
                             importance, subject_player_ids: [other], location_id, processed: False, promoted: False})
    if not kept: seen.pop()                               # per-step cap hit: re-emit next pass
    else: note_observed(importance)
for conv in conversations I am not in, with ≥ 2 participants, any participant within perception:
    names = participant names; loc = nearest_location(first participant)
    key = f"conv:{conv.id}"; h = fingerprint(",".join(names), loc.id); …same dedupe…
    importance = observation_importance(family, names[0], affinity_for(first), mean, group_size=len)
    text = "{A, B and C} were talking at {loc}."
agent.observed = seen[:32]                                # MAX_OBSERVED_SUBJECTS
```
- Texts: "Saw {name} {activity} at {place}." / "Saw {name} at {place}." / "{A} and {B} were talking at {place}."
- `fingerprint(*parts)` = 32-bit Java-style string hash (`h = (h*31 + code) | 0`) of the parts joined
  by `|` (missing part → empty string). Only compared with itself.
- `note_observed(i)`: `events_since_reflection += 1`; if `i ≥ 3`, `salient_since_reaction += 1`.
- Subjects that leave range drop out of `observed` and re-emit when they come back (that *is* the
  arrival signal).
- There is no line-of-sight model; the radius is kept small so perceiving through walls is not
  conspicuous.

### 10.2 Storage and promotion `[PORT]`

Observations go to their own table (high volume, short life, not mixed into `memories`, whose
listings and reflection window they would drown). At persist time, observations with importance
**≥ 3** (`OBSERVATION_EMBED_MIN_IMPORTANCE`) are handed to `promoteObservations`: batch-embed (through
the cache), insert a `memories` row (`type 'observation'`, `subject_player_ids`, `last_access = at`),
and set `promoted = True`. Idempotent: skip already-promoted rows. Observations are vacuumed after
~3.8 real hours (§3.7).

### 10.3 Reacting loop `[PORT]`

Gate (prelude):
```
if salient_since_reaction == 0: return
if now - last_reaction_at < 45 s: return                 # REACTION_INTERVAL_MS
if op in flight or in a conversation or held by a scenario or walking to a gathering: return
last_reaction_at = now; salient_since_reaction = 0       # optimistic
schedule_operation('agentReact', name, current activity, current place
                   ('home' for a 'home' step, else the location name),
                   short-term note, nearby names (perception radius))
```
Operation: fetch up to 8 newest **unprocessed** observations of this agent; none → return; mark them
processed **first** (a failed call must not make the same observations prompt again); prompt
Appendix A.9 → JSON `{"reaction": "ignore"|"talk"|"activity"|"replan", "target"?, "activity"?, "emoji"?, "reason"}`.
- `ignore` → nothing.
- `talk` → target must match a nearby name (case-insensitive) → `finishReact talk target_player_id`
  → `preferred_invitee` (a preference only: every invite rule still applies).
- `activity` → ambient activity for 20 game minutes (`CONTEXTUAL_EVENT_MINUTES × CYCLE_MS / 1440` real ms).
- `replan` → ≤ 2 per game day (`MAX_REACT_REPLANS_PER_DAY`) → `schedule_needs_refresh` +
  `reaction_replan` (own 60 s cooldown, not `force_plan`).
Failures are cheap and inert.

### 10.4 Observation salience (rule table) `[PORT]`

```
score = 1
+2 if the subject is family
+2 if |affinity_for(subject) - observer's mean affinity| >= 15     # AFFINITY_STANDOUT_DELTA — RELATIVE
+1 if the subject is out of place (neither at home nor at their workplace while on shift)
+1 if the subject is sick
+1 if it is a group of ≥ 3
clamp to 1..6
```
Affinity is scored relative to the observer's own mean on purpose: in a long-running world nearly
every affinity saturates at 100 (§11.5), and a fixed "≥ 75" rule then marks every observation salient,
promotes the whole ambient stream into memory and floods the reacting loop.

---

## 11. Relationships: family and affinity

Source: `convex/aiTown/affinity.ts`, `relationshipEvents.ts`, `agentInputs.agentApplyAffinity`,
`applyEvaluationOutcome`, invite/leave logic in `agent.ts`, `convex/messages.ts conversationGraph`,
`convex/world.ts recentRelationshipEvents / relationshipEventsForPlayer`.

### 11.1 Family `[PORT]`
Immutable, authored by name with directional labels (§5.1), stored on the agent description. Used
for: default affinity 75, observation salience, scenario cast selection (+45), prompts ("they are
your daughter"), self-summary anchors, the analysis graph (dashed family edges), the inspector.

### 11.2 Affinity `[PORT]`
Directional (A→B may differ from B→A), integer 0–100, stored sparsely on the agent
(`affinities[other_player_id]`). Missing → default: **75** if family, else **50**.
Labels / emoji / colour (prompts, inspector, analysis):
```
≥ 80 "very close" 💚 #4ade80 | ≥ 65 "warm" 🙂 #86efac | ≥ 45 "neutral" 😐 #fcd34d |
≥ 25 "cool" 🙁 #fb923c      | < 25 "hostile" 💢 #f87171        (HOSTILE_AFFINITY_THRESHOLD = 25)
```

### 11.3 What changes affinity

| Cause | Change | Event kind |
|---|---|---|
| End of conversation (the `Affinity:` verdict, §9.3) | ± up to 10 toward each other participant | `affinityShift` (reason = summary's first sentence) |
| An agent declines my invite on the affinity roll (not for being tired/busy/off post) | my affinity toward them −2 | `inviteDeclined` |
| Leaving a group early while disliking it (avg affinity < 40) | none (logged only) | `groupExit` |
| Evaluated group decision (§14.6) | each participant's affinity toward the **focal agent**: hard taboo violated −8; else round(clamp((utility − 55)/9, −5, +5)) | `decisionOutcome` |

`last_affinity_change = {at, net}` drives a 💗 (net > 0) / 💔 (net < 0) over the sprite for 6 s.

### 11.4 How affinity changes behaviour
- **Whom to approach:** `score = affinity − (2 + 0.03·weariness) × distance` (§6.7).
- **Invite acceptance:** `p = 0.30 + 0.67 × affinity/100` (humans always accepted).
- **Leaving groups:** drift probability scaled by the average affinity toward the group (§6.6 helper).
- **Prompts:** relationship line when family or clearly warm/cool; group retrieval focuses on the
  most strongly felt person (§8.5 block 7).
- **Scenario casts:** togetherness score starts from affinity (§13.3).
- **Map:** persistent 💢 while in a conversation with someone the agent feels hostile toward (or
  while arguing a scenario conflict).

### 11.5 Known issue: saturation `[PORT]` + recommendation
Ordinary conversations mostly add affinity and there is no decay, so in a long-running AI City world
nearly every pair sat at 100. Anything keyed on an absolute threshold then fires for everyone.
Mitigation already in place: relative scoring in perception. `[OPTIONAL][NEW]` RECOMMENDED: a daily
decay of every stored affinity a few points toward its default (50 or 75) at the day rollover, so
relationships can both recover and cool, and absolute thresholds regain meaning. Flag it as a
behaviour change if added.

### 11.6 Relationship event log `[PORT]`
```
RelationshipEvent: at, kind ∈ {affinityShift, inviteDeclined, groupExit, decisionOutcome},
                   actor (whose feeling changed / who acted), target?, delta?, affinity_after?,
                   reason? (≤ 120 chars), conversation_id?, scenario_id?, scenario_name?
```
Buffered during the step, inserted at persist time. Read by: the inspector (two latest events per
relationship + a ↗/↘ trend from the net of the last three), the scenario generator ("recent
friction": negative deltas with a reason), and analysis. Queries: newest 30 for the world; newest 50
per actor.

---

## 12. Short-term state, sleep, sickness, economy

Source: `convex/aiTown/shortTerm.ts`, `shortTermEvents.ts`, `Agent.accrueStepShortTerm`,
`Agent.applySleepPressure`, `Agent.updateHealthForNewDay`, `Agent.updateShortTermForNewDay`,
`agentInputs.agentApplyShortTerm / agentSetState`, constants in `convex/constants.ts`,
`evaluation/src/theory/stateRules.ts`.

### 12.1 Gauges `[PORT]`

Four integer gauges 0–100 on the agent (absent = at baseline): **mood** (baseline 60, high is good),
**stress** (15), **fatigue** (10), **hunger** (10). Every change is clamped and rounded.

Profile-derived reactivity multipliers (`short_term_sensitivity`, keyword scan of all profile values,
lower-cased):
```
stress  × 0.6 if any of: resilient, calm, easygoing, even-tempered, unflappable, stoic, laid-back
stress  × 1.4 if any of: anxious, high-strung, highly strung, nervous, worrier, easily stressed  (wins if both)
fatigue × 0.7 if any of: energetic, athletic, fit, active, sporty, high energy
fatigue × 1.4 if any of: chronic fatigue, night shift, frail, tires easily, low energy, sickly    (wins if both)
```
Applied to event deltas (`agentApplyShortTerm`), to fatigue accrual, and to the sleep-pressure ramp
length; **not** to operator overrides (`agentSetState` sets absolute values).
`last_short_term_change = {at, net}` is set by `agentApplyShortTerm` and `agentSetState` when the
net is non-zero (`net` > 0 when mood went up or stress/fatigue/hunger went down), but AI City's UI
never draws it (`SHORT_TERM_INDICATOR_MS`
is unused). `[OPTIONAL]` a brief map cue like the affinity 💗/💔.

### 12.2 Sleep pressure — the nightly fatigue clock `[PORT]`

Every 15 s real, from the prelude:
```
if current step is a sleep step: asleep = True
elif asleep: asleep = False; fatigue = 10 (baseline); event cause 'rest' "waking up"; return
ramp = 300 game min × fatigue_multiplier
m = minutes_until_sleep():  0 if in a sleep step; else start of the next sleep step later today minus now;
    else (none left today): None if on night shift tonight, else game_minutes_until(own bedtime)
floor = 0 if m is None or m >= ramp; 95 if m <= 0; else round(95 × (1 − m/ramp))
if fatigue < floor: fatigue = floor; event cause 'sleepPressure'      # only ever pushes UP
```
- **Going to bed does not reset fatigue; waking does.** Fatigue is held at the peak through the
  night.
- `too_tired_to_talk()` = in a sleep step or fatigue ≥ 80: no starting, accepting (except humans) or
  joining conversations, a goodnight after 2 messages, exhausted prompt lines, excluded from scenario
  casts. The ramp crosses 80 roughly 50 game minutes before bedtime (at multiplier 1).

### 12.3 Health and sickness `[PORT]`

Daily roll on the first tick of each game day:
```
if sick: sick_days_left -= 1; if ≤ 0: well
elif weekday: p = min(0.5, 0.02 + 0.04 × consecutive_work_days)
              if random() < p: sick for 2 days, streak = 0  else streak += 1
else (weekend): streak = 0
```
Contagion: once per conversation, if any participant is sick, a well agent falls sick with p = 0.0625.
Sick effects: deterministic rest schedule at home (§7.4); no initiating conversations; prompt line;
daily stress +12 and mood −10 (cause `sickness`); no income that day; inspector shows 🤒.

### 12.4 Step accrual (on settling into a schedule block, once per step key) `[PORT]`

```
text = f"{activity} {description}".lower()
is_home = step.location_id == 'home'; is_sleep = is_sleep_step(step)
is_meal = not is_own_workplace and regex \b(lunch|dinner|breakfast|brunch|supper|eat|eating|meal|makan|
          hawker|food court|chicken rice|kopi|coffee|tea|prata|noodle|curry|snack)\b on text
if is_sleep:   nothing (the sleep clock owns fatigue)
elif is_meal:  hunger = 10 (cause 'meal'); last_meal_day = day; pay MEAL_COST 8 if affordable
               (eating "at home" for free otherwise)
elif is_home and not is_own_workplace: hunger = 10 (cause 'meal', free)       # eating at home
else:
    is_work = is_own_workplace or (not is_home and regex \b(work|working|shift|office|lab|counter|
              kitchen|driving|deadline|meeting)\b on text)
    fatigue += (12 if is_work else 0 if is_home else 8) × fatigue_multiplier   (cause 'activity')
if hunger was not reset: hunger += 7 × (minutes_left_in_step / 60)            (cause 'activity')
```
`is_own_workplace` = the step's location id equals the character's workplace id (a hawker at the
hawker centre is working, not eating).

### 12.5 Money `[PORT]`

- `balance` (S$), default 400. `spend(balance, amount)` is the only debit path and floors at 0
  (pays what it can, reports the shortfall). `can_afford(balance, cost)`.
- Day rollover: decay every gauge 25 toward its baseline (one `dailyDecay` event per gauge), then
  sickness penalties, then **income 150 on a weekday if not sick**, then **expenses 75 every day**
  (through `spend`; clamping heals a ledger that was already negative).
- Meals 8 (when affordable), free-roam activity costs from the menu (affordability filtered
  first), scenario tasks have no cost.
- Financial pressure (derived, 0–100): 0 at ≥ 300 (`FINANCIAL_COMFORT_THRESHOLD`), 100 at ≤ 0,
  linear between. Rationale for the numbers: a healthy week nets ≈ +113, a week with a sick spell
  ≈ −187, so pressure is a live signal rather than pinned at 100.

### 12.6 Self-description for prompts (`shortTermSelfDescription`) `[PORT]`

Bands: ≥ 75 high, ≥ 50 moderate, ≥ 25 slight. Parts, in order:
mood ≤ 25 "in low spirits" / ≥ 80 "in good spirits"; stress high "very stressed" / moderate "rather
stressed"; fatigue ≥ 80 "barely able to keep your eyes open" / high "exhausted" / moderate "tired";
hunger high "very hungry" / moderate "getting hungry"; financial pressure ≥ 66 "anxious about money" /
≥ 33 "watching your budget". Joined as "Right now you feel A, B, and C." — omitted entirely when
nothing is notable. Used by conversation prompts, the planner, reacting and interview.

### 12.7 Short-term event log `[PORT]`

```
ShortTermEvent: at, player_id, component, delta (applied, after multiplier and clamp),
                value_before, value_after, cause, reason?, conversation_id?, scenario_id?, goal_met?
cause ∈ activity | meal | rest | sleepPressure | sickness | dailyDecay | conversationFeelings |
        scenarioOutcome | manualOverride
```
Invariant: `value_before + delta == value_after`; no-op changes are not logged. The offline evaluator
checks every transition against the expected direction (activity: fatigue/hunger up; meal: hunger
down; rest: fatigue down; sleepPressure: fatigue up; sickness: stress up, mood down; dailyDecay:
toward baseline; conversationFeelings and scenarioOutcome: direction depends on how it went;
manualOverride: unconstrained) and counts large jumps to baseline with no valid cause as
**unexpected resets** (valid reset causes: dailyDecay, meal, rest, manualOverride).

---

## 13. Scenarios

Source: `data/scenarios.ts`, `convex/aiTown/scenarios.ts`, `injectScenario` and the scenario inputs in
`convex/aiTown/agentInputs.ts`, `convex/aiTown/generatedScenario.ts`, `convex/scenarioGen.ts`,
`agentPlanScenarioTasks` / `agentRememberScenario` / `agentExtractScenarioProfile` in
`agentOperations.ts`, `planScenarioTasks` in `convex/agent/conversation.ts`,
`rememberScenarioOutcome` in `convex/agent/memory.ts`, UI `src/components/Scenarios.tsx`,
`ScenarioCreator.tsx`, `ScenarioMarker.tsx`.

A scenario is a situation that enlists a group of residents, injects a directive (plus topics, a
goal and optionally a point of disagreement) into their prompts, usually gathers them in one place,
and runs until its goal is met or it times out. Decision scenarios additionally run the decision
engine (§14).

### 13.1 Scenario definition `[PORT]`

```
ScenarioDef:
  id, name, emoji
  scope: 'universal' | 'local'
  location_id?: str             # required for local: a workplace location id
  duration_ms?: int             # default SCENARIO_DEFAULT_DURATION_MS (4 real min)
  min_participants: int
  outcome?: 'tasks' | 'decision'   # default: local → 'tasks', universal → 'decision'
  textable?: bool               # may be held over a group text when the cast is at work
  instruction: str              # the directive injected into prompts
  what_happens, background, relationships, context, goals: str   # info panel (+ fed to LLMs)
  conflict?: str                # authored fault line; participants are told to take sides
  topics: list[str]             # 4–5 concrete beats to work through
  completion_goal: str          # one sentence the goal judge checks against
```
The catalogue has **18** definitions (Appendix C): 8 universal (5 talk-style: downpour, National Day,
MRT breakdown, haze, CNY eve; 3 decision: dinner, movie night, weekend trip) and 10 local (7 tasks-style:
grant crunch and demo day at A\*STAR, lunch rush and health inspection at the hawker centre, latte-art
throwdown at the café, convention surge at MBS, deadline panic at the polytechnic; 3 decision: new café
drink, which A\*STAR project first, hawker price rise). Note: the universal talk-style ones default to outcome `decision`
too (the default for universal), so a deliberation is attempted for them as well.

### 13.2 Active scenario instance `[PORT]`

```
ActiveScenario:
  id = f"{def.id}-{start_ms}"        # instance id; messages are stamped with it
  def_id, scope, name, emoji, location_id?, x?, y?   # marker position (local) [ADAPT → lng/lat]
  instruction (possibly an edited override), what_happens, background, relationships,
  context = f"{def.context} Present: {names}.", goals, conflict?, outcome, topics, completion_goal
  topics_done: list[bool], topics_done_at: list[ms], goal_met: bool, goal_met_at?: ms
  participant_ids, participant_names
  start_time, duration_ms, content_start_time, end_time, wait_until?
  phase: 'waiting' | 'gathering' | 'active' | 'working'
  gather_x?, gather_y?   [ADAPT → gather AOI id + lng/lat]
  via_text?: bool
  tasks?: [{label, emoji, assignee_id, assignee_name, started_at?, duration_ms, done_at?}]
  task_plan_requested?: bool
  deliberation?: Deliberation        # decision scenarios (§14.2)
```
Agents enlisted carry `scenario_id`, `scenario_name`, `scenario_instruction`, `scenario_topics`,
`scenario_goal`, `scenario_conflict`, and while walking to the spot `scenario_target` +
`scenario_arrival_time`. `[NEW]` RECOMMENDED: when an instance ends, write it to a
`scenario_history` table (AI City lost everything but evaluations and messages at teardown).

### 13.3 Choosing the cast (`pick_scenario_participants`) `[PORT]` `[ADAPT]` proximity

```
candidates = agents with no scenario_id and no scenario_instruction       # never double-book
min = max(1, def.min_participants); max = max(min, min(len(candidates), SCENARIO_PARTICIPANT_MAX=5))
if len(candidates) <= min: return candidates
target = random integer in [min, max]
chosen = [one candidate picked uniformly at random]
while len(chosen) < target:
    for each remaining c: score = mean(togetherness(m, c) for m in chosen) + random() * 55   # SCENARIO_PICK_NOISE
    add the best
togetherness(a, b) = affinity_for(a→b)
                   + 45 if b is a's family                       # SCENARIO_FAMILY_BONUS
                   + 35 if same workplace id                     # SCENARIO_WORKPLACE_BONUS
                   + 20 if same home area id                     # SCENARIO_NEIGHBOUR_BONUS
                   + 60 * max(0, 1 - distance(a, b) / falloff)   # SCENARIO_PROXIMITY_BONUS; falloff
                                                                 # 25 tiles → [ADAPT] 3000 m
```
Local scenarios instead take every free agent whose workplace is the scenario's `location_id`.
Generated scenarios are universal.

### 13.4 The manager (`tick_scenarios`, called from `Game.tick`) `[PORT]`

```
if now - last_scenario_eval < 3 s: return; last_scenario_eval = now
next_scenario_time ??= now + 30 s                                   # SCENARIO_FIRST_DELAY_MS
cooldowns = copy(scenario_cooldowns)
still = []
for sc in active_scenarios:
    if sc.def_id == 'manual': still.append(sc); continue            # owned by the injector
    if sc.end_time <= now: teardown(sc); cooldowns[scope_key(sc)] = now + 3 min; continue
    maybe_begin_waiting(sc); maybe_promote(sc); maybe_reassign_focal(sc)   # §13.5, §14.4
    maybe_schedule_evaluation(sc, on_expiry=False)                          # §14.6
    if sc.phase == 'active' and sc.task_plan_requested and not sc.tasks
       and now > (sc.goal_met_at or sc.start_time) + 135 s: sc.task_plan_requested = False   # stuck planner
    if sc.phase == 'working': tick_working(sc)                              # §13.6
    if sc.end_time <= now: teardown(sc); cooldowns[…] = now + 3 min
    else: still.append(sc)
if scenario_gen_requested and now > scenario_gen_requested + 120 s: scenario_gen_requested = None
if now >= next_scenario_time and scenario_gen_requested is None:
    universal_slot_free = no universal in still and cooldowns['universal'] <= now and game hour >= 6
    if universal_slot_free and random() < 0.5:                      # SCENARIO_GENERATION_PROBABILITY
        scenario_gen_requested = now; schedule_operation('generateAndStartScenario')   # §13.8
        next_scenario_time = now + 120 s                            # hold while it is written
    else:
        def = random choice of UNIVERSAL defs if game hour >= 6 and universal count < 1
              and 'universal' not occupied and off cooldown            # LOCAL defs never fire randomly
        inst = start_scenario(def) if def else None
        if inst: still.append(inst)
        next_scenario_time = now + randint(60 s, 120 s) if inst else now + 20 s     # retry
active_scenarios = still or None; scenario_cooldowns = cooldowns or None
scope_key = 'universal' | f"local:{location_id}"
```
Local (workplace) scenarios only start manually (§13.7).

### 13.5 Starting and the phase machine `[PORT]` `[ADAPT]` gathering geometry

`start_scenario(def, instruction_override=None, duration_override=None)`:
```
instruction = override or def.instruction
free = agents with no scenario_id and no scenario_instruction
cast = pick_scenario_participants(free, def.min) if universal else free workers of def.location_id
if len(cast) < def.min: return None
outcome = def.outcome or ('tasks' if local else 'decision')
ready_now = enough_are_free(cast, def.min)
via_text  = not ready_now and def.textable and enough_are_awake(cast, def.min)
gather    = None if via_text else (location tile of def.location_id if local else meeting_point_for(cast))
reserve the cast now: scenario_name, scenario_id, topics, goal, conflict; clear scenario_profile(_for)
          (but NOT the directive and NOT a walk order — those land when content begins)
inst = {…, phase 'waiting', content_start_time: now, wait_until: now + 6 min,
        end_time: now + 6 min + duration, deliberation: {focal_player_id: lowest-sorting participant id,
        options: [], questions_asked: 0} if outcome == 'decision'}
if ready_now or via_text: begin_content(inst)
return inst
```
"Lowest-sorting participant id" (focal agent, task planner, `was_planner`) is the first id in
AI City's **string** sort of `p:N` ids, so `p:12` sorts before `p:3`. Any deterministic rule will do;
use the same one everywhere.
- `enough_are_free`: free = not in a sleep step, not too tired, not on shift at their own
  workplace; needed = `max(min, ceil(n × 2/3))` (`SCENARIO_READY_FRACTION`). A bare quorum would
  drag the rest out of work.
- `enough_are_awake`: same count of people not asleep and not too tired (a thread nobody is awake to
  read just burns its message budget).
- `meeting_point_for(cast)`: the named location nearest the centroid of the cast's positions
  (`[OPTIONAL]` prefer a social POI near the centroid).

`begin_content(sc)`:
```
participants = agents with scenario_id == sc.id
gather = (sc.gather) unless sc.via_text
content_start = now + min(max ETA of participants to gather + 8 s, 90 s) if gather else now
for a in participants:
    a.scenario_instruction = sc.instruction
    if gather: a.scenario_target = gather; a.scenario_arrival_time = content_start
    clear a.scenario_profile(_for)                # forces re-extraction (§13.10)
sc.phase = 'gathering' if gather else 'active'; sc.content_start_time = content_start
sc.end_time = content_start + duration; sc.wait_until = None
if sc.via_text: Conversation.start_text(all participant players)     # one thread, everyone at once
```
`maybe_begin_waiting(sc)` (phase `waiting`): if enough are free (min 2) **or** `now ≥ wait_until`:
recompute the meeting point for universal scenarios (they have moved) and begin. Else, if the def is
`textable` and enough are awake: switch to text (`via_text = True`, drop the gather point) and begin.

`maybe_promote(sc)` (phase `gathering`): when every participant still in the world is within
`SCENARIO_ARRIVAL_RADIUS` of the gather point, or `now ≥ content_start_time`: phase `active`,
`content_start_time = now`, `end_time = now + duration`, clear every participant's
`scenario_target`/`scenario_arrival_time`. From then until the scenario ends the gather point
**replaces their schedule destination** (`scenario_meeting_point`), so the group stays together
long enough to talk; the normal invite/join logic forms the conversation (participants invite only
fellow participants, are exempt from the work leash unless texting, and ignore "pending step").

### 13.6 Tasks scenarios: planning chat → working phase `[PORT]`

For a local scenario with outcome `tasks`:
1. The planning conversation runs under the scenario rules until the goal judge latches `goal_met`.
2. `maybe_request_scenario_tasks` (prelude): the **planner** = lowest-sorting participant id; when
   `phase == 'active'`, `goal_met`, no tasks and not requested → `task_plan_requested = True` and
   start the locked op `agentPlanScenarioTasks`.
3. `plan_scenario_tasks` (Appendix A.12): the scenario framing, participants with their scenario
   profiles, and the whole scenario transcript (≤ 40 messages) → JSON
   `{"tasks": [{"label", "emoji", "assignee", "durationSec": 20–90}]}`; aim for N to N+3 tasks,
   everyone gets ≥ 1, labels ≤ ~6 words. Parse: resolve assignees by exact then substring name match,
   else round-robin; clamp duration 20–90 s real (default 45 s); default emoji 🛠️.
4. `finishPlanScenarioTasks` → tasks set, phase `working`, `goal_met = False` (the goal is now the
   tasks), `end_time = now + 6 min` (`SCENARIO_WORK_MAX_MS`), stop the participants' conversations.
5. While held (`is_held_by_scenario`), participants stand still at the workplace and skip
   invites/joins/schedule.
6. `tick_working(sc)` every manager evaluation: per assignee, the first unfinished task becomes
   current (`started_at = now` the first time); after `duration_ms` it gets `done_at` and the next
   starts; the current task is mirrored onto the player as a timed activity (`started_at`/`until`) so
   the UI draws a progress bar; when all tasks are done: `goal_met = True`, `goal_met_at`,
   `end_time = now` (retire immediately).
7. An empty or failed plan clears `task_plan_requested` and the scenario wraps up normally; a stuck
   request is released after 135 s (§13.4).

Decision-outcome local scenarios never enter `working`: they argue, decide and end through the
goal-met wrap-up.

### 13.7 Manual control `[PORT]`

- **Custom scenario** (`startCustomScenario` → `inject_scenario`): free text from the scenario
  creator. Sets the world's global `scenario_instruction`/`scenario_start_time`; stops **every**
  conversation; clears every agent's scenario fields, `to_remember` and `in_progress_operation`;
  picks a cast with `pick_scenario_participants(all agents, 2)` (or everyone for the park button);
  for the cast sets the instruction, `schedule_needs_refresh`, `force_plan`, clears
  `last_plan_attempt`, activity and movement (so they **re-plan immediately**, with the planner's
  urgent "reaction" step); stores `scenario_participant_ids`; replaces `active_scenarios` with one
  manual entry (`id manual-<ms>`, `def_id 'manual'`, phase `active`, `end_time = now + CYCLE_MS`,
  relationships/context text naming the cast). It expires after one game day (§6.1). While a manual
  scenario is active for an agent, `finishPlanDay` does **not** merge fixed obligations (the event
  takes over the day). The automatic manager leaves manual entries alone and only enlists agents
  with no instruction, so automatic scenarios pause until it ends.
- **Catalogue scenario** (`startCatalogScenario` → `inject_catalog_scenario`; the creator uses this
  for **every** catalogue entry, universal or local): stop every conversation; clear all world-level
  manual fields and all agents' scenario fields, operations and `to_remember`; clear every player's
  activity and movement; `active_scenarios = None`; `start_scenario(def, edited instruction,
  duration = SCENARIO_MANUAL_DURATION_MS 10 min)`; fail (error toast) if too few of the right people;
  otherwise make it the only active scenario, clear the participants' `last_conversation` and
  `last_invite_attempt` (stopping everyone's chats put them on cooldown), and push
  `next_scenario_time` 60 s out.
- **Meet at the park** (`startScenarioMeetAtPark`): custom scenario for everyone: "A spontaneous
  town gathering is happening at Gardens by the Bay right now. Drop what you are doing and head to the
  park (location "gardens") …". (No UI button currently triggers it.)
- **Clear** (`clearScenario`): full reset of manual and automatic scenarios: world-level manual
  fields, every agent's scenario fields, `active_scenarios = None`. It is not a teardown: no
  evaluation, no takeaway memories, no cooldown, and running conversations carry on without their
  directive.
- Side effect of both injectors: they stop every conversation (which sets `to_remember`) and then
  clear `to_remember` on every agent. So the conversations they interrupt are archived (if they had
  messages) but **never remembered**: no memory, no `Affinity:`/`Feelings:` verdict, no re-plan.
  Port this as-is, or `[OPTIONAL]` let those remembers run first; flag it if you change it.

### 13.8 Decider-generated scenarios `[PORT]`

Purpose: stop a long-running town replaying the same catalogue by inventing situations from what has
actually happened. The information rule holds: **ground truth is never read**; only what has been
said out loud.

Town snapshot (`loadTownSnapshot`): cast (agents only; name + first sentence of the authored
identity); "what has come up": all focal agents' perceived-knowledge rows merged per target (≤ 4
taboos, ≤ 5 preferences, ≤ 3 open questions; only people with something known); "recent friction":
from the 40 newest relationship events, the first 8 with a negative delta and a reason, formatted
"Actor toward Target: reason"; "already been through": names of the 10 newest generated scenarios plus
every catalogue name.

Prompt Appendix A.16 → JSON with name (2–4 words), emoji, instruction, whatHappens, background,
relationships, context, goals, conflict, topics (4–5), completionGoal, reasoning (≤ 25 words),
groundedIn (facts it built on, ≤ 8 words each). Validated; `def_id = f"gen-{ms}"`, emoji truncated to
4 chars, empty conflict → none, `min_participants = 2`. Always converted to a **universal decision**
scenario (so it runs the full Decider → Focal → Evaluator pipeline).

- Automatic path (`generateAndStartScenario`, lock-free): generate, store in `generated_scenarios`
  (`created_by 'auto'`), and **always** send `startGeneratedScenario` (with no scenario on failure, so
  the manager retries the catalogue in 20 s). On success the handler starts it like a catalogue
  scenario (or retries in 20 s if too few are free) and sets the next scenario time to now + 60 s.
- Manual path (creator's "Generate" button → `draftScenario` action): returns the draft for the
  human to read/edit (stored with `created_by 'manual'`); "Start" sends
  `startGeneratedScenario {scenario (with the edited instruction), manual: true}` → manual catalogue
  semantics (§13.7).
- `generated_scenarios.used_at` is meant to mark drafts the town actually played, but AI City never
  sets it (`markGeneratedScenarioUsed` is unused), so the viewer shows every one as "draft". The new
  build SHOULD set it when a generated scenario starts.

### 13.9 Teardown `[PORT]`

When `end_time ≤ now` (expiry, or tasks finished):
1. `maybe_schedule_evaluation(sc, on_expiry=True)` (§14.6) — a decision scenario that never
   committed is still scored on its leading estimate, flagged `forced`.
2. Unless the scenario never got past `waiting`/`gathering`: for each participant agent, a lock-free
   `agentRememberScenario` with the scenario's fields (they are about to be deleted) and
   `was_planner = (id == lowest-sorting participant id)`. The op (Appendix A.10) writes a `scenarioOutcome`
   memory "{scenario name}: {1–2 sentence first-person takeaway}" (importance + embedding) and
   returns mood/stress deltas from a `Feelings:` line (clamp ±20). Fallback when missing: goal met →
   mood +6, stress −4; not met → mood −5, stress +10 if there was a conflict else +6. Applied via
   `agentApplyShortTerm` (cause `scenarioOutcome`, `goal_met`, `scenario_id`).
3. Clear every participant's scenario fields and any scenario task activity.
4. Cooldown the scope for 3 min (`SCENARIO_COOLDOWN_MS`).

### 13.10 Scenario-relevant profiles — "others-filtered" `[PORT]`

A character always sees **its own full profile**. During a scenario, *other* people see a compact,
scenario-relevant note instead of the full identity. Once per (agent, instruction), a lock-free
`agentExtractScenarioProfile` (Appendix A.11, 160 tokens) distils the profile into 1–2 sentences
("{name} is a strict vegetarian and prefers clear bill-splitting"), mentioning nothing irrelevant and
inventing nothing. Stored on the agent (`scenario_profile`), ignored if the instruction changed
meanwhile, cleared when the scenario ends or (re)begins. Used in others' conversation prompts, the
Decider's option generation (as "what is publicly known") and task planning.

### 13.11 How a scenario reaches agents (summary)

- Prompts: directive, conflict ("take a side … don't just cave"), topics, goal (§8.5 block 4),
  cross-conversation scenario history (60 messages, block 8), past-scenario recall (block 9);
  planner's urgent block for manual scenarios.
- Movement: walk to the gather point; the meeting point replaces the schedule destination while
  active; working phase holds them in place.
- Social isolation: invites and joins are scenario-relative (no outsiders in, no participants out);
  manual injection clears cooldowns and in-flight ops.
- Conversation termination: goal-judged with minimum and hard caps (§8.4); goal wrap-up summary.
- Profile extraction (§13.10); decision engine for `outcome == 'decision'` (§14).
- Memories: every scenario conversation is remembered normally; plus a takeaway at teardown.

### 13.12 Scenario UI `[PORT]`

- **Panel** (top-right of the map): one chip per active scenario (universal first): emoji, name, a
  sub-label ("Waiting till they're free…", "Gathering…", "📱 Texting · N", the location name for local,
  "N residents" for universal), a done/total counter (tasks if delegated, else topics), a green ✓
  when the goal is met or a pulsing dot (sky = waiting/gathering, amber = in progress); and a
  "⏳ Next in m:ss" countdown to `next_scenario_time`. Click → detail.
- **Detail modal**: header with status badge ("Goal achieved" / "Waiting for a free moment" /
  "Gathering participants" / "Working on tasks" / "Texting from work" / "In progress"); sections
  "Where they disagree", "What's happening", "Background", "Relationships", "Current context";
  tasks-and-goal section (delegated tasks with assignee and live progress bar, or the topics
  checklist; relabelled "Considerations"/"Decision" for decision scenarios); deliberation section
  (§14.8); scorecard section once evaluated; participants; "View the conversation" (opens the live
  conversation of a participant).
- **Map marker** for local scenarios at the location's marker point: halo + dot; green when the
  goal is met, sky-blue while gathering, amber while in progress; clickable.
- **Creator modal**: the catalogue (universal and local) with every detail field, an editable
  directive, a "Custom Scenario" free-text option, "Generate" (Decider draft), "Start", "Clear".

---

## 14. Decision engine: Decider, Focal agent, Evaluator

Source: `convex/decider.ts`, `convex/focal.ts`, `convex/evaluator.ts`, `convex/scoring.ts`,
`convex/util/factMerge.ts`, `convex/util/llmJson.ts`, `convex/aiTown/deliberation.ts`,
`convex/groundTruth.ts`, `convex/dryRun.ts`, tests `convex/scoring.test.ts`,
`convex/util/factMerge.test.ts`; UI `ScorecardModal.tsx`, `DeciderViewer.tsx`, `AnalysisPage.tsx`,
`Scenarios.tsx`, `Character.tsx` cues.

### 14.1 Shape of the experiment

A decision scenario is a **sequential game under incomplete information**:
- The **Decider** turns the scenario into 4 concrete options and later extracts, from what people
  actually say, what the focal agent now believes about each participant (beliefs may be wrong).
- One **Focal agent** (a participant) estimates the group utility of every option each turn and
  either asks one person one clarifying question or commits — **code decides which**, not the model.
- The **Evaluator** — the only component that reads the hidden ground truth — scores every option for
  every participant and reports **regret** = best available group utility − chosen group utility.
- Rule: *the LLM supplies judgements; code does every piece of arithmetic.*

### 14.2 Deliberation state (on the active scenario) `[PORT]`

```
Deliberation:
  focal_player_id                         # lowest-sorting participant id (deterministic)
  options: [{option_id 'opt1'.., title, details}]
  options_requested?: bool
  estimates?: [{option_id, estimated_score, taboo_risk: bool, risky_for_player_ids?: [id]}]
  top_score_history?: [{option_id, group_utility}]     # last 8 completed focal turns
  blocked_by?: [str]      # 'taboo' | 'margin' | 'stability' | 'insufficient-options' | 'incomplete-scoring'
  questions_asked?: int
  resolved_option_id?, resolved_at?, forced_decision?
  evaluation_requested?: bool
  last_question?: {target_player_id, at}     # map cue ❓
  last_extraction?: {count, at}              # map cue 💡 +N
```
Durable tables: `perceived_knowledge` (beliefs), `decider_traces` (framing), `evaluations` (scores).

### 14.3 Generating options (`generateDecisionOptions`, lock-free)

Requested by the focal agent (prelude) once the scenario is `active`, its deliberation exists, it has
no options and none were requested (`options_requested = True` stamped). Context = scenario framing +
participants with their **public** `scenario_profile` (never the private profile, never ground truth)
+ the named places and descriptions. Prompt Appendix A.13 → JSON
`{reasoning, options: [{title, details, rationale, riskNote}]}` (exactly 4; specific, nameable; trading
off cost/effort/what it offers; at least one quietly a poor fit for someone's dietary/medical/religious/
budget constraint without flagging it; terse rationale and a guess at who it won't suit). Validate with
the schema (≥ 2 options); ids `opt1…`. Failure → fall back to the scenario's topics as options (≥ 2
needed) with reasoning "Option generation failed; fell back to the scenario's authored talking points."
Store the full record in `decider_traces` (upsert per scenario id, with scenario name and participant
names); send only `{option_id, title, details}` to the engine via `finishGenerateDecisionOptions`
(< 2 options → clear `options_requested` to retry later; meanwhile the scenario runs as an ordinary
conversation).

### 14.4 The focal turn (`runFocalAgentTurn`, locked)

`maybe_take_focal_turn(conv)` (in §8.4 after the leave check) takes the turn when: my active
scenario is a decision scenario with a deliberation; I am the focal agent; there are ≥ 2 options and
no resolution; this is my scenario's conversation and has a first message; and the **ordinary turn
rules** say it is my turn (designated or open floor, not replying to myself, past the 2 s cooldown).
Then set typing and start `runFocalAgentTurn`.

Turn:
```
data = scenario framing, options, previous estimates, top-score history, questions asked,
       participants (+ present = participating in this conversation), my name, message count,
       is_text, end_time
1. knowledge, learned = extract_memories(transcript of the scenario)          # §14.5
2. action = focal_decision(data, knowledge, chat history)                     # Appendix A.15
   → {estimatedUtilityBreakdown[{optionId, estimatedScore 0–100, tabooRisk, riskyForNames}],
      suggestedAction ASK_QUESTION|DECIDE, questionTargetName, questionOutput,
      selectedOptionId, decisionOutput}        # BOTH branches drafted every turn
3. estimates = breakdown filtered to real option ids; names → ids
   check = check_stopping_criteria(estimates, history)                        # §14.7
   scored_every = len(estimates) == len(options)
   blocked_by = check.blocked_by + (['incomplete-scoring'] if not scored_every else [])
   forced = questions_asked >= 4 or messages >= 24 - 4 or now > end_time - 90 s
   decide = (check.can_decide and scored_every) or forced
4a. DECIDE: text = decisionOutput if non-empty and selectedOptionId == top else
       "Okay — let's settle on {title}. That's the one that works best for all of us."
    → goal_met = True; focal = {estimates, top_score, blocked_by, asked_question: False,
       facts_learned, resolved_option_id: top, forced_decision: forced and not (can_decide and scored_every)}
4b. ASK: target = questionTargetName → id; text = questionOutput or a fallback aimed at the target or
       the least-understood person: "{name}, before we lock this in — is there anything about this
       that wouldn't work for you?" (no one: "Before we lock this in — is there anything that would
       not work for anyone?")
    → next_speaker = target if present (so the question gets answered); goal_met = False;
       focal = {…, asked_question: True, question_target_id, facts_learned}
on any failure: fall back to an ordinary continue message + moderator; last resort text '...'
send via agentSendMessage (scenario_id stamped) → agentFinishSendingMessage applies the focal delta
```
`apply_focal_turn` (shared by engine and dry run): replace estimates and blocked_by; append the
top score (keep 8); on a question `questions_asked += 1` and `last_question = {target, now}`; if
facts were learned `last_extraction = {count, now}`; on the first resolution set
`resolved_option_id`, `resolved_at`, `forced_decision`. The goal latch makes the conversation post
its wrap-up summary and end; the manager then schedules the evaluation.

Focal reassignment (`maybe_reassign_focal`, manager): if phase `active`, unresolved, at least 45 s
(`FOCAL_REASSIGN_MS`) after content start, and the focal agent is not in a conversation with ≥ 2
participants of this scenario while someone else is → hand the role to the lowest-sorting participant
who is (and clear `options_requested` if no options arrived). Prevents a lone, leashed focal agent
from stalling the whole deliberation.

### 14.5 Beliefs: memory extraction and fact merging

`extract_memories(scenario, focal)` (Appendix A.14, 900 tokens, JSON): from the scenario transcript
(≤ 40 messages) and the beliefs already held, report per other person who revealed something:
`newTaboos` (absolute constraints only), `newPreferences` (likes, dislikes, budget, convenience —
strong dislikes go here), `resolvedUncertainties`, `openQuestions`, `confidenceScore` 0–1. Only what was
said or clearly implied; one fact per entry, ≤ 10 words. Names must match exactly (hallucinated
names dropped). No transcript yet → return current beliefs. Parse failure → beliefs unchanged.

Merge into `perceived_knowledge(world, focal, target)` (`factMerge.ts`, pure, tested):
```
normalize(f) = lowercase, trim, strip trailing .!?
tokens(f)    = words (a–z0–9) minus stop words, length > 1, crude stem (drop trailing 's' unless 'ss', len > 3)
overlap(a,b) = |shared tokens| / |tokens of the shorter|        (0 if empty)
same(a,b)    = normalize equal or overlap >= 0.7
split compounds on ';'
merge(existing, incoming, max=8): for each fact of split(existing + incoming): if it says the same
    thing as one already kept, replace that one with the newer wording; else append; keep the last 8
count_new(existing, incoming) = incoming facts not covered by existing (counted, not inferred from length)
drop_resolved(open, resolved) = remove open questions that "say the same thing" as a resolution
known_taboos      = merge(old, new_taboos)
known_preferences = merge(old, new_preferences)
uncertainties     = merge(drop_resolved(old, resolved), open_questions)
confidence_score  = the latest extraction's value (NOT a running max)
learned           = count_new over taboos + preferences  → the "💡 +N" cue
```
The focal prompt receives one row per other participant (including people nothing is known about).

### 14.6 The Evaluator (`evaluateFinalDecision`, lock-free)

Scheduled by `maybe_schedule_evaluation(sc, on_expiry)` when: the scenario has a deliberation, not
yet requested, ≥ 2 options, phase not `waiting`/`gathering`; selected = `resolved_option_id`, or — on
expiry only — the top current estimate (`forced = True`); if there is nothing to select, skip. Stamp
`evaluation_requested`; pass the options, participants, questions asked and forced flag as op args
(the scenario is about to be deleted).

```
ensure_ground_truth(world); profiles = ground truth for participants (need ≥ 2, else no row)
transcript = scenario messages (≤ 60)
for option in options:                                  # one call per option, not one giant call
    LLM (Appendix A.17): for EVERY person, using the TRUTH (not what they said):
        hardTabooViolated (+ violatedTaboo quote), dimensionFactors ×6 each in {1,.75,.5,.25,0},
        reason (≤ 12 words), plus analyticalCommentary
    names → profiles (unknown names dropped); snap factors; utility per person (§14.7)
    if scored people != participants: drop this option ("scoring failed … excluded")
    group_utility = mean; keep per-agent utilities for every option
regret = compute_regret(option_scores, selected)   # selected must have been scored, else no row
insert evaluations row: scenario id/name, focal id/name, selected id/title + group utility,
       best id/title + group utility, regret, questions_asked, forced_decision,
       option_scores [{option_id, title, group_utility, per_agent[{player_id, name, hard_taboo_violated,
       total_individual_utility}]}], agent_scores for the SELECTED option [{player_id, name,
       hard_taboo_violated, violated_taboo?, reason?, dimension_factors, total_individual_utility}],
       commentary (per option, joined), at
feedback (unless a dry run): applyEvaluationOutcome with, per participant ≠ focal,
       delta = affinity_delta_from_utility(utility, violated) and reason:
       violated → "{focal} picked {title}, which they simply can't do"; ≥ 80 → "…which suited them
       well"; ≤ 35 → "…which didn't work for them"; else "{focal} picked {title}"
```
Mood and stress are deliberately **not** touched here (the scenario-outcome memory does that).

### 14.7 Scoring maths (`scoring.ts`) `[PORT]` — pure, unit-tested

```
WEIGHTS = {essentialNeeds 35, preferenceMatch 20, costTimeBurden 15, fairness 15,
           socialComfort 10, relationshipImpact 5}                  # sums to 100
snap(x) = 0 if not finite else round(clamp(x, 0, 1) * 4) / 4        # levels 0, .25, .5, .75, 1
individual_utility(f, violated) = 0 if violated else round2(Σ WEIGHTS[k] * snap(f[k]))   # missing k → 0
group_utility(us) = round2(mean(u if finite else 0)); empty → 0
DECISION_MARGIN_THRESHOLD = 10.0; SCORE_STABILITY_THRESHOLD = 3.0
check_stopping_criteria(estimates, history):
    ranked = finite estimates by score desc; none → blocked ['insufficient-options']
    top, runner_up = ranked[0], ranked[1]?
    'taboo'     if top.taboo_risk or top.risky_for_player_ids
    margin      = round2(top - runner_up) if runner_up;  'margin' if margin < 10   (exactly 10 passes;
                  a lone candidate has no margin to clear)
    previous    = history[-1]?; leader_changed = previous and previous.option_id != top.option_id
    drift       = round2(|top - previous.group_utility|) if previous and not leader_changed
    'stability' if drift is None or drift >= 3                          (exactly 3 blocks)
    can_decide  = no blockers
# consequence: the first focal turn is always blocked on stability → at least one question
affinity_delta_from_utility(u, violated) = -8 if violated; 0 if not finite;
                                           round(clamp((u - 55) / 9, -5, 5))
compute_regret(scores, selected) = None if selected not scored;
                                   best = max by group utility; regret = round2(max(0, best - selected))
```
Human-readable blockers: "no scored options yet", "possible hard constraint (N at risk)",
"margin X < 10.0", "front-runner changed", "no prior estimate yet", "drift X ≥ 3.0".

### 14.8 UI for the decision engine

- **Deliberation section** (scenario detail): focal name, "questions asked / 4", each option with
  its estimated score as a bar (green = chosen, red = at risk, amber = otherwise), a ✓ on the chosen
  one, "⚠ may break a hard limit for {names}", and a status line ("Committed" / "Committed (ran out of
  time to keep asking)" / "Waiting on {focal}'s first read of the options." / the current blockers).
  The panel recomputes the stopping criteria with the same pure function as the engine.
- **Scorecard modal** (auto-pops whenever a new evaluation appears since the page loaded; also
  opened from the analysis page): chosen option and group utility, regret against the best option,
  forced flag, and per resident a stacked bar whose segments are the six weighted contributions
  (Essential needs `#3987e5`, Preference match `#008300`, Cost & time `#d55181`, Fairness `#c98500`,
  Social comfort `#199e70`, Relationships `#d95926`) so length = utility; a violated hard taboo shows
  no bar and names the taboo; plus the evaluator's reason.
- **Decider viewer** (footer button): tabs **Framings** (each trace: reasoning, options with
  rationale and risk guess, and — once evaluated — each option's true group utility, the chosen one,
  regret and who had a hard limit violated; summary stats), **Beliefs** (per focal agent, per target:
  limits, likes, open questions, confidence bar, last updated), **Generated** (generated scenarios
  with reasoning and grounded-in facts, "played"/"draft").
- **Analysis page → Decisions**: the 25 latest evaluations with mean regret and how many were
  optimal (regret 0); each opens the scorecard.
- **Map cues**: 👑 + aura at the focal agent's feet while the deliberation is unresolved; a pulsing
  ❓ over whoever was just asked (20 s, until they speak); "💡 +N" over the focal agent for 6 s after
  new facts.

### 14.9 Dry run (`python -m city dry-run [--scenario dinner_decision]`)

Runs option generation, a scripted multi-round transcript, extraction + focal turns per round, and the
evaluation against the **real cast and real ground truth** of the default world, entirely outside
the engine: no locks, no inputs, no affinity feedback. The script makes the interesting case
certain: Rahman only mentions halal in round 2 (round 1: Cedric, Xavier, Clara, Rahman discuss
where to eat; round 2: "Ah — one thing, I only eat halal. No pork, and no alcohol for me."; round 3:
budget and liveliness; …). Expected: round 1 blocked on stability, round 2 flags a taboo risk, free to
commit by round 3. ~11 LLM calls. Use it as an end-to-end test of §14.

### 14.10 Open items to carry over (user decisions, not bugs to fix silently)

1. The three `[ADDED]` ground-truth constraints (§5.5) await the user's review.
2. The extraction prompt says "an unstated constraint is exactly what is being tested for" —
   experimental framing inside an agent-facing prompt. The evaluation program's neutrality lint
   flags it. It was left unchanged deliberately because changing it changes behaviour. Port it
   verbatim and keep it flagged.
3. Every theory dimension in the evaluator registry carries `citation: 'TODO'` (§20).

---

## 15. Interview mode

Source: `convex/interview.ts`, `src/components/InterviewPopup.tsx`.

Ask a character questions **without touching the simulation**: no input is sent, nothing is
scheduled, moved or interrupted; no message, memory, conversation, affinity or gauge is written; only
the usual `llm_calls` row. The transcript lives in the browser and is sent back with each question.

- Context (one read-only query): name; effective identity; profile split into background/fixed
  facts; learned traits; workplace line ("You work at {place} — {activity}."); current game time;
  place (`[ADAPT]` `describe_place`); current plan step; live activity; sickness; short-term
  self-description; the people they know with relation and affinity label (family first, then every
  stored affinity); and the **12 newest memories read straight from the table** — not through
  retrieval, because retrieval touches `last_access` and would reorder what they recall next.
- Prompt Appendix A.18 as the system message; then the last 12 transcript lines (interviewer →
  `user`, character → `assistant`); then the question. 400 tokens. Strip a leading "{Name}:" from
  the answer. Only agents can be interviewed.
- UI: a 🎤 "interview" button in the inspector and the agents panel; a popup with suggested openers
  ("Tell me about yourself.", "How has your week been?", "Who around here do you trust most, and
  why?", "What would you change about your life if you could?"), the running transcript and an input
  box; closes (and forgets) when the selection changes.

---

## 16. User interface

AI City is a single-page app (React 18, Tailwind, PixiJS; routes `/`, `/analysis`, `/usage` with a
hash router). In agent-society it becomes **new pages in the Studio app** (`ui/web`, React 19,
TanStack Query, Leaflet). Visual style can follow the Studio; behaviour must follow this section.

### 16.1 Navigation
- **City** (main view: map + inspector + overlays), **Agents** (control panel), **Decider**
  (viewer), **Chat history**, **Analysis**, **Usage**, plus the human **Interact** toggle
  (join/leave as "Me") and **Help** (spectating: drag/zoom, click a character to read their chat;
  interacting: join, click an agent → Start conversation, accept invites, leave; max 8 humans; idle
  humans removed after 5 minutes).
- Data refresh: world snapshot every ~1 s (players incl. trips, agents' public fields,
  conversations, active scenarios, world clock fields, engine `current_time`); descriptions and
  locations rarely; everything else on demand.

### 16.2 City map `[ADAPT]` (replaces the PIXI canvas)
- Leaflet with OSM tiles; faint land-use polygons from `preview.json`; named-location pins with
  labels; homes optional.
- Residents as **faces** (crop of each sprite's down-facing frame: `ai_city_faces.json` +
  `ai_city_folk.png`); grouping of overlapping faces into numbered bubbles that zoom in or fan out on
  click (copy `peopleLayer` from agent-society's `maps.js`); status ring idle/moving; names when few.
- Movement: animate each trip along its route between `depart_at` and `arrive_at`
  (`requestAnimationFrame`, ~25 redraws/s), with an optional trail; idle faces jitter slightly within
  their AOI so a workplace does not look frozen.
- Cues above a face (from `src/components/Player.tsx` + `Character.tsx`):
  - 💬 speaking: holds the typing lock in a face-to-face conversation;
  - 💭 thinking: has an operation in flight and is not composing;
  - the current activity's emoji while the activity is live;
  - 💗 / 💔 for 6 s after a net affinity change (`AFFINITY_INDICATOR_MS`);
  - 💢 while participating in a conversation and either arguing a scenario conflict or facing
    someone they feel hostile toward (< 25);
  - 👑 + aura on the focal agent of an unresolved deliberation; pulsing ❓ over the person just asked
    (20 s, until they speak); "💡 +N" over the focal agent for 6 s after new facts;
  - 📱 while in a group text, animated typing dots while composing a text;
  - highlight on the human player's own face; `[OPTIONAL]` 😴 asleep, 🤒 sick.
- Scenario markers for local scenarios (§13.12). Click a face → inspector (and, if they are
  mid-conversation, open the conversation popup). Human player: click the map → move to the nearest
  reachable building.
- Overlays: game clock (Day N, h:mm AM, day/night icon) top-left; time controls bottom-left
  (⏸ Pause / ▶ Resume, ☀️ Day = skip to next 06:00, 🌙 Night = skip to next 18:00, ⏩ +1h) — only when
  allowed; scenarios panel and countdown top-right; `[OPTIONAL]` night tint.
- A new evaluation since page load pops the scorecard modal (§14.8).

### 16.3 Inspector (right column; one resident)
Header with name and close. Buttons: **scenario creator**, **read conversation** (live, marked
"live") or **read last conversation**, **interview**. For a human: Start conversation / Waiting for
accept… / Walking over… / Leave conversation / Accept / Reject. Then:
- current activity (emoji + description) with a progress bar for timed tasks;
- description (identity text), "Works at {place} — {activity}.", "Conversing with you!";
- **Relationships**: family ties first (even untouched), then everyone with a stored affinity: emoji,
  name · relation, ↗/↘ trend (net of the last 3 events), label (value), coloured bar, and the two
  latest relationship events with reason, delta and "how long ago";
- **Wellbeing** (+ "🤒 unwell"): mood, stress, fatigue, hunger, money stress bars (`gauge_color`:
  severity ≥ 75 red `#f87171`, ≥ 50 orange `#fb923c`, ≥ 25 yellow `#fcd34d`, else green `#4ade80`;
  mood inverted), savings, "Learned about self" list;
- **Today's schedule · Day N**: every step with time, emoji, description; current step highlighted,
  past steps struck through.
- Conversation popup (non-modal, wide; Esc/close only): transcript with author faces, scenario task
  and goal markers (§8.9), a message box when the human is in it.

### 16.4 Agents panel (operator control)
Full-screen roster of every agent: face, name, where they are (nearest named place), pinned badge,
in-scenario badge. Selecting one shows: editable mood/stress/fatigue/hunger sliders, savings, health
toggle (Save → `agentSetState`; Reset discards the draft); **Move here** (pick a named location →
`agentSetLocation`, held until the next game day) and **Release** (`agentReleaseLocation`); identity
drift ("Who they are now (day N)" self-summary vs the authored identity); workplace; learned traits;
memories (60 newest) grouped as Insights (reflection), Conversations, Takeaways (scenarioOutcome),
Noticed (observation), People (relationship) with relative times; **Interview**.

### 16.5 Scenario creator, scenario detail, decider viewer, scorecard
§13.12 and §14.8.

### 16.6 Analysis page
- **Relationship graph** from `participated_together` + live affinities + family: nodes in a ring
  (sprite face, ring colour = the agent's average outgoing affinity), an edge per pair who ever talked
  (thickness = number of distinct conversations, colour = mutual average affinity using the affinity
  palette, dashed = family). Hover a node: each relationship with "how they feel" and "how the other
  feels back" badges.
- Side lists: most active agents (top 8 by conversations, with average warmth), closest bonds,
  tensions (the lowest-affinity pairs), top pairings (by conversation count).
- **Decisions**: §14.8.

### 16.7 Usage page (LLM accounting)
Time windows 15m / 1h / 6h / 24h / 7d / All (refreshed on a slow clock so the subscription isn't
rebuilt every render); filter by operation and kind; headline totals (calls, failures, prompt /
completion / total tokens, latency, estimated calls, retries); breakdowns by operation, model, agent
(subject) and kind; a bucketed time series; the individual calls (newest first, capped at 500;
"~" marks estimated token counts); Clear (delete the log). Reads cap at 10,000 rows and say
"truncated" rather than failing.

### 16.8 Chat history viewer
Every archived conversation, newest first: participants (faces and names), message count, times,
text-thread marker; open a transcript. Exports of **all** conversations: Markdown (readable), JSON
(the chat-history export format, §20.1), CSV (one row per message).

---

## 17. LLM layer and usage accounting

Source: `convex/util/llm.ts`, `convex/util/llmTrack.ts`, `convex/util/llmJson.ts`,
`convex/llmUsage.ts`, `convex/agent/embeddingsCache.ts`.

### 17.1 Provider `[ADAPT]`
- Chat: OpenAI-compatible `POST {base}/chat/completions`. Default to the Studio's `.env`
  (`AGENTSOCIETY_LLM_API_BASE`, `AGENTSOCIETY_LLM_API_KEY`, `AGENTSOCIETY_LLM_MODEL`) with optional
  `CITY_LLM_*` overrides. (Note agentsociety2 sends `openai/<MODEL>` through litellm; the City calls
  the endpoint directly with the plain model id.)
- Embeddings: `POST {embedding_base}/embeddings` with `CITY_EMBEDDING_MODEL` (+ optional
  `CITY_EMBEDDING_API_BASE/KEY`, defaulting to the chat ones). Send
  `{model, input: [text with newlines replaced by spaces]}`. Only send `dimensions` to OpenAI proper
  — OpenRouter-proxied models reject it, and OpenRouter returns such rejections as **HTTP 200 with an
  `{error}` body**: treat a missing `data` array as a (non-retryable) error rather than crashing.
- AI City also supported Azure OpenAI (`api-key` header, `/openai/deployments/{model}/…?api-version=`),
  Together and Ollama (native `/api/embeddings`, auto-pull on 404). `[OPTIONAL]`.
- Retries: on HTTP 429 or ≥ 500 only, backoff 1 s, 10 s, 20 s (+ ≤ 100 ms jitter), 4 attempts.
  Record `retries` and `ms` of the successful attempt.
- `response_format: {"type": "json_object"}` for the JSON calls (planner, decomposition, reacting,
  Decider options, extraction, focal, evaluator, scenario generation). Stop sequences per call (§8.5),
  max 4.

### 17.2 Structured output `[PORT]`
`parse_llm_json(content, schema, context)`: take the body inside a ```json fence if present, slice
from the first `{` to the last `}`, `json.loads`, validate with a pydantic model (replacing zod;
defaults allowed). **Never raises; returns None** on any failure and logs the context, the failing
paths and the first 400 characters. Every caller has a defined behaviour for None (fallback options,
unchanged beliefs, plain message, skipped evaluation, …). The older tolerant parsers (moderator
JSON/name, tasks, `Affinity:`/`Feelings:` lines, schedules) follow the same contract.

### 17.3 Usage log `[PORT]`
One `llm_calls` row per provider call (successful or failed), written best-effort (a failed insert is
logged and swallowed — it must never break an agent):
```
at, kind ('chat'|'embedding'), operation (dotted label), model, provider,
prompt_tokens, completion_tokens, total_tokens, estimated (no usage block → chars/4 estimate),
ms, retries, ok, error (≤ 500 chars), world_id, subject (agent name or scenario)
```
Operation labels in use: `conversation.start|continue|leave|summarizeGoal|nextSpeaker`,
`memory.rememberConversation|importance|reflect|rememberScenario`,
`agent.planDay|decomposeStep|react|selfSummary|scenarioProfile`, `scenario.planTasks|generate`,
`decider.generateOptions|extractMemories`, `focal.decision`, `evaluator.scoreOption`,
`interview.ask`, `embeddings.cacheMiss`. Only embedding cache **misses** are recorded.
Summary query: window `[since, until]` by `at`, newest first, scan ≤ 10,000 (+1 to detect
truncation), optional operation/kind filter, totals, per-key buckets sorted by tokens then calls,
and a time series of N buckets.

### 17.4 Cost awareness
Every conversation message is one completion plus (for start/continue) a moderator call (skipped on
the 1:1 fast path), embedding lookups (usually cache hits) and two or three vector searches; every
finished conversation costs a summary, an importance rating and an embedding *per participant*; every
remembered conversation can trigger a re-plan. Scenario profile extraction runs once per scenario per
participant. Measure with the usage page; keep the world-lifecycle controls (§3.6).

---

## 18. SQLite schema

`[NEW]`. One file per installation (`city.db`, WAL), worlds distinguished by `world_id`. JSON in
TEXT columns (SQLite JSON1 is available). Engine-owned tables are written only by the engine;
operation-written logs are append-only. Migrations via `PRAGMA user_version`.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ---------------------------------------------------------------- worlds and the engine
CREATE TABLE worlds (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  map_id        TEXT NOT NULL,                 -- agent-society map folder, e.g. 'singapore_island'
  is_default    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('running','inactive','stoppedByDeveloper')),
  last_viewed   INTEGER NOT NULL,              -- epoch ms
  created_at    INTEGER NOT NULL
);
CREATE TABLE engines (
  world_id               INTEGER PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  running                INTEGER NOT NULL,
  current_time           INTEGER,              -- engine ms of the last simulated tick
  last_step_ts           INTEGER,
  processed_input_number INTEGER NOT NULL DEFAULT -1,
  lease_owner            TEXT,                 -- 'pid@host'
  lease_expires          INTEGER,
  pid                    INTEGER
);
CREATE TABLE world_state (                     -- scalar + nested world fields (§3.1)
  world_id          INTEGER PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  next_id           INTEGER NOT NULL,
  world_start_time  INTEGER,
  data              TEXT NOT NULL              -- JSON: scenario_*, active_scenarios, cooldowns, timers
);
CREATE TABLE inputs (
  world_id     INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  number       INTEGER NOT NULL,
  name         TEXT NOT NULL,
  args         TEXT NOT NULL,                  -- JSON
  received     INTEGER NOT NULL,
  return_kind  TEXT CHECK (return_kind IN ('ok','error')),   -- NULL while pending
  return_value TEXT,                           -- JSON value or error message
  PRIMARY KEY (world_id, number)
);

-- ---------------------------------------------------------------- map binding
CREATE TABLE locations (                       -- the nine named places, bound to AOIs (§4.2)
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, kind TEXT NOT NULL,
  aoi_id INTEGER NOT NULL, poi_id INTEGER, lng REAL NOT NULL, lat REAL NOT NULL,
  radius_m REAL NOT NULL, marker_lng REAL, marker_lat REAL,
  PRIMARY KEY (world_id, id)
);
CREATE TABLE character_places (                -- homes and workplaces by NAME (§4.3)
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  home_location_id TEXT NOT NULL, home_aoi_id INTEGER NOT NULL, home_lng REAL, home_lat REAL, home_label TEXT,
  work_location_id TEXT, work_aoi_id INTEGER, work_activity TEXT,
  commute_minutes INTEGER,
  PRIMARY KEY (world_id, name)
);

-- ---------------------------------------------------------------- live entities (engine-owned)
CREATE TABLE players (
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  id TEXT NOT NULL,                            -- 'p:12'
  name TEXT, human TEXT, last_input INTEGER NOT NULL,
  position TEXT NOT NULL,                      -- JSON Position (§4.4)
  trip TEXT,                                   -- JSON Trip or NULL
  activity TEXT,                               -- JSON Activity or NULL
  PRIMARY KEY (world_id, id)
);
CREATE TABLE agents (
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  id TEXT NOT NULL, player_id TEXT NOT NULL,
  state TEXT NOT NULL,                         -- JSON of every Agent field in §3.1
  PRIMARY KEY (world_id, id)
);
CREATE TABLE conversations (
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  id TEXT NOT NULL, data TEXT NOT NULL,        -- JSON Conversation (§3.1)
  PRIMARY KEY (world_id, id)
);
CREATE TABLE player_descriptions (
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, character TEXT NOT NULL,
  PRIMARY KEY (world_id, player_id)
);
CREATE INDEX player_descriptions_name ON player_descriptions(world_id, name);
CREATE TABLE agent_descriptions (
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL, identity TEXT NOT NULL,
  profile TEXT, family TEXT,                   -- JSON
  self_summary TEXT, self_summary_day INTEGER,
  PRIMARY KEY (world_id, agent_id)
);

-- ---------------------------------------------------------------- history
CREATE TABLE archived_players (world_id INTEGER NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, archived_at INTEGER NOT NULL);
CREATE TABLE archived_agents  (world_id INTEGER NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, archived_at INTEGER NOT NULL);
CREATE TABLE archived_conversations (
  world_id INTEGER NOT NULL, id TEXT NOT NULL, creator TEXT NOT NULL,
  created INTEGER NOT NULL, ended INTEGER NOT NULL,
  last_message TEXT, num_messages INTEGER NOT NULL,
  participants TEXT NOT NULL,                  -- JSON list of player ids (everyone who ever took part)
  is_text INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, id)
);
CREATE INDEX archived_conversations_ended ON archived_conversations(world_id, ended);
CREATE TABLE participated_together (
  world_id INTEGER NOT NULL, conversation_id TEXT NOT NULL,
  player1 TEXT NOT NULL, player2 TEXT NOT NULL, ended INTEGER NOT NULL
);
CREATE INDEX pt_edge    ON participated_together(world_id, player1, player2, ended);
CREATE INDEX pt_conv    ON participated_together(world_id, player1, conversation_id);
CREATE INDEX pt_history ON participated_together(world_id, player1, ended);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL, conversation_id TEXT NOT NULL, message_uuid TEXT NOT NULL,
  author TEXT NOT NULL, text TEXT NOT NULL, scenario_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX messages_conv     ON messages(world_id, conversation_id, created_at);
CREATE INDEX messages_scenario ON messages(world_id, scenario_id, created_at);
CREATE TABLE scenario_history (                -- [NEW] durable record of every instance
  world_id INTEGER NOT NULL, scenario_id TEXT NOT NULL, def_id TEXT NOT NULL,
  data TEXT NOT NULL,                          -- JSON of the final ActiveScenario
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, scenario_id)
);

-- ---------------------------------------------------------------- memory
CREATE TABLE memories (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL, player_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('conversation','reflection','observation','scenarioOutcome','relationship')),
  description TEXT NOT NULL, importance REAL NOT NULL, last_access INTEGER NOT NULL,
  data TEXT NOT NULL,                          -- JSON, type-specific (§9.1)
  embedding BLOB NOT NULL, embedding_dim INTEGER NOT NULL, embedding_model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX memories_player      ON memories(world_id, player_id, created_at);
CREATE INDEX memories_player_type ON memories(world_id, player_id, type, created_at);
CREATE TABLE embeddings_cache (
  text_hash BLOB NOT NULL, model TEXT NOT NULL,
  embedding BLOB NOT NULL, dim INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (text_hash, model)
);
CREATE TABLE observations (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL, player_id TEXT NOT NULL, at INTEGER NOT NULL,
  description TEXT NOT NULL, importance INTEGER NOT NULL,
  subject_player_ids TEXT, location_id TEXT,
  processed INTEGER NOT NULL DEFAULT 0, promoted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX observations_player      ON observations(world_id, player_id, at);
CREATE INDEX observations_unprocessed ON observations(world_id, player_id, processed, at);

-- ---------------------------------------------------------------- event logs
CREATE TABLE relationship_events (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('affinityShift','inviteDeclined','groupExit','decisionOutcome')),
  actor TEXT NOT NULL, target TEXT, delta INTEGER, affinity_after INTEGER, reason TEXT,
  conversation_id TEXT, scenario_id TEXT, scenario_name TEXT
);
CREATE INDEX relationship_events_world ON relationship_events(world_id, at);
CREATE INDEX relationship_events_actor ON relationship_events(world_id, actor, at);
CREATE TABLE short_term_events (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, at INTEGER NOT NULL, player_id TEXT NOT NULL,
  component TEXT NOT NULL, delta INTEGER NOT NULL, value_before INTEGER NOT NULL, value_after INTEGER NOT NULL,
  cause TEXT NOT NULL CHECK (cause IN ('activity','meal','rest','sleepPressure','sickness','dailyDecay',
                                       'conversationFeelings','scenarioOutcome','manualOverride')),
  reason TEXT, conversation_id TEXT, scenario_id TEXT, goal_met INTEGER
);
CREATE INDEX short_term_events_world  ON short_term_events(world_id, at);
CREATE INDEX short_term_events_player ON short_term_events(world_id, player_id, at);

-- ---------------------------------------------------------------- decision engine
CREATE TABLE ground_truth_profiles (            -- ONLY evaluator.py and export.py may read this
  world_id INTEGER NOT NULL, player_id TEXT NOT NULL, name TEXT NOT NULL,
  cultural_background TEXT NOT NULL, religion TEXT NOT NULL,
  hard_taboos TEXT NOT NULL, essential_needs TEXT NOT NULL, preferences TEXT NOT NULL,   -- JSON lists
  budget_limit INTEGER NOT NULL, communication_style TEXT NOT NULL, added TEXT,  -- JSON list: items marked [ADDED]
  PRIMARY KEY (world_id, player_id)
);
CREATE INDEX ground_truth_name ON ground_truth_profiles(world_id, name);
CREATE TABLE perceived_knowledge (
  world_id INTEGER NOT NULL, focal_player_id TEXT NOT NULL, target_player_id TEXT NOT NULL,
  known_taboos TEXT NOT NULL, known_preferences TEXT NOT NULL, uncertainties TEXT NOT NULL,   -- JSON lists
  confidence_score REAL NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, focal_player_id, target_player_id)
);
CREATE TABLE decider_traces (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, scenario_id TEXT NOT NULL,
  scenario_name TEXT NOT NULL, participant_names TEXT NOT NULL, reasoning TEXT NOT NULL,
  options TEXT NOT NULL,                       -- JSON [{option_id,title,details,rationale,risk_note}]
  at INTEGER NOT NULL,
  UNIQUE (world_id, scenario_id)
);
CREATE TABLE generated_scenarios (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, def_id TEXT NOT NULL,
  draft TEXT NOT NULL,                         -- JSON of every ScenarioDef field + reasoning + grounded_in
  created_by TEXT NOT NULL CHECK (created_by IN ('auto','manual')),
  used_at INTEGER, at INTEGER NOT NULL,
  UNIQUE (world_id, def_id)
);
CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, scenario_id TEXT NOT NULL, scenario_name TEXT NOT NULL,
  focal_player_id TEXT NOT NULL, focal_name TEXT NOT NULL,
  selected_option_id TEXT NOT NULL, selected_option_title TEXT NOT NULL, aggregated_group_utility REAL NOT NULL,
  best_option_id TEXT NOT NULL, best_option_title TEXT NOT NULL, best_group_utility REAL NOT NULL,
  regret REAL NOT NULL, questions_asked INTEGER NOT NULL, forced_decision INTEGER NOT NULL,
  option_scores TEXT NOT NULL, agent_scores TEXT NOT NULL, commentary TEXT NOT NULL,   -- JSON, JSON, text
  at INTEGER NOT NULL
);
CREATE INDEX evaluations_world    ON evaluations(world_id, at);
CREATE INDEX evaluations_scenario ON evaluations(world_id, scenario_id);

-- ---------------------------------------------------------------- accounting
CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat','embedding')), operation TEXT NOT NULL,
  model TEXT NOT NULL, provider TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
  estimated INTEGER NOT NULL, ms INTEGER NOT NULL, retries INTEGER NOT NULL, ok INTEGER NOT NULL,
  error TEXT, world_id INTEGER, subject TEXT
);
CREATE INDEX llm_calls_at        ON llm_calls(at);
CREATE INDEX llm_calls_operation ON llm_calls(operation, at);
```
Notes:
- Persisting the agents as one JSON document each keeps the code close to AI City's serialised
  objects; add generated columns or views if the UI needs to filter on a field.
- Write only changed rows each step. With 50 agents a full rewrite would still be cheap in SQLite,
  but dirty tracking keeps the WAL small.
- `wipe` deletes every world-scoped row except `embeddings_cache`.
- Keep message timestamps in engine ms so prompts can format them with `format_game_timestamp`.

---

## 19. HTTP API

`[NEW]` FastAPI routes on the Studio server under `/api/city`. Reads use a read-only connection; the
only writes are inserting inputs and the lifecycle calls. Shapes mirror the Convex queries the old UI
used, so the old components are a guide.

| Method & path | Returns / does | Old Convex function |
|---|---|---|
| `GET /worlds` | worlds with status; default world id | `world.defaultWorldStatus` |
| `GET /worlds/{w}/state` | world_state, players (with trips), agents (public fields), conversations, engine time, server time | `world.worldState` |
| `GET /worlds/{w}/descriptions` | player/agent descriptions, locations, map meta (bbox, map id) | `world.gameDescriptions` |
| `GET /worlds/{w}/map/preview` | `preview.json` of the world's map | — |
| `POST /worlds/{w}/inputs` `{name, args}` | inserts an input; returns its number | `aiTown.main.sendInput`, `world.sendWorldInput` |
| `GET /worlds/{w}/inputs/{n}` | `null` while pending, else `{kind, value \| message}` | `aiTown.main.inputStatus` |
| `POST /worlds/{w}/heartbeat`, `/release` | lifecycle (§3.6) | `world.heartbeatWorld`, `world.releaseWorld` |
| `POST /worlds/{w}/stop`, `/resume`, `/skip {ms}`; `GET /stop-allowed` | pause/resume/skip | `testing.stop/resume/skipTime/stopAllowed` |
| `POST /worlds/{w}/join`, `/leave` | human player | `world.joinWorld/leaveWorld` |
| `POST /worlds/{w}/messages` `{conversation_id, message_uuid, player_id, text}` | human message + `finishSendingMessage` input | `messages.writeMessage` |
| `GET /worlds/{w}/conversations/{c}/messages` | messages with author name and sprite | `messages.listMessages` |
| `GET /worlds/{w}/players/{p}/previous-conversation` | last archived conversation with ≥ 1 message | `world.previousConversation` |
| `GET /worlds/{w}/conversations` | archived list with participant names/sprites | `messages.listAllConversations` |
| `GET /worlds/{w}/conversations/export?format=json\|md\|csv` | all conversations with messages | `messages.exportAllConversations` |
| `GET /worlds/{w}/graph` | nodes/links for the analysis graph | `messages.conversationGraph` |
| `GET /worlds/{w}/relationship-events?player={p}` | newest 30 (world) / 50 (actor) | `world.recentRelationshipEvents`, `relationshipEventsForPlayer` |
| `GET /worlds/{w}/players/{p}/memories` | 60 newest, embeddings omitted | `world.memoriesForPlayer` |
| `GET /worlds/{w}/evaluations?scenario=…&limit=` | one / newest N (≤ 100) | `world.evaluationForScenario`, `recentEvaluations` |
| `GET /worlds/{w}/decider/traces`, `/beliefs`, `/generated` | Decider viewer tabs | `decider.recentDeciderTraces`, `deciderBeliefs`, `scenarioGen.recentGeneratedScenarios` |
| `POST /worlds/{w}/scenario-drafts` | Decider-generated draft (manual) | `scenarioGen.draftScenario` |
| `POST /worlds/{w}/interview` `{player_id, question, history}` | `{answer}` | `interview.ask` |
| `GET /usage/summary`, `GET /usage/calls`, `DELETE /usage` | usage page | `llmUsage.summary/calls/clear` |
| `GET /worlds/{w}/export/bundle?limit&since` | evaluation bundle (local only; contains ground truth) | `evaluationExport.bundle` |

Scenario controls, operator controls and conversation actions are all inputs (§3.4). The bundle
endpoint exposes the answer key: serve it only on `127.0.0.1` (the Studio already binds there) and
never call it from agent-facing code.

---

## 20. Exports and the offline evaluation program

Source: `convex/messages.ts exportAllConversations`, `convex/evaluationExport.ts`,
`evaluation/README.md`, `evaluation/src/**`.

### 20.1 Chat-history export (public)
```
[ { id, created: ISO, ended: ISO, participants: [{id, name}], numMessages,
    messages: [{author: name, text, timestamp: ISO, scenarioId?}] } ]      # newest first
```

### 20.2 Evaluation bundle (admin only — contains the answer key)
```
{ kind: "ai-town-evaluation-bundle",
  world: {worldId, exportedAt},
  players: [{playerId, name, character}],
  groundTruth: [{playerId, name, culturalBackground, religion, hardTaboos, essentialNeeds,
                 preferences, budgetLimit, communicationStyle}],
  conversations: [ …chat-history shape…, scenarioIds: [distinct message scenario ids] ],
  decisions: [ evaluation fields (scenarioId, scenarioName, focalPlayerId, focalName,
               selectedOptionId/Title, aggregatedGroupUtility, bestOptionId/Title, bestGroupUtility,
               regret, questionsAsked, forcedDecision, optionScores[{optionId,title,groupUtility}],
               agentScores[{playerId,name,hardTabooViolated,violatedTaboo?,reason?,totalIndividualUtility}], at),
               options: the full menu from decider_traces [{optionId,title,details,rationale,riskNote}],
               perOptionUtilities: [{optionId, utilities: [{name, utility}]}] ],
  perceivedKnowledge: [{focalPlayerId, targetPlayerId, knownTaboos, knownPreferences,
                        uncertainties, confidenceScore, updatedAt}],
  shortTermEvents: [{at, playerId, name?, component, delta, valueBefore, valueAfter, cause,
                     reason?, conversationId?, scenarioId?, goalMet?}] }
```
Default caps: 200 most recent conversations and decisions; 5,000 events (or `limit × 50`); optional
`since`. Keys are camelCase because the evaluation program validates exactly this shape
(`evaluation/src/corpus/schema.ts`). `python -m city export-bundle [--limit N] [--since ms] > bundle.json`.

### 20.3 The fidelity evaluator `[PORT as-is]`
`ai-town/evaluation/` is a standalone Node/TypeScript program (`node evaluation/run.mjs …`) that never
writes to a world. Keep using it unchanged by feeding it the bundle above:
`node evaluation/run.mjs analyze --input bundle.json` (its `--from-convex` flag will no longer
work). It uses its own LLM credentials (`.env.keys` in ai-town) and caches every judgement.
`[OPTIONAL]` port it to Python later; the README documents every metric.

What it measures (no composite score, every rate with its denominator and a Wilson interval):
| Component | Metric | Source |
|---|---|---|
| 1 Persona fidelity | PCR, HCCR (target 0) | transcripts × profiles: opportunities found by one judge, graded by another |
| 2 Theory-anchored plausibility | DCR (and how many groups actually separate) | `probe` mode: standard situations put to characters grouped by an attribute (conflict style, payment norm, privacy, alcohol, social power, directness, observance) |
| 3 Population diversity | option coverage, within-group diversity | choice probes / decisions with full menus |
| 4 Disclosure | relevant disclosure (higher), premature disclosure (lower) | transcripts × hard constraints (conditional constraints only "live" when the transcript establishes the occasion) |
| 5 Dynamic state | state-transition accuracy, unexpected reset rate (target 0) | `shortTermEvents` vs the rules in §12.7 |
| Aggregation | utilitarian vs max-min vs average-without-misery vs Nash winners and regret | `perOptionUtilities` |

Open items recorded by the user's earlier sessions: all theory dimensions have `citation: 'TODO'`;
DCR suffered a ceiling effect (conflict-avoidance probes drew objections from nearly everyone);
a 50-agent run gave DCR 7/7 but only 1/7 separating groups, HCCR 6/13, relevant disclosure 3/19 on 20
conversations, STA 799/799.

---

## 21. Constants reference

Values from `convex/constants.ts` and the modules named. **Bold** = changed or new for the
Singapore build. "unused" = defined in AI City but not referenced (keep only if you want parity of
the file).

**Engine, lifecycle, time**
| Constant | Value | Notes |
|---|---|---|
| tick duration / step | 16 ms / 1000 ms (hard-coded in `Game`) | **`TICK_MS` 250 ms**, `STEP_INTERVAL_MS` 1000 |
| max ticks / inputs per step | 600 / 32 | **inputs 64** is fine |
| `ENGINE_ACTION_DURATION` | 30 s | Convex-specific; drop |
| `ACTION_TIMEOUT` | 120 s | operation lock timeout |
| `IDLE_WORLD_TIMEOUT` | 2 min | stop unwatched worlds (also the check period) |
| `WORLD_HEARTBEAT_INTERVAL` / `WORLD_RELEASE_DELAY` | 60 s / 10 s | |
| dead-engine restart | not stepped for 60 s (2 × action duration) | check every 60 s |
| `VACUUM_MAX_AGE` / `DELETE_BATCH_SIZE` | 14 days / 64 | |
| `OBSERVATION_MAX_AGE_MS` | 12 × 19 min | vacuum every 15 min |
| `HUMAN_IDLE_TOO_LONG` / `MAX_HUMAN_PLAYERS` / `DEFAULT_NAME` | 5 min / 8 / 'Me' | |
| `AWAKE_MS` / `DEEP_NIGHT_MS` / `CYCLE_MS` | 18 / 1 / 19 min | `gameTime.ts` |
| `MAX_STEP`, `INPUT_DELAY`, `AGENT_WAKEUP_THRESHOLD`, `TICK`, `STEP_INTERVAL` | — | unused |
| **`LLM_MAX_CONCURRENCY`** | **16** | new |

**Movement and space** (§4.6 for the translation)
| AI City | Value | Singapore build |
|---|---|---|
| `movementSpeed` | 1.25 tiles/s | **routed; walk 1.34 m/s** |
| `PATHFINDING_TIMEOUT` / `PATHFINDING_BACKOFF` | 60 s / ≤ 1 s | **trip timeout arrive_at + 30 s; retry backoff ≤ 1 s** |
| `MAX_PATHFINDS_PER_STEP` | 32 | **`MAX_ROUTES_PER_STEP` 32** |
| `COLLISION_THRESHOLD` | 0.75 tiles | **dropped** |
| `CONVERSATION_DISTANCE` / `GROUP_JOIN_DISTANCE` | 1.3 / 2.5 tiles | **same AOI or 40 m / 60 m** |
| `MIDPOINT_THRESHOLD` | 4 tiles | **dropped** (invitee goes to the inviter) |
| `GROUP_JOIN_RADIUS` | 6 tiles | **300 m** |
| `SCHEDULE_CHAT_RADIUS` | 6 tiles | **`PERCEPTION_RADIUS_M` 150** |
| `WORK_LEASH_RADIUS` | 8 tiles | **300 m** |
| `ARRIVAL_RADIUS` / `SCENARIO_ARRIVAL_RADIUS` | 1.5 / 3 tiles | **50 m / 80 m (or same AOI)** |
| `STEP_WANDER_RADIUS` / `STEP_SETTLED_RADIUS` / `STEP_WANDER_INTERVAL_MS` | 4 / 5 tiles / 12 s | **settled = at the step's AOI or within the location radius; wander client-side** |
| `SCENARIO_PROXIMITY_FALLOFF_TILES` | 25 | **3000 m** |
| `COMMUTE_MINUTES` | 45 game min | **per character (§4.5)** |
| — | — | **`WALK_MAX_M` 1200, `INVITE_MAX_TRAVEL_MIN` 30, location radii 150/400/500/1200 m, `HOMES_PER_AOI` hdb 4 / shophouses 2 / university 4** |

**Conversations**
| Constant | Value |
|---|---|
| `CONVERSATION_COOLDOWN` (after a conversation / after an invite attempt) | 15 s |
| `PLAYER_CONVERSATION_COOLDOWN` (same pair) | 60 s |
| `ACTIVITY_COOLDOWN` | 10 s |
| `INVITE_TIMEOUT` / `AWKWARD_CONVERSATION_TIMEOUT` / `TYPING_TIMEOUT` | 60 s / 60 s / 15 s |
| `MESSAGE_COOLDOWN` | 2 s |
| `MAX_CONVERSATION_PARTICIPANTS` / `SCENARIO_MAX_PARTICIPANTS` | 5 / 8 |
| `MAX_CONVERSATION_DURATION` / `MAX_CONVERSATION_MESSAGES` | 10 min / 8 (groups: 8 + 2 per extra person, ≤ `MAX_GROUP_CONVERSATION_MESSAGES` 16) |
| `GROUP_LEAVE_MIN_MESSAGES` / `GROUP_LEAVE_PROBABILITY` / `GROUP_LEAVE_AFFINITY_WEIGHT` | 6 / 0.35 / 0.6 |
| `SCENARIO_CONVO_MIN_MESSAGES` / `SCENARIO_CONVO_MAX_MESSAGES` / `SCENARIO_MAX_CONVO_DURATION` | 8 (+2 per extra person) / 24 / 15 min |
| `SCENARIO_GOAL_CHECK_MIN_MESSAGES` | 6 |
| `FATIGUE_MAX_CONVERSATION_MESSAGES` / `OBLIGATION_MAX_CONVERSATION_MESSAGES` | 2 / 4 |
| `INVITE_ACCEPT_MIN_PROBABILITY` / `INVITE_ACCEPT_MAX_PROBABILITY` | 0.30 / 0.97 (`INVITE_ACCEPT_PROBABILITY` 0.8 unused) |
| message max tokens | start 120, continue 300, leave 300, summary 200; moderator 10 / 60 |

**Schedules and routines**
| Constant | Value |
|---|---|
| plan cooldown / stagger window | 5 min real / 120 s |
| `SCHEDULE_DISRUPTION_MINUTES` | 60 game min |
| `CONTEXTUAL_EVENT_PROBABILITY` / `CONTEXTUAL_EVENT_MINUTES` | 0.4 / 20 game min |
| `SUBSTEP_MIN_BLOCK_MINUTES` / `SUBSTEP_MIN_MINUTES` / `MAX_SUBSTEPS_PER_BLOCK` | 90 / 15 / 5 |
| shift / lunch / service / Friday prayer | 09:00–18:00 / 12:00–13:00 / Sun 10:00–11:30 / Fri 12:30–14:00 |
| default bed / wake; wake routine | 22:30 / 06:30; 45 min |
| night shift / post-night sleep | 22:00–06:00 / 07:00–13:00 |

**Memory and cognition**
| Constant | Value |
|---|---|
| `NUM_MEMORIES_TO_SEARCH` / overfetch / `RELATIONSHIP_MEMORIES_TO_SEARCH` / `SCENARIO_RECALL_MEMORY_COUNT` | 3 / ×10 / 2 / 3 |
| `MEMORY_ACCESS_THROTTLE` / recency decay | 5 min / 0.99 per hour since last access |
| `EMBEDDING_DIMENSION` | 768 in AI City (provider-dependent) |
| `REFLECTION_IMPORTANCE_THRESHOLD` / `REFLECTION_MIN_MEMORIES` | 40 / 5 |
| `REFLECTION_CHECK_INTERVAL_MS` / `REFLECTION_MIN_INTERVAL_MS` / `REFLECTION_MIN_EVENTS` | 30 s / 4 min / 5 |
| `REFLECTION_OBSERVATION_CANDIDATES` / `REFLECTION_OBSERVATIONS` / `REFLECTION_OBSERVATION_WEIGHT_CAP` | 60 / 20 / 2 |
| `MAX_LEARNED_TRAITS` | 6 |
| `SELF_SUMMARY_ENABLED` / `_FIRST_DAY` / `_INTERVAL_DAYS` | true / 2 / 4 |
| `SELF_SUMMARY_REFLECTIONS` / `_MEMORY_CANDIDATES` / `_MEMORIES` | 6 / 40 / 8 |
| `SCENARIO_HISTORY_MESSAGE_COUNT` | 60 |
| `PLAYER_MEMORIES_LIMIT` | 60 |
| `INTERVIEW_MEMORY_COUNT` / `INTERVIEW_HISTORY_TURNS` | 12 / 12 |

**Perception and reacting**
| Constant | Value |
|---|---|
| `OBSERVATION_INTERVAL_MS` | 5 s |
| `OBSERVATION_EMBED_MIN_IMPORTANCE` / `REACTION_MIN_IMPORTANCE` | 3 / 3 |
| `MAX_OBSERVATIONS_PER_STEP` / `MAX_OBSERVED_SUBJECTS` | 32 / 32 |
| `AFFINITY_STANDOUT_DELTA` | 15 |
| `REACTION_INTERVAL_MS` / `MAX_REACTION_OBSERVATIONS` | 45 s / 8 |
| `REACTION_REPLAN_COOLDOWN_MS` / `MAX_REACT_REPLANS_PER_DAY` | 60 s / 2 |

**Relationships**
| Constant | Value |
|---|---|
| `MIN_AFFINITY` / `MAX_AFFINITY` / `DEFAULT_AFFINITY` / `FAMILY_BASE_AFFINITY` | 0 / 100 / 50 / 75 |
| `MAX_AFFINITY_CHANGE_PER_CONVERSATION` | 10 |
| `CANDIDATE_AFFINITY_WEIGHT` / `CANDIDATE_FATIGUE_DISTANCE_WEIGHT` | 2 / 0.03 (**per travel minute**) |
| `HOSTILE_AFFINITY_THRESHOLD` / `GROUP_EXIT_LOW_AFFINITY_THRESHOLD` | 25 / 40 |
| `REJECTED_INVITE_AFFINITY_PENALTY` | 2 |
| `AFFINITY_INDICATOR_MS` | 6 s |
| `RELATIONSHIP_EVENT_REASON_MAX_CHARS` / `RECENT_RELATIONSHIP_EVENTS_LIMIT` / `PLAYER_RELATIONSHIP_EVENTS_LIMIT` | 120 / 30 / 50 |
| `TENSIONS_FEED_MAX_CHIPS` / `TENSIONS_FEED_WINDOW_MS` | unused |

**Short-term, health, economy**
| Constant | Value |
|---|---|
| baselines mood / stress / fatigue / hunger | 60 / 15 / 10 / 10 |
| `SHORT_TERM_DAILY_DECAY` / `MAX_SHORT_TERM_CHANGE_PER_EVENT` | 25 / 20 |
| `FATIGUE_PER_WORK_BLOCK` / `AWAY_STEP_FATIGUE` / `HUNGER_PER_GAME_HOUR` | 12 / 8 / 7 |
| `SLEEP_PRESSURE_PEAK` / `_RAMP_MINUTES` / `_INTERVAL_MS` | 95 / 300 game min / 15 s |
| `FATIGUE_SOCIAL_CUTOFF` | 80 |
| `SICK_BASE_PROBABILITY` / `SICK_PER_WORKDAY_PROBABILITY` / `SICK_MAX_PROBABILITY` / `SICK_DURATION_DAYS` | 0.02 / 0.04 / 0.5 / 2 |
| `CONTAGION_PROBABILITY` | 0.0625 per conversation |
| `SICK_STRESS_PER_DAY` / `SICK_MOOD_PENALTY_PER_DAY` | 12 / 10 |
| `DEFAULT_BALANCE` / `DAILY_INCOME` / `DAILY_EXPENSES` / `MEAL_COST` | 400 / 150 / 75 / 8 |
| `FINANCIAL_COMFORT_THRESHOLD` | 300 |
| `ACTIVITY_COST_PRESSURE_WEIGHT` / `ACTIVITY_ENERGY_FATIGUE_WEIGHT` | 0.6 / 0.5 |
| `SHORT_TERM_INDICATOR_MS`, `DEFAULT_ACTIVITY_COST` | unused |

**Scenarios**
| Constant | Value |
|---|---|
| `SCENARIO_EVAL_INTERVAL` / `SCENARIO_FIRST_DELAY_MS` | 3 s / 30 s |
| `SCENARIO_INTERVAL_MIN_MS` / `_MAX_MS` / `SCENARIO_RETRY_MS` | 60 s / 120 s / 20 s |
| `SCENARIO_DEFAULT_DURATION_MS` / `SCENARIO_MANUAL_DURATION_MS` | 4 min / 10 min |
| `SCENARIO_COOLDOWN_MS` / `MAX_UNIVERSAL_SCENARIOS` | 3 min / 1 |
| `SCENARIO_PARTICIPANT_MAX` / `SCENARIO_CUSTOM_MIN_PARTICIPANTS` | 5 / 2 |
| bonuses family / workplace / neighbour / proximity; noise | 45 / 35 / 20 / 60; 55 |
| `SCENARIO_GATHER_BUFFER_MS` / `SCENARIO_GATHER_MAX_MS` | 8 s / 90 s |
| `SCENARIO_WAIT_MAX_MS` / `SCENARIO_READY_FRACTION` | 6 min / 2/3 |
| `SCENARIO_GENERATION_PROBABILITY` / `SCENARIO_GENERATION_TIMEOUT_MS` | 0.5 / 120 s |
| `SCENARIO_TASK_MIN/MAX/DEFAULT_DURATION_MS` / `SCENARIO_WORK_MAX_MS` / `SCENARIO_TASK_PLAN_TIMEOUT_MS` | 20 / 90 / 45 s / 6 min / 135 s |
| `SCENARIO_GATHER_TIMEOUT` | unused |

**Decision engine**
| Constant | Value |
|---|---|
| `MAX_DECISION_OPTIONS` / `MAX_FOCAL_QUESTIONS` / `FOCAL_DECIDE_MESSAGE_HEADROOM` | 4 / 4 / 4 |
| `FOCAL_FORCE_DECIDE_MS` / `FOCAL_REASSIGN_MS` | 90 s / 45 s |
| `DECISION_MARGIN_THRESHOLD` / `SCORE_STABILITY_THRESHOLD` | 10.0 / 3.0 |
| utility weights | 35 / 20 / 15 / 15 / 10 / 5 |
| `DECISION_OUTCOME_MAX_AFFINITY_DELTA` / `DECISION_TABOO_AFFINITY_PENALTY` / neutral utility | 5 / 8 / 55 |
| fact list cap / same-fact overlap | 8 / 0.7 |
| `MEMORY_GAIN_INDICATOR_MS` / `QUESTION_INDICATOR_MS` | 6 s / 20 s |

**LLM**
| Constant | Value |
|---|---|
| retry backoff / jitter / attempts | 1 s, 10 s, 20 s / ≤ 100 ms / 4 |
| usage scan cap / rows cap / default rows | 10,000 / 500 / 100 |

---

## 22. Invariants and acceptance tests

Port AI City's unit tests (`convex/*.test.ts`, `convex/util/*.test.ts`) to pytest; they encode most
invariants. Then add the map, storage and end-to-end checks.

**Data and roster** (`roster.test.ts`): 50 characters, the original 8 then 17 then 25; unique names;
sprites exist; everyone has a home; everyone but Bernard has a workplace; ground truth and activity
menus for all 50.

**Routines** (`sleep.test.ts`, `roster.test.ts`, `plans.test.ts`):
- Sleep blocks at each character's own hours from the profile; night owls stay in bed through the
  small hours; every sleep block is followed by a getting-up step.
- The night-shift roster is exactly Nurul (Tue, Wed), Dylan (Thu, Fri), Somchai (Wed, Sat), Hafiz
  (Tue, Fri); never Monday or Sunday nights. Nurul is on the ward at midnight while the town sleeps,
  sleeps 07:00–13:00 after, has no 09:00–18:00 block on a night-shift day, and is back to an
  ordinary night once the run ends.
- Walking the clock through midnight keeps the nurse on the ward past midnight and sends the night
  owl to bed after midnight.
- A commute never starts before the character is up; night-shift workers commute to the evening
  shift; weekends have no commutes; obligations are `fixed`, planned blocks are not; Bernard is free
  all day; Muslims are home for Friday prayer, Christians for Sunday service.
- Sleep pressure is flat through the day and peaks at bedtime; holds while asleep; is zero with no
  sleep ahead (night-shift worker clocking on); crosses the social cutoff before bedtime; a rested
  agent is sociable; the next bedtime is found in a merged schedule (tonight; wrapping past midnight
  for a night owl; the day sleep after a night shift).
- `pending_step`: walking to a started step → pending; settled → not; milling nearby → not; early →
  not; a pin or a scenario gathering suspends it; no schedule → none. Obligations may interrupt a
  conversation; planner-invented blocks may not. On a real merged day at 08:30 a worker still at home
  is due; once at her desk she is free.

**Perception** (`observation.test.ts`): salience rules (floor 1; family; relative affinity in both
directions; groups; out of place; stacking; clamp 1–6; absent affinity = neutral); `affinity_mean`;
fingerprint stability (including a JSON round trip), change detection, "no activity" ≠ an activity;
observation texts; `parse_sub_steps` (anchored first step, inside the block, spacing, ordering, cap,
malformed → []).

**Decision maths** (`scoring.test.ts`, `factMerge.test.ts`): every case listed in §14.7 including
"a margin exactly at 10 passes", "a drift exactly at 3 blocks", "a changed front-runner is unstable",
"compares against the most recent turn only", "reports every failing criterion at once", "a lone
candidate has no margin", "no scored options", "non-finite estimates ignored"; fact merge,
compound splitting, `count_new_facts`, `drop_resolved`.

**Engine** (new): inputs applied in number order with recorded return values; a write-back with a
stale `operation_id` is ignored; the lock times out after 120 s; restart resumes from SQLite with
nothing lost; a second engine refuses to start while the lease is valid; input numbering stays
monotonic after vacuuming; the clock functions at boundaries (06:00, 23:59, 00:00, 05:59) and
`real_ms_between_hours` across midnight.

**Map** (new): every named location binds to a reachable AOI; every resident has home and work AOIs;
a route home → work exists for every worker and its ETA is plausible (< 120 game minutes); trips
interpolate correctly and end idle at the destination; two agents at the same AOI promote a
conversation; an invitee travels to the inviter.

**End to end with a fake LLM** (new; make the LLM client injectable and keyed on the operation
label so tests are free and deterministic):
- Day-1 smoke from a 06:00 start: by 10:00 on a weekday most workers are at their workplace AOI; at
  03:00 everyone except tonight's night-shift roster is asleep at home; conversations happen and
  produce memories, affinity events and re-plans.
- Manual `dinner_decision`: waiting/gathering/active phases; options generated; the focal agent asks
  at least one question (first turn always blocked on stability); commits; an evaluation row with
  regret appears; `decisionOutcome` relationship events follow.
- A tasks scenario: planning chat → tasks → working phase with progress → goal met → retired early.
- Interview writes nothing but `llm_calls`.
- Lifecycle: release stops the engine; a heartbeat restarts an inactive world; a stopped world is
  not restarted by heartbeats.
- With a real LLM: the dry run (§14.9).

---

## 23. Pitfalls and lessons already paid for

Each of these cost a debugging session in AI City. Most are invisible from the feature code.

1. **Throttle by wall clock.** Agent logic runs every tick; anything per-tick and expensive (or
   random) must be rate-limited on real time (`last_*_at` fields), like the scenario manager (3 s),
   perception (5 s), sleep pressure (15 s), reflection checks (30 s), reactions (45 s).
2. **Prelude placement.** Hooks that must work while an agent is busy, talking or held go in the
   prelude **before** the operation guard. `tick_schedule` returns True on nearly every tick, so
   anything placed after it never runs.
3. **Persist throttles and dedupe on the agent** and keep them small (hashes, not prose). AI City's
   engine object was rebuilt from the database every 30 s; in-memory dedupe re-fired constantly.
4. **Lock-free ops stamp optimistically; locked ops always report back** (§3.5). A locked op that
   throws leaves the agent frozen for 120 s and can hold a conversation's typing lock.
5. **Validate `operation_id` on every write-back.** Timed-out operations come back late.
6. **A throttled re-plan must keep executing the old schedule** rather than fall into free roam;
   otherwise every conversation leaves the agent standing at a random spot for minutes.
7. **The day is a ring that starts at 06:00.** Rewind the step index when the clock wraps past
   midnight; the obligation merge treats the stretch before the first planned step as covered by the
   last one. A forward-only scan once left the whole town without a 00:00–06:00 block.
8. **Night runs ~6× faster than day.** Durations that cross midnight must use
   `real_ms_between_hours`; a flat rate left people "asleep in bed" well into the morning.
9. **Pre-dawn hold.** Before the first step of the day, walk to it (home) and wait — else agents
   freed early (e.g. by a scenario ending at 05:30) wander to random places.
10. **Going to bed doesn't cure tiredness; waking does.** And the sleep-pressure floor only ever
    pushes fatigue up.
11. **The plan comes first.** No new chats while on the way somewhere they are due (each chat costs
    a game-hour); fixed obligations end ordinary conversations after 4 messages; discretionary
    re-plans wait until they have arrived. Before this, the town arrived at work mid-morning.
12. **Scenario isolation.** Invites and joins are scenario-relative; manual starts must stop all
    conversations and clear in-flight ops, `to_remember`, activities, movement and the participants'
    cooldowns — otherwise participants stay frozen on orphaned ops or are pulled into unrelated chats.
    (Clearing `to_remember` also drops the memories of the interrupted chats; see §13.7.)
13. **Waiting phase.** Reserve the cast but withhold the directive and the walk order until the
    scenario really begins, or they re-plan around something that hasn't happened.
14. **Every deliberation must resolve** (forced valves, focal reassignment, evaluation on expiry
    flagged `forced`), or decision scenarios silently produce no data.
15. **Information barrier.** Only the Evaluator (and exports) read ground truth. The generator
    builds on what was said; the Decider guesses "who it won't suit" from public profiles.
16. **LLM judges, code computes.** Never ask a model for totals; snap factors to the rubric levels.
17. **Facts come back paraphrased.** Deduplicate by token overlap, count new facts directly,
    confidence is the latest value (a running max pinned it at 100% and stopped the questions).
18. **Reflection windows** advance only when a reflection happens; scenario takeaways are their own
    memory type; reflection is not triggered from conversation end (two triggers raced).
19. **Observations ≠ memories.** Separate table, per-step cap, fingerprint not advanced on a drop,
    salience relative to the observer, dedupe list ≥ the largest crowd one agent can see.
20. **Affinity saturates** (§11.5); avoid absolute thresholds, consider decay.
21. **Identity drift**: summaries every 4 days with anchors, `effective_identity` everywhere.
22. **Abandoned invites** have no messages: never remember or archive them; remembering must
    swallow errors.
23. **Group drift-off is rolled every tick.** In AI City `random() < p` is re-evaluated on every tick
    while the agent is the last speaker in an eligible group, so leaving is effectively certain right
    after their own message once a group has ≥ 6 messages — not the per-turn 35% the comment
    describes. Decide deliberately: reproduce it, or roll once per own message (record the message
    count you rolled for) and note the behaviour change.
24. **Remembering is deferred to the next conversation** in AI City (§6.7 timing caveat): the
    `to_remember` branch sits after `tick_schedule`, which claims nearly every tick once an agent
    has a schedule. Decide deliberately whether to reproduce that or move the check up (recommended).
25. **Input numbering** must stay monotonic past a vacuum.
26. **Embedding providers** may return HTTP 200 with an error body; only OpenAI accepts
    `dimensions`; stop sequences max 4.
27. **Worlds cost money while open.** Visibility-aware heartbeat, release on hide/close, explicit
    stop; the ai-town CLAUDE.md requires `npm run stop` after any test session — give the City an
    equivalent (`python -m city stop`) and keep the same rule.
28. **`'home'` vs the area id.** Home steps use the sentinel so the work leash, meal detection and
    work event pools don't misfire for people who live where they work.
29. **No night shifts on Monday or Sunday nights** (day 1 must be an ordinary Monday).
30. **All universal scenarios default to the decision outcome**, including talk-style ones
    (downpour, haze…), so the Decider generates options for them too. Set `outcome` explicitly in the
    data if that is not wanted.
31. **Latent gaps to fix, not copy:** `generated_scenarios.used_at` is never set; the "meet at the
    park" input has no button; `agentGenerateMessage` has no failure guard.
32. **Texting never stops anyone.** `tick_schedule` returns `not texting`; a text thread doesn't
    cancel activities; nobody can walk into one.
33. **Descriptions are written once.** Editing an existing character's profile/family/ground truth
    needs a wipe (or a new `refresh-descriptions` command); appending characters needs only `init`.
34. **Keep `city.db` out of OneDrive** (§2.3).
35. **Windows.** agentsociety2 is patched to run on Windows in this repo (see its RUN.md); the City
    engine needs none of Ray, Docker or the native router — `py_router` is pure Python.
36. **Python `round` is not `Math.round`.** Banker's rounding turns `snap(0.125)` into 0 instead of
    0.25 and `affinity_delta_from_utility(59.5)` into 0 instead of +1. Use the `js_round` helper (§0).

---

## 24. Build plan

Each milestone ends with its tests green and `python -m city stop` run.

| # | Milestone | Done when |
|---|---|---|
| M0 | Data export (§5.6) into `city/data/*.json` | validation counts pass (50 / 50 / 50 / 18 / 9) |
| M1 | SQLite schema, clock, engine loop, inputs, lease, lifecycle, CLI (`init/run/stop/resume/wipe`) | engine tests (§22) pass; a world steps and persists; restart resumes |
| M2 | Map service: load island map, bind locations, place homes/works, routing, trips, interpolation, `moveTo`/`teleport` | map tests pass; every resident can commute |
| M3 | City page v1: Leaflet map with faces moving along trips, clock, pause/resume/skip, inspector skeleton | you can watch the town move |
| M4 | Schedules and routines (§7), LLM layer + usage log (§17), fake LLM for tests | routine tests and day-1 smoke pass |
| M5 | Conversations (§8), human join/chat, remembering, affinity (§9.3, §11), archives, chat history UI | conversations happen and are remembered; inspector shows relationships |
| M6 | Memory retrieval, reflection, self-summary, perception, reacting, decomposition (§9–§10) | perception and reflection tests pass; agents panel shows memories |
| M7 | Short-term state, sleep pressure, sickness, economy (§12) | state rules hold; event log populated |
| M8 | Scenarios (§13): catalogue, manager, phases, texting, tasks, manual controls, panel/detail/creator, markers | scenario e2e tests pass |
| M9 | Decision engine (§14): Decider, focal, evaluator, ground truth, scorecard, decider viewer, decisions panel, dry run | scoring tests and the dinner e2e pass; dry run behaves as expected |
| M10 | Agents panel, interview, analysis graph, usage page, exports, evaluation bundle → run the ai-town evaluator | evaluator accepts the bundle |

---

## Appendix A. Prompt templates

Transcribed from the ai-town source with `{placeholders}`. Lines in `[brackets]` are conditional.
If anything here disagrees with the source file named, the source wins. `[ADAPT]` notes mark the
only wording that should change for the Singapore map.

### A.1 Day plan — `convex/aiTown/agentOperations.ts` `agentPlanDay` (JSON mode, 800 tokens)
```
You are planning a single day in the life of {name}, who lives in Singapore.
Identity: {effective identity}
Home: {home name} (use location_id "home")                      [or: Home: no fixed home]
[Workplace: {workplace name} (use location_id "{workplace id}") — {work activity}.]
Today is Day {day} ({weekday name}, a {weekday|weekend day}). The current in-game time is {h:mm AM}.
[Your current state: {short-term self-description} Factor this into today's plan — rest or head home earlier if you're exhausted, make time to eat if hungry, and lean toward cheaper options if money is tight.]
[SCENARIO NOTE — see below]

Available locations (use the location_id verbatim):
- {id} — {name}: {description}                                  (one line per named location)
- home — the character's home
[
Recent conversations — read these carefully for any commitments you made (who you agreed to meet, what you agreed to do, and where/when):
- {conversation memory description}                             (≤ 5, from the 8 newest memories)]

Produce a believable daily schedule of 4–7 entries that fits this character.
Each entry needs: start_time (24h "HH:MM"), location_id, activity (short phrase), emoji (one), description (one sentence).
Keep timings consistent and realistic, and take meals at regular times.
{SLEEP RULE}
{WORK RULE}
If recent memories mention plans or arrangements made in conversation, honour them.
Pick locations that suit the character's personality and goal.
[REPLAN NOTE]
[Remember: the URGENT SCENARIO above takes priority over everything else — the "reaction" object is what you do THIS INSTANT, and the schedule is the aftermath.]

Respond ONLY with strict JSON of the form:
{"schedule":[{"start_time":"07:30","location_id":"shophouses","activity":"opening the cafe","emoji":"☕","description":"setting up for the morning rush"}]}
[with a scenario instead:
{"reaction":{"location_id":"mbs","activity":"hurrying to shelter","emoji":"🏃","description":"rushing indoors to Marina Bay Sands to take cover"},"schedule":[{"start_time":"20:30","location_id":"home","activity":"sitting with the news on","emoji":"📺","description":"back home, still shaken by the afternoon"}]}]
```
- SCENARIO NOTE: `*** URGENT SCENARIO — THIS IS HAPPENING RIGHT NOW ({time}) AND OVERRIDES YOUR NORMAL ROUTINE ***` / `"{instruction}"` / `You must respond to this immediately and in character. In your JSON response, include a top-level "reaction" object describing the single action you take RIGHT NOW (this instant, at {time}) in response to the scenario — with location_id (the closest match from the list above to where the event calls you), activity, emoji, and description. Do NOT give the reaction a start_time; it happens now. Then the "schedule" array covers the AFTERMATH for the rest of today (all entries strictly after {time}), reflecting how the event reshaped your day.`
- SLEEP RULE (normal): `{name} sleeps from {HH:MM bed} until {HH:MM wake}. Do NOT schedule sleep, going to bed, or waking up — those blocks are added for you. Every entry must fall inside the waking hours, and the last one should have them home and winding down before {HH:MM bed}.`
- SLEEP RULE (night-shift day): `Do NOT schedule sleep, waking up, or going to bed — the night shift and the daytime sleep that follows it are added for you. Every entry must fall inside the waking window above.`
- WORK RULE (night-shift day): `Today {name} is on the NIGHT SHIFT at "{work id}" — on duty overnight and asleep through the middle of the day. There is no daytime work block. Plan only the hours they are up and off duty: roughly 13:00 to 22:00.`
- WORK RULE (weekday): `Today is a WEEKDAY: {name} goes to work. Schedule a work block at "{work id}" covering roughly 09:00–17:00 (you may split it around a short lunch elsewhere), then head home afterwards.`
- WORK RULE (weekend): `Today is a WEEKEND: no work shift. Fill the day with rest, errands, and social time that fit the character.` (no workplace → empty)
- REPLAN NOTE: `This is a RE-PLAN (current time: {time}). A conversation may have changed your plans, or the previous schedule was disrupted. Produce a revised schedule for the REST of today only — keep entries whose start_time has already passed, and revise the rest.` / `IMPORTANT: If in a recent conversation you agreed to meet someone or do something at a particular place and/or time, you MUST add a schedule entry for it (pick a sensible start_time if none was stated, and map the place to the closest location_id from the list above). Do not drop commitments you made.`

### A.2 Decompose a block — `agentDecomposeStep` (JSON mode, 400 tokens)
```
You are breaking one block of {name}'s day into finer actions.
Identity: {effective identity}
The block: "{activity}" — {description}
[Where: {location name} — {location description}]
It runs from {HH:MM start} to {HH:MM end}.

Break it into 3-{max_steps} smaller things {name} actually does during that block, in order. They stay at the same place the whole time — this is about WHAT they're doing, not where they go.
Each entry needs: start_time (24h "HH:MM", the first one exactly {HH:MM start}), activity (a short phrase in the "-ing" form, like the block's own), and emoji (one).
SPREAD THEM ACROSS THE WHOLE BLOCK, roughly evenly — the last one should begin near {HH:MM max(start, end - round(block/4))}, not in the first hour. Gaps of around {max(15, round(block / max(2, max_steps)))} minutes are about right.
Keep every start_time inside the block and at least 15 minutes apart. Make them specific and in character, not generic filler.

Respond ONLY with strict JSON of the form:
{"steps":[{"start_time":"09:00","activity":"setting up the workstation","emoji":"🧪"}]}
```

### A.3 Conversation messages — `convex/agent/conversation.ts`
Openers:
```
start (1:1):    You are {me}, and you just started a conversation with {audience}.
start (group):  You are {me}, and you just joined a group conversation with {audience}.
continue:       You are {me}, and you're currently in a [group ]conversation with {audience}.
                The conversation started at {Day N, h:mm AM}.
leave:          You are {me}, and you're currently in a conversation with {audience}.
                You've decided to leave and would like to politely tell them you're heading off.
                [exhausted: You are exhausted and going to bed. Say goodnight and go.]
summary:        You are {me}, wrapping up a conversation with {audience}.
                Your group has just achieved what you set out to do: {goal}   [or: Your group has just reached a conclusion.]
                In one or two short sentences (under 200 characters), tell the others — in character, first person — HOW you pulled it off: the key decision or arrangement you reached and who's doing what. Just the upshot, not a recap of the whole chat. Don't greet them again.
```
Time and place:
```
It is currently Day {N}, {h:mm AM} ({daytime|nighttime}) in Singapore.
You are at {nearest location}.  |  You are on the street near {nearest location}.  |  You are somewhere in the city, away from major landmarks.
        [ADAPT: use describe_place (§4.7)]
[Your current plan: {current step description}.]
[Right now you are {activity} — you're carrying on with it while you talk. Mention or work it into what you say when it fits naturally; don't force it.]
```
Group text (if `is_text`):
```
IMPORTANT — this is a GROUP TEXT on your phone, not a face-to-face conversation. The others are somewhere else entirely and most of you are in the middle of work or errands. Type like you would in a real group chat: short, casual, lowercase is fine, contractions and the odd emoji or "lah"/"leh" are fine. Never describe gestures, glances, body language or the room ("*nods*", "looks over at", "walks up") — nobody can see you. It's normal to be brief because you're busy, and to mention that you're snatching a moment between tasks.
```
Self and others:
```
About you: {effective identity}
Your background details:
  - {key}: {value}                         (non-constraint profile fields)
Fixed facts about your life — these are not preferences you can trade away:
  - {key}: {value}                         (constraint fields, §5.2)
Nobody else here knows any of this unless you have said it out loud in this conversation.
Things you've come to realise about yourself over time:
  - {learned trait}
[sick] You're feeling under the weather today — you've come down with a cold. You're low on energy and a little irritable, your replies are shorter and more subdued than usual, and you may mention not feeling well or wanting to head home and rest.
[{Right now you feel …}] Let this temporary state colour your tone and choices in the moment, but stay in character.
[exhausted] You are dead on your feet and about to turn in for the night. Do NOT start a topic, ask a question that needs an answer, or make plans. Say one short line — a goodnight, or a quick word before bed — and leave it there. Absolutely no more than two short sentences.
About {other}: {other's scenario_profile or effective identity}
[Your relationship with {other}: they are your {relation}, you feel {affinity label} toward them.]
[{other} is {activity} as you talk.]
[group] This is a group conversation with {N} people present ({names and you}). Address the group or a specific person naturally, keep your turn short, and don't try to speak for anyone else.
[scenario]
SCENARIO DIRECTIVE (follow this right now): {instruction}
Weave this directive naturally into the conversation without breaking character.
[POINT OF DISAGREEMENT: {conflict}
You genuinely disagree with some of the others here. Pick the side that fits YOUR character, background and feelings toward them, and argue for it — make your case, push back when you disagree, and don't just cave to keep the peace. Let the argument actually play out over a few turns before anyone gives ground or a compromise is reached.]
[Work through these specific points over the conversation (advance the discussion — don't just repeat yourself or restate the situation):
  - {topic}]
[The goal of this conversation is: {goal}. Keep it productive and moving toward that goal; once it's reached, you can wrap up naturally.]
```
Memory blocks and endings:
```
[start] Last time you chatted with {other} it was {Day…}. It's now {Day…}.
Here are some related memories in decreasing relevance order:
 - {memory}
What you remember about {focus person}:
 - {memory}
Earlier in this same scenario, others said the following in conversations you weren't part of. Stay consistent with it — especially any plan already made or tasks already claimed or assigned; don't contradict or re-litigate it:
 - {author}: {text}
You also recall these past situations like this one, which you can draw on:
 - {memory}
[start] You may briefly reference your last conversation with {other} in one short clause, but keep it light.
[start] Keep your greeting to one or two short sentences, like real spoken dialogue — under 200 characters. Don't monologue or give a speech.
        [text: Open the thread with one short line — a text, not a speech. Under 200 characters.]
[continue] Below is the current chat history.
           DO NOT greet them again. Do NOT use the word "Hey" too often. Your response should be brief and within 200 characters.
[leave]    Below is the current chat history.
           How would you like to tell them that you're leaving? Your response should be brief and within 200 characters.
           [exhausted: Give them a short goodnight — ONE line, in your own voice, under 100 characters. No plans, no questions, no new topics.]
speaker label (last user message): "{me} to {other}:" (1:1)  |  "{me}:" (group)
```

### A.4 Moderator / goal judge — `decideNextSpeaker` (10 or 60 tokens)
```
You are the moderator of a casual group conversation in a small town.
Everyone present: {names}.
{speaker} just finished speaking.
--- without a goal to judge ---
Decide who should speak next so the conversation flows naturally — pick whoever was addressed or asked a question, or whoever would most plausibly jump in.
You must choose exactly one of these names: {candidates}.

Recent conversation:
{last 8 messages as "Name: text"}

Reply with ONLY the chosen name, nothing else.
--- with a scenario goal (≥ 6 messages) ---
This conversation is part of a scenario. Its overall goal: {goal}
[Tasks it should work through:
1. {topic}
2. …]
[There is a genuine disagreement at the heart of this: {conflict} Only count the goal as met once the group has actually argued this out and reached a clear joint decision or compromise — NOT if they gave in instantly or never really engaged with the disagreement.]
First, decide who should speak next from: {candidates} (pick whoever was addressed or asked a question, or who would most plausibly jump in).
[Second, list the task numbers above that the group has SUBSTANTIVELY covered so far (discussed with real content, not merely mentioned in passing).]
{Third|Second}, judge whether the group has now SUBSTANTIVELY achieved the overall goal — key points discussed and any decisions or arrangements actually made. Be strict: only true if it would feel natural to wrap up.

Recent conversation:
{last 8 messages}

Reply with ONLY strict JSON: {"next":"<one of: {candidates}>","covered":[task numbers],"goalMet":true or false}
```

### A.5 Importance — `calculateImportance` (temperature 0, 1 token)
```
On the scale of 0 to 9, where 0 is purely mundane (e.g., brushing teeth, making bed) and 9 is extremely poignant (e.g., a break up, college acceptance), rate the likely poignancy of the following piece of memory.
      Memory: {description}
      Answer on a scale of 0 to 9. Respond with number only, e.g. "5"
```

### A.6 Remember a conversation — `rememberConversation` (500 tokens)
First user message:
```
You are {me}, and you just finished a conversation with {other}. I would like you to summarize the conversation from {me}'s perspective, using first-person pronouns like "I," and add if you liked or disliked this interaction. Then, on a line beginning with "Commitments:", state any concrete plans you agreed to (who, what, where, and when) — for example "Commitments: meet {other} somewhere at 3pm". If you made no concrete plans, write "Commitments: none". Finally, on a separate last line beginning with "Affinity:", output strict JSON mapping each of these people — {roster names} — to an integer from -10 to 10 capturing how your regard for them shifted during THIS conversation: negative if you clashed, disagreed, or were treated badly (e.g. a tense decision where you held conflicting views), positive if it was warm, supportive, or you found common ground, and 0 if neutral try to keep neutral unless the conversation was particularly moving. For example: "Affinity: {"{other}": 0}". Then, on ANOTHER separate last line beginning with "Feelings:", output strict JSON with two integers from -10 to 10 describing how THIS conversation left YOU feeling: "mood" (positive if it lifted your spirits — a warm chat, a good outcome; negative if it was draining or upsetting) and "stress" (positive if it left you more tense or pressured — a conflict, being dismissed, an unresolved problem; negative if it relieved tension). Keep both near 0 unless the conversation was genuinely affecting. For example: "Feelings: {"mood": 0, "stress": 0}".
```
Then one user message per chat line `"{author} to {recipient}: {text}"`, then `"Summary:"`.

### A.7 Reflection — `reflectOnMemories`
```
[no prose]
[Output only JSON]
You are {name}, statements about you:
Statement 0: {memory description}
Statement 1: …
[Things you noticed around you recently:
- {observation}]
What 3 high-level insights can you infer from the above statements?
Return in JSON format, where the key is a list of input statements that contributed to your insights and value is your insight. Make the response parseable by Typescript JSON.parse() function. DO NOT escape characters or include "\n" or white space in response.
Example: [{insight: "...", statementIds: [1,2]}, {insight: "...", statementIds: [1]}, ...]
```
(AI City parses the reply directly with `JSON.parse`; the port SHOULD tolerate fences and a
surrounding object.)

### A.8 Self-summary — `agentRegenerateSelfSummary` (250 tokens)
```
Here is how {name} was originally described:
{current self-summary or authored identity}

[Things {name} has come to understand about themselves:
- {reflection}]
[
What has actually happened to them lately:
- {memory}]
[
Facts that are FIXED and must survive verbatim:
- Occupation: … / - Nationality: … / - Religion / worldview: … / - Dietary rule: … / - Family: {name (relation), …}]

Rewrite the description of {name} so it reflects who they have become. Keep what is still true, let what has changed show through, and don't invent events that aren't above.
Write 2-4 sentences in the third person, in the same voice as the original description. Every fixed fact above must still be true of your version.
Respond with the description only — no preamble, no quotes.
```

### A.9 Reacting — `agentReact` (JSON mode, 200 tokens)
```
You are {name}.
Identity: {effective identity}
[You are at {place}.]
[Right now you are {activity}.]
[Your current state: {short-term self-description}]

You've just noticed:
- {observation}                                    (≤ 8 unprocessed, newest first)

Does any of this actually change what you do next? Most of the time it doesn't — people notice things all day without acting on them. Only react if it genuinely would matter to {name}.
Choose exactly one:
- "ignore": carry on with what you were doing. This is usually right.
[- "talk": go and speak to one of these people who are nearby: {names}. Put their name in "target".]
- "activity": briefly do something different where you are. Put a short "-ing" phrase in "activity" and one emoji in "emoji".
- "replan": what you saw genuinely upends the rest of your day and you need a new plan. Reserve this for real disruptions.

Respond ONLY with strict JSON: {"reaction":"ignore","reason":"why, in one short clause"}
```

### A.10 Scenario takeaway — `rememberScenarioOutcome` (220 tokens)
```
You are {name}. A situation just wrapped up: "{scenario name}".
What it was about: {instruction}
[The aim was: {goal}]
[There was disagreement over: {conflict}]
{In the end the group reached a workable decision or got the work done. | It wrapped up without really resolving.} {You were the one who pulled the plan together. | You took part in it.}
In 1-2 first-person sentences, note how this went for you and how you feel about the outcome — a lasting takeaway, not a play-by-play.
Then, on a separate last line beginning with "Feelings:", output strict JSON with two integers from -20 to 20: "mood" (positive if the outcome pleased you, negative if it left you deflated) and "stress" (positive if it left you tense or frustrated — e.g. you were overruled or it stayed unresolved; negative if it relieved pressure). For example: "Feelings: {"mood": 0, "stress": 0}".
```

### A.11 Scenario-relevant profile — `agentExtractScenarioProfile` (160 tokens)
```
Here is {name}'s full background as key-value pairs:
- {key}: {value}
…

The current scenario / activity is:
"{scenario name}: {instruction}"

In 1-2 sentences, summarise ONLY the traits, constraints, and preferences from {name}'s background that are most relevant to how others should perceive and interact with {name} in THIS scenario. Write it as a compact third-person note about {name} (e.g. "{name} is a strict vegetarian and prefers clear bill-splitting"). Mention nothing irrelevant to this scenario, and do not invent anything not present in the background.
```

### A.12 Delegate scenario tasks — `planScenarioTasks` (400 tokens)
```
You are planning the hands-on work for a workplace scene in a small town.
Scenario: {name} — {instruction}
Situation: {context}
[Guidance on who does what: {goals}]
People present (use these EXACT names as assignees): {names}.
[Relevant notes:
 - {name}: {scenario_profile}]

They just finished talking and agreed a plan. Here is what they said:
{scenario transcript, ≤ 40 lines "Name: text"}

Turn their plan into concrete, physical to-do tasks — the actual hands-on work each person now goes off to DO (not talk about). Honour who agreed to do what. Give each person at least one task; aim for {N}-{N+3} tasks total. Keep each label a short imperative of at most ~6 words.
Reply with ONLY strict JSON, no prose: {"tasks":[{"label":"...","emoji":"<one emoji>","assignee":"<one of: {names}>","durationSec":<number 20-90>}]}
```

### A.13 Decider — candidate options — `generateOptionsFor` (JSON mode, 1200 tokens)
```
You are setting up a group decision in a Singapore-themed town simulation.
Scenario: {name} — {instruction}
Situation: {context}
[What people want out of it: {goals}]
[The fault line: {conflict}]
[Things they will argue about: {topics joined by "; "}]
People involved: {names}.
[What is publicly known about them:
 - {name}: {scenario_profile}]
Places in this town you may draw on: {Name (description); …}          [ADAPT: the bound named locations]

Propose exactly 4 concrete options this group could choose between.
Requirements:
- Every option must be a direct answer to THIS decision and nothing else. If the group is picking a film, every option is a film or a way of watching one; if it is picking a place to eat, every option is a place to eat. Do not drift into a different kind of choice.
- Each must be a specific, nameable choice ("the 9pm IMAX showing of the new horror release"), never a vague direction ("something scary").
- They must genuinely trade off against each other along cost, effort or travel, and what each actually offers — roughly: one cheap and familiar, one pricier or more ambitious, one low-effort, one that suits someone with a constraint the others don't share.
- At least one option should quietly be a poor fit for someone with a dietary, medical, religious or budget constraint — whichever of those this kind of decision can even run into — without flagging it in the option text.
- 'details' is one sentence: roughly what it costs per person, how much effort or travel it takes, and what it actually involves.

Also explain your thinking. Keep all three TERSE — these are read at a glance, so write fragments, not sentences, and never open with filler like "This option..." or "This set...":
- "reasoning": at most 25 words on what this set makes the group trade off.
- "rationale" per option: at most 12 words on why it is on the table. e.g. "Cheap, familiar, hard to object to."
- "riskNote" per option: at most 12 words naming who among {names} you suspect it would quietly not suit, and why. e.g. "Rahman — mostly pork stalls." Say "no one obvious" if you can't name anyone. A guess from what is publicly known; you are not told anyone's private constraints.

Reply with ONLY strict JSON, no prose:
{"reasoning":"...","options":[{"title":"...","details":"...","rationale":"...","riskNote":"..."}]}
```

### A.14 Decider — belief extraction — `extractMemoriesFor` (JSON mode, 900 tokens)
```
You are tracking what {focal} has learned about the other people in a group conversation.
They are trying to pick one option for: {scenario name} — {completion goal or goals}
The other people are: {names}.
[Already believed before this conversation:
 - {name}: constraints [{taboos or "none known"}]; likes [{preferences or "none known"}]]

Transcript:
{scenario transcript, ≤ 40 lines}

For each OTHER person who revealed something, report what was learned. Rules:
- "newTaboos": only absolute constraints — a religious restriction, a medical or allergy limit, a legal rule. Something they cannot do, not something they would rather not do.
- "newPreferences": likes, dislikes, budget concerns, and convenience needs. Strong dislikes go here, NOT in newTaboos.
- Only record what was actually said or clearly implied in the transcript. Do not infer from someone's background what they "probably" cannot eat — an unstated constraint is exactly what is being tested for.
- "resolvedUncertainties": previously open questions this transcript has now answered.
- "openQuestions": what is still unknown about this person that would change which option is best for them. Phrase each as a short question.
- "confidenceScore": 0 to 1, how well {focal} now understands what this person needs.
- Omit anyone who revealed nothing new.
- Use each person's EXACT name as "targetName".
- ONE fact per array entry, at most 10 words each. Never join several into one string with semicolons or "and" — "wants comfort food; open to something new" must be two entries.

Reply with ONLY strict JSON, no prose:
{"extractedFacts":[{"targetName":"...","newTaboos":[],"newPreferences":[],"resolvedUncertainties":[],"openQuestions":[],"confidenceScore":0.5}]}
```
(The "an unstated constraint is exactly what is being tested for" clause is open item §14.10-2.)

### A.15 Focal agent — `focalDecision` (JSON mode, 900 tokens; system message + the chat history as user messages)
```
You are {me}. You are the one trying to get this group to actually land on a decision.
[This is a GROUP TEXT on your phone, not a face-to-face conversation — everyone is off doing their own thing. Both lines you draft below must read like texts: short, casual, lowercase is fine, no stage directions or descriptions of the room.]
Scenario: {name} — {instruction}
Situation: {context}
What counts as done: {completion goal}
[Where people disagree: {conflict}]

The options on the table:
 - {optionId} "{title}": {details}

What you currently believe about the others (this is YOUR picture, and it may be wrong or incomplete):
 - {name} — constraints you know of: {…|none} | what they seem to want: {…|nothing yet} | still unclear: {…|nothing flagged} | your confidence: {NN}%
   [or: - you know nothing about anyone yet]
[Your estimates last turn: opt1=…, opt2=…]

Score EVERY ONE of the {K} options above out of 100 — all {K} must appear in "estimatedUtilityBreakdown" — for how well each serves the WHOLE group, using what you know:
  35% whether it meets everyone's essential practical needs
  20% how well it matches what people actually want
  15% cost and time burden
  15% fairness — nobody carrying more of the cost or hassle than the rest
  10% social comfort
   5% effect on how people get on afterwards
Anyone you suspect has an absolute constraint against an option — a religious rule, an allergy or medical limit, a legal issue — makes that option worthless to them. Flag it with "tabooRisk": true and name them in "riskyForNames". Do NOT flag mere dislikes or preferences.

Now draft BOTH of the following. Fill in BOTH, even the one you would not choose — whether the group is actually allowed to commit yet is decided separately, so an empty field wastes the turn:
1. "questionOutput" — one short, natural line of dialogue asking ONE person the single question that would most change your scoring. Name them in "questionTargetName" (one of: {present others | nobody available}). Ask about what they need or can't do, not about your scoring. Never mention scores, option ids, or that you are evaluating anyone.
2. "decisionOutput" — one short, natural line committing the group to the option with your HIGHEST estimatedScore, said the way {me} would say it. Put that option's id in "selectedOptionId".
Then say in "suggestedAction" which of the two you would choose.
Both lines must sound like real speech in a casual conversation, under 200 characters, with no stage directions.

Reply with ONLY strict JSON, no prose:
{"estimatedUtilityBreakdown":[{"optionId":"opt1","estimatedScore":0,"tabooRisk":false,"riskyForNames":[]}],"suggestedAction":"ASK_QUESTION","questionTargetName":null,"questionOutput":"...","selectedOptionId":null,"decisionOutput":"..."}
```

### A.16 Scenario generator — `generateScenarioDraft` (JSON mode, 1400 tokens)
```
You invent situations for a Singapore-themed town simulation. Your job is to stage ONE new situation that forces this group into a real joint decision.

The residents:
 - {name}: {first sentence of authored identity}

[What has come up in their conversations so far:
 - {name}: constraints mentioned [{…|none}]; wants [{…|nothing noted}][; still unclear [{…}]]
]
[Recent friction between them:
 - {Actor} toward {Target}: {reason}
]
Situations they have ALREADY been through — invent something genuinely different from all of these: {names joined by "; "}.

Design the new situation so that:
- It is an everyday Singapore situation these specific people would plausibly end up in together — not a disaster, not a spectacle.
- It forces ONE concrete joint choice with about 4 plausible answers, not an open-ended chat.
- The pressure comes from things you actually see above: a constraint someone mentioned, an unresolved disagreement, a difference in budget or schedule. Build on what is real rather than inventing new facts about anyone.
- Somebody's needs genuinely conflict with somebody else's, so the group cannot simply please everyone.

Fields:
- "name": 2-4 words, the way a person would refer to it ("The Broken Lift").
- "emoji": a single emoji.
- "instruction": the directive given to every participant, second person, telling them what they are trying to settle and to push for what they want.
- "whatHappens", "background", "relationships", "context": one or two sentences each, for the info panel.
- "goals": what each person is trying to get out of it.
- "conflict": the fault line — the opposing positions, named.
- "topics": 4-5 concrete things they will have to work through.
- "completionGoal": one sentence describing when the group has actually settled it.
- "reasoning": at most 25 words on why this situation, these people, now. A fragment, not a sentence — no "This scenario..." preamble.
- "groundedIn": the specific facts from above you built on, at most 8 words each. Leave empty if you invented the premise from nothing.

Reply with ONLY strict JSON, no prose:
{"name":"...","emoji":"...","instruction":"...","whatHappens":"...","background":"...","relationships":"...","context":"...","goals":"...","conflict":"...","topics":["..."],"completionGoal":"...","reasoning":"...","groundedIn":["..."]}
```

### A.17 Evaluator — score one option — `scoreOption` (JSON mode, 1400 tokens)
```
You are scoring how well one option would actually serve each person in a group, using private information about them that they did not necessarily share.
Scenario: {scenario name}
Option under evaluation — "{title}": {details}

The people, and the TRUTH about each of them:
{name}:
  background: {culturalBackground}; {religion}
  ABSOLUTE constraints: {hardTaboos joined by " | " or "none"}
  essential needs: {… | none}
  preferences: {… | none}
  budget ceiling: {about S${budgetLimit} | no real limit}
…

For context, what they actually said to each other:
{transcript, ≤ 60 lines}                                  [or: (no transcript available)]

For EACH person, report:
- "hardTabooViolated": true only if this option violates one of their ABSOLUTE constraints — a religious rule, a medical or allergy limit, a legal issue. A merely disliked or over-budget option is NOT a violation. If true, quote the constraint in "violatedTaboo".
- "dimensionFactors": six numbers, each EXACTLY one of 1, 0.75, 0.5, 0.25, or 0:
    1 = fully satisfied / high match / no burden
    0.75 = basically satisfied / minor inconvenience
    0.5 = moderate compromise / medium burden
    0.25 = barely feasible / heavy burden
    0 = unfeasible / completely dissatisfied
  essentialNeeds — does it meet their essential practical needs?
  preferenceMatch — how well does it match what they actually like?
  costTimeBurden — is it affordable and convenient FOR THEM, against their budget ceiling? (1 = easily affordable, 0 = far beyond their means)
  fairness — are they carrying a proportionate share of the cost and hassle?
  socialComfort — will they feel at ease there?
  relationshipImpact — will this leave them on better terms with the others?
- "reason": ONE short clause, at most 12 words, naming what drove their score — the specific need met or missed, not a restatement of the numbers. Write "Highly matched preference; low cost burden" or "Met dietary need, but a long trip", never "scored 0.75 on preference".
Score honestly from the private information, NOT from what they said out loud. Someone who politely agreed to something that does not suit them still scores low.
Include every person listed, using their EXACT name.

Reply with ONLY strict JSON, no prose:
{"agentScores":[{"name":"...","hardTabooViolated":false,"violatedTaboo":null,"reason":"...","dimensionFactors":{"essentialNeeds":1,"preferenceMatch":0.75,"costTimeBurden":0.5,"fairness":1,"socialComfort":0.75,"relationshipImpact":1}}],"analyticalCommentary":"one or two sentences on who this option serves well and who it fails"}
```

### A.18 Interview — `convex/interview.ts` (system message; 400 tokens)
```
You are {name}, a resident of this Singapore neighbourhood. Someone has stopped you to ask you a few questions about yourself and your life here, and you are willing to talk to them.
Answer in the first person, in your own voice, entirely in character. Speak from your own experience and opinions — never describe yourself from the outside, never narrate stage directions, and never answer as anyone else.
About you: {effective identity}
[Your background details: …]
[Fixed facts about your life — these are not preferences you can trade away: …]
[Things you've come to realise about yourself over time: …]
[You work at {place} — {activity}.]
[It is Day {N}, {h:mm AM} ({daytime|nighttime}).]
You are at {place}.                                         [ADAPT: describe_place]
[Your plan for right now: {step description}.]
[You are {activity} while you answer.]
[You're unwell today — low on energy, and it shows in how you answer.]
[{Right now you feel …} Let it colour your tone without taking over the answer.]
[The people you know, and how you feel about them:
  - {name}[ (your {relation})]: you feel {label} toward them]
[Things you remember, most recent first. Draw on them when they're relevant, in your own words:
  - {memory}]
If you genuinely wouldn't know something, say so rather than inventing it. If a question is too personal for how you're feeling, you may deflect — in character.
Keep answers conversational: two or three sentences unless the question really needs more.
```

---

## Appendix B. Roster (all 50 residents)

Generated from the ai-town data files (not retyped). "Home area" and "Workplace" are named-location
ids (§4.2); `restaurant` is the hawker centre. Sleep windows come from §7.3; night shifts are the
evenings the shift starts. Hard taboos are from the hidden ground truth (§5.5) and truncated with "…"
here; Faisal's budget of 0 means unconstrained. Ages/sexes of the original 8 are not in their
profiles.

| # | Name | Sprite | Age/Sex | Occupation | Religion tag | Home area | Workplace | Sleep (bed–wake) | Night shifts | Family | Hard taboos (ground truth) | Budget S$ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Lukas | f5 | –/– | Postdoctoral researcher at A*STAR (materials science) | none | hdb | astar | 22:30-06:30 | – | – | – | 60 |
| 1 | Cedric | f1 | –/– | Barista at a third-wave coffee shop | none | shophouses | shophouses | 22:30-06:30 | – | – | – | 40 |
| 2 | James | f4 | –/– | Grab driver | none | hdb | mbs | 22:30-06:30 | – | Sarah (daughter); Xavier (son) | Doctor-ordered low salt and low sugar - no heavily salted, deep-fried… | 25 |
| 3 | Sarah | f6 | –/– | Hawker; runs the family stall | christian | hdb | restaurant | 22:30-06:30 | – | James (father); Xavier (younger brother) | – | 30 |
| 4 | Rahman | f2 | –/– | Kopitiam drinks-stall owner (teh tarik, kopi) | muslim | hdb | restaurant | 22:30-06:30 | – | – | Halal only - no pork and no non-halal meat; No alcohol, including alcohol used in cooking | 30 |
| 5 | Isabel | f3 | –/– | ML researcher at a small AI startup | none | hdb | astar | 22:30-06:30 | – | – | Shellfish allergy - no prawn, crab or shellfish, including in stocks,… | 60 |
| 6 | Xavier | f7 | –/– | IT student at Temasek Polytechnic | none | shophouses | university | 22:30-06:30 | – | James (father); Sarah (older sister) | – | 15 |
| 7 | Clara | f8 | –/– | Senior research scientist / PI at A*STAR (genomics) | none | shophouses | astar | 22:30-06:30 | – | – | – | 80 |
| 8 | Yvonne | f3 | 24/F | Junior public administration officer | none | hdb | fusionopolis | 22:30-06:30 | – | – | Cannot accept anything that could read as an improper benefit through… | 35 |
| 9 | Bernard | f4 | 68/M | Retired teacher | none | hdb | – (retired) | 21:00-06:00 | – | – | – | 30 |
| 10 | Nikhil | f1 | 35/M | IT project manager | none | hdb | fusionopolis | 22:30-06:30 | – | – | Strict vegetarian and no beef - this includes shared serving spoons a… | 40 |
| 11 | Nurul | f6 | 32/F | Nurse | muslim | hdb | changi_hospital | 22:30-06:30 | Tue,Wed | – | Halal only - no pork and no non-halal meat; No alcohol, including alcohol used in cooking | 40 |
| 12 | Ratna | f3 | 29/F | Domestic worker | muslim | hdb | hdb | 22:30-06:30 | – | – | Halal only - no pork; No alcohol | 15 |
| 13 | Kerem | f1 | 43/M | Logistics manager | muslim | hdb | fusionopolis | 22:30-06:30 | – | – | No pork | 40 |
| 14 | Irina | f8 | 60/F | Piano teacher | christian | hdb | university | 21:00-06:00 | – | – | During Orthodox fasting periods she avoids animal products entirely -… | 35 |
| 15 | Emeka | f2 | 39/M | Construction supervisor | christian | hdb | hdb | 21:00-06:00 | – | – | – | 20 |
| 16 | Sharifah | f8 | 34/F | Pharmacist | muslim | hdb | changi_hospital | 22:30-06:30 | – | – | Halal only - no pork and no non-halal meat; No alcohol, including alcohol used in cooking | 40 |
| 17 | Hanna | f2 | 46/F | Nurse | christian | hdb | changi_hospital | 22:30-06:30 | – | – | During Orthodox fasting periods - which cover much of the year - she … | 40 |
| 18 | Naomi | f3 | 33/F | Lawyer | none | hdb | mbs | 22:30-06:30 | – | – | Kosher-style - no pork and no shellfish | 80 |
| 19 | Tiago | f2 | 30/M | Musician/event helper | none | shophouses | shophouses | 01:00-09:00 | – | – | – | 20 |
| 20 | Harpreet | f6 | 37/F | Teacher / community volunteer | none | hdb | university | 22:30-06:30 | – | – | – | 40 |
| 21 | Mateo | f7 | 55/M | Cleaner | christian | hdb | gardens | 22:30-06:30 | – | – | – | 15 |
| 22 | Dylan | f5 | 36/M | Paramedic | none | hdb | changi_hospital | 22:30-06:30 | Thu,Fri | – | Severe peanut allergy - no peanuts, peanut oil, satay sauce or anythi… | 40 |
| 23 | Aroha | f8 | 42/F | Social worker | christian | hdb | hdb | 22:30-06:30 | – | – | – | 40 |
| 24 | Ravi | f7 | 50/M | Grocery shop owner | none | shophouses | shophouses | 22:30-06:30 | – | – | No beef, ever | 40 |
| 25 | Faisal | f5 | 41/M | Small business investor | muslim | hdb | mbs | 22:30-06:30 | – | – | Halal only - pork and anything cooked with alcohol are absolutely out; No alcohol, and he will not attend an event whose centre of gravity i… | no limit |
| 26 | Somchai | f4 | 27/M | Service worker | none | hdb | mbs | 22:30-06:30 | Wed,Sat | – | – | 25 |
| 27 | Katrin | f3 | 31/F | Mechanical engineer | none | hdb | fusionopolis | 22:30-06:30 | – | – | Lactose intolerant - dairy-heavy food makes her genuinely ill | 70 |
| 28 | Pilar | f8 | 45/F | Café owner | christian | shophouses | shophouses | 23:30-07:00 | – | – | – | 80 |
| 29 | Danuta | f6 | 52/F | Elder-care worker | christian | hdb | hdb | 22:30-06:30 | – | – | – | 25 |
| 30 | Camille | f8 | 38/F | Designer | none | shophouses | fusionopolis | 22:30-06:30 | – | – | – | 90 |
| 31 | Sipho | f2 | 28/M | Graduate student | none | university | university | 00:30-08:00 | – | – | Lactose intolerant - dairy-heavy food makes him ill | 25 |
| 32 | Lucia | f6 | 40/F | Food-stall assistant | christian | hdb | restaurant | 22:30-06:30 | – | – | – | 20 |
| 33 | Bryan | f4 | 19/M | Polytechnic student | none | university | university | 00:30-08:00 | – | – | – | 15 |
| 34 | Farah | f6 | 20/F | Polytechnic student and part-time barista | muslim | university | university | 00:30-08:00 | – | – | Halal only - no pork, nothing cooked with alcohol; Does not drink | 20 |
| 35 | Anh | f8 | 22/F | Polytechnic scholarship student | none | university | university | 00:30-08:00 | – | – | – | 15 |
| 36 | Tomoko | f3 | 21/F | Design exchange student | none | university | university | 00:30-08:00 | – | – | – | 40 |
| 37 | Daniyal | f5 | 23/M | Engineering postgraduate and teaching assistant | muslim | university | university | 00:30-08:00 | – | – | Halal only - no pork, nothing cooked with alcohol; Does not drink, and will not attend an event centred on drinking | 30 |
| 38 | Grace | f6 | 26/F | Campus librarian | christian | university | university | 22:30-06:30 | – | – | – | 25 |
| 39 | Priya | f3 | 29/F | Residential life officer at the polytechnic | none | university | university | 22:30-06:30 | – | – | No beef, in any form | 50 |
| 40 | Hafiz | f4 | 34/M | Auxiliary police officer | muslim | hdb | mbs | 22:30-06:30 | Tue,Fri | – | Halal only - no pork, nothing cooked with alcohol; Does not drink; Cannot accept a gift, a discount or a free round while on duty | 35 |
| 41 | Meihua | f6 | 58/F | Hawker centre cleaner | none | hdb | restaurant | 21:00-06:00 | – | – | – | 10 |
| 42 | Arun | f7 | 45/M | Prata stall owner | none | hdb | restaurant | 21:00-06:00 | – | – | No beef, in any form | 25 |
| 43 | Nadia | f8 | 33/F | Radiographer | muslim | hdb | changi_hospital | 22:30-06:30 | – | – | Halal only - no pork, nothing cooked with alcohol; Does not drink | 55 |
| 44 | Tavita | f7 | 30/M | Security guard | christian | hdb | gardens | 21:00-06:00 | – | – | Sunday is for church and rest - he will not be booked for anything on… | 15 |
| 45 | Sofia | f3 | 27/F | Physiotherapist | christian | hdb | changi_hospital | 22:30-06:30 | – | – | – | 60 |
| 46 | Haoran | f1 | 29/M | Research engineer | none | hdb | astar | 01:00-09:00 | – | – | – | 50 |
| 47 | Siti | f6 | 31/F | Tailor and shop owner | muslim | shophouses | shophouses | 22:30-06:30 | – | – | Halal only - no pork, nothing cooked with alcohol; Does not drink | 30 |
| 48 | Gordon | f1 | 42/M | Bar manager | none | shophouses | shophouses | 01:00-09:00 | – | – | – | 80 |
| 49 | Meera | f3 | 35/F | Bioinformatician | none | shophouses | astar | 22:30-06:30 | – | – | Severe shellfish allergy - a kitchen that handles prawns is not an op…; No beef | 60 |

---

## Appendix C. Scenario catalogue

From `data/scenarios.ts`; "outcome" is the resolved value (an omitted outcome defaults to `decision`
for universal and `tasks` for local). Export the full text fields (§5.6); they are long and feed both
prompts and the info panel.

| id | Name | Scope · place | Outcome | Min | Textable | Conflict | Completion goal |
|---|---|---|---|---|---|---|---|
| `downpour` | ⛈️ Sudden Downpour | universal | decision (default) | 2 | – | – | everyone present has sorted out shelter or an umbrella and agreed a plan for once the rain eases |
| `national_day` | 🇸🇬 National Day Buzz | universal | decision (default) | 2 | – | – | the group has agreed where and with whom to watch the fireworks or flypast together |
| `mrt_breakdown` | 🚇 MRT Breakdown | universal | decision (default) | 2 | – | – | each person has a concrete way to get where they need to be (a shared cab arranged or a route chosen) |
| `haze` | 😷 Haze Advisory | universal | decision (default) | 2 | – | – | the group has shared masks or advice and agreed how to look after anyone vulnerable and adjust their outdoor plans |
| `cny_eve` | 🧧 CNY Eve | universal | decision (default) | 2 | yes | – | the group has exchanged greetings and compared or coordinated their reunion-dinner and visiting plans |
| `dinner_decision` | 🍽️ What's for Dinner? | universal | decision | 2 | yes | yes | the group has settled on ONE specific place to eat that everyone has agreed to |
| `movie_night_pick` | 🎬 Movie Night Pick | universal | decision | 2 | yes | yes | the group has chosen ONE specific film to watch together |
| `weekend_trip_plan` | 🧳 Weekend Trip Plan | universal | decision | 2 | yes | yes | the group has agreed on ONE weekend plan (a specific destination, or a clear decision not to go) |
| `astar_grant_crunch` | 🧪 Grant Deadline Crunch | local · astar | tasks | 2 | – | yes | the team has divided up the remaining sections and agreed the proposal can be finished and submitted in time |
| `astar_demo_day` | 🔬 Lab Demo Day | local · astar | tasks | 2 | – | – | the team has agreed who presents what and is ready to receive the visitors |
| `hawker_lunch_rush` | 🍜 Lunch Rush Mayhem | local · restaurant | tasks | 2 | – | – | they have split the work to clear the backlog and have the lunch rush under control |
| `hawker_inspection` | 🧼 Surprise Health Inspection | local · restaurant | tasks | 2 | – | yes | their stalls are tidied and they have coordinated to get through the inspection cleanly |
| `cafe_latte_art` | ☕ Latte-Art Throwdown | local · shophouses | tasks | 1 | – | – | they have run a few rounds, judged the pours, and crowned a winner (or agreed to keep it going) |
| `mbs_convention_surge` | 🚕 Convention Surge | local · mbs | tasks | 1 | – | – | they have the queue moving in an orderly way and have sorted out fares and directions for the crowd |
| `poly_deadline_panic` | 💻 Project Deadline Panic | local · university | tasks | 1 | – | – | they have split the remaining work and have a plan to ship the project before the deadline |
| `cafe_new_drink` | 🧋 New Drink to Add | local · shophouses | decision | 2 | – | yes | they have agreed on ONE specific new drink to add to the menu |
| `astar_project_priority` | 🧭 Which Project First | local · astar | decision | 2 | – | yes | the lab has agreed which single project to prioritise this quarter |
| `hawker_price_change` | 💰 Raise Prices? | local · restaurant | decision | 2 | – | yes | the stallholders have agreed on a clear decision about whether and how much to raise prices |

Several local scenario texts name specific characters in their `goals` (e.g. "Clara should steer the
framing… Lukas… Isabel…", "Sarah… Rahman…", "Cedric…", "James…", "Xavier…"); the local cast is
whoever works there, which with 50 residents includes more people than the text names.

---

## Appendix D. Source map

| ai-town (old) | Role | New module (§2.5) |
|---|---|---|
| `convex/engine/abstractGame.ts`, `engine/schema.ts` | step loop, inputs, generation number | `engine.py` |
| `convex/engine/historicalObject.ts`, `aiTown/location.ts`, `util/compression.ts`, `FastIntegerCompression.ts`, `xxhash.ts` | packed position history | dropped (trip interpolation) |
| `convex/aiTown/main.ts`, `game.ts`, `world.ts`, `ids.ts`, `inputs.ts`, `inputHandler.ts`, `insertInput.ts`, `worldInputs.ts` | engine runner, world model, ids, input plumbing | `engine.py`, `model/`, `inputs.py` |
| `convex/aiTown/player.ts`, `movement.ts`, `worldMap.ts`, `util/geometry.ts`, `util/minheap.ts` | players, A\*, tile map | `model/player.py`, `geo/` |
| `convex/aiTown/agent.ts` | agent tick, schedule execution, invites, helpers | `agent_tick.py` |
| `convex/aiTown/agentInputs.ts` | write-backs, operator and scenario inputs | `inputs.py` |
| `convex/aiTown/agentOperations.ts` | LLM operations (plan, do-something, messages, remember, react, reflect, decompose, self-summary, profile extraction, task planning) | `ops/` |
| `convex/aiTown/conversation.ts`, `conversationMembership.ts` | conversation state machine | `model/conversation.py` |
| `convex/aiTown/scenarios.ts`, `generatedScenario.ts` | scenario manager | `scenarios/manager.py` |
| `convex/aiTown/deliberation.ts` | deliberation state + focal delta | `decision/deliberation.py` |
| `convex/aiTown/affinity.ts`, `relationshipEvents.ts` | relationships | `relationships.py` |
| `convex/aiTown/shortTerm.ts`, `shortTermEvents.ts` | gauges, money, sleep pressure | `short_term.py` |
| `convex/aiTown/observation.ts` | perception rules | `perception.py` |
| `convex/aiTown/gameTime.ts` | clock | `clock.py` |
| `convex/aiTown/agentDescription.ts`, `playerDescription.ts` | descriptions, effective identity | `model/descriptions.py` |
| `convex/agent/conversation.ts`, `agent/profileConstraints.ts` | prompts, moderator, task planning | `conversation.py` |
| `convex/agent/memory.ts`, `agent/embeddingsCache.ts`, `agent/schema.ts` | memory stream | `memory.py` |
| `convex/decider.ts`, `focal.ts`, `evaluator.ts`, `scoring.ts`, `groundTruth.ts`, `dryRun.ts`, `util/factMerge.ts` | decision engine | `decision/` |
| `convex/scenarioGen.ts` | Decider-generated scenarios | `scenarios/generator.py` |
| `convex/interview.ts` | interview | `interview.py` |
| `convex/util/llm.ts`, `util/llmTrack.ts`, `util/llmJson.ts`, `convex/llmUsage.ts` | LLM calls, usage log | `llm.py`, `usage.py` |
| `convex/world.ts`, `convex/messages.ts`, `convex/evaluationExport.ts` | public queries/mutations, exports | `ui/server.py` `/api/city/*`, `export.py` |
| `convex/init.ts`, `convex/testing.ts`, `convex/crons.ts` | init/top-up, stop/resume/wipe/teleport, vacuums, idle stop | `__main__.py`, engine maintenance |
| `convex/music.ts`, `convex/http.ts` | Replicate background music | dropped |
| `data/characters.ts`, `characterProfiles.ts`, `groundTruth.ts`, `scenarios.ts`, `cityLocations.ts`, `routines.ts`, `spritesheets/*` | authored data | `city/data/*.json`, `routines.py` |
| `data/city.js`, `convertMap.js`, `gentle.js`, `animations/*`, `converted-map.js`, `src/cityTileset.ts`, `src/editor/*` | tile map and editors | dropped (Singapore map) |
| `src/components/Game.tsx`, `PixiGame.tsx`, `PixiStaticMap.tsx`, `PixiViewport.tsx`, `Player.tsx`, `Character.tsx`, `ScenarioMarker.tsx`, `MiniMap.tsx`, `DebugPath.tsx`, `PositionIndicator.tsx` | map rendering | City map page (Leaflet) |
| `src/components/PlayerDetails.tsx`, `ConversationPopup.tsx`, `Messages.tsx`, `MessageInput.tsx` | inspector and chat | City page panels |
| `src/components/AgentsPanel.tsx`, `InterviewPopup.tsx` | operator control, interview | Agents page |
| `src/components/Scenarios.tsx`, `ScenarioCreator.tsx`, `ScorecardModal.tsx`, `DeciderViewer.tsx` | scenario and decision UI | City overlays, Decider page |
| `src/components/AnalysisPage.tsx`, `UsagePage.tsx`, `ChatHistoryViewer.tsx` | pages | Analysis, Usage, Chat history pages |
| `src/components/GameClock.tsx`, `TimeControls.tsx`, `FreezeButton.tsx`, `DebugTimeManager.tsx` | overlays | City overlays (debug manager dropped) |
| `src/hooks/useWorldHeartbeat.ts`, `sendInput.ts`, `serverGame.ts`, `useNewEvaluation.ts`, `useEscapeKey.ts` | client behaviour | port; `useHistoricalTime.ts`, `useHistoricalValue.ts` dropped |
| `evaluation/**` | offline fidelity evaluator | keep as-is (§20.3) |
| `convex/*.test.ts`, `convex/util/*.test.ts`, `evaluation/*.test.ts` | invariants | `city/tests/` (§22) |

