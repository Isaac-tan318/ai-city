// Procedurally-generated city map. Tile graphics are generated at runtime in
// src/cityTileset.ts; the magic '__city__' URL tells the renderer to use the
// procedural canvas instead of fetching a PNG.

export const tilesetpath = '__city__';
export const tiledim = 32;
export const tilesetpxw = 256;
export const tilesetpxh = 256;

const W = 48;
const H = 32;

// Tile indices (must match CITY_TILE in src/cityTileset.ts).
const ASPHALT = 0;
const YELLOW_H = 1;
const YELLOW_V = 2;
const CROSSWALK_H = 3;
const CROSSWALK_V = 4;
const SIDEWALK = 5;
const GRASS = 6;
const PLAZA = 7;
const BRICK = 8;
const WINDOW = 9;
const DOOR = 10;
const ROOF = 11;
const TREE = 12;
const BENCH = 13;
const LAMP = 14;
const CAR = 15;
const GLASS_WALL = 16;
const GLASS_WINDOW = 17;
const CONCRETE_WALL = 18;
const CONCRETE_WINDOW = 19;
const AWNING_RED = 20;
const FLAT_ROOF_LIGHT = 21;
const POND = 22;
const FLOWERBED = 23;
const DIRT_PATH = 24;
const HEDGE = 25;
const FIRE_HYDRANT = 26;
const MAILBOX = 27;
const BUS_STOP = 28;
const TRASHCAN = 29;
const STATUE = 30;
const FOUNTAIN_BASE = 31;
const SUNTEC_WALL = 32;
const SUNTEC_WINDOW = 33;
const HDB_WALL = 34;
const HDB_WINDOW = 35;
const WHITE_BRICK = 36;
const WHITE_BRICK_WINDOW = 37;
const WHITE_BRICK_DOOR = 38;
const FUSION_WALL = 39;
const FUSION_WINDOW = 40;
const ASTAR_WALL = 41;
const MBS_WALL = 42;
const MBS_WINDOW = 43;
const MBS_SKYPARK_LEFT = 44;
const MBS_SKYPARK_MID = 45;
const MBS_SKYPARK_RIGHT = 46;
const RESTAURANT_TABLE = 47;
const RESTAURANT_UMBRELLA = 48;
const SUPERTREE = 49;
const PERANAKAN_PINK = 50;
const PERANAKAN_BLUE = 51;
const PERANAKAN_MINT = 52;
const PERANAKAN_ROOF = 53;
const SUNTEC_FOUNTAIN = 54;

const H_ROAD_Y = [11, 23];
const V_ROAD_X = [15, 33];

function makeLayer(fill) {
  const a = [];
  for (let x = 0; x < W; x++) {
    const col = new Array(H);
    for (let y = 0; y < H; y++) col[y] = fill;
    a.push(col);
  }
  return a;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < W && y < H;
}

const ground = makeLayer(GRASS);
const markings = makeLayer(-1);
const objs = makeLayer(-1);

// --- Roads & sidewalks --------------------------------------------------

for (let x = 0; x < W; x++) {
  for (const ry of H_ROAD_Y) {
    ground[x][ry - 1] = SIDEWALK;
    ground[x][ry] = ASPHALT;
    ground[x][ry + 1] = SIDEWALK;
  }
}
for (let y = 0; y < H; y++) {
  for (const rx of V_ROAD_X) {
    if (ground[rx - 1][y] !== ASPHALT) ground[rx - 1][y] = SIDEWALK;
    ground[rx][y] = ASPHALT;
    if (ground[rx + 1][y] !== ASPHALT) ground[rx + 1][y] = SIDEWALK;
  }
}
// Open up the 3x3 intersections to plain asphalt (drop sidewalk corners).
for (const rx of V_ROAD_X) {
  for (const ry of H_ROAD_Y) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (Math.abs(dx) === 1 && Math.abs(dy) === 1) continue;
        ground[rx + dx][ry + dy] = ASPHALT;
      }
    }
  }
}

// --- Road markings ------------------------------------------------------

for (let x = 0; x < W; x++) {
  for (const ry of H_ROAD_Y) {
    let nearIntersection = false;
    for (const rx of V_ROAD_X) if (Math.abs(x - rx) <= 1) nearIntersection = true;
    if (!nearIntersection) markings[x][ry] = YELLOW_H;
  }
}
for (let y = 0; y < H; y++) {
  for (const rx of V_ROAD_X) {
    let nearIntersection = false;
    for (const ry of H_ROAD_Y) if (Math.abs(y - ry) <= 1) nearIntersection = true;
    if (!nearIntersection) markings[rx][y] = YELLOW_V;
  }
}
// Crosswalks just outside each intersection.
for (const rx of V_ROAD_X) {
  for (const ry of H_ROAD_Y) {
    for (let dx = -1; dx <= 1; dx++) {
      if (inBounds(rx + dx, ry - 2)) markings[rx + dx][ry - 2] = CROSSWALK_V;
      if (inBounds(rx + dx, ry + 2)) markings[rx + dx][ry + 2] = CROSSWALK_V;
    }
    for (let dy = -1; dy <= 1; dy++) {
      if (inBounds(rx - 2, ry + dy)) markings[rx - 2][ry + dy] = CROSSWALK_H;
      if (inBounds(rx + 2, ry + dy)) markings[rx + 2][ry + dy] = CROSSWALK_H;
    }
  }
}

// Parked cars on the road. They overwrite the yellow-line marking on that tile.
const PARKED_CARS = [
  [5, 11],
  [22, 11],
  [40, 11],
  [8, 23],
  [27, 23],
  [42, 23],
];
for (const [cx, cy] of PARKED_CARS) {
  if (inBounds(cx, cy) && ground[cx][cy] === ASPHALT) markings[cx][cy] = CAR;
}

// --- Buildings (objects, block movement) --------------------------------

function placeBuilding(ox, oy, w, h, style = 'brick') {
  if (h < 2) return;
  if (style === 'shop' && h < 3) style = 'brick';
  const wallY = oy + h - 1;
  const T = {
    brick: { wall: BRICK, win: WINDOW, roof: ROOF, door: DOOR },
    glass: { wall: GLASS_WALL, win: GLASS_WINDOW, roof: FLAT_ROOF_LIGHT, door: GLASS_WALL },
    concrete: { wall: CONCRETE_WALL, win: CONCRETE_WINDOW, roof: ROOF, door: CONCRETE_WALL },
    shop: { wall: BRICK, win: WINDOW, roof: ROOF, door: DOOR },
    suntec: { wall: SUNTEC_WALL, win: SUNTEC_WINDOW, roof: FLAT_ROOF_LIGHT, door: SUNTEC_WALL },
    hdb: { wall: HDB_WALL, win: HDB_WINDOW, roof: FLAT_ROOF_LIGHT, door: HDB_WALL },
    whitebrick: {
      wall: WHITE_BRICK,
      win: WHITE_BRICK_WINDOW,
      roof: ROOF,
      door: WHITE_BRICK_DOOR,
    },
    fusion: { wall: FUSION_WALL, win: FUSION_WINDOW, roof: FLAT_ROOF_LIGHT, door: FUSION_WALL },
    astar: { wall: ASTAR_WALL, win: ASTAR_WALL, roof: FLAT_ROOF_LIGHT, door: ASTAR_WALL },
    mbs: { wall: MBS_WALL, win: MBS_WINDOW, roof: FLAT_ROOF_LIGHT, door: MBS_WALL },
    pera_pink: {
      wall: PERANAKAN_PINK,
      win: PERANAKAN_PINK,
      roof: PERANAKAN_ROOF,
      door: PERANAKAN_PINK,
    },
    pera_blue: {
      wall: PERANAKAN_BLUE,
      win: PERANAKAN_BLUE,
      roof: PERANAKAN_ROOF,
      door: PERANAKAN_BLUE,
    },
    pera_mint: {
      wall: PERANAKAN_MINT,
      win: PERANAKAN_MINT,
      roof: PERANAKAN_ROOF,
      door: PERANAKAN_MINT,
    },
  }[style];

  const isTower =
    style === 'hdb' ||
    style === 'suntec' ||
    style === 'mbs' ||
    style === 'fusion';

  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h - 1; dy++) {
      if (!inBounds(ox + dx, oy + dy)) continue;
      const isAwningRow = style === 'shop' && oy + dy === wallY - 1;
      if (isAwningRow) {
        objs[ox + dx][oy + dy] = AWNING_RED;
      } else if (isTower && dy === 0) {
        objs[ox + dx][oy + dy] = T.roof;
      } else if (isTower) {
        objs[ox + dx][oy + dy] = dy % 2 === 0 ? T.wall : T.win;
      } else {
        objs[ox + dx][oy + dy] = T.roof;
      }
    }
  }

  const doorX = ox + Math.floor(w / 2);
  for (let dx = 0; dx < w; dx++) {
    if (!inBounds(ox + dx, wallY)) continue;
    if (ox + dx === doorX) {
      objs[ox + dx][wallY] = T.door;
    } else if (dx % 2 === 0) {
      objs[ox + dx][wallY] = T.win;
    } else {
      objs[ox + dx][wallY] = T.wall;
    }
  }
}

const BUILDINGS = [
  // 1. NW — Suntec City: 5 dark towers in a horseshoe (cols 0..13, rows 0..9)
  [1, 1, 2, 5, 'suntec'],
  [4, 0, 2, 4, 'suntec'],
  [7, 0, 2, 4, 'suntec'],
  [10, 0, 2, 4, 'suntec'],
  [12, 1, 2, 5, 'suntec'],

  // 2. N-mid — HDBs (cols 17..31, rows 0..9)
  [18, 1, 4, 8, 'hdb'],
  [23, 1, 4, 8, 'hdb'],
  [28, 1, 3, 8, 'hdb'],

  // 3. NE — landed white-brick housing (cols 35..47, rows 0..9)
  [36, 1, 4, 4, 'whitebrick'],
  [41, 1, 5, 4, 'whitebrick'],
  [36, 6, 5, 3, 'whitebrick'],
  [42, 6, 5, 3, 'whitebrick'],

  // 4. W-mid — Fusionopolis + A*STAR (cols 0..13, rows 13..21)
  [1, 14, 4, 7, 'fusion'],
  [6, 14, 4, 7, 'fusion'],
  [11, 14, 3, 4, 'astar'],
  [11, 19, 3, 2, 'fusion'],

  // 5. Center — Marina Bay Sands: 3 tall white towers (cols 17..31, rows 13..21)
  [19, 14, 2, 8, 'mbs'],
  [24, 14, 2, 8, 'mbs'],
  [29, 14, 2, 8, 'mbs'],

  // 6. E-mid — HDBs (cols 35..47, rows 13..21)
  [36, 14, 4, 7, 'hdb'],
  [41, 14, 4, 7, 'hdb'],
  [45, 14, 2, 7, 'hdb'],

  // 7. SW — outdoor restaurant kitchen (rest is plaza/objects, see below)
  [1, 26, 3, 5, 'shop'],

  // 8. S-mid — supertree park (no buildings; placed below)

  // 9. SE — Peranakan shophouses: two rows (cols 35..47, rows 25..31)
  [36, 26, 3, 3, 'pera_pink'],
  [40, 26, 3, 3, 'pera_blue'],
  [44, 26, 3, 3, 'pera_mint'],
  [36, 29, 3, 2, 'pera_blue'],
  [40, 29, 3, 2, 'pera_mint'],
  [44, 29, 3, 2, 'pera_pink'],
];
for (const [ox, oy, w, h, style] of BUILDINGS) placeBuilding(ox, oy, w, h, style);

const animatedSprites = [];

// --- Suntec inner plaza + static fountain centerpiece (NOT animated) ---

for (let x = 4; x <= 11; x++) {
  for (let y = 3; y <= 7; y++) {
    if (objs[x][y] === -1) ground[x][y] = PLAZA;
  }
}
objs[8][5] = SUNTEC_FOUNTAIN;

// --- MBS — plaza promenade + full-width SkyPark (cols 17-31) -----------

for (let x = 17; x <= 31; x++) {
  for (let y = 13; y <= 21; y++) ground[x][y] = PLAZA;
}
objs[17][13] = MBS_SKYPARK_LEFT;
for (let x = 18; x <= 30; x++) objs[x][13] = MBS_SKYPARK_MID;
objs[31][13] = MBS_SKYPARK_RIGHT;

// --- Outdoor restaurant plaza (SW) -------------------------------------

for (let x = 5; x <= 13; x++) {
  for (let y = 25; y <= 31; y++) {
    if (objs[x][y] === -1) ground[x][y] = PLAZA;
  }
}
const TABLES = [
  [6, 26],
  [9, 26],
  [12, 26],
  [6, 29],
  [9, 29],
  [12, 29],
];
const UMBRELLAS = [
  [7, 27],
  [10, 27],
  [13, 27],
  [7, 30],
  [10, 30],
  [13, 30],
];
for (const [x, y] of TABLES) {
  if (inBounds(x, y) && objs[x][y] === -1) objs[x][y] = RESTAURANT_TABLE;
}
for (const [x, y] of UMBRELLAS) {
  if (inBounds(x, y) && objs[x][y] === -1) objs[x][y] = RESTAURANT_UMBRELLA;
}

// --- Supertree park (S-mid) — drives "Meet at Park" centroid -----------

for (let x = 17; x <= 31; x++) {
  for (let y = 25; y <= 31; y++) ground[x][y] = PLAZA;
}
for (let x = 17; x <= 31; x++) ground[x][28] = DIRT_PATH;
for (let y = 25; y <= 31; y++) ground[24][y] = DIRT_PATH;
const SUPERTREES = [
  [19, 26],
  [22, 26],
  [26, 26],
  [29, 26],
  [18, 30],
  [21, 30],
  [27, 30],
  [30, 30],
];
for (const [x, y] of SUPERTREES) {
  if (inBounds(x, y) && objs[x][y] === -1) objs[x][y] = SUPERTREE;
}
objs[24][28] = FOUNTAIN_BASE;
animatedSprites.push({
  x: 24 * tiledim,
  y: 28 * tiledim,
  w: tiledim,
  h: tiledim,
  layer: 1,
  sheet: '__city_fountain__',
  animation: 'bubble',
});

// --- Decorative props ---------------------------------------------------

// Plaza patches in some open green pockets.
const PLAZA_CENTERS = [];
for (const [cx, cy] of PLAZA_CENTERS) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = cx + dx,
        y = cy + dy;
      if (inBounds(x, y) && objs[x][y] === -1 && ground[x][y] === GRASS) {
        ground[x][y] = PLAZA;
      }
    }
  }
}

// Trees scattered in green pockets along edges and between blocks.
const TREES = [
  [0, 0],
  [0, 4],
  [0, 8],
  [13, 8],
  [16, 4],
  [16, 8],
  [22, 9],
  [32, 4],
  [32, 8],
  [34, 1],
  [34, 4],
  [34, 8],
  [40, 8],
  [47, 1],
  [47, 8],
  [0, 13],
  [0, 17],
  [0, 21],
  [13, 21],
  [34, 13],
  [34, 17],
  [34, 21],
  [40, 21],
  [47, 13],
  [47, 21],
  [0, 25],
  [0, 29],
  [34, 25],
  [34, 29],
  [40, 31],
  [47, 25],
  [47, 29],
];
for (const [tx, ty] of TREES) {
  if (inBounds(tx, ty) && objs[tx][ty] === -1 && ground[tx][ty] === GRASS) {
    objs[tx][ty] = TREE;
  }
}

// Streetlamps along sidewalks (sparse).
const LAMPS = [
  [4, 10],
  [11, 10],
  [22, 10],
  [29, 10],
  [38, 10],
  [46, 10],
  [4, 12],
  [11, 12],
  [29, 12],
  [38, 12],
  [4, 22],
  [11, 22],
  [22, 22],
  [29, 22],
  [38, 22],
  [46, 22],
  [4, 24],
  [11, 24],
  [29, 24],
  [38, 24],
  [14, 4],
  [14, 18],
  [14, 27],
  [16, 7],
  [16, 20],
  [16, 28],
  [32, 4],
  [32, 18],
  [32, 27],
  [34, 7],
  [34, 20],
  [34, 28],
];
for (const [lx, ly] of LAMPS) {
  if (inBounds(lx, ly) && objs[lx][ly] === -1 && ground[lx][ly] === SIDEWALK) {
    objs[lx][ly] = LAMP;
  }
}

// Benches at intersections / parks.
const BENCHES = [
  [6, 10],
  [25, 10],
  [37, 10],
  [6, 24],
  [25, 24],
  [37, 24],
  [10, 6],
  [28, 16],
  [40, 16],
];
for (const [bx, by] of BENCHES) {
  if (inBounds(bx, by) && objs[bx][by] === -1) {
    if (ground[bx][by] === SIDEWALK || ground[bx][by] === PLAZA) {
      objs[bx][by] = BENCH;
    }
  }
}

const HYDRANTS = [
  [3, 12],
  [27, 12],
  [44, 24],
];
for (const [hx, hy] of HYDRANTS) {
  if (inBounds(hx, hy) && objs[hx][hy] === -1 && ground[hx][hy] === SIDEWALK) {
    objs[hx][hy] = FIRE_HYDRANT;
  }
}

const MAILBOXES = [
  [18, 10],
  [37, 12],
  [12, 24],
];
for (const [mx, my] of MAILBOXES) {
  if (inBounds(mx, my) && objs[mx][my] === -1 && ground[mx][my] === SIDEWALK) {
    objs[mx][my] = MAILBOX;
  }
}

const BUS_STOPS = [
  [20, 24],
  [38, 22],
];
for (const [sx, sy] of BUS_STOPS) {
  if (inBounds(sx, sy) && objs[sx][sy] === -1 && ground[sx][sy] === SIDEWALK) {
    objs[sx][sy] = BUS_STOP;
  }
}

const TRASHCANS = [
  [7, 10],
  [22, 24],
  [42, 10],
];
for (const [tx, ty] of TRASHCANS) {
  if (inBounds(tx, ty) && objs[tx][ty] === -1 && ground[tx][ty] === SIDEWALK) {
    objs[tx][ty] = TRASHCAN;
  }
}

// --- Animated traffic lights at each intersection -----------------------

for (const rx of V_ROAD_X) {
  for (const ry of H_ROAD_Y) {
    // Place traffic light on the NE sidewalk corner of each intersection.
    const tx = rx + 2;
    const ty = ry - 2;
    animatedSprites.push({
      x: tx * tiledim,
      y: ty * tiledim,
      w: tiledim,
      h: tiledim,
      layer: 1,
      sheet: '__city_trafficlight__',
      animation: 'cycle',
    });
  }
}

export const bgtiles = [ground, markings];
export const objmap = [objs];
export const animatedsprites = animatedSprites;
export const mapwidth = bgtiles[0].length;
export const mapheight = bgtiles[0][0].length;
