export type CityLocation = {
  id: string;
  name: string;
  x: number;
  y: number;
  description: string;
};

// Singapore-themed points of interest. Coordinates were picked as passable tiles
// (objmap[x][y] === -1) immediately next to each rendered building on the
// 70×44 city map (data/city.js), so an agent can stand at the tile and look
// like they are "at" the location.
export const CITY_LOCATIONS: CityLocation[] = [
  {
    id: 'mbs',
    name: 'Marina Bay Sands',
    x: 45,
    y: 15,
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
    x: 12,
    y: 8,
    description:
      "Singapore's national research agency campus. Scientists, postdocs, gleaming labs.",
  },
  {
    id: 'gardens',
    name: 'Gardens by the Bay',
    x: 22,
    y: 5,
    description:
      'Huge public park with the supertree grove and winding paths. Joggers, families, picnics.',
  },
  {
    id: 'university',
    name: 'Temasek University',
    x: 12,
    y: 35,
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
    y: 37,
    description:
      'Row of colourful shophouses — small cafes, boutiques, tailor shops, hidden bars.',
  },
  {
    id: 'restaurant',
    name: 'Hawker Centre',
    x: 60,
    y: 23,
    description:
      'Open-air kopitiam with food stalls and shared tables. Always busy at meal times, gossip central.',
  },
  {
    id: 'changi_hospital',
    name: 'Changi General Hospital',
    x: 38,
    y: 33,
    description: 'Large general hospital with the blue cross emblem.',
  },
];

// Per-character home assignment. Every character lives either in the HDB
// estate or above one of the Peranakan shophouses; each gets a distinct
// passable tile next to their building so they spawn in different "units".
export const CHARACTER_HOMES: Record<string, { locationId: string; x?: number; y?: number }> = {
  Lucky: { locationId: 'shophouses', x: 57, y: 37 }, // back room above his cafe
  Pete: { locationId: 'shophouses', x: 60, y: 37 }, // upstairs unit two doors down
  Bob: { locationId: 'hdb', x: 57, y: 17 }, // HDB block, ground floor
  Stella: { locationId: 'hdb', x: 61, y: 17 }, // HDB block, middle unit
  Alice: { locationId: 'hdb', x: 65, y: 17 }, // HDB block, far unit
};

export function getLocationById(id: string): CityLocation | undefined {
  return CITY_LOCATIONS.find((l) => l.id === id);
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
