// Hidden ground-truth constraints for the Decider-Focal-Evaluator engine.
//
// This is the answer key. It is read by exactly one thing — convex/evaluator.ts,
// which scores a group's decision after the fact. The Decider and the Focal agent
// never see it: their whole job is to infer it from what people actually say in
// the conversation, and the gap between what they inferred and what was true is
// the regret number the engine reports.
//
// Keyed by character NAME rather than playerId because GameIds ('p:7') are
// allocated per world and reassigned on every wipe+init, exactly like the
// `family` ties in data/characters.ts.
//
// Most fields are distilled straight from each character's `profile` map in
// data/characters.ts. Three constraints are NOT in the authored profiles and were
// added so the engine's hard-taboo path is exercised by more than one character —
// each is marked `[ADDED]` below. They are additive (nothing in the authored
// identity text contradicts them) and they are the kind of thing a person would
// plausibly not announce unprompted, which is the point. Delete the `[ADDED]`
// entries to run with Rahman as the only taboo-holder; nothing else depends on
// them.

export type GroundTruthProfile = {
  culturalBackground: string;
  religion: string;
  // Absolute constraints — religious restriction, medical/allergy, or legal rule.
  // Violating one zeroes that agent's utility no matter how good the option is
  // otherwise. Strong dislikes and diets-of-choice belong in `preferences`.
  hardTaboos: string[];
  // Practical requirements that dominate whether an option works at all for this
  // person. Feeds the heaviest (35-weight) dimension.
  essentialNeeds: string[];
  preferences: string[];
  // Rough ceiling in SGD for one outing. 0 means effectively unconstrained.
  budgetLimit: number;
  communicationStyle: string;
};

export const groundTruth: Record<string, GroundTruthProfile> = {
  Lukas: {
    culturalBackground: 'Bavarian German; recently arrived in Singapore',
    religion: 'Secular / no religion',
    hardTaboos: [],
    essentialNeeds: [
      'A plan fixed in advance with a definite time and place — open-ended "we\'ll see" arrangements are genuinely stressful for him',
      'Somewhere reachable without a long unplanned detour',
    ],
    preferences: [
      'Bread, cured meats, strong coffee, craft beer',
      'Still building spice tolerance; struggles with very oily or very sweet food',
      'Splits the bill strictly to the cent and is uncomfortable being treated',
      'Air-conditioned or shaded — has not adjusted to the heat',
    ],
    budgetLimit: 60,
    communicationStyle: 'Blunt and concise; says exactly what he means',
  },

  Cedric: {
    culturalBackground: 'Singaporean; third-wave coffee scene',
    religion: 'Secular / no religion',
    hardTaboos: [],
    essentialNeeds: [
      'Somewhere with enough life and chatter to actually be sociable — a silent room defeats the purpose for him',
    ],
    preferences: [
      'Single-origin coffee, pastries, café fare',
      'Happy to treat people and dislikes fussy bill-splitting',
      'Enjoys somewhere new he can talk about afterwards',
    ],
    budgetLimit: 40,
    communicationStyle: 'Chatty and welcoming',
  },

  James: {
    culturalBackground: 'Singaporean Chinese; heartland Grab-driver community',
    religion: 'Secular / no religion',
    hardTaboos: [
      // [ADDED] Not in his authored profile. Fits an older driver who "smiles
      // through the pain" and is "reserved and proud" — exactly the sort of
      // person who would quietly order around a restriction rather than announce
      // it, which makes him a good test of whether the Focal agent asks.
      'Doctor-ordered low salt and low sugar — no heavily salted, deep-fried or sugar-heavy mains, no sweetened drinks (medical)',
    ],
    essentialNeeds: [
      'Somewhere he can park, or that sits on a route he already drives',
      'Proper seating — he cannot stand around for long',
    ],
    preferences: [
      'Hawker food, char kway teow, kopi',
      'A cold beer after his shift',
      'Careful and practical with money; dislikes anything he considers a rip-off',
    ],
    budgetLimit: 25,
    communicationStyle: 'Bright Singlish; laughs things off',
  },

  Sarah: {
    culturalBackground: 'Singaporean Chinese; second-generation hawker family',
    religion: 'Christian (cultural observance)',
    hardTaboos: [],
    essentialNeeds: [
      'Timing that fits around the stall — nothing that collides with the dinner rush',
    ],
    preferences: [
      'Hawker classics; sharply critical of overpriced food she could cook better',
      'Quietly generous — would rather slip someone extra than split hairs over a bill',
      'Impatient with long queues and drawn-out plans',
    ],
    budgetLimit: 30,
    communicationStyle: 'Fast, blunt, tough on the surface',
  },

  Rahman: {
    culturalBackground: 'Tamil-Muslim Singaporean, second generation',
    religion: 'Muslim (practicing)',
    hardTaboos: [
      'Halal only — no pork and no non-halal meat',
      'No alcohol, including alcohol used in cooking',
    ],
    essentialNeeds: [
      'A halal option genuinely available on the menu, not just a vegetarian side',
      'Timing that leaves room for prayer; Friday prayers are fixed',
    ],
    preferences: [
      'Teh tarik, roti prata, mutton curry, kopi',
      'Somewhere everyone can be comfortable — he will quietly absorb a worse option to keep the peace',
      'Generous; likes to cover other people',
    ],
    budgetLimit: 30,
    communicationStyle: 'Chatty Singlish; banters with everyone',
  },

  Isabel: {
    culturalBackground: 'Downtown AI startup scene; few strong cultural ties',
    religion: 'Secular / no religion',
    hardTaboos: [
      // [ADDED] Not in her authored profile, which says only "No restrictions;
      // forgets to eat when absorbed" — so nothing is contradicted. She is
      // "reserved" and "lives in her own head", so she would not volunteer it.
      'Shellfish allergy — no prawn, crab or shellfish, including in stocks, sauces and pastes (medical)',
    ],
    essentialNeeds: [
      'Not so loud or crowded that she cannot hold a thought or hear a conversation',
    ],
    preferences: [
      'Largely indifferent to food; will eat whatever is put in front of her',
      'Absent-minded about money — neither cost-conscious nor extravagant',
      'Prefers a small group to a big noisy one',
    ],
    budgetLimit: 60,
    communicationStyle: 'Oblique technical riddles; half-finished sentences',
  },

  Xavier: {
    culturalBackground: 'Singaporean; Gen-Z polytechnic student',
    religion: 'Secular / no religion',
    hardTaboos: [],
    essentialNeeds: [
      // [ADDED] as a hard budget ceiling rather than a taboo — being priced out
      // is a cost problem, not a violated principle, so it belongs here and in
      // budgetLimit rather than in hardTaboos.
      'A total he can genuinely afford on a student budget — roughly S$15 is the real ceiling',
      'Late enough not to collide with classes or a submission deadline',
    ],
    preferences: [
      'Iced Milo, cheap eats, supper',
      'Somewhere casual — he will not enjoy anywhere he has to dress up for',
      'Goes along with whatever the group wants rather than argue',
    ],
    budgetLimit: 15,
    communicationStyle: 'Gen-Z slang; keeps things light',
  },

  Clara: {
    culturalBackground: 'British; long-term expatriate in Singapore',
    religion: 'Secular / nominally Anglican',
    hardTaboos: [],
    essentialNeeds: [
      'Somewhere a proper conversation is actually possible',
    ],
    preferences: [
      'Pescatarian-leaning — strongly prefers fish or vegetarian over red meat, but will eat around it rather than refuse',
      'Good wine, seafood, cheese, a proper cup of tea',
      'Comfortable treating the group; unbothered by cost',
      'Low tolerance for badly made coffee and overcooked food',
    ],
    budgetLimit: 80,
    communicationStyle: 'Articulate and measured; makes complex things clear',
  },

  // ---------------------------------------------------------------------------
  // The wider cast. Unlike the three `[ADDED]` entries above, nothing here is
  // invented: every taboo, need and preference is distilled from that character's
  // row in the 'Agent Setting' spreadsheet (see data/characterProfiles.ts). The
  // spreadsheet supplies plenty of constraints a person plausibly would not
  // announce unprompted, which is exactly what the Focal agent has to dig out.
  // ---------------------------------------------------------------------------

  Yvonne: {
    culturalBackground: 'Chinese Singaporean; junior officer in the public service',
    religion: 'Buddhist-leaning (moderate personal observance)',
    hardTaboos: [
      'Cannot accept anything that could read as an improper benefit through her public-sector role — being treated by anyone with business before her agency is out of the question',
    ],
    essentialNeeds: [
      'A bill that can be split cleanly and visibly, so nobody could ever say she was hosted',
      'Vegetarian food available on Buddhist observance days, which she will not flag in advance',
    ],
    preferences: [
      'Spicy Sichuan food, hotpot, mapo tofu; finds bland food genuinely disappointing',
      'Avoids heavy drinking',
      'Uncomfortable receiving an expensive gift of any kind',
    ],
    budgetLimit: 35,
    communicationStyle: 'Formal and polite',
  },

  Bernard: {
    culturalBackground: 'Chinese Singaporean; retired schoolteacher, decades in the estate',
    religion: 'Buddhist-Taoist family background; low ritual observance',
    hardTaboos: [],
    essentialNeeds: [
      'Flat, short routes — his knees rule out steep stairs or a long walk from the carpark',
      'An early finish; he is asleep by nine and will simply not come to a late plan',
      'No public confrontation — a raised voice in the room and he leaves',
    ],
    preferences: [
      'Mild food, rice dishes, tea; very spicy food is off the table',
      'Rarely drinks',
      'Modest reciprocal gifts only; extravagance embarrasses him',
      'Expects an apology to be offered properly, with everyone’s face intact',
    ],
    budgetLimit: 30,
    communicationStyle: 'Indirect and polite',
  },

  Nikhil: {
    culturalBackground: 'Gujarati Singaporean; family from Ahmedabad',
    religion: 'Hindu (high dietary observance)',
    hardTaboos: [
      'Strict vegetarian and no beef — this includes shared serving spoons and buffet lines where meat and vegetarian dishes touch',
    ],
    essentialNeeds: [
      'A kitchen that keeps vegetarian food genuinely separate, not just a vegetarian side dish',
      'Evenings kept free around family religious days',
    ],
    preferences: [
      'Gujarati snacks, vegetarian thali, chai',
      'Usually avoids alcohol-heavy events',
      'Fair cost-sharing worked out properly; dislikes a vague compromise more than an argument',
    ],
    budgetLimit: 40,
    communicationStyle: 'Clear and task-focused',
  },

  Nurul: {
    culturalBackground: 'Malay Singaporean; ward nurse',
    religion: 'Muslim (practicing)',
    hardTaboos: [
      'Halal only — no pork and no non-halal meat',
      'No alcohol, including alcohol used in cooking',
    ],
    essentialNeeds: [
      'Timing that leaves room for prayer, and that works around a rotating shift roster',
      'Not being made the visible reason a plan had to change — she would rather quietly miss it',
    ],
    preferences: [
      'Halal Malay food, nasi padang, soup dishes',
      'Will not split a bill that has alcohol on it',
      'Tired and short on energy after a run of night shifts',
    ],
    budgetLimit: 40,
    communicationStyle: 'Polite and careful',
  },

  Ratna: {
    culturalBackground: 'Javanese Indonesian; live-in domestic worker, six years in Singapore',
    religion: 'Muslim (practicing)',
    hardTaboos: ['Halal only — no pork', 'No alcohol'],
    essentialNeeds: [
      'Something genuinely cheap; she sends most of what she earns home and cannot absorb a surprise',
      'A time that fits her rest day, which she does not control',
      'Somewhere she can follow what is being said — her English and Malay are both limited',
    ],
    preferences: [
      'Indonesian home food, soto, tempeh',
      'Avoids expensive restaurants and anywhere built around drinking',
      'Will not say no directly, and will agree to a plan she cannot actually afford',
    ],
    budgetLimit: 15,
    communicationStyle: 'Soft-spoken; may avoid refusing outright',
  },

  Kerem: {
    culturalBackground: 'Turkish; long-settled logistics manager',
    religion: 'Muslim (moderately observant)',
    hardTaboos: ['No pork'],
    essentialNeeds: [
      'Somewhere the group can actually sit and talk before getting to the hard part',
    ],
    preferences: [
      'Tea, grilled food, kebab',
      'Limited alcohol; not a reason to avoid a place, but not the point of one either',
      'Offers food and tea before raising anything serious',
      'Some awareness of Ramadan and Eid falling across the calendar',
    ],
    budgetLimit: 40,
    communicationStyle: 'Warm and diplomatic',
  },

  Irina: {
    culturalBackground: 'Russian; piano teacher, long-term resident',
    religion: 'Russian Orthodox Christian (moderate to practicing)',
    hardTaboos: [
      'During Orthodox fasting periods she avoids animal products entirely — the fasts are long and she does not mention when she is in one',
    ],
    essentialNeeds: [
      'No long walk — her rheumatism makes distance genuinely painful',
      'An early evening; she is an early sleeper and will not stay out',
      'Somewhere she can hear herself think — a loud casual place is unpleasant, not merely noisy',
    ],
    preferences: [
      'Tea, bread, soups',
      'Limited alcohol',
      'Respectful gifts and formal thanks; becomes stern when she thinks she has been slighted',
    ],
    budgetLimit: 35,
    communicationStyle: 'Slightly formal and reserved',
  },

  Emeka: {
    culturalBackground: 'Igbo Nigerian; construction supervisor and migrant-worker leader',
    religion: 'Pentecostal Christian (practicing)',
    hardTaboos: [],
    essentialNeeds: [
      'Sunday morning kept clear for church, and an early start Monday to Saturday',
      'Migrant-worker voices actually heard in the plan, not decided over',
    ],
    preferences: [
      'Budget meals, rice dishes, grilled meat; overpriced restaurants irritate him',
      'Avoids heavy drinking around church and community',
      'Very careful with money — most of his pay is remittances',
    ],
    budgetLimit: 20,
    communicationStyle: 'Expressive and community-centred',
  },

  Sharifah: {
    culturalBackground: 'Arab Singaporean; hospital pharmacist',
    religion: 'Muslim (practicing)',
    hardTaboos: [
      'Halal only — no pork and no non-halal meat',
      'No alcohol, including alcohol used in cooking',
    ],
    essentialNeeds: [
      'Timing that leaves room for prayer',
      'Somewhere clean enough that she is not quietly worrying about the kitchen',
    ],
    preferences: [
      'Lighter meals, tea, grilled fish',
      'Avoids alcohol-centred venues entirely',
      'Clean payment boundaries; dislikes owing anyone a favour',
      'Modesty and gender comfort matter to her in a crowded social setting',
    ],
    budgetLimit: 40,
    communicationStyle: 'Measured and polite',
  },

  Hanna: {
    culturalBackground: 'Ethiopian; nurse, nine years in town',
    religion: 'Ethiopian Orthodox Christian (practicing)',
    hardTaboos: [
      'During Orthodox fasting periods — which cover much of the year — she avoids all animal products, and she will not volunteer that she is fasting',
    ],
    essentialNeeds: [
      'A genuinely vegan option available during a fast, not just a salad on the side',
      'Not being pressed to eat; she will refuse quietly rather than explain',
    ],
    preferences: [
      'Injera, lentils, coffee',
      'Avoids alcohol during fasting and religious periods',
      'Prefers everyone sharing from the middle over a strict split',
    ],
    budgetLimit: 40,
    communicationStyle: 'Gentle and explanatory',
  },

  Naomi: {
    culturalBackground: 'Jewish Singaporean; litigator at a CBD firm',
    religion: 'Jewish (moderate observance)',
    hardTaboos: ['Kosher-style — no pork and no shellfish'],
    essentialNeeds: [
      'Friday evening and Saturday are unavailable, and she will not renegotiate that for anyone',
      'A payment arrangement stated up front — she will not accept a vague obligation',
    ],
    preferences: [
      'Bagels, salads, Mediterranean food',
      'Limited alcohol; strongly dislikes being pressured to drink',
      'Shuts down intrusive personal questions rather than answer them',
      'High income, but pays her exact share on principle rather than convenience',
    ],
    budgetLimit: 80,
    communicationStyle: 'Direct and precise',
  },

  Tiago: {
    culturalBackground: 'Afro-Brazilian; gigging musician and event helper',
    religion: 'Catholic by upbringing; culturally secular, low observance',
    hardTaboos: [],
    essentialNeeds: [
      'Nothing early — he works nights and genuinely will not make a morning',
      'A total he can cover this week; his income is unstable and he will not say when he is short',
    ],
    preferences: [
      'Street food, barbecue, sweet drinks; overly formal meals put him off',
      'Comfortable with alcohol and nightlife',
      'Flexible about splitting, and generous when he happens to be flush',
      'Does not register that late music is a problem until someone complains',
    ],
    budgetLimit: 20,
    communicationStyle: 'Casual and expressive',
  },

  Harpreet: {
    culturalBackground: 'Punjabi Sikh Singaporean; teacher and community volunteer',
    religion: 'Sikh (practicing)',
    hardTaboos: [],
    essentialNeeds: [
      'A vegetarian option, and a vegetarian table entirely where it is a community meal',
      'Nobody in the group quietly left out or priced out of the plan',
    ],
    preferences: [
      'Vegetarian Punjabi food, lentils, tea',
      'Avoids events built around drinking',
      'Transparent shared contribution over anyone quietly picking up the tab',
      'Community service and religious gatherings can take a weekend out of her calendar',
    ],
    budgetLimit: 40,
    communicationStyle: 'Inclusive and encouraging',
  },

  Mateo: {
    culturalBackground: 'Quechua-Peruvian; groundskeeper, eleven years in town',
    religion: 'Catholic with Indigenous family traditions (moderate)',
    hardTaboos: [],
    essentialNeeds: [
      'Something low-cost; he is on a cleaner’s wage and will not say when a plan is beyond him',
      'Being asked directly — he will not volunteer an opinion, and silence from him is not agreement',
      'Somewhere he can follow the conversation; his English is limited',
    ],
    preferences: [
      'Simple meals, potatoes, corn, soups',
      'Wasteful buffet meals genuinely upset him',
      'Limited alcohol',
      'Church and family customs can take precedence at short notice',
    ],
    budgetLimit: 15,
    communicationStyle: 'Quiet and brief',
  },

  Dylan: {
    culturalBackground: 'Australian; paramedic, moved over from Brisbane',
    religion: 'Secular / no religion',
    hardTaboos: [
      'Severe peanut allergy — no peanuts, peanut oil, satay sauce or anything from a kitchen that cannot rule out cross-contamination (medical)',
    ],
    essentialNeeds: [
      'A kitchen that can actually answer an allergy question, not just say it is probably fine',
      'Timing that works around a shift roster',
    ],
    preferences: [
      'Pub-style food, sandwiches, outdoor meals',
      'Comfortable with alcohol socially',
      'Splits bills casually and does not want a fuss made of it',
      'Will be blunt to the point of rude if he thinks something is unsafe',
    ],
    budgetLimit: 40,
    communicationStyle: 'Direct and informal',
  },

  Aroha: {
    culturalBackground: 'Māori New Zealander; social worker and community mediator',
    religion: 'Christian / culturally spiritual (moderate cultural observance)',
    hardTaboos: [],
    essentialNeeds: [
      'A decision nobody in the group is left bruised by — an efficient plan that costs someone their standing is not one she will agree to',
      'Room in the schedule for community and family gatherings',
    ],
    preferences: [
      'Communal meals, seafood, fruit',
      'Limited alcohol; not central to how she socialises',
      'Everyone contributing what they can, over a strict even split',
      'Would rather talk something through at length than settle it quickly',
    ],
    budgetLimit: 40,
    communicationStyle: 'Warm and story-based',
  },

  Ravi: {
    culturalBackground: 'Indian Singaporean; provision-shop owner on the shophouse row',
    religion: 'Hindu (moderate observance)',
    hardTaboos: ['No beef, ever'],
    essentialNeeds: [
      'No long hike or standing about — his gout flares and he will not say so',
      'Vegetarian food available on prayer days',
    ],
    preferences: [
      'Indian-Fijian curries, tea, simple vegetarian food; limits red meat generally',
      'Avoids heavy drinking',
      'Gives discounts and covers people freely — and quietly expects it to be remembered',
      'Perceived ingratitude after a favour genuinely stings',
    ],
    budgetLimit: 40,
    communicationStyle: 'Friendly and indirect',
  },

  // --- The 50-agent cast -----------------------------------------------------
  // Distilled from each profile in data/characters.ts the same way as the entries
  // above: a hard taboo only where the profile records a religious rule, an
  // allergy or a legal one, everything else as an essential need or a preference.
  // None of these are invented the way the three [ADDED] constraints above are.
  Faisal: {
    culturalBackground: 'Arab Saudi; recently arrived investor',
    religion: 'Muslim',
    hardTaboos: [
      'Halal only — pork and anything cooked with alcohol are absolutely out',
      'No alcohol, and he will not attend an event whose centre of gravity is drinking',
    ],
    essentialNeeds: [
      'Prayer times respected, with somewhere clean and private to pray',
      'Evenings kept free for his family',
    ],
    preferences: [
      'Dates, lamb dishes, Arabic coffee',
      'Somewhere with a bit of standing — dislikes crowded informal spaces',
      'Strongly prefers to host and pay, and is uncomfortable being paid for',
    ],
    budgetLimit: 0,
    communicationStyle: 'Polite and formal',
  },
  Somchai: {
    culturalBackground: 'Northern Thai; migrant service worker',
    religion: 'Buddhist',
    hardTaboos: [],
    essentialNeeds: [
      'A plan that fits around a shift rota he does not control',
      'Cheap enough that he is not quietly going without to afford it',
    ],
    preferences: [
      'Thai spicy food, noodles, mango sticky rice',
      'Informal places; very formal dining makes him uncomfortable',
      'Splits quietly and will never let someone else cover him',
    ],
    budgetLimit: 25,
    communicationStyle: 'Indirect; smiles when uncomfortable',
  },
  Katrin: {
    culturalBackground: 'Bavarian German; skilled migrant',
    religion: 'Secular / no religion',
    hardTaboos: [
      'Lactose intolerant — dairy-heavy food makes her genuinely ill',
    ],
    essentialNeeds: [
      'A time and place fixed in advance; last-minute changes are a real problem for her',
      'Somewhere she can eat without dairy in everything',
    ],
    preferences: [
      'Light meals, bread, salad, coffee',
      'Dislikes very oily food',
      'Strict AA; uncomfortable being treated',
      'Quiet enough to hear the person opposite',
    ],
    budgetLimit: 70,
    communicationStyle: 'Direct and concise',
  },
  Pilar: {
    culturalBackground: 'Andalusian Spanish; long-settled cafe owner',
    religion: 'Catholic',
    hardTaboos: [],
    essentialNeeds: [
      'Enough time to sit properly — a rushed meal defeats the point for her',
      'An evening slot; she eats late and always has',
    ],
    preferences: [
      'Tapas-style sharing, seafood, coffee',
      'Dislikes cold or hurried meals',
      'Wants to treat people and finds a firm refusal of hospitality rude',
      'May avoid meat on some Lent Fridays',
    ],
    budgetLimit: 80,
    communicationStyle: 'Expressive and relational',
  },
  Danuta: {
    culturalBackground: 'Polish; long-term care worker',
    religion: 'Catholic',
    hardTaboos: [],
    essentialNeeds: [
      'Timing that survives a care emergency — she may have to drop out at short notice',
      'Somewhere she can sit down; she is tired most of the time',
    ],
    preferences: [
      'Soup, home-style meals, potatoes',
      'Dislikes expensive meals she considers wasteful',
      'Modest gifts only; extravagance embarrasses her',
      'May avoid meat on Lent Fridays',
    ],
    budgetLimit: 25,
    communicationStyle: 'Respectful, and direct when it matters',
  },
  Camille: {
    culturalBackground: 'French; medium-term resident',
    religion: 'Secular / no religion',
    hardTaboos: [],
    essentialNeeds: [
      'A plan with an actual shape to it — she disengages from chaotic arrangements',
    ],
    preferences: [
      'Good pastries, cheese, properly cooked food',
      'Will not eat offal and is open about poor-quality food',
      'Comfortable with AA or treating close friends',
      'Cares how a place looks more than she admits',
    ],
    budgetLimit: 90,
    communicationStyle: 'Direct but polite',
  },
  Sipho: {
    culturalBackground: 'Zulu South African; graduate student',
    religion: 'Christian, low observance',
    hardTaboos: [
      'Lactose intolerant — dairy-heavy food makes him ill',
    ],
    essentialNeeds: [
      'A budget-friendly plan; an expensive choice quietly excludes him',
    ],
    preferences: [
      'Barbecue, spicy snacks, affordable food',
      'Dislikes expensive cafes',
      'Comfortable with alcohol when he can afford it',
      'Will challenge an unfair split, politely but every time',
    ],
    budgetLimit: 25,
    communicationStyle: 'Direct but relaxed',
  },
  Lucia: {
    culturalBackground: 'Mexican; long-term resident',
    religion: 'Catholic',
    hardTaboos: [],
    essentialNeeds: [
      'Anything scheduled has to clear school pickup — childcare wins every time',
      'Affordable; she is on a stall assistant’s wage',
    ],
    preferences: [
      'Spicy food, corn dishes, home-style meals',
      'Dislikes expensive restaurants',
      'Prefers a cheap shared meal to a smart one',
      'May avoid meat on Lent Fridays',
    ],
    budgetLimit: 20,
    communicationStyle: 'Warm and expressive',
  },
  Bryan: {
    culturalBackground: 'Chinese Singaporean; polytechnic student',
    religion: 'No religion; Taoist family customs',
    hardTaboos: [],
    essentialNeeds: [
      'Cheap — he is on an allowance and will not say when something is out of reach',
      'Nothing that starts early; he is genuinely not awake',
    ],
    preferences: [
      'Fried chicken, bubble tea, supper after midnight',
      'Somewhere he can be loud',
      'Under-age, so anywhere built around drinking is out',
    ],
    budgetLimit: 15,
    communicationStyle: 'Fast, jokey, interrupts',
  },
  Farah: {
    culturalBackground: 'Malay Singaporean; polytechnic student',
    religion: 'Muslim',
    hardTaboos: [
      'Halal only — no pork, nothing cooked with alcohol',
      'Does not drink',
    ],
    essentialNeeds: [
      'Somewhere to pray, and a schedule that does not run through maghrib',
      'A halal option that is an actual meal, not a side salad',
    ],
    preferences: [
      'Nasi lemak, mee rebus, iced Milo',
      'Splits evenly; will not be treated by near-strangers',
      'Uncomfortable in bar settings',
    ],
    budgetLimit: 20,
    communicationStyle: 'Warm and talkative',
  },
  Anh: {
    culturalBackground: 'Kinh Vietnamese; international student',
    religion: 'Ancestor veneration; no formal religion',
    hardTaboos: [],
    essentialNeeds: [
      'Genuinely cheap — a third of her stipend goes home and she will not say so',
    ],
    preferences: [
      'Pho, herbs, fresh food, strong iced coffee',
      'Dislikes very sweet drinks and heavy cream',
      'Refuses to be treated more than once; keeps a mental ledger',
      'Rarely drinks',
    ],
    budgetLimit: 15,
    communicationStyle: 'Quiet; answers rather than volunteers',
  },
  Tomoko: {
    culturalBackground: 'Japanese; one-year design exchange',
    religion: 'Secular; Shinto-Buddhist family customs',
    hardTaboos: [],
    essentialNeeds: [
      'Somewhere quiet enough to follow a conversation in her second language',
      'A small group — a big loud one shuts her down completely',
    ],
    preferences: [
      'Rice, grilled fish, clean simple flavours',
      'Struggles with heavy chilli and very oily food',
      'Pays her exact share and brings a small gift',
      'Drinks very little',
    ],
    budgetLimit: 40,
    communicationStyle: 'Softly spoken; long pauses before answering',
  },
  Daniyal: {
    culturalBackground: 'Punjabi Pakistani; postgraduate student',
    religion: 'Muslim',
    hardTaboos: [
      'Halal only — no pork, nothing cooked with alcohol',
      'Does not drink, and will not attend an event centred on drinking',
    ],
    essentialNeeds: [
      'Friday prayer protected, and prayer breaks through the day',
      'A halal main course, not an improvised vegetarian side',
    ],
    preferences: [
      'Biryani, kebabs, strong tea',
      'Dislikes bland food',
      'Will insist on paying for others even when he cannot spare it',
    ],
    budgetLimit: 30,
    communicationStyle: 'Formal and precise; enjoys debating a point',
  },
  Grace: {
    culturalBackground: 'Ilonggo Filipino; campus librarian',
    religion: 'Catholic',
    hardTaboos: [],
    essentialNeeds: [
      'Sunday morning kept for mass',
      'Affordable — a third of her pay goes home before anything else',
    ],
    preferences: [
      'Rice, grilled meat, sweet snacks, shared platters',
      'Hates eating alone; wants a table, not a counter',
      'Brings food to share and is embarrassed to be repaid',
    ],
    budgetLimit: 25,
    communicationStyle: 'Warm and indirect; softens every refusal',
  },
  Priya: {
    culturalBackground: 'Indian Singaporean; polytechnic residential staff',
    religion: 'Hindu',
    hardTaboos: [
      'No beef, in any form',
    ],
    essentialNeeds: [
      'To be genuinely off duty — she will not attend while on call for the hall',
      'A vegetarian option on Fridays',
    ],
    preferences: [
      'Thosai, sambar, filter coffee',
      'Splits strictly; will not be paid for by students',
      'Will not drink anywhere students might see her',
    ],
    budgetLimit: 50,
    communicationStyle: 'Calm and clear; asks before she tells',
  },
  Hafiz: {
    culturalBackground: 'Malay Singaporean; auxiliary police officer',
    religion: 'Muslim',
    hardTaboos: [
      'Halal only — no pork, nothing cooked with alcohol',
      'Does not drink',
      'Cannot accept a gift, a discount or a free round while on duty',
    ],
    essentialNeeds: [
      'Something that fits a shift rota, including nights',
      'Friday prayer, and prayer breaks on shift',
    ],
    preferences: [
      'Mee goreng, teh halia, hawker food over anything fussy',
      'Pays his own share, always',
    ],
    budgetLimit: 35,
    communicationStyle: 'Economical; says the necessary thing once',
  },
  Meihua: {
    culturalBackground: 'Chinese Singaporean; hawker centre cleaner',
    religion: 'Taoist-Buddhist',
    hardTaboos: [],
    essentialNeeds: [
      'Cheap, and she will refuse outright rather than admit that is why',
      'Early — she is up at five and asleep by nine',
      'Somewhere she can sit; her back will not take standing about',
    ],
    preferences: [
      'Porridge, steamed fish, hot soup',
      'Dislikes cold food and anything wasteful',
      'Vegetarian on the first and fifteenth of the lunar month',
      'Does not drink',
    ],
    budgetLimit: 10,
    communicationStyle: 'Loud, abrupt, mostly in Hokkien',
  },
  Arun: {
    culturalBackground: 'Tamil Singaporean; hawker stall owner',
    religion: 'Hindu',
    hardTaboos: [
      'No beef, in any form',
    ],
    essentialNeeds: [
      'Early evening at the latest — he is up at four and cannot do late nights',
    ],
    preferences: [
      'Prata, fish curry, sweet teh',
      'Vegetarian on prayer days',
      'Thinks most restaurant prices are an insult',
      'A beer with friends, never before a shift',
    ],
    budgetLimit: 25,
    communicationStyle: 'Teasing; jokes his way through everything',
  },
  Nadia: {
    culturalBackground: 'Egyptian Arab; hospital radiographer',
    religion: 'Muslim',
    hardTaboos: [
      'Halal only — no pork, nothing cooked with alcohol',
      'Does not drink',
    ],
    essentialNeeds: [
      'Timing that survives a rotating shift pattern she does not control',
      'Prayer breaks; Friday when she is off shift',
    ],
    preferences: [
      'Koshari, grilled meat, mint tea',
      'Dislikes heavily sweetened coffee',
      'Splits exactly and keeps favours out of work',
      'Dislikes being photographed',
    ],
    budgetLimit: 55,
    communicationStyle: 'Direct; will correct an error in front of the room',
  },
  Tavita: {
    culturalBackground: 'Samoan; security guard on contract',
    religion: 'Christian (Congregational)',
    hardTaboos: [
      'Sunday is for church and rest — he will not be booked for anything on it',
    ],
    essentialNeeds: [
      'Cheap; most of his pay goes home before he sees it',
      'Early — he starts work before six',
    ],
    preferences: [
      'Taro, roast pork, coconut, anything grilled',
      'Small portions are not a meal to him',
      'Stopped drinking entirely when he joined the choir',
      'Gives more than he can afford and refuses repayment',
    ],
    budgetLimit: 15,
    communicationStyle: 'Quiet and formal; uses titles',
  },
  Sofia: {
    culturalBackground: 'Colombian; hospital physiotherapist',
    religion: 'Catholic',
    hardTaboos: [],
    essentialNeeds: [
      'People, and enough life in the room to make it worth leaving the house for',
    ],
    preferences: [
      'Arepas, grilled meat, fresh juice',
      'Finds under-seasoned food genuinely depressing',
      'Rounds up and waves away the change',
      'Would rather dance than drink',
    ],
    budgetLimit: 60,
    communicationStyle: 'Loud, affectionate, stands close',
  },
  Haoran: {
    culturalBackground: 'Han Chinese; research engineer on contract',
    religion: 'Atheist',
    hardTaboos: [],
    essentialNeeds: [
      'Late — a morning commitment costs him the part of the day he actually works',
    ],
    preferences: [
      'Noodles, dumplings, anything still open at one in the morning',
      'A cold sandwich is not a meal',
      'Transfers his exact share the same evening',
      'Drinks only when a group clearly expects it',
    ],
    budgetLimit: 50,
    communicationStyle: 'Terse; answers the question asked and no more',
  },
  Siti: {
    culturalBackground: 'Malay Singaporean; tailor on the shophouse row',
    religion: 'Muslim',
    hardTaboos: [
      'Halal only — no pork, nothing cooked with alcohol',
      'Does not drink',
    ],
    essentialNeeds: [
      'Prayer times respected through the day',
      'Not a bar, and not a gathering where she would be the only woman',
    ],
    preferences: [
      'Lontong, kuih, teh tarik',
      'Wants somewhere quiet enough to hear herself think',
      'Undercharges friends and then resents it',
    ],
    budgetLimit: 30,
    communicationStyle: 'Measured; a long pause before she disagrees',
  },
  Gordon: {
    culturalBackground: 'Hong Kong Chinese; bar manager on the shophouse row',
    religion: 'Secular / no religion',
    hardTaboos: [],
    essentialNeeds: [
      'Late — his day starts at four in the afternoon and nothing moves it',
    ],
    preferences: [
      'Late-night roast meat, congee at three in the morning, good whisky',
      'Does not eat before four in the afternoon',
      'Comps freely and quietly expects loyalty back',
    ],
    budgetLimit: 80,
    communicationStyle: 'Easy and disarming; steers without seeming to',
  },
  Meera: {
    culturalBackground: 'Indian Singaporean; A*STAR bioinformatician',
    religion: 'Hindu by upbringing; largely secular now',
    hardTaboos: [
      'Severe shellfish allergy — a kitchen that handles prawns is not an option, at any price',
      'No beef',
    ],
    essentialNeeds: [
      'A kitchen that can credibly say it does not cross-contaminate with shellfish',
    ],
    preferences: [
      'Dosa, dark chocolate, good filter coffee',
      'Splits evenly without discussing it',
      'A glass of wine occasionally',
    ],
    budgetLimit: 60,
    communicationStyle: 'Precise and understated',
  },
};

export function groundTruthFor(name: string): GroundTruthProfile | undefined {
  return groundTruth[name];
}
