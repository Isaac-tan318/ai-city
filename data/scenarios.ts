// Scenario library for the automatic scenario system.
//
// A scenario is a situation that the engine activates on its own (see
// convex/aiTown/scenarios.ts). While active, its `instruction` is injected into
// each participant's prompts so their conversations and plans reflect it, and the
// rich detail fields drive the on-screen info panel.
//
//  - UNIVERSAL scenarios affect the whole town (every agent is a participant).
//  - LOCAL scenarios belong to a single workplace (locationId). Their participants
//    are the agents who work there; they surface as a marker on the map.
//
// Detail fields answer, for the info panel: what happens, the background of the
// activity, the relationships among participants, the current context, and the
// tasks / interaction goals each character may pursue.

export type ScenarioScope = 'universal' | 'local';

export type ScenarioDef = {
  id: string;
  name: string;
  emoji: string;
  scope: ScenarioScope;
  // Required for local scenarios — the CITY_LOCATIONS / CHARACTER_WORKPLACES id.
  locationId?: string;
  // How long the scenario stays active, in real-world ms. Optional; falls back to
  // SCENARIO_DEFAULT_DURATION_MS.
  durationMs?: number;
  // Minimum participants required for the scenario to start.
  minParticipants: number;
  // The directive injected into each participant's prompts while active.
  instruction: string;
  // --- Info-panel detail ---
  whatHappens: string;
  background: string;
  relationships: string;
  context: string;
  goals: string;
  // --- Dialogue steering ---
  // Concrete discussion beats injected into participants' conversation prompts so
  // they work through real content instead of repeating themselves.
  topics: string[];
  // One sentence describing when the conversation has accomplished its purpose.
  // The dialogue goal-judge (decideNextSpeaker) uses this to decide the chat may
  // wrap up; otherwise it runs to the max-turn cap.
  completionGoal: string;
};

export const UNIVERSAL_SCENARIOS: ScenarioDef[] = [
  {
    id: 'downpour',
    name: 'Sudden Downpour',
    emoji: '⛈️',
    scope: 'universal',
    minParticipants: 2,
    instruction:
      'A sudden tropical thunderstorm has burst over the town. You are caught in the rain and ducking for shelter. React to the downpour — grumble about it, share an umbrella or a dry spot, and make small talk while you wait it out.',
    whatHappens:
      'A heavy, no-warning thunderstorm sweeps across the town. Everyone outdoors rushes for cover under awnings, void decks, and shop fronts, crowding together until it passes.',
    background:
      'Singapore’s afternoon storms arrive in minutes and soak anyone caught without an umbrella. Strangers routinely end up huddled under the same shelter, which makes the rain a great social leveller.',
    relationships:
      'Whoever happens to be nearby is thrown together — friends, acquaintances, and total strangers all sharing one dry patch of pavement.',
    context:
      'It is pouring right now and nobody planned for it. Shelter is limited and everyone is a little damp and stuck in place for a while.',
    goals:
      'Find or share shelter, offer an umbrella to someone who has none, complain good-naturedly about the weather, and pass the time with whoever is stuck alongside you.',
    topics: [
      'where the nearest dry shelter is and whether there is room',
      'sharing an umbrella or a dry spot with someone who has none',
      'how long this storm is likely to last',
      'what plans the rain has just ruined or delayed',
      'how everyone will get home without getting soaked',
    ],
    completionGoal:
      'everyone present has sorted out shelter or an umbrella and agreed a plan for once the rain eases',
  },
  {
    id: 'national_day',
    name: 'National Day Buzz',
    emoji: '🇸🇬',
    scope: 'universal',
    instruction:
      "It's National Day and the town is buzzing with celebration. Talk about the parade, the fireworks, where to watch the flypast, and share your plans and patriotic excitement.",
    minParticipants: 2,
    whatHappens:
      'The whole town is in a festive National Day mood — flags on the HDB blocks, the roar of the flypast overhead, and everyone comparing plans for the evening fireworks.',
    background:
      'National Day on 9 August is the high point of Singapore’s civic calendar: the parade, the flypast, community heartland celebrations, and fireworks over the bay.',
    relationships:
      'Neighbours, colleagues, and friends share the holiday mood; even reserved people loosen up and chat about the celebrations.',
    context:
      'It is National Day. People are deciding where and with whom to watch the fireworks and trading memories of past parades.',
    goals:
      'Share your celebration plans, invite others to watch the fireworks together, reminisce about past National Days, and soak up the patriotic mood.',
    topics: [
      'the best spot to catch the flypast',
      'plans for watching the evening fireworks over the bay',
      'favourite memories from past National Day parades',
      'food and where to gather beforehand',
      'who is coming along and how to meet up',
    ],
    completionGoal:
      'the group has agreed where and with whom to watch the fireworks or flypast together',
  },
  {
    id: 'mrt_breakdown',
    name: 'MRT Breakdown',
    emoji: '🚇',
    scope: 'universal',
    instruction:
      'An island-wide MRT disruption has thrown everyone’s commute into chaos. Vent about the breakdown, swap alternative-route tips, arrange shared cabs, and figure out how to get where you need to be.',
    minParticipants: 2,
    whatHappens:
      'A major rail line has gone down across the island. Stations are jammed, shuttle-bus queues stretch around the block, and everyone is scrambling for another way to get around.',
    background:
      'Train disruptions are a recurring sore point in Singapore — they snarl commutes for hundreds of thousands and dominate conversation (and complaints) for the rest of the day.',
    relationships:
      'Stranded commuters commiserate; drivers and people with cars suddenly become very popular among those needing a lift.',
    context:
      'The trains are down right now. People are late, frustrated, and bargaining for alternative transport.',
    goals:
      'Vent about the breakdown, share the fastest workaround, offer or angle for a shared ride, and help each other actually get moving.',
    topics: [
      'which line is down and how bad the jam is',
      'the fastest alternative route or shuttle',
      'sharing a cab to split the fare',
      'who is running late and what for',
      'whether to wait it out or set off now',
    ],
    completionGoal:
      'each person has a concrete way to get where they need to be (a shared cab arranged or a route chosen)',
  },
  {
    id: 'haze',
    name: 'Haze Advisory',
    emoji: '😷',
    scope: 'universal',
    instruction:
      'A thick haze has settled over the town and the air quality is unhealthy. Talk about the PSI reading, masks, staying indoors, and looking out for the more vulnerable. Keep outdoor plans short.',
    minParticipants: 2,
    whatHappens:
      'A blanket of transboundary haze pushes the air quality into the unhealthy range. The sky is grey, eyes sting, and everyone is checking the PSI on their phones.',
    background:
      'Seasonal haze drifts over Singapore from regional fires, spiking the PSI and forcing masks, air purifiers, and cancelled outdoor plans for days at a time.',
    relationships:
      'Health-conscious residents fuss over neighbours, the elderly, and anyone with breathing trouble; others just want to grumble about the smell.',
    context:
      'The haze is bad right now. People are masked up, indoors where possible, and worried about the vulnerable.',
    goals:
      'Compare PSI readings, share masks or advice, check on anyone who might be at risk, and rethink any outdoor plans.',
    topics: [
      'the current PSI reading and whether it is still climbing',
      'masks — who has spares and where to get more',
      'staying indoors and running air purifiers',
      'checking on the elderly or anyone with breathing trouble',
      'which outdoor plans to cancel or move inside',
    ],
    completionGoal:
      'the group has shared masks or advice and agreed how to look after anyone vulnerable and adjust their outdoor plans',
  },
  {
    id: 'cny_eve',
    name: 'Lunar New Year Eve',
    emoji: '🧧',
    scope: 'universal',
    instruction:
      "It's the eve of Lunar New Year. Talk about reunion dinner, ang pao, visiting plans, and well-wishes. Be warm, festive, and a little nostalgic about family.",
    minParticipants: 2,
    whatHappens:
      'The town winds down into reunion-dinner mode on the eve of Lunar New Year — red decorations everywhere, talk of family gatherings, and ang pao being prepared.',
    background:
      'Lunar New Year is the biggest family festival for much of Singapore: reunion dinners, ang pao (red packets), visiting relatives, and exchanging auspicious greetings.',
    relationships:
      'Family and close friends feature heavily; even acquaintances exchange new-year well-wishes and compare visiting schedules.',
    context:
      'It is the eve of Lunar New Year. People are heading to or planning reunion dinners and sorting out who is visiting whom.',
    goals:
      'Exchange new-year greetings, compare reunion-dinner and visiting plans, talk ang pao, and share a little family nostalgia.',
    topics: [
      'reunion-dinner menu and who is hosting',
      'getting the ang pao ready',
      'the visiting schedule — who visits whom and when',
      'exchanging auspicious new-year greetings',
      'a little nostalgia about past family gatherings',
    ],
    completionGoal:
      'the group has exchanged greetings and compared or coordinated their reunion-dinner and visiting plans',
  },
];

export const LOCAL_SCENARIOS: ScenarioDef[] = [
  // --- A*STAR ---
  {
    id: 'astar_grant_crunch',
    name: 'Grant Deadline Crunch',
    emoji: '🧪',
    scope: 'local',
    locationId: 'astar',
    minParticipants: 2,
    instruction:
      'A major research grant proposal is due tonight and the lab is in crunch mode. Focus on finishing the proposal — push on results, argue over framing and numbers, divide up the writing, and keep each other going.',
    whatHappens:
      'The lab scrambles to finish a make-or-break grant proposal before the midnight deadline. Results are being re-run, sections rewritten, and nerves are fraying as the clock ticks.',
    background:
      'A*STAR labs live and die by competitive grants. A big submission means days of intense work culminating in a frantic final push to get every figure and claim right.',
    relationships:
      'The senior scientist (PI) leads and defends the team’s budget; postdocs and researchers carry the technical work and lean on each other under pressure.',
    context:
      'It is deadline day. The proposal is nearly done but not quite, and there is no time to spare.',
    goals:
      'Clara should steer the framing and keep morale up; Lukas should nail down the experimental results and methods; Isabel should pressure-test the ideas and catch flaws — together get the proposal submitted in time.',
    topics: [
      'whether the latest experimental results actually hold up',
      'how to frame the proposal’s central claim',
      'the budget numbers and justification',
      'who writes which section of what remains',
      'the submission logistics and the midnight deadline',
    ],
    completionGoal:
      'the team has divided up the remaining sections and agreed the proposal can be finished and submitted in time',
  },
  {
    id: 'astar_demo_day',
    name: 'Lab Demo Day',
    emoji: '🔬',
    scope: 'local',
    locationId: 'astar',
    minParticipants: 2,
    instruction:
      'Visiting officials are touring the lab today. Present your work impressively, coordinate who explains what, and make the research sound exciting and important.',
    whatHappens:
      'Funders and ministry officials are touring the lab. The team must present their research crisply and make a strong impression while everything is on display.',
    background:
      'Demo days and VIP visits are a fact of life at a national research agency — they shape reputations and future funding, so the lab puts its best foot forward.',
    relationships:
      'The PI fronts the visit and introduces the team; the researchers each own a piece of the demo and try not to step on each other’s lines.',
    context:
      'The visitors arrive any moment. The lab is tidied, the slides are ready, and everyone is a little nervous.',
    goals:
      'Clara should host the tour and tie the story together; Lukas and Isabel should each explain their part clearly and field tough questions without getting lost in jargon.',
    topics: [
      'who explains which part of the demo',
      'the single key message to leave the visitors with',
      'how to handle tough or sceptical questions',
      'the running order of the tour',
      'last-minute setup and tidying',
    ],
    completionGoal:
      'the team has agreed who presents what and is ready to receive the visitors',
  },
  // --- Hawker Centre / kopitiam ---
  {
    id: 'hawker_lunch_rush',
    name: 'Lunch Rush Mayhem',
    emoji: '🍜',
    scope: 'local',
    locationId: 'restaurant',
    minParticipants: 2,
    instruction:
      'It’s the peak lunch rush and the hawker centre is slammed. Orders are flying, the queue is out the door, and tables need clearing. Move fast, call out orders, help each other keep up, and banter with the crowd.',
    whatHappens:
      'The lunch crowd descends all at once and every stall is swamped. Woks roar, drinks orders pile up, and the stallholders race to keep the line moving without losing their cool.',
    background:
      'The midday rush is the make-or-break hour at a hawker centre — an hour of controlled chaos where speed, memory, and teamwork decide whether everyone gets fed.',
    relationships:
      'The cooked-food and drinks stalls depend on each other and on regulars; tempers flare but there’s real camaraderie under the pressure.',
    context:
      'The queue is out the door right now and tickets are stacking up. There’s no time to stand still.',
    goals:
      'Sarah should fire out orders and command the floor; Rahman should keep the drinks flowing and soothe impatient customers; together clear the backlog and keep the regulars happy.',
    topics: [
      'clearing the backlog of tickets',
      'splitting the work — who handles food vs drinks',
      'calling out and keeping track of orders',
      'clearing and turning over tables fast',
      'keeping the regulars and the queue happy',
    ],
    completionGoal:
      'they have split the work to clear the backlog and have the lunch rush under control',
  },
  {
    id: 'hawker_inspection',
    name: 'Surprise Health Inspection',
    emoji: '🧼',
    scope: 'local',
    locationId: 'restaurant',
    minParticipants: 2,
    instruction:
      'A surprise health inspector has just shown up. Scramble to clean up, check the stall’s hygiene, coordinate quietly with the other stallholders, and try to pass the inspection without panicking.',
    whatHappens:
      'An NEA inspector arrives unannounced and starts working down the row of stalls. Everyone springs into a quiet frenzy of wiping, tidying, and double-checking before their turn comes.',
    background:
      'Hygiene grades are posted publicly and matter enormously to a stall’s reputation. A surprise inspection is a small crisis the whole hawker centre rides out together.',
    relationships:
      'Rival stallholders briefly become allies, passing warnings and lending cloths down the line as the inspector advances.',
    context:
      'The inspector is here right now, a few stalls away and getting closer.',
    goals:
      'Sarah should whip her stall into shape and keep her composure; Rahman should pass the word and help the others; both should aim to come through the inspection clean.',
    topics: [
      'what the inspector is most likely to check',
      'the cleaning and tidying to do right now',
      'passing the warning down the row of stalls',
      'keeping calm and composed',
      'who deals with the inspector when they arrive',
    ],
    completionGoal:
      'their stalls are tidied and they have coordinated to get through the inspection cleanly',
  },
  // --- Café (shophouses) ---
  {
    id: 'cafe_latte_art',
    name: 'Latte-Art Throwdown',
    emoji: '☕',
    scope: 'local',
    locationId: 'shophouses',
    minParticipants: 1,
    instruction:
      'A friendly latte-art throwdown is happening at the café and a little crowd has gathered. Show off your pours, hype up the competition, judge the rosettas, and pull people into the fun.',
    whatHappens:
      'The café hosts an impromptu latte-art throwdown. Baristas (and brave regulars) take turns pouring rosettas and tulips while a small crowd cheers and judges.',
    background:
      'Third-wave cafés run latte-art throwdowns as part competition, part social event — a chance to show off craft and draw a lively, caffeinated crowd.',
    relationships:
      'The barista is the host and ringleader; regulars and passers-by become contestants, hecklers, and judges.',
    context:
      'The throwdown is underway right now, milk jugs at the ready and a crowd watching each pour.',
    goals:
      'Cedric should run the throwdown, hype every pour, and rope newcomers in; everyone else should pick favourites, trash-talk gently, and have a go.',
    topics: [
      'the running order — who pours next',
      'judging the rosettas and tulips',
      'hyping up the crowd',
      'roping newcomers into having a go',
      'who is winning so far',
    ],
    completionGoal:
      'they have run a few rounds, judged the pours, and crowned a winner (or agreed to keep it going)',
  },
  // --- Taxi stand / MBS ---
  {
    id: 'mbs_convention_surge',
    name: 'Convention Surge',
    emoji: '🚕',
    scope: 'local',
    locationId: 'mbs',
    minParticipants: 1,
    instruction:
      'A huge convention just let out at Marina Bay Sands and there’s a surge of people needing rides. The taxi queue is chaos. Manage the rush, talk surge pricing and routes, and keep tempers in check.',
    whatHappens:
      'Thousands spill out of a convention at once and descend on the taxi stand. The queue snakes back on itself, surge pricing kicks in, and drivers and riders jostle to sort it out.',
    background:
      'MBS hosts massive conventions whose closing sessions dump a wall of people onto the taxi stand all at once — a famous pressure point for drivers working the bay.',
    relationships:
      'Drivers compete for the best fares while loosely cooperating to keep the queue moving; tourists and delegates need directions and reassurance.',
    context:
      'The crowd is surging right now and the queue is barely holding together.',
    goals:
      'James should work the queue, snag good fares, and help confused tourists; everyone should keep the line orderly and the mood from boiling over.',
    topics: [
      'managing the taxi queue so it keeps moving',
      'surge pricing and which fares are worth taking',
      'the best routes out of the bay',
      'helping confused tourists and delegates',
      'keeping tempers from boiling over',
    ],
    completionGoal:
      'they have the queue moving in an orderly way and have sorted out fares and directions for the crowd',
  },
  // --- Temasek Poly ---
  {
    id: 'poly_deadline_panic',
    name: 'Project Deadline Panic',
    emoji: '💻',
    scope: 'local',
    locationId: 'university',
    minParticipants: 1,
    instruction:
      'A big project is due tonight and the whole campus is in a panic. Cram, debug, beg teammates for their parts, fuel up on caffeine, and try to ship it before the deadline.',
    whatHappens:
      'A major project deadline looms and the campus is a sea of stressed students debugging, merging last-minute changes, and pleading for extensions.',
    background:
      'Polytechnic project deadlines are infamous all-nighters — group work, last-minute integration, and a frantic dash to submit before the portal closes.',
    relationships:
      'Project teammates depend on (and blame) each other; friends share notes, chargers, and moral support across the chaos.',
    context:
      'The deadline is tonight and nothing is quite finished yet.',
    goals:
      'Xavier should rally his team, debug the worst fires, and keep spirits up with memes; everyone should get their part in and submit before the portal closes.',
    topics: [
      'which parts of the project are still unfinished',
      'debugging the worst bugs first',
      'who owns which remaining piece',
      'fuelling up on caffeine and snacks',
      'submitting before the portal closes',
    ],
    completionGoal:
      'they have split the remaining work and have a plan to ship the project before the deadline',
  },
];

export const ALL_SCENARIOS: ScenarioDef[] = [...UNIVERSAL_SCENARIOS, ...LOCAL_SCENARIOS];

export function scenarioById(id: string): ScenarioDef | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}
