export const ACTION_TIMEOUT = 120_000; // more time for local dev
// export const ACTION_TIMEOUT = 60_000;// normally fine

export const IDLE_WORLD_TIMEOUT = 5 * 60 * 1000;
export const WORLD_HEARTBEAT_INTERVAL = 60 * 1000;

export const MAX_STEP = 10 * 60 * 1000;
export const TICK = 16;
export const STEP_INTERVAL = 1000;

export const PATHFINDING_TIMEOUT = 60 * 1000;
export const PATHFINDING_BACKOFF = 1000;
export const CONVERSATION_DISTANCE = 1.3;
export const MIDPOINT_THRESHOLD = 4;
export const TYPING_TIMEOUT = 15 * 1000;
export const COLLISION_THRESHOLD = 0.75;

// How many human players can be in a world at once.
export const MAX_HUMAN_PLAYERS = 8;

// Don't talk to anyone for 15s after having a conversation.
export const CONVERSATION_COOLDOWN = 15000;

// Don't do another activity for 10s after doing one.
export const ACTIVITY_COOLDOWN = 10_000;

// Don't talk to a player within 60s of talking to them.
export const PLAYER_CONVERSATION_COOLDOWN = 60000;

// Invite 80% of invites that come from other agents.
export const INVITE_ACCEPT_PROBABILITY = 0.8;

// Wait for 1m for invites to be accepted.
export const INVITE_TIMEOUT = 60000;

// Wait for another player to say something before jumping in.
export const AWKWARD_CONVERSATION_TIMEOUT = 60_000; // more time locally
// export const AWKWARD_CONVERSATION_TIMEOUT = 20_000;

// --- Group conversations ---
// Maximum participants in an emergent (non-scenario) group conversation.
export const MAX_CONVERSATION_PARTICIPANTS = 5;
// Maximum participants in an enforced-gathering (scenario) conversation. High
// enough that every agent (plus a human) can join the same dinner/shopping chat.
export const SCENARIO_MAX_PARTICIPANTS = 8;
// A walkingOver member transitions to participating once within this distance
// of ANY participating member (a bit looser than CONVERSATION_DISTANCE so
// late joiners can slot into the outside of the huddle).
export const GROUP_JOIN_DISTANCE = 2.5;
// A free agent passing within this many tiles of an active group conversation
// will join it instead of starting a fresh two-person one.
export const GROUP_JOIN_RADIUS = 6;

// --- Scenario gatherings (enforced dinner/shopping) ---
// Tile distance at which an agent counts as "arrived" at the gathering target.
// Loose enough for a small crowd to stand around the same spot.
export const SCENARIO_ARRIVAL_RADIUS = 3;
// Hard fallback: release an agent from a gathering this long after arrival even
// if the group conversation never produced messages (e.g. LLM outage).
export const SCENARIO_GATHER_TIMEOUT = 5 * 60_000;

// --- Automatic scenarios (data/scenarios.ts) ---
// How often (real ms) the engine evaluates scenarios (expiry checks + the start
// timer). Kept small so a scenario starts promptly once the countdown hits zero.
export const SCENARIO_EVAL_INTERVAL = 3_000;
// Default lifetime of an active scenario (real ms) unless its def overrides it.
export const SCENARIO_DEFAULT_DURATION_MS = 4 * 60_000;
// Cooldown (real ms) before the same scope/location can host another scenario.
export const SCENARIO_COOLDOWN_MS = 3 * 60_000;
// The next scenario starts on a timer — a random gap in this range after the
// previous start. This is what the on-screen "next scenario" countdown shows.
export const SCENARIO_INTERVAL_MIN_MS = 60_000;
export const SCENARIO_INTERVAL_MAX_MS = 120_000;
// If the timer fires but nothing is eligible (deep night, everything on cooldown),
// retry after this short delay instead of waiting out a whole interval.
export const SCENARIO_RETRY_MS = 20_000;
// Delay before the first scenario fires after the world (re)starts.
export const SCENARIO_FIRST_DELAY_MS = 30_000;
// Cap on how many universal (town-wide) scenarios can run at once.
export const MAX_UNIVERSAL_SCENARIOS = 1;

// --- Local-scenario gathering (travel-time arrival) ---
// Slack (real ms) added to the slowest participant's estimated travel time when
// computing how long the "gathering" phase lasts, so everyone has a moment to
// settle once they arrive before the scenario content begins.
export const SCENARIO_GATHER_BUFFER_MS = 8_000;
// Hard cap (real ms) on the gathering phase. If a participant is blocked or
// can't reach the spot, the scenario promotes to active anyway so it never stalls.
export const SCENARIO_GATHER_MAX_MS = 90_000;

// Leave a conversation after participating too long.
export const MAX_CONVERSATION_DURATION = 10 * 60_000; // more time locally
// export const MAX_CONVERSATION_DURATION = 2 * 60_000;

// Leave a conversation if it has more than 8 messages;
export const MAX_CONVERSATION_MESSAGES = 8;

// --- Group conversation wind-down ---
// Hard ceiling on a group conversation's message budget. Without this, the
// budget scaled with participant count (e.g. 5 people → 32 messages) so big
// groups dragged on forever. Past this many messages every participant wraps up.
export const MAX_GROUP_CONVERSATION_MESSAGES = 16;
// Once a group conversation has had at least this many messages, each agent is
// eligible to gracefully peel off (say goodbye and leave) instead of everyone
// staying glued together until the hard cap. This makes groups thin out
// naturally, one person at a time.
export const GROUP_LEAVE_MIN_MESSAGES = 6;
// Per-eligible-turn probability that an agent decides to drift away from a group
// conversation. Tuned so members leave over several turns rather than all at once.
export const GROUP_LEAVE_PROBABILITY = 0.35;

// --- Scenario conversation termination (goal-driven) ---
// Scenario conversations (those between automatic-scenario participants) ignore
// the random drift-off and run until their goal is judged achieved or a hard cap
// is hit, so the scenario's core content actually gets covered.
// Minimum messages before a scenario conversation may end on its goal being met
// (+2 per extra group participant beyond two).
export const SCENARIO_CONVO_MIN_MESSAGES = 8;
// Hard ceiling on a scenario conversation's message budget. Past this, everyone
// wraps up regardless of whether the goal was judged met.
export const SCENARIO_CONVO_MAX_MESSAGES = 24;
// Only start asking the LLM goal-judge whether the goal is met once a scenario
// conversation has had at least this many messages (saves tokens early on).
export const SCENARIO_GOAL_CHECK_MIN_MESSAGES = 6;
// Time safety valve: leave a scenario conversation that has run this long even if
// the goal was never judged met.
export const SCENARIO_MAX_CONVO_DURATION = 15 * 60_000;

// --- Decision scenarios (Decider / Focal / Evaluator) ---
// A scenario with outcome === 'decision' runs a deliberation: one designated
// "focal" participant estimates a utility for each candidate option and either
// asks a clarifying question or commits. See convex/scoring.ts for the maths and
// convex/focal.ts for the turn itself.
// How many candidate options the Decider generates for a decision scenario.
export const MAX_DECISION_OPTIONS = 4;
// Question budget. The stopping criteria decide WHETHER the focal agent may
// commit; this decides when it must anyway. Without it a group that keeps
// revealing new constraints would deliberate until the conversation cap and
// never actually choose anything.
export const MAX_FOCAL_QUESTIONS = 4;
// Force a decision once the conversation is this close to SCENARIO_CONVO_MAX_MESSAGES,
// leaving room for the decision message plus the goal summary and goodbyes.
export const FOCAL_DECIDE_MESSAGE_HEADROOM = 4;
// Force a decision once the scenario is within this long of expiring, so a
// deliberation always resolves into something the evaluator can score.
export const FOCAL_FORCE_DECIDE_MS = 90_000;

// --- Scenario shared memory (cross-conversation + past scenarios) ---
// How many recent messages from the REST of the current scenario (its OTHER
// conversations) to surface to a participant as shared context, so a plan/task
// claimed in one chat carries into another. Sized to cover a whole scenario's
// cross-conversation transcript in practice (each conversation is itself capped at
// SCENARIO_CONVO_MAX_MESSAGES), so participants effectively see ALL of the scenario's
// past chats rather than a short recent window.
export const SCENARIO_HISTORY_MESSAGE_COUNT = 60;
// How many memories of PAST scenarios to recall when an agent is enlisted in one, via
// a memory search seeded with the current scenario's theme. Grounds a new situation in
// how earlier similar ones went (each scenario conversation is already remembered).
export const SCENARIO_RECALL_MEMORY_COUNT = 3;

// --- Local-scenario "working" phase (delegated tasks) ---
// After a local scenario's planning conversation reaches its goal, an LLM op
// generates concrete tasks and assigns each to a participant; the scenario then
// enters a "working" phase where each assignee performs their task, shown as an
// activity with a time-based progress bar.
// Clamp the LLM-suggested per-task duration to this range (real ms).
export const SCENARIO_TASK_MIN_DURATION_MS = 20_000;
export const SCENARIO_TASK_MAX_DURATION_MS = 90_000;
// Fallback duration when the LLM omits / gives an unusable duration.
export const SCENARIO_TASK_DEFAULT_DURATION_MS = 45_000;
// Overall safety cap on the working phase — the scenario expires by this long
// after tasks are assigned even if some task never completes.
export const SCENARIO_WORK_MAX_MS = 6 * 60_000;
// If the task-planning op is requested but no tasks come back within this window,
// abandon the working phase and let the scenario wrap up normally (so a slow or
// failed LLM call can't freeze participants on an orphaned op).
export const SCENARIO_TASK_PLAN_TIMEOUT_MS = ACTION_TIMEOUT + 15_000;

// Wait for 1s after sending an input to the engine. We can remove this
// once we can await on an input being processed.
export const INPUT_DELAY = 1000;

// How many memories to get from the agent's memory.
// This is over-fetched by 10x so we can prioritize memories by more than relevance.
export const NUM_MEMORIES_TO_SEARCH = 3;

// Wait for at least two seconds before sending another message.
export const MESSAGE_COOLDOWN = 2000;

// Don't run a turn of the agent more than once a second.
export const AGENT_WAKEUP_THRESHOLD = 1000;

// How old we let memories be before we vacuum them
export const VACUUM_MAX_AGE = 2 * 7 * 24 * 60 * 60 * 1000;
export const DELETE_BATCH_SIZE = 64;

export const HUMAN_IDLE_TOO_LONG = 5 * 60 * 1000;

// --- Relationship affinity ---
// How warmly one character regards another, on a 0–100 scale. Affinity is
// directional (A→B can differ from B→A) and stored per-agent; family pairs start
// warmer. Entries are created lazily (only once an interaction moves them), so an
// agent with no stored entry for someone uses one of these defaults.
export const MIN_AFFINITY = 0;
export const MAX_AFFINITY = 100;
// Neutral starting point for two unrelated characters.
export const DEFAULT_AFFINITY = 50;
// Family members start out closer than strangers.
export const FAMILY_BASE_AFFINITY = 75;
// Clamp on how far affinity can move from a single conversation, so one chat can
// nudge a relationship without wild swings.
export const MAX_AFFINITY_CHANGE_PER_CONVERSATION = 10;

// --- Affinity-driven behaviour ---
// These make affinity mechanical (not just prompt flavour): relationships shape
// who agents approach, whether they accept invites, and when they drift off.
// When choosing whom to approach, how many affinity points (0–100) are worth one
// tile of extra distance. Higher → agents travel further to reach someone they
// like and skip a nearby someone they dislike.
export const CANDIDATE_AFFINITY_WEIGHT = 2;
// Invite-acceptance probability scales with affinity toward the inviter, between
// these bounds (hostile ≈ MIN, adored ≈ MAX). Humans are accepted unconditionally.
export const INVITE_ACCEPT_MIN_PROBABILITY = 0.3;
export const INVITE_ACCEPT_MAX_PROBABILITY = 0.97;
// How strongly disliking the rest of a group makes an agent drift off sooner. The
// base GROUP_LEAVE_PROBABILITY is scaled by 1 ± this around neutral affinity.
export const GROUP_LEAVE_AFFINITY_WEIGHT = 0.6;
// How long (real ms) the post-conversation 💗/💔 affinity indicator stays up above
// a character on the map after their affinity shifts.
export const AFFINITY_INDICATOR_MS = 6000;
// Below this, a relationship reads as hostile (the bottom band of
// affinityLabel/affinityEmoji/affinityColor); also drives the 💢 badge when a
// hostile pair ends up in the same conversation.
export const HOSTILE_AFFINITY_THRESHOLD = 25;

// --- Conflict visibility & grudges ---
// How much the inviter's affinity toward the decliner drops when an agent turns
// down their invite (only when the low-affinity acceptance roll failed — not
// work-leash declines). Small, so grudges build from repeated snubs.
export const REJECTED_INVITE_AFFINITY_PENALTY = 2;
// A group exit is considered "low-affinity driven" (and logged as a
// relationship event) when the leaver's average affinity toward the remaining
// members is below this.
export const GROUP_EXIT_LOW_AFFINITY_THRESHOLD = 40;
// Cap on the human-readable reason snippet stored per relationship event.
export const RELATIONSHIP_EVENT_REASON_MAX_CHARS = 120;
// Tensions feed: how many chips to show at once and how far back to look.
export const TENSIONS_FEED_MAX_CHIPS = 6;
export const TENSIONS_FEED_WINDOW_MS = 5 * 60_000;
// Server-side caps on the relationship-event queries.
export const RECENT_RELATIONSHIP_EVENTS_LIMIT = 30;
export const PLAYER_RELATIONSHIP_EVENTS_LIMIT = 50;

// `cost` (local dollars, default 0) is deducted from the agent's balance when the
// activity is committed, feeding financial pressure. `energy` (0–100, default 0)
// is how tiring the activity is, used by the Phase 3 activity scorer (a tired
// agent avoids high-energy options). Both optional so most activities stay free.
export type Activity = {
  description: string;
  emoji: string;
  duration: number;
  cost?: number;
  energy?: number;
};

// Generic fallback used for humans or any character without a bespoke list.
export const ACTIVITIES: Activity[] = [
  { description: 'reading a book', emoji: '📖', duration: 20_000 },
  { description: 'daydreaming', emoji: '🤔', duration: 20_000 },
  { description: 'people-watching', emoji: '👀', duration: 20_000 },
];

// Per-character activities so free-roam behaviour reflects who the agent is,
// rather than everyone reading/daydreaming/gardening at random.
export const CHARACTER_ACTIVITIES: Record<string, Activity[]> = {
  Cedric: [
    { description: 'wiping down the counter', emoji: '☕', duration: 20_000, energy: 15 },
    { description: 'chatting up a regular', emoji: '💬', duration: 20_000, energy: 5 },
    { description: 'humming a tune', emoji: '🎶', duration: 20_000, energy: 0 },
  ],
  James: [
    { description: 'waiting for a fare', emoji: '🚗', duration: 20_000, energy: 5 },
    { description: 'checking the Grab app', emoji: '📱', duration: 20_000, energy: 0 },
    { description: 'grabbing a kopi', emoji: '☕', duration: 20_000, cost: 3, energy: 0 },
  ],
  Sarah: [
    { description: 'frying up an order', emoji: '🍳', duration: 20_000, energy: 25 },
    { description: 'wiping down the tables', emoji: '🧽', duration: 20_000, energy: 20 },
    { description: 'sneaking in an extra egg', emoji: '🥚', duration: 20_000, energy: 5 },
  ],
  Isabel: [
    { description: 'scribbling equations', emoji: '📝', duration: 20_000, energy: 10 },
    { description: 'reading a paper', emoji: '📄', duration: 20_000, energy: 5 },
    { description: 'lost in thought', emoji: '🧠', duration: 20_000, energy: 0 },
  ],
  Xavier: [
    { description: "debugging a friend's code", emoji: '💻', duration: 20_000, energy: 25 },
    { description: 'sipping iced Milo', emoji: '🥤', duration: 20_000, cost: 3, energy: 0 },
    { description: 'rushing a deadline', emoji: '😩', duration: 20_000, energy: 40 },
  ],
  Rahman: [
    { description: 'pulling a long teh tarik', emoji: '🫖', duration: 20_000, energy: 15 },
    { description: 'chatting with a regular', emoji: '💬', duration: 20_000, energy: 5 },
    { description: 'treating himself to a snack', emoji: '🍢', duration: 20_000, cost: 4, energy: 0 },
  ],
  Lukas: [
    { description: 'sketching an experiment in his notebook', emoji: '📓', duration: 20_000, energy: 5 },
    { description: 'planning a weekend bouldering trip', emoji: '🧗', duration: 20_000, cost: 20, energy: 10 },
    { description: 'frowning at a vague meeting invite', emoji: '🤨', duration: 20_000, energy: 0 },
  ],
  Clara: [
    { description: 'reviewing a draft paper', emoji: '📄', duration: 20_000, energy: 10 },
    { description: 'sipping a proper cup of tea', emoji: '🫖', duration: 20_000, cost: 4, energy: 0 },
    { description: 'mentoring a postdoc', emoji: '🧑‍🔬', duration: 20_000, energy: 15 },
  ],
};

export function activitiesForName(name?: string): Activity[] {
  return (name && CHARACTER_ACTIVITIES[name]) || ACTIVITIES;
}

export const ENGINE_ACTION_DURATION = 30000;

// Bound the number of pathfinding searches we do per game step.
export const MAX_PATHFINDS_PER_STEP = 16;

export const DEFAULT_NAME = 'Me';

// Tile distance at which an agent counts as "arrived" at a scheduled location.
export const ARRIVAL_RADIUS = 1.5;

// If an agent's current schedule step has been overdue for this many game-minutes
// AND they still haven't reached the location, trigger a re-plan.
export const SCHEDULE_DISRUPTION_MINUTES = 60;

// Tile radius within which a settled (arrived) agent will look for another free
// agent to strike up a conversation with. This is what makes conversations
// emerge from agents' schedules bringing them to the same place.
export const SCHEDULE_CHAT_RADIUS = 6;

// While on shift (scheduled at their workplace), agents are leashed to within
// this many tiles of the workplace — they won't wander off or trek across the
// map to chat, so they stay "at work" instead of disappearing during their shift.
export const WORK_LEASH_RADIUS = 8;

// --- Stage 2: contextual random events ---
// When an agent settles into a schedule block, the probability that any given
// activity slot is a short contextual micro-event (office event during work,
// flexible otherwise) rather than the block's base activity.
export const CONTEXTUAL_EVENT_PROBABILITY = 0.4;
// How long a contextual micro-event lasts, in game-minutes, before reverting to
// the base block activity.
export const CONTEXTUAL_EVENT_MINUTES = 20;

// --- Stage 3: probabilistic sickness ---
// Baseline per-day chance a well agent falls sick on a work day, before the
// consecutive-work-day penalty is added.
export const SICK_BASE_PROBABILITY = 0.02;
// Added to the sick chance for each consecutive work day already accrued, so
// burnout from working many days in a row makes illness more likely.
export const SICK_PER_WORKDAY_PROBABILITY = 0.04;
// Hard cap on the daily sick chance regardless of accrued work days.
export const SICK_MAX_PROBABILITY = 0.5;
// How many in-game days an illness lasts before the agent recovers.
export const SICK_DURATION_DAYS = 2;
// Chance a well agent catches the illness from a sick partner during a single
// conversation (rolled once per conversation).
export const CONTAGION_PROBABILITY = 0.25;

// --- Short-term memory (dynamic per-agent affective/physiological state) ---
// Four gauges on a 0–100 scale, distinct from the durable `profile`. Unlike
// affinity (directional, per-other-player) these are single per-agent values.
// Each drifts back toward its baseline over time; events push it around.
export const SHORT_TERM_MIN = 0;
export const SHORT_TERM_MAX = 100;
// Where each gauge sits at rest / drifts back toward.
export const MOOD_BASELINE = 60;
export const STRESS_BASELINE = 15;
export const FATIGUE_BASELINE = 10;
export const HUNGER_BASELINE = 10;
// Points each gauge moves back toward its baseline at a day rollover.
export const SHORT_TERM_DAILY_DECAY = 25;
// Fatigue gained on arriving at a demanding work block vs. any other "away" (out
// of the house) schedule step. Resets at the nightly sleep step.
export const FATIGUE_PER_WORK_BLOCK = 12;
// Hunger accrued per in-game hour spent on a non-meal step; a meal step resets it.
export const HUNGER_PER_GAME_HOUR = 7;
// Sickness bleeds into the affective gauges each day it persists.
export const SICK_STRESS_PER_DAY = 12;
export const SICK_MOOD_PENALTY_PER_DAY = 10;
// Clamp on how far a gauge can move from one interaction/scenario outcome, so a
// single event nudges rather than swings (mirrors MAX_AFFINITY_CHANGE_PER_*).
export const MAX_SHORT_TERM_CHANGE_PER_EVENT = 20;
// How long (real ms) the transient short-term-shift map indicator stays up.
export const SHORT_TERM_INDICATOR_MS = 6000;
// Cap on how many durable "learned traits" an agent accumulates from reflection
// (spec point 6); oldest are dropped past this so the list stays bounded.
export const MAX_LEARNED_TRAITS = 6;

// --- Economic model (savings + costs → financial pressure) ---
// Every agent tracks a savings balance in local dollars. Income is credited on
// work days; activities/scenario tasks cost money. `financialPressure` is a
// 0–100 gauge derived from how far the balance sits below the comfort threshold.
export const DEFAULT_BALANCE = 400;
// Credited to a working agent at each weekday rollover (a day's pay).
export const DAILY_INCOME = 120;
// Living costs (rent, transport, utilities) deducted EVERY day, weekends included.
// Tuned so weekday pay roughly covers a full week of expenses + meals, leaving the
// balance near-neutral in the long run but dipping into pressure after a shock
// (e.g. a sick spell with no income) or a spendy stretch — so financial pressure
// is a live, situational signal rather than always 0 or a runaway death spiral.
export const DAILY_EXPENSES = 85;
// At/above this balance financial pressure is 0; at 0 it is 100 (linear between).
export const FINANCIAL_COMFORT_THRESHOLD = 300;
// Default cost of an activity when its Activity def omits `cost` (most are free).
export const DEFAULT_ACTIVITY_COST = 0;

// --- Short-term-driven behaviour (numeric scoring weights) ---
// How steeply tiredness/stress raise the effective distance penalty when choosing
// whom to approach (added on top of CANDIDATE_AFFINITY_WEIGHT). 0 = no effect.
export const CANDIDATE_FATIGUE_DISTANCE_WEIGHT = 0.03;
// Activity scoring: how much an option's cost is penalised, scaled by the agent's
// current financial pressure, and how much its energy cost is penalised, scaled by
// fatigue. Both are 0–1 multipliers over the option's raw cost/energy.
export const ACTIVITY_COST_PRESSURE_WEIGHT = 0.6;
export const ACTIVITY_ENERGY_FATIGUE_WEIGHT = 0.5;
// Cost (local dollars) deducted when an agent settles into a meal schedule step.
export const MEAL_COST = 8;
// Fatigue gained on arriving at an "away" (non-home, non-meal) schedule step —
// this stands in for the travel + exertion of going out to do something.
export const AWAY_STEP_FATIGUE = 8;
