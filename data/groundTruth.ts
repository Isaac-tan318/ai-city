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
};

export function groundTruthFor(name: string): GroundTruthProfile | undefined {
  return groundTruth[name];
}
