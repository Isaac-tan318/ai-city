export const CITY_TILESET_URL = '__city__';
export const CITY_TILESET_DIM_X = 256;
export const CITY_TILESET_DIM_Y = 128;
export const CITY_TILE_DIM = 32;

export const CITY_TRAFFICLIGHT_SHEET = '__city_trafficlight__';
export const CITY_FOUNTAIN_SHEET = '__city_fountain__';

const TILE = 32;

type Ctx = CanvasRenderingContext2D;

const COLORS = {
  asphalt: '#2c2c30',
  asphaltDark: '#1f1f24',
  yellow: '#f5c93f',
  white: '#ececec',
  sidewalk: '#a8a4a0',
  sidewalkLine: '#7d7975',
  grass: '#3d6a2c',
  grassDark: '#2e5520',
  plaza: '#8a7a5e',
  plazaLine: '#6e6048',
  brick: '#8b3f30',
  brickMortar: '#6a2f24',
  windowGlass: '#7ec8e3',
  windowFrame: '#1a1a20',
  door: '#5a3a20',
  doorFrame: '#3a2410',
  doorKnob: '#dba93a',
  roof: '#1a1a1f',
  roofLine: '#0e0e12',
  treeTrunk: '#5a3920',
  treeLeaf: '#2d6620',
  treeLeafDark: '#1f4a16',
  benchSeat: '#704420',
  benchLeg: '#3a2410',
  lampPole: '#1a1a20',
  lampGlow: '#ffd870',
  carBody: '#b53030',
  carWindow: '#3a3a40',
  carBlack: '#0a0a0a',
  carHeadlight: '#fff8c0',
  glass: '#a8d4e8',
  glassDark: '#6fa9c0',
  glassFrame: '#1f2a30',
  concrete: '#b8b3a8',
  concreteDark: '#7e7a72',
  awningRed: '#c5302a',
  awningWhite: '#ececec',
  flatRoof: '#a8a4a0',
  flatRoofLine: '#7d7975',
  water: '#3a8fb8',
  waterLight: '#5fa6c8',
  flowerRed: '#d8504a',
  flowerYellow: '#f5c93f',
  flowerPink: '#e69ab8',
  dirt: '#a08458',
  dirtDark: '#7c6440',
  hedge: '#1f4a16',
  hedgeDark: '#163510',
  hydrantRed: '#c93030',
  hydrantCap: '#dba93a',
  mailboxBlue: '#1a4a8a',
  mailboxLight: '#2a6abf',
  signYellow: '#f5c93f',
  signPole: '#1a1a20',
  binGray: '#5a5a60',
  binDark: '#3a3a40',
  stone: '#a8a4a0',
  stoneDark: '#5a5650',
};

function fillRect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function pixel(ctx: Ctx, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function prand(x: number, y: number, seed: number): number {
  let h = (x * 374761393) ^ (y * 668265263) ^ (seed * 982451653);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return h / 0xffffffff;
}

function asphaltBase(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.asphalt);
  for (let i = 0; i < 16; i++) {
    const px = ox + Math.floor(prand(ox + i, oy + i, 1) * TILE);
    const py = oy + Math.floor(prand(ox - i, oy + i * 3, 2) * TILE);
    pixel(ctx, px, py, COLORS.asphaltDark);
  }
}

function drawAsphalt(ctx: Ctx, ox: number, oy: number) {
  asphaltBase(ctx, ox, oy);
}

function drawYellowH(ctx: Ctx, ox: number, oy: number) {
  asphaltBase(ctx, ox, oy);
  for (let x = 2; x < TILE - 2; x += 8) {
    fillRect(ctx, ox + x, oy + 14, 5, 4, COLORS.yellow);
  }
}

function drawYellowV(ctx: Ctx, ox: number, oy: number) {
  asphaltBase(ctx, ox, oy);
  for (let y = 2; y < TILE - 2; y += 8) {
    fillRect(ctx, ox + 14, oy + y, 4, 5, COLORS.yellow);
  }
}

function drawCrosswalkH(ctx: Ctx, ox: number, oy: number) {
  asphaltBase(ctx, ox, oy);
  for (let i = 0; i < 4; i++) {
    fillRect(ctx, ox + 2 + i * 8, oy + 2, 4, TILE - 4, COLORS.white);
  }
}

function drawCrosswalkV(ctx: Ctx, ox: number, oy: number) {
  asphaltBase(ctx, ox, oy);
  for (let i = 0; i < 4; i++) {
    fillRect(ctx, ox + 2, oy + 2 + i * 8, TILE - 4, 4, COLORS.white);
  }
}

function drawSidewalk(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.sidewalk);
  fillRect(ctx, ox, oy + 16, TILE, 1, COLORS.sidewalkLine);
  fillRect(ctx, ox + 16, oy, 1, TILE, COLORS.sidewalkLine);
  for (let i = 0; i < 8; i++) {
    const px = ox + Math.floor(prand(ox + i, oy, 3) * TILE);
    const py = oy + Math.floor(prand(ox, oy + i, 4) * TILE);
    pixel(ctx, px, py, COLORS.sidewalkLine);
  }
}

function drawGrass(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.grass);
  for (let i = 0; i < 36; i++) {
    const px = ox + Math.floor(prand(ox + i, oy + i * 7, 5) * TILE);
    const py = oy + Math.floor(prand(ox * 3 + i, oy + i, 6) * TILE);
    pixel(ctx, px, py, COLORS.grassDark);
  }
}

function drawPlaza(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.plaza);
  for (let y = 0; y < TILE; y += 4) {
    fillRect(ctx, ox, oy + y, TILE, 1, COLORS.plazaLine);
    const offset = ((y / 4) | 0) % 2 === 0 ? 0 : 4;
    for (let x = offset; x < TILE; x += 8) {
      fillRect(ctx, ox + x, oy + y, 1, 4, COLORS.plazaLine);
    }
  }
}

function brickPattern(ctx: Ctx, ox: number, oy: number, w: number, h: number) {
  fillRect(ctx, ox, oy, w, h, COLORS.brick);
  for (let y = 0; y < h; y += 4) {
    fillRect(ctx, ox, oy + y, w, 1, COLORS.brickMortar);
    const offset = ((y / 4) | 0) % 2 === 0 ? 0 : 4;
    for (let x = offset; x < w; x += 8) {
      fillRect(ctx, ox + x, oy + y, 1, 4, COLORS.brickMortar);
    }
  }
}

function drawBrick(ctx: Ctx, ox: number, oy: number) {
  brickPattern(ctx, ox, oy, TILE, TILE);
}

function drawWindow(ctx: Ctx, ox: number, oy: number) {
  brickPattern(ctx, ox, oy, TILE, TILE);
  fillRect(ctx, ox + 5, oy + 6, 22, 22, COLORS.windowFrame);
  fillRect(ctx, ox + 6, oy + 7, 20, 20, COLORS.windowGlass);
  fillRect(ctx, ox + 6, oy + 16, 20, 1, COLORS.windowFrame);
  fillRect(ctx, ox + 15, oy + 7, 1, 20, COLORS.windowFrame);
  fillRect(ctx, ox + 4, oy + 28, 24, 2, COLORS.windowFrame);
}

function drawDoor(ctx: Ctx, ox: number, oy: number) {
  brickPattern(ctx, ox, oy, TILE, TILE);
  fillRect(ctx, ox + 8, oy + 4, 16, 28, COLORS.doorFrame);
  fillRect(ctx, ox + 9, oy + 5, 14, 27, COLORS.door);
  fillRect(ctx, ox + 11, oy + 8, 10, 8, COLORS.doorFrame);
  fillRect(ctx, ox + 11, oy + 18, 10, 10, COLORS.doorFrame);
  fillRect(ctx, ox + 20, oy + 18, 2, 2, COLORS.doorKnob);
}

function drawRoof(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.roof);
  fillRect(ctx, ox, oy, TILE, 2, COLORS.roofLine);
  fillRect(ctx, ox, oy + TILE - 2, TILE, 2, COLORS.roofLine);
  fillRect(ctx, ox + 8, oy + 8, 4, 4, COLORS.roofLine);
  fillRect(ctx, ox + 22, oy + 18, 6, 8, COLORS.roofLine);
}

function drawTree(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.grass);
  fillRect(ctx, ox + 14, oy + 18, 4, 12, COLORS.treeTrunk);
  const canopy: Array<[number, number, number, number]> = [
    [10, 4, 12, 4],
    [8, 8, 16, 4],
    [6, 12, 20, 4],
    [8, 16, 16, 4],
    [10, 20, 12, 2],
  ];
  for (const [x, y, w, h] of canopy) {
    fillRect(ctx, ox + x, oy + y, w, h, COLORS.treeLeaf);
  }
  fillRect(ctx, ox + 18, oy + 8, 6, 2, COLORS.treeLeafDark);
  fillRect(ctx, ox + 20, oy + 12, 4, 2, COLORS.treeLeafDark);
}

function drawBench(ctx: Ctx, ox: number, oy: number) {
  drawSidewalk(ctx, ox, oy);
  fillRect(ctx, ox + 3, oy + 8, 26, 2, COLORS.benchSeat);
  fillRect(ctx, ox + 3, oy + 12, 26, 4, COLORS.benchSeat);
  fillRect(ctx, ox + 3, oy + 16, 26, 1, COLORS.benchLeg);
  fillRect(ctx, ox + 4, oy + 16, 2, 6, COLORS.benchLeg);
  fillRect(ctx, ox + 26, oy + 16, 2, 6, COLORS.benchLeg);
}

function drawLamp(ctx: Ctx, ox: number, oy: number) {
  drawSidewalk(ctx, ox, oy);
  fillRect(ctx, ox + 15, oy + 10, 2, 22, COLORS.lampPole);
  fillRect(ctx, ox + 13, oy + 30, 6, 2, COLORS.lampPole);
  fillRect(ctx, ox + 12, oy + 6, 8, 4, COLORS.lampPole);
  fillRect(ctx, ox + 13, oy + 4, 6, 2, COLORS.lampPole);
  fillRect(ctx, ox + 14, oy + 8, 4, 2, COLORS.lampGlow);
}

function drawCar(ctx: Ctx, ox: number, oy: number) {
  asphaltBase(ctx, ox, oy);
  fillRect(ctx, ox + 2, oy + 8, 28, 16, COLORS.carBody);
  pixel(ctx, ox + 2, oy + 8, COLORS.asphalt);
  pixel(ctx, ox + 29, oy + 8, COLORS.asphalt);
  pixel(ctx, ox + 2, oy + 23, COLORS.asphalt);
  pixel(ctx, ox + 29, oy + 23, COLORS.asphalt);
  fillRect(ctx, ox + 5, oy + 11, 8, 10, COLORS.carWindow);
  fillRect(ctx, ox + 19, oy + 11, 8, 10, COLORS.carWindow);
  fillRect(ctx, ox + 28, oy + 10, 2, 2, COLORS.carHeadlight);
  fillRect(ctx, ox + 28, oy + 20, 2, 2, COLORS.carHeadlight);
  fillRect(ctx, ox + 5, oy + 7, 5, 2, COLORS.carBlack);
  fillRect(ctx, ox + 22, oy + 7, 5, 2, COLORS.carBlack);
  fillRect(ctx, ox + 5, oy + 23, 5, 2, COLORS.carBlack);
  fillRect(ctx, ox + 22, oy + 23, 5, 2, COLORS.carBlack);
}

function drawGlassWall(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.glass);
  fillRect(ctx, ox, oy + 24, TILE, 8, COLORS.glassDark);
  for (let x = 0; x < TILE; x += 4) {
    fillRect(ctx, ox + x, oy, 1, TILE, COLORS.glassFrame);
  }
  fillRect(ctx, ox, oy, TILE, 1, COLORS.glassFrame);
  fillRect(ctx, ox, oy + TILE - 1, TILE, 1, COLORS.glassFrame);
  for (let i = 0; i < 22; i++) {
    fillRect(ctx, ox + 5 + i, oy + 2 + i, 2, 1, COLORS.windowGlass);
  }
}

function drawGlassWindow(ctx: Ctx, ox: number, oy: number) {
  drawGlassWall(ctx, ox, oy);
  fillRect(ctx, ox + 6, oy + 5, 14, 18, '#cce8f5');
  fillRect(ctx, ox + 6, oy + 5, 1, 18, COLORS.glassFrame);
  fillRect(ctx, ox + 19, oy + 5, 1, 18, COLORS.glassFrame);
}

function drawConcreteWall(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.concrete);
  for (let y = 0; y < TILE; y += 8) {
    fillRect(ctx, ox, oy + y, TILE, 1, COLORS.concreteDark);
  }
  fillRect(ctx, ox + 16, oy, 1, TILE, COLORS.concreteDark);
}

function drawConcreteWindow(ctx: Ctx, ox: number, oy: number) {
  drawConcreteWall(ctx, ox, oy);
  fillRect(ctx, ox + 8, oy + 7, 16, 16, COLORS.windowFrame);
  fillRect(ctx, ox + 10, oy + 9, 12, 12, COLORS.glassDark);
  fillRect(ctx, ox + 10, oy + 14, 12, 1, COLORS.windowFrame);
}

function drawAwningRed(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE - 4, COLORS.awningWhite);
  for (let x = 0; x < TILE; x += 8) {
    fillRect(ctx, ox + x, oy, 4, TILE - 4, COLORS.awningRed);
  }
  for (let x = 0; x < TILE; x += 8) {
    fillRect(ctx, ox + x + 1, oy + 25, 4, 3, COLORS.brickMortar);
  }
  brickPattern(ctx, ox, oy + TILE - 4, TILE, 4);
}

function drawFlatRoofLight(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.flatRoof);
  fillRect(ctx, ox, oy, TILE, 2, COLORS.flatRoofLine);
  fillRect(ctx, ox, oy + TILE - 2, TILE, 2, COLORS.flatRoofLine);
  fillRect(ctx, ox, oy, 2, TILE, COLORS.flatRoofLine);
  fillRect(ctx, ox + TILE - 2, oy, 2, TILE, COLORS.flatRoofLine);
  fillRect(ctx, ox + 5, oy + 7, 9, 7, COLORS.concreteDark);
  fillRect(ctx, ox + 6, oy + 8, 7, 5, COLORS.concrete);
  fillRect(ctx, ox + 19, oy + 17, 8, 7, COLORS.flatRoofLine);
  fillRect(ctx, ox + 20, oy + 18, 6, 5, COLORS.flatRoof);
}

function drawPond(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.water);
  for (let i = 0; i < 40; i++) {
    const px = ox + Math.floor(prand(ox + i, oy + i * 5, 17) * TILE);
    const py = oy + Math.floor(prand(ox - i, oy + i * 2, 18) * TILE);
    pixel(ctx, px, py, COLORS.waterLight);
  }
  for (let i = 0; i < 6; i++) {
    const px = ox + 5 + Math.floor(prand(ox + i, oy, 19) * 20);
    const py = oy + 6 + Math.floor(prand(ox, oy + i, 20) * 18);
    pixel(ctx, px, py, '#ffffff');
  }
}

function drawFlowerbed(ctx: Ctx, ox: number, oy: number) {
  drawGrass(ctx, ox, oy);
  const flowers = [COLORS.flowerRed, COLORS.flowerYellow, COLORS.flowerPink];
  for (let i = 0; i < 22; i++) {
    const px = ox + Math.floor(prand(ox + i, oy + i * 3, 21) * (TILE - 2));
    const py = oy + Math.floor(prand(ox - i, oy + i * 4, 22) * (TILE - 2));
    const color = flowers[i % flowers.length];
    if (i % 5 === 0) fillRect(ctx, px, py, 2, 2, color);
    else pixel(ctx, px, py, color);
  }
}

function drawDirtPath(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.dirt);
  for (let i = 0; i < 42; i++) {
    const px = ox + Math.floor(prand(ox + i, oy + i, 23) * TILE);
    const py = oy + Math.floor(prand(ox - i, oy + i * 2, 24) * TILE);
    pixel(ctx, px, py, COLORS.dirtDark);
  }
}

function drawHedge(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.hedgeDark);
  for (let i = 0; i < 26; i++) {
    const px = ox + Math.floor(prand(ox + i, oy + i * 7, 25) * (TILE - 3));
    const py = oy + Math.floor(prand(ox * 2 + i, oy + i, 26) * (TILE - 3));
    fillRect(ctx, px, py, 3, 3, COLORS.hedge);
  }
}

function drawFireHydrant(ctx: Ctx, ox: number, oy: number) {
  drawSidewalk(ctx, ox, oy);
  fillRect(ctx, ox + 14, oy + 16, 4, 8, COLORS.hydrantRed);
  fillRect(ctx, ox + 13, oy + 13, 6, 3, COLORS.hydrantCap);
  fillRect(ctx, ox + 11, oy + 18, 3, 3, COLORS.hydrantCap);
  fillRect(ctx, ox + 18, oy + 18, 3, 3, COLORS.hydrantCap);
  fillRect(ctx, ox + 12, oy + 24, 8, 2, COLORS.hydrantRed);
}

function drawMailbox(ctx: Ctx, ox: number, oy: number) {
  drawSidewalk(ctx, ox, oy);
  fillRect(ctx, ox + 10, oy + 12, 12, 8, COLORS.mailboxBlue);
  fillRect(ctx, ox + 11, oy + 10, 10, 3, COLORS.mailboxLight);
  fillRect(ctx, ox + 12, oy + 15, 8, 1, COLORS.windowFrame);
  fillRect(ctx, ox + 15, oy + 20, 2, 6, COLORS.signPole);
  fillRect(ctx, ox + 13, oy + 26, 6, 2, COLORS.signPole);
}

function drawBusStop(ctx: Ctx, ox: number, oy: number) {
  drawSidewalk(ctx, ox, oy);
  fillRect(ctx, ox + 15, oy + 8, 2, 20, COLORS.signPole);
  fillRect(ctx, ox + 11, oy + 5, 10, 10, COLORS.signYellow);
  fillRect(ctx, ox + 13, oy + 9, 6, 3, COLORS.windowFrame);
  pixel(ctx, ox + 13, oy + 13, COLORS.windowFrame);
  pixel(ctx, ox + 18, oy + 13, COLORS.windowFrame);
  fillRect(ctx, ox + 5, oy + 24, 18, 2, COLORS.benchSeat);
  fillRect(ctx, ox + 7, oy + 26, 2, 3, COLORS.benchLeg);
  fillRect(ctx, ox + 19, oy + 26, 2, 3, COLORS.benchLeg);
}

function drawTrashcan(ctx: Ctx, ox: number, oy: number) {
  drawSidewalk(ctx, ox, oy);
  fillRect(ctx, ox + 10, oy + 11, 12, 3, COLORS.binDark);
  fillRect(ctx, ox + 11, oy + 14, 10, 14, COLORS.binGray);
  fillRect(ctx, ox + 11, oy + 14, 2, 14, COLORS.binDark);
  fillRect(ctx, ox + 18, oy + 14, 2, 14, COLORS.binDark);
  fillRect(ctx, ox + 12, oy + 28, 8, 2, COLORS.binDark);
}

function drawStatue(ctx: Ctx, ox: number, oy: number) {
  drawPlaza(ctx, ox, oy);
  fillRect(ctx, ox + 9, oy + 23, 14, 4, COLORS.stoneDark);
  fillRect(ctx, ox + 11, oy + 19, 10, 4, COLORS.stone);
  fillRect(ctx, ox + 13, oy + 16, 6, 3, COLORS.stoneDark);
  fillRect(ctx, ox + 15, oy + 7, 3, 9, COLORS.stoneDark);
  fillRect(ctx, ox + 14, oy + 5, 5, 4, COLORS.stone);
  fillRect(ctx, ox + 12, oy + 10, 3, 2, COLORS.stone);
  fillRect(ctx, ox + 18, oy + 10, 3, 2, COLORS.stone);
}

function drawFountainBase(ctx: Ctx, ox: number, oy: number) {
  drawPlaza(ctx, ox, oy);
  ctx.fillStyle = COLORS.stoneDark;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 18, 13, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.stone;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 17, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  fillRect(ctx, ox + 13, oy + 14, 6, 5, COLORS.stoneDark);
  fillRect(ctx, ox + 14, oy + 13, 4, 4, COLORS.stone);
}

const TILE_PAINTERS: Array<(ctx: Ctx, ox: number, oy: number) => void> = [
  drawAsphalt,
  drawYellowH,
  drawYellowV,
  drawCrosswalkH,
  drawCrosswalkV,
  drawSidewalk,
  drawGrass,
  drawPlaza,
  drawBrick,
  drawWindow,
  drawDoor,
  drawRoof,
  drawTree,
  drawBench,
  drawLamp,
  drawCar,
  drawGlassWall,
  drawGlassWindow,
  drawConcreteWall,
  drawConcreteWindow,
  drawAwningRed,
  drawFlatRoofLight,
  drawPond,
  drawFlowerbed,
  drawDirtPath,
  drawHedge,
  drawFireHydrant,
  drawMailbox,
  drawBusStop,
  drawTrashcan,
  drawStatue,
  drawFountainBase,
];

export const CITY_TILE = {
  ASPHALT: 0,
  YELLOW_H: 1,
  YELLOW_V: 2,
  CROSSWALK_H: 3,
  CROSSWALK_V: 4,
  SIDEWALK: 5,
  GRASS: 6,
  PLAZA: 7,
  BRICK: 8,
  WINDOW: 9,
  DOOR: 10,
  ROOF: 11,
  TREE: 12,
  BENCH: 13,
  LAMP: 14,
  CAR: 15,
  GLASS_WALL: 16,
  GLASS_WINDOW: 17,
  CONCRETE_WALL: 18,
  CONCRETE_WINDOW: 19,
  AWNING_RED: 20,
  FLAT_ROOF_LIGHT: 21,
  POND: 22,
  FLOWERBED: 23,
  DIRT_PATH: 24,
  HEDGE: 25,
  FIRE_HYDRANT: 26,
  MAILBOX: 27,
  BUS_STOP: 28,
  TRASHCAN: 29,
  STATUE: 30,
  FOUNTAIN_BASE: 31,
};

export function createCityTilesetCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CITY_TILESET_DIM_X;
  canvas.height = CITY_TILESET_DIM_Y;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < TILE_PAINTERS.length; i++) {
    const col = i % 8;
    const row = Math.floor(i / 8);
    TILE_PAINTERS[i](ctx, col * TILE, row * TILE);
  }
  return canvas;
}

export function createTrafficLightCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const frames = [
    { red: true, yellow: false, green: false },
    { red: false, yellow: true, green: false },
    { red: false, yellow: false, green: true },
    { red: false, yellow: true, green: false },
  ];
  const drawLight = (ox: number, cy: number, on: boolean, color: string) => {
    const c = on ? color : '#22222a';
    fillRect(ctx, ox + 13, cy - 3, 6, 6, c);
    if (on) pixel(ctx, ox + 14, cy - 2, '#ffffff');
  };
  for (let i = 0; i < frames.length; i++) {
    const ox = i * 32;
    fillRect(ctx, ox + 14, 22, 4, 10, '#1a1a1f');
    fillRect(ctx, ox + 11, 2, 10, 22, '#0a0a0e');
    drawLight(ox, 6, frames[i].red, '#e44545');
    drawLight(ox, 13, frames[i].yellow, '#f5c93f');
    drawLight(ox, 20, frames[i].green, '#4cd860');
  }
  return canvas;
}

export function createFountainCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const heights = [6, 9, 12, 9];
  for (let i = 0; i < heights.length; i++) {
    const ox = i * 32;
    ctx.fillStyle = COLORS.stoneDark;
    ctx.beginPath();
    ctx.ellipse(ox + 16, 22, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.stone;
    ctx.beginPath();
    ctx.ellipse(ox + 16, 21, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    fillRect(ctx, ox + 14, 17, 4, 4, COLORS.stoneDark);
    fillRect(ctx, ox + 15, 16, 2, 4, COLORS.stone);

    const h = heights[i];
    fillRect(ctx, ox + 15, 16 - h, 2, h, COLORS.water);
    pixel(ctx, ox + 16, 15 - h, COLORS.waterLight);
    pixel(ctx, ox + 15, 14 - h, '#ffffff');
    pixel(ctx, ox + 12 - (i % 2), 18 - h, COLORS.waterLight);
    pixel(ctx, ox + 20 + (i % 2), 18 - h, COLORS.waterLight);
    pixel(ctx, ox + 11, 20 - Math.floor(h / 2), '#ffffff');
    pixel(ctx, ox + 21, 20 - Math.floor(h / 2), '#ffffff');
  }
  return canvas;
}

export const TRAFFIC_LIGHT_SPRITESHEET = {
  frames: {
    'tl1.png': {
      frame: { x: 0, y: 0, w: 32, h: 32 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
      sourceSize: { w: 32, h: 32 },
    },
    'tl2.png': {
      frame: { x: 32, y: 0, w: 32, h: 32 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
      sourceSize: { w: 32, h: 32 },
    },
    'tl3.png': {
      frame: { x: 64, y: 0, w: 32, h: 32 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
      sourceSize: { w: 32, h: 32 },
    },
    'tl4.png': {
      frame: { x: 96, y: 0, w: 32, h: 32 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
      sourceSize: { w: 32, h: 32 },
    },
  },
  animations: {
    cycle: ['tl1.png', 'tl2.png', 'tl3.png', 'tl4.png'],
  },
  meta: {
    image: 'trafficlight.png',
    format: 'RGBA8888',
    size: { w: 128, h: 32 },
    scale: '1',
  },
};

export const FOUNTAIN_SPRITESHEET = {
  frames: {
    'f1.png': {
      frame: { x: 0, y: 0, w: 32, h: 32 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
      sourceSize: { w: 32, h: 32 },
    },
    'f2.png': {
      frame: { x: 32, y: 0, w: 32, h: 32 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
      sourceSize: { w: 32, h: 32 },
    },
    'f3.png': {
      frame: { x: 64, y: 0, w: 32, h: 32 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
      sourceSize: { w: 32, h: 32 },
    },
    'f4.png': {
      frame: { x: 96, y: 0, w: 32, h: 32 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
      sourceSize: { w: 32, h: 32 },
    },
  },
  animations: {
    bubble: ['f1.png', 'f2.png', 'f3.png', 'f4.png'],
  },
  meta: {
    image: 'fountain.png',
    format: 'RGBA8888',
    size: { w: 128, h: 32 },
    scale: '1',
  },
};
