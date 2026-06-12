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

export type Activity = { description: string; emoji: string; duration: number };

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
    { description: 'wiping down the counter', emoji: '☕', duration: 20_000 },
    { description: 'chatting up a regular', emoji: '💬', duration: 20_000 },
    { description: 'humming a tune', emoji: '🎶', duration: 20_000 },
  ],
  James: [
    { description: 'waiting for a fare', emoji: '🚗', duration: 20_000 },
    { description: 'checking the Grab app', emoji: '📱', duration: 20_000 },
    { description: 'cracking a joke with a passenger', emoji: '😄', duration: 20_000 },
  ],
  Sarah: [
    { description: 'frying up an order', emoji: '🍳', duration: 20_000 },
    { description: 'wiping down the tables', emoji: '🧽', duration: 20_000 },
    { description: 'sneaking in an extra egg', emoji: '🥚', duration: 20_000 },
  ],
  Isabel: [
    { description: 'scribbling equations', emoji: '📝', duration: 20_000 },
    { description: 'reading a paper', emoji: '📄', duration: 20_000 },
    { description: 'lost in thought', emoji: '🧠', duration: 20_000 },
  ],
  Xavier: [
    { description: "debugging a friend's code", emoji: '💻', duration: 20_000 },
    { description: 'sipping iced Milo', emoji: '🥤', duration: 20_000 },
    { description: 'rushing a deadline', emoji: '😩', duration: 20_000 },
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
