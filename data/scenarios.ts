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


// caine/ focal agent summarise agentes memories
// decider makes optimal scenario decision
// focal agent makes the decision and matches against decider's decision
// store mood with convo

export type ScenarioScope = 'universal' | 'local';

// What a scenario is ultimately for:
//  - 'tasks'    (default for local scenarios): after the planning conversation the
//    group delegates concrete work and enters the "working" phase (progress bars).
//  - 'decision' (default for universal scenarios): the group just needs to reach a
//    joint decision — no tasks, no working phase; the scenario ends on goal-met.
export type ScenarioOutcome = 'tasks' | 'decision';

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
  // The kind of resolution the scenario drives toward. Defaults (resolved in
  // startScenario): local -> 'tasks', universal -> 'decision'.
  outcome?: ScenarioOutcome;
  // Can this be settled over the phone? True for situations that are about
  // ARRANGING something for later — the kind of thing people really do sort out
  // by group chat between customers. When such a scenario comes up while its cast
  // is on shift, it opens a text thread instead of queueing until they're free
  // (see convex/aiTown/scenarios.ts). Reactive, physical situations are not
  // textable: you can't text your way out of being caught in a downpour.
  textable?: boolean;
  // The directive injected into each participant's prompts while active.
  instruction: string;
  // --- Info-panel detail ---
  whatHappens: string;
  background: string;
  relationships: string;
  context: string;
  goals: string;
  // An authored point of disagreement — the fault line and the opposing positions
  // (e.g. "split over rushing the submission tonight vs asking for an extension").
  // Injected into participants' prompts so they take clear sides and argue it out
  // before resolving. Optional; omit for a friction-free scenario.
  conflict?: string;
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
    name: 'CNY Eve',
    emoji: '🧧',
    scope: 'universal',
    instruction:
      "It's the eve of Lunar New Year. Talk about reunion dinner, ang pao, visiting plans, and well-wishes. Be warm, festive, and a little nostalgic about family.",
    minParticipants: 2,
    textable: true,
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
  {
    id: 'dinner_decision',
    name: 'What’s for Dinner?',
    emoji: '🍽️',
    scope: 'universal',
    outcome: 'decision',
    minParticipants: 2,
    textable: true,
    instruction:
      'The group is hungry and trying to agree on where to eat together tonight. Push for the food YOU want, weigh price, distance, queue and cravings, and hash it out until everyone lands on ONE place.',
    whatHappens:
      'A hungry huddle forms over the eternal question of where to eat. Suggestions fly — hawker, zi char, a new café, prata at midnight — and nobody wants to be the one who decides.',
    background:
      'Deciding what to eat is Singapore’s favourite low-stakes argument. Everyone has a craving, a budget, and a strong opinion on whether it’s worth queueing.',
    relationships:
      'Friends and neighbours who eat together often, each with well-known food quirks — the fussy one, the cheapskate, the one who always suggests the same stall.',
    context:
      'It is dinnertime and everyone is hungry and slightly cranky. No one has committed to a plan yet.',
    goals:
      'Champion your own craving, veto what you can’t stand, factor in cost and queue, and get the group to actually commit to one place instead of dithering.',
    conflict:
      'Cravings clash hard: someone wants cheap familiar hawker food, someone wants to splurge on the trendy new place, someone is sick of the usual and someone just wants whatever is closest. Budget versus adventure versus effort — nobody wants to give in first.',
    topics: [
      'what everyone is actually craving tonight',
      'cheap and familiar versus somewhere new and pricier',
      'how far to travel and how long the queue will be',
      'dietary limits and who refuses what',
      'locking in one final choice everyone can live with',
    ],
    completionGoal:
      'the group has settled on ONE specific place to eat that everyone has agreed to',
  },
  {
    id: 'movie_night_pick',
    name: 'Movie Night Pick',
    emoji: '🎬',
    scope: 'universal',
    outcome: 'decision',
    minParticipants: 2,
    textable: true,
    instruction:
      'The group is planning a movie night and can’t agree on what to watch. Argue for your genre, talk showtimes or streaming, and settle on ONE film everyone will actually sit through.',
    whatHappens:
      'A movie night is coming together, but the group chat has stalled on the only hard part: what to actually watch. Everyone has a pick and a reason the others are wrong.',
    background:
      'Picking a film for a group is a negotiation — action fans, horror lovers, and the person who only wants a feel-good comedy all have to be satisfied at once.',
    relationships:
      'A friend group that hangs out often; their taste differences are a running joke, and someone always ends up outvoted.',
    context:
      'The night is set but the film is not. People are lobbying hard for their pick.',
    goals:
      'Pitch your genre, shoot down the ones you’ll hate, weigh runtime and where to watch, and get the group to commit to a single film.',
    conflict:
      'Tastes are genuinely opposed: one wants a scary horror, one refuses anything violent, one wants a long epic and one will fall asleep past two hours. Everyone thinks their pick is the obvious choice.',
    topics: [
      'which genre the night should be',
      'a specific film each person is pushing for',
      'runtime and how late it will run',
      'cinema tickets versus streaming at home',
      'agreeing on the one film to watch',
    ],
    completionGoal:
      'the group has chosen ONE specific film to watch together',
  },
  {
    id: 'weekend_trip_plan',
    name: 'Weekend Trip Plan',
    emoji: '🧳',
    scope: 'universal',
    outcome: 'decision',
    minParticipants: 2,
    textable: true,
    instruction:
      'The group is toying with a short weekend getaway and needs to agree where to go. Push your destination, weigh budget and travel time, and decide on ONE plan (or agree to bail).',
    whatHappens:
      'Talk turns to escaping for the weekend — a JB food run, a Batam beach, or just a staycation. Excitement is high but nobody agrees on where or how much to spend.',
    background:
      'Quick regional getaways are a beloved Singapore weekend habit, but they live or die on agreeing budget, timing, and who is actually free.',
    relationships:
      'Friends who travel well together in theory but have very different budgets and tolerances for hassle.',
    context:
      'The weekend is open and the idea of a trip is on the table, but nothing is booked and opinions differ.',
    goals:
      'Pitch your ideal getaway, be honest about budget and time, weigh the hassle, and get the group to commit to a single plan or call it off.',
    conflict:
      'The split is real: one wants a cheap no-frills day trip, one wants a proper hotel weekend, one is worried about money, and one would rather just staycation at home. Ambition versus budget versus effort.',
    topics: [
      'where to actually go — or whether to stay in',
      'the budget everyone can stomach',
      'how much travel and hassle is worth it',
      'who is genuinely free and committed',
      'locking in one plan or deciding to bail',
    ],
    completionGoal:
      'the group has agreed on ONE weekend plan (a specific destination, or a clear decision not to go)',
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
    conflict:
      'The team is split on whether to submit tonight. One camp wants to send the strong-but-imperfect proposal in before the midnight deadline; the other insists the shakier results need re-running first, even if it means begging for an extension. Money, pride, and whose section is weakest are all on the line.',
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
    conflict:
      'They disagree on how to handle the inspector. One wants to quietly warn every stall down the row and present a united front; the other thinks tipping people off is asking for trouble and each stall should just cover itself. There is old rivalry under the sudden teamwork.',
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
  // --- Local DECISION scenarios (no tasks — the group just has to decide) ---
  {
    id: 'cafe_new_drink',
    name: 'New Drink to Add',
    emoji: '🧋',
    scope: 'local',
    locationId: 'shophouses',
    outcome: 'decision',
    minParticipants: 2,
    instruction:
      'The café is deciding on ONE new drink to add to the menu this season. Pitch your idea, argue over what customers actually want versus what’s fun to make, and settle on a single addition.',
    whatHappens:
      'Between orders the café crew debates the one new drink to put on the season’s menu — a trendy matcha, a classic they do better, or a wildcard special.',
    background:
      'A café’s menu is its personality. A new drink has to sell, fit the brand, and not slow the bar down during a rush — so the choice matters more than it sounds.',
    relationships:
      'Baristas who take pride in their craft, with friendly rivalry over whose taste is better and who has to actually make the thing all day.',
    context:
      'It is a quiet lull and the menu decision has been put off long enough — they need to pick today.',
    goals:
      'Argue for your drink, weigh what will actually sell against what’s fun or on-trend, consider cost and how fiddly it is to make, and commit to one.',
    conflict:
      'Two visions clash: one wants a safe crowd-pleaser that sells and pours fast, the other wants an ambitious signature drink that’s trendy but slow and pricey to make. Craft pride versus practicality.',
    topics: [
      'what customers are actually asking for',
      'trendy signature drink versus reliable crowd-pleaser',
      'ingredient cost and margin',
      'how fiddly it is to make during a rush',
      'committing to one drink for the menu',
    ],
    completionGoal:
      'they have agreed on ONE specific new drink to add to the menu',
  },
  {
    id: 'astar_project_priority',
    name: 'Which Project First',
    emoji: '🧭',
    scope: 'local',
    locationId: 'astar',
    outcome: 'decision',
    minParticipants: 2,
    instruction:
      'The lab can only push ONE project hard this quarter and has to decide which. Make the case for the direction you believe in, weigh impact against feasibility, and reach a joint call.',
    whatHappens:
      'With limited time and people, the lab huddles to decide which project gets the resources this quarter — and which get parked.',
    background:
      'Research groups constantly triage: chasing the exciting high-risk idea versus the safer work that reliably produces papers and keeps funders happy.',
    relationships:
      'A PI and researchers who respect each other but have staked their reputations on different lines of work.',
    context:
      'Resourcing is due and they can’t hedge any longer — one project has to be chosen to lead with.',
    goals:
      'Advocate for your preferred project, be honest about risk and effort, weigh impact versus what’s achievable, and converge on a single priority.',
    conflict:
      'The split is sharp: one backs the bold, high-risk project that could be a breakthrough (or a dead end); the other wants the safe, incremental work that guarantees results and funding. Ambition versus security — and each has a personal stake in their line.',
    topics: [
      'the potential impact of each project',
      'how realistic each is with the time and people available',
      'what funders and reviewers will reward',
      'whose work gets parked and how they feel about it',
      'committing to one project to lead with',
    ],
    completionGoal:
      'the lab has agreed which single project to prioritise this quarter',
  },
  {
    id: 'hawker_price_change',
    name: 'Raise Prices?',
    emoji: '💰',
    scope: 'local',
    locationId: 'restaurant',
    outcome: 'decision',
    minParticipants: 2,
    instruction:
      'Costs are up and the stallholders are debating whether to raise prices — and by how much. Argue your position, weigh regulars versus margins, and reach a decision together.',
    whatHappens:
      'Over a slow stretch the hawkers thrash out the touchy question of raising prices as ingredient costs climb, worried about scaring off loyal regulars.',
    background:
      'Hawker prices are famously sensitive — even a fifty-cent rise makes the news and upsets regulars, but stallholders are squeezed by rising costs and rent.',
    relationships:
      'Neighbouring stallholders who’ve fed the same regulars for years and don’t want to be the first to hike prices.',
    context:
      'Costs have risen enough that the status quo is hurting, and they need to decide on a stance today.',
    goals:
      'State your position on raising prices, weigh keeping regulars happy against staying afloat, consider portion sizes as an alternative, and reach a shared decision.',
    conflict:
      'They genuinely disagree: one insists on holding prices to protect loyal regulars and reputation, even if margins bleed; the other says refusing to raise prices is unsustainable and they’ll go under being sentimental. Loyalty versus survival.',
    topics: [
      'how much costs have actually gone up',
      'whether regulars will tolerate a rise',
      'shrinking portions instead of raising prices',
      'raising together versus each stall deciding alone',
      'agreeing on a final stance and amount',
    ],
    completionGoal:
      'the stallholders have agreed on a clear decision about whether and how much to raise prices',
  },
];

export const ALL_SCENARIOS: ScenarioDef[] = [...UNIVERSAL_SCENARIOS, ...LOCAL_SCENARIOS];

export function scenarioById(id: string): ScenarioDef | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}
