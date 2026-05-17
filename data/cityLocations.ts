export type CityLocation = {
  id: string;
  name: string;
  x: number;
  y: number;
  description: string;
};

// Singapore-themed points of interest. Coordinates were picked as passable tiles
// (objmap[x][y] === -1) close to the building each POI represents on the
// current 50×30 city map (data/city.js).
export const CITY_LOCATIONS: CityLocation[] = [
  {
    id: 'mbs',
    name: 'Marina Bay Sands',
    x: 10,
    y: 5,
    description: 'Iconic three-tower hotel with the rooftop skypark. Tourists, business meetings, expensive drinks.',
  },
  {
    id: 'fusionopolis',
    name: 'Fusionopolis',
    x: 20,
    y: 7,
    description: 'Glassy research and tech complex in one-north. Startups, biotech labs, AI offices.',
  },
  {
    id: 'astar',
    name: 'A*STAR',
    x: 28,
    y: 7,
    description: "Singapore's national research agency campus. Scientists, postdocs, gleaming labs.",
  },
  {
    id: 'university',
    name: 'University Campus',
    x: 40,
    y: 5,
    description: 'Large tertiary campus with lecture halls, dorms, and a sprawling library.',
  },
  {
    id: 'shophouses',
    name: 'Peranakan Shophouses',
    x: 25,
    y: 11,
    description: 'Row of colourful shophouses — small cafes, boutiques, tailor shops, hidden bars.',
  },
  {
    id: 'restaurant',
    name: 'Hawker Centre',
    x: 15,
    y: 14,
    description: 'Open-air hawker centre with food stalls. Always busy at meal times, gossip central.',
  },
  {
    id: 'gardens',
    name: 'Gardens by the Bay',
    x: 10,
    y: 22,
    description: 'Huge public park with the supertree grove and conservatories. Joggers, families, picnics.',
  },
  {
    id: 'hdb',
    name: 'HDB Estate',
    x: 15,
    y: 22,
    description: 'Public housing block where most residents live. Void decks, playgrounds, neighbours chatting.',
  },
  {
    id: 'changi_hospital',
    name: 'Changi General Hospital',
    x: 40,
    y: 20,
    description: 'Large general hospital on the eastern side of the island.',
  },
  {
    id: 'airport',
    name: 'Changi Airport',
    x: 47,
    y: 29,
    description: "Singapore's airport on the eastern edge. Travellers, departures, the famous Jewel waterfall.",
  },
];

// Per-character home assignment. Most live in HDBs; thematic exceptions for
// characters whose backstory implies they sleep elsewhere.
export const CHARACTER_HOMES: Record<string, { locationId: string }> = {
  Lucky: { locationId: 'shophouses' }, // sleeps in the back room of his cafe
  Bob: { locationId: 'hdb' },
  Stella: { locationId: 'mbs' }, // wannabe high-roller, claims to live at MBS
  Alice: { locationId: 'fusionopolis' }, // ML researcher with a startup desk
  Pete: { locationId: 'hdb' },
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
  if (!entry) return getLocationById('hdb');
  return getLocationById(entry.locationId);
}
