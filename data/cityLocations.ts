export type CityLocation = {
  id: string;
  name: string;
  x: number;
  y: number;
  description: string;
  // Optional cosmetic override for where a scenario marker is drawn. The x/y
  // above are passable tiles agents stand on (often just outside the building);
  // markerX/markerY let the on-map scenario beacon sit inside the building roof
  // instead, without affecting pathfinding or work gathering.
  markerX?: number;
  markerY?: number;
};

// Singapore-themed points of interest. Coordinates were picked as passable tiles
// (objmap[x][y] === -1) immediately next to each rendered building on the
// 70×44 city map (data/city.js), so an agent can stand at the tile and look
// like they are "at" the location.
export const CITY_LOCATIONS: CityLocation[] = [
  {
    id: 'mbs',
    name: 'Marina Bay Sands',
    x: 36,
    y: 22,
    // Beacon sits up in the building, not on the taxi-stand tile below it.
    markerX: 36,
    markerY: 20,
    description:
      'Iconic three-tower hotel with the rooftop skypark and reflecting pool. Tourists, business meetings, expensive drinks.',
  },
  {
    id: 'fusionopolis',
    name: 'Fusionopolis',
    x: 4,
    y: 8,
    description:
      'Glassy research and tech complex in one-north. Startups, biotech labs, AI offices.',
  },
  {
    id: 'astar',
    name: 'A*STAR',
    x: 13,
    y: 8,
    // Beacon sits up in the building, not on the standing tile below it.
    markerX: 13,
    markerY: 6,
    description:
      "Singapore's national research agency campus. Scientists, postdocs, gleaming labs.",
  },
  {
    id: 'gardens',
    name: 'Gardens by the Bay',
    x: 36,
    y: 6,
    description:
      'Huge public park with the supertree grove and winding paths. Joggers, families, picnics.',
  },
  {
    id: 'university',
    name: 'Temasek Polytechnic',
    x: 6,
    y: 39,
    description: 'Large tertiary campus with lecture halls, dorms, and a sprawling library.',
  },
  {
    id: 'hdb',
    name: 'HDB Estate',
    x: 62,
    y: 17,
    description:
      'Public housing block where most residents live. Void decks, playgrounds, neighbours chatting.',
  },
  {
    id: 'shophouses',
    name: 'Peranakan Shophouses',
    x: 60,
    y: 42,
    description: 'Row of colourful shophouses — small cafes, boutiques, tailor shops, hidden bars.',
  },
  {
    id: 'restaurant',
    name: 'Hawker Centre',
    x: 63,
    y: 27,
    description:
      'Open-air kopitiam with food stalls and shared tables. Always busy at meal times, gossip central.',
  },
  {
    id: 'changi_hospital',
    name: 'Changi General Hospital',
    x: 36,
    y: 42,
    description: 'Large general hospital with the blue cross emblem.',
  },
];

// Per-character home assignment. Everyone lives in the HDB estate, above one of
// the Peranakan shophouses, or (the students and campus staff) in the polytechnic
// halls; each gets a distinct passable tile next to their building so they spawn
// in different "units".
//
// Distinct is not enough on its own, and getting that wrong is what stopped the
// town sleeping. Agents block each other (`blockedWithPositions` treats another
// player's tile as impassable), and a sleeping agent stands on their home tile
// all night. The old addresses were strung along the two one-tile-wide walkways
// that run past the HDB block — y=9 across the top and y=17 down the side, both
// walled in above and below. The first two residents to turn in sealed each
// walkway like a cork in a bottle, and everyone whose flat was behind them could
// no longer reach it: they never arrived, never settled, never got a sleep
// activity, and just re-planned in place all night. Three agents in bed and the
// rest standing about was exactly that.
//
// So every tile below is picked to satisfy three rules, all enforced by
// `homes.test.ts`:
//   1. passable, and claimed by exactly one character;
//   2. at least two tiles (Manhattan) from every other home, so nobody beds down
//      in a neighbour's doorway;
//   3. still reachable with all 49 other residents asleep on their own tiles,
//      and blocking no route through the estate when they are.
// Rule 3 is what caps how many people can live in a walkway: a sleeper in a
// one-tile passage corks it, so the run down the block's west side (which opens
// onto the wide courtyard behind it) carries most of the estate, the south
// walkway takes the few addresses it can spare, and the rest sit a tile or two
// back in the courtyard. Every one of them still touches the block or the
// shophouse frontage — nobody sleeps out in the middle of the road.
export const CHARACTER_HOMES: Record<string, { locationId: string; x?: number; y?: number }> = {
  Cedric: { locationId: 'shophouses', x: 61, y: 42 }, // back room above his cafe
  Xavier: { locationId: 'shophouses', x: 63, y: 42 }, // upstairs unit two doors down
  Clara: { locationId: 'shophouses', x: 56, y: 42 }, // rents a restored shophouse unit
  James: { locationId: 'hdb', x: 56, y: 9 }, // HDB block, ground floor
  Sarah: { locationId: 'hdb', x: 56, y: 11 }, // HDB block, middle unit
  Isabel: { locationId: 'hdb', x: 56, y: 13 }, // HDB block, far unit
  Rahman: { locationId: 'hdb', x: 56, y: 15 }, // HDB block, corner unit
  Lukas: { locationId: 'hdb', x: 56, y: 17 }, // HDB block, rented unit

  // The wider cast (see data/characters.ts). Every tile below is passable
  // (objmap[0][x][y] === -1) and claimed by exactly one character — sharing one
  // would spawn two people on the same square.
  Yvonne: { locationId: 'hdb', x: 61, y: 17 }, // HDB block, upper unit
  Bernard: { locationId: 'hdb', x: 63, y: 17 }, // HDB block, lived here for decades
  Nikhil: { locationId: 'hdb', x: 65, y: 17 }, // HDB block, family flat
  Nurul: { locationId: 'hdb', x: 67, y: 17 }, // HDB block, near the lift lobby
  Ratna: { locationId: 'hdb', x: 62, y: 9 }, // lives in, in her employer's flat
  Kerem: { locationId: 'hdb', x: 54, y: 9 }, // HDB block, rented unit
  Irina: { locationId: 'hdb', x: 54, y: 11 }, // HDB block, the flat with the piano
  Emeka: { locationId: 'hdb', x: 54, y: 13 }, // HDB block, shared with two of his crew
  Aroha: { locationId: 'hdb', x: 54, y: 15 }, // HDB block, ground floor
  Sharifah: { locationId: 'hdb', x: 54, y: 17 }, // HDB block, middle unit
  Hanna: { locationId: 'hdb', x: 54, y: 19 }, // HDB block, next stack over
  Naomi: { locationId: 'hdb', x: 55, y: 18 }, // HDB block, corner unit she owns
  Harpreet: { locationId: 'hdb', x: 57, y: 19 }, // HDB block, near the void deck
  Mateo: { locationId: 'hdb', x: 58, y: 18 }, // HDB block, the one with the potted chillies
  Dylan: { locationId: 'hdb', x: 68, y: 18 }, // HDB block, rented while on posting
  Tiago: { locationId: 'shophouses', x: 58, y: 42 }, // room above one of the bars
  Ravi: { locationId: 'shophouses', x: 65, y: 42 }, // lives above his own shop

  // The 50-agent cast. Same three rules as above, re-checked for all fifty at
  // once by homes.test.ts: passable, two tiles clear of every other address,
  // and still reachable with the other forty-nine asleep on their own tiles.
  // That last rule is what decides the shape of this list - the estate walkways
  // and the shophouse frontage were already full, so the new residents are in
  // the estate courtyard, the back lane behind the shophouses, and (new here)
  // the polytechnic halls, which is where the students and campus staff live.
  // HDB estate
  Faisal: { locationId: 'hdb', x: 60, y: 19 }, // HDB block, the unit he keeps for weekdays
  Somchai: { locationId: 'hdb', x: 62, y: 20 }, // HDB block, a room shared with two others
  Katrin: { locationId: 'hdb', x: 64, y: 23 }, // HDB block, a serviced unit near the courtyard
  Danuta: { locationId: 'hdb', x: 52, y: 18 }, // HDB block, close to the client she sits with
  Lucia: { locationId: 'hdb', x: 66, y: 20 }, // HDB block, the flat with the children’s drawings
  Hafiz: { locationId: 'hdb', x: 54, y: 22 }, // HDB block, the flat with the motorbike parts
  Meihua: { locationId: 'hdb', x: 67, y: 23 }, // HDB block, the one-room flat she has had for thirty years
  Arun: { locationId: 'hdb', x: 52, y: 23 }, // HDB block, ground floor, scooter under the window
  Nadia: { locationId: 'hdb', x: 69, y: 22 }, // HDB block, east end, near the lift
  Tavita: { locationId: 'hdb', x: 59, y: 22 }, // HDB block, a room in a shared flat
  Sofia: { locationId: 'hdb', x: 61, y: 23 }, // HDB block, the flat you can hear music from
  Haoran: { locationId: 'hdb', x: 56, y: 23 }, // HDB block, rented, curtains always shut
  // Shophouse row
  Pilar: { locationId: 'shophouses', x: 55, y: 40 }, // above her own cafe on the row
  Camille: { locationId: 'shophouses', x: 56, y: 39 }, // a restored shophouse unit she picked for the light
  Siti: { locationId: 'shophouses', x: 69, y: 43 }, // above her tailor shop at the end of the row
  Gordon: { locationId: 'shophouses', x: 55, y: 37 }, // above the bar, in the back lane
  Meera: { locationId: 'shophouses', x: 69, y: 37 }, // a shophouse unit in the back lane
  // Polytechnic halls
  Sipho: { locationId: 'university', x: 12, y: 34 }, // postgraduate hall on the campus’s east side
  Bryan: { locationId: 'university', x: 12, y: 41 }, // hall block at the south end of campus
  Farah: { locationId: 'university', x: 7, y: 30 }, // hall block on the north side of campus
  Anh: { locationId: 'university', x: 3, y: 29 }, // hall block, the room with the drying rack
  Tomoko: { locationId: 'university', x: 13, y: 29 }, // exchange-student room at the campus’s north-east corner
  Daniyal: { locationId: 'university', x: 0, y: 31 }, // postgraduate hall on the campus’s west side
  Grace: { locationId: 'university', x: 8, y: 39 }, // staff quarters at the south edge of campus
  Priya: { locationId: 'university', x: 3, y: 39 }, // warden’s flat at the foot of the hall
};

// Per-character workplace. On weekdays agents spend their working hours here.
// `activity` is a short in-character description of what they do at work.
export const CHARACTER_WORKPLACES: Record<string, { locationId: string; activity: string }> = {
  Cedric: { locationId: 'shophouses', activity: 'working the espresso bar at his cafe' },
  James: { locationId: 'mbs', activity: 'waiting at the taxi stand for fares' },
  Sarah: { locationId: 'restaurant', activity: 'cooking and serving at her hawker stall' },
  Rahman: {
    locationId: 'restaurant',
    activity: 'pulling teh tarik and serving kopi at his drinks stall',
  },
  Isabel: { locationId: 'astar', activity: 'running experiments in the lab' },
  Lukas: { locationId: 'astar', activity: 'running materials experiments in the lab' },
  Clara: { locationId: 'astar', activity: 'leading her genomics lab and reviewing data' },
  Xavier: { locationId: 'university', activity: 'cramming on coding projects on campus' },

  // The wider cast. Bernard is deliberately absent — he is retired, and
  // workplaceFor returning undefined is what leaves him free to roam all day.
  Yvonne: { locationId: 'fusionopolis', activity: 'drafting policy papers at her desk' },
  Nikhil: { locationId: 'fusionopolis', activity: 'running the delivery board with his team' },
  Kerem: { locationId: 'fusionopolis', activity: 'sorting out freight schedules over tea' },
  Nurul: { locationId: 'changi_hospital', activity: 'doing her rounds on the ward' },
  Sharifah: { locationId: 'changi_hospital', activity: 'checking prescriptions in the dispensary' },
  Hanna: { locationId: 'changi_hospital', activity: 'settling patients and changing dressings' },
  Dylan: { locationId: 'changi_hospital', activity: 'restocking the ambulance between callouts' },
  Ratna: { locationId: 'hdb', activity: 'cleaning and cooking in her employer’s flat' },
  Emeka: { locationId: 'hdb', activity: 'supervising the upgrading crew on site' },
  Aroha: { locationId: 'hdb', activity: 'running the youth programme at the family service centre' },
  Irina: { locationId: 'university', activity: 'taking piano students through their scales' },
  Harpreet: { locationId: 'university', activity: 'teaching class and marking assignments' },
  Naomi: { locationId: 'mbs', activity: 'working through case files at her firm' },
  Tiago: { locationId: 'shophouses', activity: 'setting up sound for tonight’s gig' },
  Ravi: { locationId: 'shophouses', activity: 'minding the counter at his provision shop' },
  Mateo: { locationId: 'gardens', activity: 'sweeping the paths and clearing the bins' },

  // The 50-agent cast. Everyone here has a workplace; the students and the
  // campus staff share the polytechnic, which is also where they live, so the
  // home step's locationId is 'home' rather than the building (see routines.ts)
  // and workLeashAnchor does not mistake a night in hall for a shift.
  Faisal: { locationId: 'mbs', activity: 'taking meetings over Arabic coffee in the hotel lobby' },
  Somchai: { locationId: 'mbs', activity: 'turning over rooms and running the service lift' },
  Katrin: { locationId: 'fusionopolis', activity: 'running tolerance checks on a rig design' },
  Pilar: { locationId: 'shophouses', activity: 'running the front of house at her cafe' },
  Danuta: { locationId: 'hdb', activity: 'sitting with an elderly client in her flat' },
  Camille: { locationId: 'fusionopolis', activity: 'reworking a layout nobody asked her to rework' },
  Sipho: { locationId: 'university', activity: 'reading in the postgraduate room' },
  Lucia: { locationId: 'restaurant', activity: 'prepping and serving at the stall she assists on' },
  Bryan: { locationId: 'university', activity: 'half-attending a lecture' },
  Farah: { locationId: 'university', activity: 'in a business tutorial, taking better notes than anyone' },
  Anh: { locationId: 'university', activity: 'working through a problem set in the studio' },
  Tomoko: { locationId: 'university', activity: 'sketching through a design crit' },
  Daniyal: { locationId: 'university', activity: 'marking undergraduate problem sets' },
  Grace: { locationId: 'university', activity: 'reshelving and fielding questions at the library desk' },
  Priya: { locationId: 'university', activity: 'working through hall cases at her desk' },
  Hafiz: { locationId: 'mbs', activity: 'walking the hotel perimeter and watching the concourse' },
  Meihua: { locationId: 'restaurant', activity: 'clearing and wiping down the tables' },
  Arun: { locationId: 'restaurant', activity: 'flipping prata at his stall' },
  Nadia: { locationId: 'changi_hospital', activity: 'running the imaging list' },
  Tavita: { locationId: 'gardens', activity: 'walking the gardens and keeping an eye on the gates' },
  Sofia: { locationId: 'changi_hospital', activity: 'putting a patient through their rehab exercises' },
  Haoran: { locationId: 'astar', activity: 'characterising a device on the bench' },
  Siti: { locationId: 'shophouses', activity: 'pinning an alteration at the tailor shop' },
  Gordon: { locationId: 'shophouses', activity: 'setting up the bar for the evening' },
  Meera: { locationId: 'astar', activity: 'running a pipeline and watching it fail' },
};

export function getLocationById(id: string): CityLocation | undefined {
  return CITY_LOCATIONS.find((l) => l.id === id);
}

export function workplaceFor(
  characterName: string,
): { location: CityLocation; activity: string } | undefined {
  const entry = CHARACTER_WORKPLACES[characterName];
  if (!entry) return undefined;
  const location = getLocationById(entry.locationId);
  if (!location) return undefined;
  return { location, activity: entry.activity };
}

// If the character is currently scheduled AT their own workplace (the work shift
// or the lunch break, both of which sit at the workplace location), return the
// workplace tile so callers can "leash" the agent nearby and stop them wandering
// across the map mid-shift. Otherwise undefined (off shift — free to roam).
export function workLeashAnchor(
  characterName: string | undefined,
  step: { locationId: string } | undefined,
): { x: number; y: number } | undefined {
  if (!characterName || !step) return undefined;
  const entry = CHARACTER_WORKPLACES[characterName];
  if (!entry || step.locationId !== entry.locationId) return undefined;
  const loc = getLocationById(entry.locationId);
  return loc ? { x: loc.x, y: loc.y } : undefined;
}

// Accepts the canonical id or a fuzzy match on name (case-insensitive substring).
export function resolveLocation(idOrName: string): CityLocation | undefined {
  const key = idOrName.trim().toLowerCase();
  const byId = CITY_LOCATIONS.find((l) => l.id.toLowerCase() === key);
  if (byId) return byId;
  return CITY_LOCATIONS.find(
    (l) => l.name.toLowerCase().includes(key) || key.includes(l.id.toLowerCase()),
  );
}

export function homeFor(characterName: string): CityLocation | undefined {
  const entry = CHARACTER_HOMES[characterName];
  const base = entry ? getLocationById(entry.locationId) : getLocationById('hdb');
  if (!base) return undefined;
  // If the character has a specific unit (x/y override), use that as the
  // standing tile so two roommates don't pile onto the same square.
  if (entry && entry.x !== undefined && entry.y !== undefined) {
    return { ...base, x: entry.x, y: entry.y };
  }
  return base;
}

// The named place an agent is standing at (or closest to). Used to label a
// position in the UI, where "x: 36, y: 22" means nothing but "Marina Bay Sands"
// does. Squared distance — no need for the sqrt just to compare.
export function nearestLocation(p: { x: number; y: number }): CityLocation {
  let best = CITY_LOCATIONS[0];
  let bestDist = Infinity;
  for (const loc of CITY_LOCATIONS) {
    const dx = loc.x - p.x;
    const dy = loc.y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = loc;
    }
  }
  return best;
}
