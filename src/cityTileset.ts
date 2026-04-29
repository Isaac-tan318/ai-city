export const CITY_TILESET_URL = '__city__';
export const CITY_TILESET_DIM_X = 256;
export const CITY_TILESET_DIM_Y = 64;
export const CITY_TILE_DIM = 32;

export const CITY_TRAFFICLIGHT_SHEET = '__city_trafficlight__';

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
