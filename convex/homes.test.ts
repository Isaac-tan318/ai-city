import { Descriptions } from '../data/characters';
import { CHARACTER_HOMES, CITY_LOCATIONS, homeFor } from '../data/cityLocations';
import { isSleepStep, mergeFixedObligations } from '../data/routines';
import * as cityMap from '../data/city';

// The engine treats another player's tile as impassable (see
// `blockedWithPositions`: COLLISION_THRESHOLD is 0.75, so an agent standing on an
// integer tile blocks that tile and no other). An agent asleep at home stands on
// their home tile all night, which makes the whole cast's addresses a single
// connectivity problem rather than fifty independent ones — the reason the town only
// ever got three people into bed was that the early sleepers corked the one-tile
// walkways everybody else's flat opened off.
//
// These tests are the guard rail for that: they walk the real map with the real
// blocking rule and refuse a home that a neighbour's bedtime can cut off.

const objmap: number[][][] = (cityMap as any).objmap;
const WIDTH: number = (cityMap as any).mapwidth;
const HEIGHT: number = (cityMap as any).mapheight;

type Tile = { x: number; y: number };

const names = Descriptions.map((d) => d.name);
const homes = names.map((name) => ({ name, tile: homeFor(name)! }));

const key = (t: Tile) => `${t.x},${t.y}`;
const passable = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT && objmap.every((layer) => layer[x][y] === -1);
const neighbours = (t: Tile): Tile[] =>
  [
    { x: t.x + 1, y: t.y },
    { x: t.x - 1, y: t.y },
    { x: t.x, y: t.y + 1 },
    { x: t.x, y: t.y - 1 },
  ].filter((n) => passable(n.x, n.y));

// Every tile an agent can walk to from the middle of town, treating `blocked` as
// occupied. Marina Bay Sands is as good a starting point as any — it is on the
// main walkable expanse, so this is the map the cast actually lives on.
const TOWN_CENTRE: Tile = CITY_LOCATIONS.find((l) => l.id === 'mbs')!;
function walkableFrom(blocked: Set<string>): Set<string> {
  const seen = new Set([key(TOWN_CENTRE)]);
  const queue: Tile[] = [TOWN_CENTRE];
  while (queue.length) {
    for (const next of neighbours(queue.shift()!)) {
      const k = key(next);
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return seen;
}
const EMPTY_TOWN = walkableFrom(new Set());
const ALL_HOMES = new Set(homes.map((h) => key(h.tile)));

describe('where everybody lives', () => {
  it('gives every character an address', () => {
    for (const name of names) {
      expect(CHARACTER_HOMES[name]).toBeDefined();
      expect(homeFor(name)).toBeDefined();
    }
  });

  it('never puts two characters on the same tile', () => {
    const occupants = new Map<string, string>();
    for (const { name, tile } of homes) {
      expect(occupants.get(key(tile))).toBeUndefined();
      occupants.set(key(tile), name);
    }
    expect(occupants.size).toBe(names.length);
  });

  it.each(homes.map((h) => [h.name, h.tile] as const))(
    '%s sleeps on a passable tile in town',
    (_name, tile) => {
      expect(passable(tile.x, tile.y)).toBe(true);
      expect(EMPTY_TOWN.has(key(tile))).toBe(true);
    },
  );

  // Reachability alone would happily scatter the cast across the middle of the
  // nearest open square, which looks like everyone sleeping in the road. A home
  // has to be somewhere a home could be: up against the block, or the shophouse
  // frontage, or at worst a tile or two back into the estate's courtyard.
  it.each(homes.map((h) => [h.name, h.tile] as const))(
    "%s sleeps against a building, not out in the open",
    (_name, tile) => {
      let nearestWall = Infinity;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const x = tile.x + dx;
          const y = tile.y + dy;
          if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue;
          if (!passable(x, y)) nearestWall = Math.min(nearestWall, Math.max(Math.abs(dx), Math.abs(dy)));
        }
      }
      expect(nearestWall).toBeLessThanOrEqual(2);
    },
  );

  it('leaves at least a tile between neighbours, so nobody beds down in a doorway', () => {
    const tooClose: string[] = [];
    for (let i = 0; i < homes.length; i++) {
      for (let j = i + 1; j < homes.length; j++) {
        const a = homes[i];
        const b = homes[j];
        const gap = Math.abs(a.tile.x - b.tile.x) + Math.abs(a.tile.y - b.tile.y);
        if (gap < 2) tooClose.push(`${a.name}/${b.name}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  // The one that actually matters: the whole cast in bed at once must not wall
  // anyone out of their own flat, or off any part of town.
  it('keeps the town connected with every resident asleep at home', () => {
    const stillWalkable = walkableFrom(ALL_HOMES);
    const sealedOff = [...EMPTY_TOWN].filter((k) => !ALL_HOMES.has(k) && !stillWalkable.has(k));
    expect(sealedOff).toEqual([]);
  });

  it.each(homes.map((h) => [h.name, h.tile] as const))(
    '%s can still get home with everyone else already in bed',
    (_name, tile) => {
      const others = new Set(ALL_HOMES);
      others.delete(key(tile));
      expect(walkableFrom(others).has(key(tile))).toBe(true);
    },
  );

  // Day 1 is a Monday, which nobody's night shift touches, and 03:00 is inside
  // every sleep window the persona library produces — the early sleepers', the
  // students', and the night owls'. So at that moment the whole town should be
  // asleep, each of them on their own doorstep.
  it.each(homes.map((h) => [h.name, h.tile] as const))(
    '%s is asleep at their own address at 3am',
    (name, tile) => {
      const schedule = mergeFixedObligations(name, 1, [
        {
          startMinute: 0,
          locationId: 'home',
          destination: tile,
          activity: 'pottering about',
          description: 'at home',
        },
      ]);
      const step = [...schedule].reverse().find((s) => s.startMinute <= 3 * 60)!;
      expect(isSleepStep(step)).toBe(true);
      expect(step.destination).toEqual({ x: tile.x, y: tile.y });
    },
  );
});
