// Procedurally-generated city map. Tile graphics are generated at runtime in
// src/cityTileset.ts; the magic '__city__' URL tells the renderer to use the
// procedural canvas instead of fetching a PNG.

export const tilesetpath = '__city__';
export const tiledim = 32;
export const tilesetpxw = 256;
export const tilesetpxh = 64;

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
  [5, 11], [22, 11], [40, 11],
  [8, 23], [27, 23], [42, 23],
];
for (const [cx, cy] of PARKED_CARS) {
  if (inBounds(cx, cy) && ground[cx][cy] === ASPHALT) markings[cx][cy] = CAR;
}

// --- Buildings (objects, block movement) --------------------------------

function placeBuilding(ox, oy, w, h) {
  if (h < 2) return;
  const wallY = oy + h - 1;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h - 1; dy++) {
      if (inBounds(ox + dx, oy + dy)) objs[ox + dx][oy + dy] = ROOF;
    }
  }
  const doorX = ox + Math.floor(w / 2);
  for (let dx = 0; dx < w; dx++) {
    if (!inBounds(ox + dx, wallY)) continue;
    if (ox + dx === doorX) {
      objs[ox + dx][wallY] = DOOR;
    } else if (dx % 2 === 0) {
      objs[ox + dx][wallY] = WINDOW;
    } else {
      objs[ox + dx][wallY] = BRICK;
    }
  }
}

const BUILDINGS = [
  // Block NW (cols 0..13, rows 0..9)
  [2, 1, 5, 4], [8, 2, 4, 4], [2, 6, 5, 3], [8, 6, 5, 3],
  // Block NE (cols 17..31, rows 0..9)
  [18, 1, 6, 4], [25, 2, 5, 5], [18, 6, 5, 3], [24, 7, 6, 2],
  // Block N-far-E (cols 35..47, rows 0..9)
  [36, 1, 4, 4], [41, 2, 5, 5], [36, 6, 5, 3], [42, 7, 5, 2],
  // Block W-mid (cols 0..13, rows 13..21)
  [2, 14, 5, 4], [8, 14, 5, 3], [2, 18, 6, 3], [9, 18, 4, 3],
  // Block mid (cols 17..31, rows 13..21)
  [18, 14, 5, 4], [24, 14, 6, 5], [18, 19, 4, 2], [23, 19, 7, 2],
  // Block E-mid (cols 35..47, rows 13..21)
  [36, 14, 5, 4], [42, 14, 5, 4], [36, 19, 5, 2], [42, 19, 5, 2],
  // Block SW (cols 0..13, rows 25..31)
  [2, 26, 5, 5], [8, 27, 6, 4],
  // Block S-mid (cols 17..31, rows 25..31)
  [17, 26, 5, 5], [23, 27, 5, 4], [28, 26, 4, 5],
  // Block S-far-E (cols 35..47, rows 25..31)
  [36, 26, 5, 5], [42, 27, 5, 4],
];
for (const [ox, oy, w, h] of BUILDINGS) placeBuilding(ox, oy, w, h);

// --- Decorative props ---------------------------------------------------

// Plaza patches in some open green pockets.
const PLAZA_CENTERS = [[10, 5], [28, 17], [40, 17]];
for (const [cx, cy] of PLAZA_CENTERS) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = cx + dx, y = cy + dy;
      if (inBounds(x, y) && objs[x][y] === -1 && ground[x][y] === GRASS) {
        ground[x][y] = PLAZA;
      }
    }
  }
}

// Trees scattered in green pockets between buildings.
const TREES = [
  [13, 1], [13, 4], [13, 7],
  [16, 1], [16, 4], [16, 7],
  [22, 8], [30, 1], [31, 4], [34, 1], [34, 4], [34, 7],
  [40, 7], [44, 8],
  [13, 13], [16, 13], [16, 16], [22, 13], [30, 13], [34, 13], [34, 17], [40, 21],
  [13, 25], [16, 25], [16, 29], [22, 25], [30, 25], [34, 25], [34, 29], [44, 25],
  [0, 1], [0, 4], [0, 7], [0, 13], [0, 17], [0, 25], [0, 29],
  [47, 1], [47, 4], [47, 13], [47, 17], [47, 25], [47, 29],
];
for (const [tx, ty] of TREES) {
  if (inBounds(tx, ty) && objs[tx][ty] === -1 && ground[tx][ty] === GRASS) {
    objs[tx][ty] = TREE;
  }
}

// Streetlamps along sidewalks (sparse).
const LAMPS = [
  [4, 10], [11, 10], [22, 10], [29, 10], [38, 10], [46, 10],
  [4, 12], [11, 12], [29, 12], [38, 12],
  [4, 22], [11, 22], [22, 22], [29, 22], [38, 22], [46, 22],
  [4, 24], [11, 24], [29, 24], [38, 24],
  [14, 4], [14, 18], [14, 27],
  [16, 7], [16, 20], [16, 28],
  [32, 4], [32, 18], [32, 27],
  [34, 7], [34, 20], [34, 28],
];
for (const [lx, ly] of LAMPS) {
  if (inBounds(lx, ly) && objs[lx][ly] === -1 && ground[lx][ly] === SIDEWALK) {
    objs[lx][ly] = LAMP;
  }
}

// Benches at intersections / parks.
const BENCHES = [
  [6, 10], [25, 10], [37, 10],
  [6, 24], [25, 24], [37, 24],
  [10, 6], [28, 16], [40, 16],
];
for (const [bx, by] of BENCHES) {
  if (inBounds(bx, by) && objs[bx][by] === -1) {
    if (ground[bx][by] === SIDEWALK || ground[bx][by] === PLAZA) {
      objs[bx][by] = BENCH;
    }
  }
}

// --- Animated traffic lights at each intersection -----------------------

const animatedSprites = [];
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
