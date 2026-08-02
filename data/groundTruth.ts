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
};

export function groundTruthFor(name: string): GroundTruthProfile | undefined {
  return groundTruth[name];
}
