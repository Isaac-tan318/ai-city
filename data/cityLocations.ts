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
    description:
      'Large tertiary campus with lecture halls, dorms, and a sprawling library.',
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
    description:
      'Row of colourful shophouses — small cafes, boutiques, tailor shops, hidden bars.',
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

// Per-character home assignment. Every character lives either in the HDB
// estate or above one of the Peranakan shophouses; each gets a distinct
// passable tile next to their building so they spawn in different "units".
export const CHARACTER_HOMES: Record<string, { locationId: string; x?: number; y?: number }> = {
  Cedric: { locationId: 'shophouses', x: 60, y: 42 }, // back room above his cafe
  Xavier: { locationId: 'shophouses', x: 64, y: 37 }, // upstairs unit two doors down
  Clara: { locationId: 'shophouses', x: 56, y: 40 }, // rents a restored shophouse unit
  James: { locationId: 'hdb', x: 56, y: 9 }, // HDB block, ground floor
  Sarah: { locationId: 'hdb', x: 65, y: 9 }, // HDB block, middle unit
  Isabel: { locationId: 'hdb', x: 61, y: 17 }, // HDB block, far unit
  Rahman: { locationId: 'hdb', x: 54, y: 9 }, // HDB block, corner unit
  Lukas: { locationId: 'hdb', x: 53, y: 16 }, // HDB block, rented unit
};

// Per-character workplace. On weekdays agents spend their working hours here.
// `activity` is a short in-character description of what they do at work.
export const CHARACTER_WORKPLACES: Record<string, { locationId: string; activity: string }> = {
  Cedric: { locationId: 'shophouses', activity: 'working the espresso bar at his cafe' },
  James: { locationId: 'mbs', activity: 'waiting at the taxi stand for fares' },
  Sarah: { locationId: 'restaurant', activity: 'cooking and serving at her hawker stall' },
  Rahman: { locationId: 'restaurant', activity: 'pulling teh tarik and serving kopi at his drinks stall' },
  Isabel: { locationId: 'astar', activity: 'running experiments in the lab' },
  Lukas: { locationId: 'astar', activity: 'running materials experiments in the lab' },
  Clara: { locationId: 'astar', activity: 'leading her genomics lab and reviewing data' },
  Xavier: { locationId: 'university', activity: 'cramming on coding projects on campus' },
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
