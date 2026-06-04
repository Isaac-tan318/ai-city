export const CITY_TILESET_URL = '__city__';
export const CITY_TILESET_DIM_X = 256;
export const CITY_TILESET_DIM_Y = 256;
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
  // Suntec
  suntecGlass: '#1e3a5f',
  suntecGlassLite: '#2d5a8f',
  suntecFrame: '#0a1828',
  suntecAccent: '#7ec8e3',
  // HDB
  hdbCream: '#e8dec7',
  hdbCreamDark: '#c2b691',
  hdbWindow: '#5b8aa5',
  hdbBalcony: '#a89e7c',
  // White brick
  whiteBrick: '#ece4d4',
  whiteBrickMortar: '#c2b896',
  // Fusionopolis
  fusionGlass: '#3fb1c8',
  fusionGlassDark: '#1f7a8f',
  fusionAccent: '#a8e8f0',
  // A*STAR
  astarBlue: '#1a4f8a',
  astarLogo: '#ffd84a',
  // MBS
  mbsWhite: '#f4f0e6',
  mbsWhiteDark: '#cfc8b4',
  mbsSkypark: '#5a9a4a',
  mbsSkyparkDark: '#3d6a2c',
  mbsCurve: '#d4cdb6',
  mbsDeck: '#c8b480',
  mbsDeckFace: '#ddd0a8',
  mbsPoolBlue: '#1a6090',
  mbsPoolLight: '#3090c0',
  mbsSky: '#b8d0e4',
  // Restaurant
  restaurantTable: '#7a4a28',
  restaurantTableLight: '#a86b3c',
  umbrellaRed: '#d8392c',
  umbrellaWhite: '#f5f0e4',
  // Supertree
  supertreeTrunk: '#3a2e4a',
  supertreeCanopy: '#9a4cb8',
  supertreeCanopyHi: '#d878e0',
  supertreeBranch: '#6a3a85',
  // Peranakan
  peraPink: '#f3b8c8',
  peraPinkShade: '#c87890',
  peraBlue: '#a8d8e8',
  peraBlueShade: '#6fa9c0',
  peraMint: '#bfe2c4',
  peraMintShade: '#7eb088',
  peraTrim: '#e8d8a8',
  peraRoof: '#a64a2a',
  peraRoofDark: '#7a3320',
  peraArch: '#4a3220',
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

// --- Suntec City -------------------------------------------------------

function drawSuntecWall(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.suntecGlass);
  fillRect(ctx, ox, oy + 4, TILE, 1, COLORS.suntecGlassLite);
  fillRect(ctx, ox, oy + 14, TILE, 1, COLORS.suntecGlassLite);
  fillRect(ctx, ox, oy + 24, TILE, 1, COLORS.suntecGlassLite);
  for (let x = 0; x < TILE; x += 4) {
    fillRect(ctx, ox + x, oy, 1, TILE, COLORS.suntecFrame);
  }
  fillRect(ctx, ox, oy, TILE, 1, COLORS.suntecFrame);
  fillRect(ctx, ox, oy + TILE - 1, TILE, 1, COLORS.suntecFrame);
  for (let i = 0; i < 14; i++) {
    pixel(ctx, ox + 6 + i, oy + 5 + i, COLORS.suntecAccent);
  }
}

function drawSuntecWindow(ctx: Ctx, ox: number, oy: number) {
  drawSuntecWall(ctx, ox, oy);
  fillRect(ctx, ox + 6, oy + 6, 20, 9, COLORS.suntecAccent);
  fillRect(ctx, ox + 7, oy + 7, 18, 7, '#a8d8f0');
  fillRect(ctx, ox + 6, oy + 18, 20, 9, COLORS.suntecAccent);
  fillRect(ctx, ox + 7, oy + 19, 18, 7, '#a8d8f0');
}

// --- HDB ----------------------------------------------------------------

function drawHdbWall(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.hdbCream);
  fillRect(ctx, ox, oy, TILE, 2, COLORS.hdbCreamDark);
  fillRect(ctx, ox, oy + 16, TILE, 1, COLORS.hdbCreamDark);
  for (let i = 0; i < 24; i++) {
    const px = ox + Math.floor(prand(ox + i, oy + i * 2, 31) * TILE);
    const py = oy + Math.floor(prand(ox - i, oy + i, 32) * TILE);
    pixel(ctx, px, py, COLORS.hdbCreamDark);
  }
}

function drawHdbWindow(ctx: Ctx, ox: number, oy: number) {
  drawHdbWall(ctx, ox, oy);
  fillRect(ctx, ox + 4, oy + 4, 10, 9, COLORS.windowFrame);
  fillRect(ctx, ox + 5, oy + 5, 8, 7, COLORS.hdbWindow);
  fillRect(ctx, ox + 18, oy + 4, 10, 9, COLORS.windowFrame);
  fillRect(ctx, ox + 19, oy + 5, 8, 7, COLORS.hdbWindow);
  fillRect(ctx, ox + 2, oy + 19, 28, 3, COLORS.hdbBalcony);
  fillRect(ctx, ox + 2, oy + 21, 28, 1, COLORS.hdbCreamDark);
  for (let x = 4; x < TILE - 2; x += 4) {
    fillRect(ctx, ox + x, oy + 19, 1, 3, COLORS.hdbCreamDark);
  }
  fillRect(ctx, ox + 8, oy + 24, 16, 6, COLORS.windowFrame);
  fillRect(ctx, ox + 9, oy + 25, 14, 4, COLORS.hdbWindow);
}

// --- White brick (landed housing) --------------------------------------

function whiteBrickPattern(ctx: Ctx, ox: number, oy: number, w: number, h: number) {
  fillRect(ctx, ox, oy, w, h, COLORS.whiteBrick);
  for (let y = 0; y < h; y += 4) {
    fillRect(ctx, ox, oy + y, w, 1, COLORS.whiteBrickMortar);
    const offset = ((y / 4) | 0) % 2 === 0 ? 0 : 4;
    for (let x = offset; x < w; x += 8) {
      fillRect(ctx, ox + x, oy + y, 1, 4, COLORS.whiteBrickMortar);
    }
  }
}

function drawWhiteBrick(ctx: Ctx, ox: number, oy: number) {
  whiteBrickPattern(ctx, ox, oy, TILE, TILE);
}

function drawWhiteBrickWindow(ctx: Ctx, ox: number, oy: number) {
  whiteBrickPattern(ctx, ox, oy, TILE, TILE);
  fillRect(ctx, ox + 5, oy + 6, 22, 22, COLORS.windowFrame);
  fillRect(ctx, ox + 6, oy + 7, 20, 20, COLORS.windowGlass);
  fillRect(ctx, ox + 6, oy + 16, 20, 1, COLORS.windowFrame);
  fillRect(ctx, ox + 15, oy + 7, 1, 20, COLORS.windowFrame);
  fillRect(ctx, ox + 4, oy + 28, 24, 2, COLORS.windowFrame);
}

function drawWhiteBrickDoor(ctx: Ctx, ox: number, oy: number) {
  whiteBrickPattern(ctx, ox, oy, TILE, TILE);
  fillRect(ctx, ox + 8, oy + 4, 16, 28, COLORS.doorFrame);
  fillRect(ctx, ox + 9, oy + 5, 14, 27, COLORS.door);
  fillRect(ctx, ox + 11, oy + 8, 10, 8, COLORS.doorFrame);
  fillRect(ctx, ox + 11, oy + 18, 10, 10, COLORS.doorFrame);
  fillRect(ctx, ox + 20, oy + 18, 2, 2, COLORS.doorKnob);
}

// --- Fusionopolis ------------------------------------------------------

function drawFusionWall(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.fusionGlass);
  fillRect(ctx, ox, oy + 24, TILE, 8, COLORS.fusionGlassDark);
  for (let x = 0; x < TILE; x += 4) {
    fillRect(ctx, ox + x, oy, 1, TILE, COLORS.glassFrame);
  }
  fillRect(ctx, ox, oy, TILE, 1, COLORS.glassFrame);
  fillRect(ctx, ox, oy + TILE - 1, TILE, 1, COLORS.glassFrame);
  for (let i = 0; i < 18; i++) {
    pixel(ctx, ox + 4 + i, oy + 3 + i, COLORS.fusionAccent);
    pixel(ctx, ox + 6 + i, oy + 3 + i, COLORS.fusionAccent);
  }
}

function drawFusionWindow(ctx: Ctx, ox: number, oy: number) {
  drawFusionWall(ctx, ox, oy);
  fillRect(ctx, ox + 6, oy + 6, 20, 14, COLORS.fusionAccent);
  fillRect(ctx, ox + 7, oy + 7, 18, 12, '#cdf2f8');
  fillRect(ctx, ox + 15, oy + 7, 1, 12, COLORS.glassFrame);
}

function drawAstarWall(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.astarBlue);
  for (let x = 0; x < TILE; x += 4) {
    fillRect(ctx, ox + x, oy, 1, TILE, '#0e3060');
  }
  fillRect(ctx, ox, oy, TILE, 1, '#0a2348');
  fillRect(ctx, ox, oy + TILE - 1, TILE, 1, '#0a2348');
  fillRect(ctx, ox + 8, oy + 9, 16, 12, COLORS.mbsWhite);
  fillRect(ctx, ox + 8, oy + 9, 16, 1, COLORS.windowFrame);
  fillRect(ctx, ox + 8, oy + 20, 16, 1, COLORS.windowFrame);
  fillRect(ctx, ox + 11, oy + 12, 3, 6, COLORS.astarBlue);
  fillRect(ctx, ox + 14, oy + 14, 3, 4, COLORS.astarBlue);
  pixel(ctx, ox + 18, oy + 12, COLORS.astarLogo);
  fillRect(ctx, ox + 17, oy + 13, 3, 1, COLORS.astarLogo);
  pixel(ctx, ox + 18, oy + 14, COLORS.astarLogo);
  pixel(ctx, ox + 19, oy + 15, COLORS.astarLogo);
  fillRect(ctx, ox + 18, oy + 16, 1, 2, COLORS.astarLogo);
}

// --- Marina Bay Sands --------------------------------------------------

function drawMbsWall(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.mbsWhite);
  // Structural edge columns (3px each side — distinctive MBS tower feature)
  fillRect(ctx, ox, oy, 3, TILE, COLORS.mbsCurve);
  fillRect(ctx, ox + TILE - 3, oy, 3, TILE, COLORS.mbsCurve);
  // Hard outer edge lines
  fillRect(ctx, ox, oy, 1, TILE, COLORS.mbsWhiteDark);
  fillRect(ctx, ox + TILE - 1, oy, 1, TILE, COLORS.mbsWhiteDark);
  // Horizontal floor dividers every 8px
  for (let y = 0; y <= TILE; y += 8) {
    fillRect(ctx, ox + 3, oy + y, TILE - 6, 1, COLORS.mbsWhiteDark);
  }
}

function drawMbsWindow(ctx: Ctx, ox: number, oy: number) {
  drawMbsWall(ctx, ox, oy);
  // Wide horizontal glass window bands (three rows)
  for (const by of [2, 12, 22]) {
    fillRect(ctx, ox + 3, oy + by, TILE - 6, 5, COLORS.windowFrame);
    fillRect(ctx, ox + 4, oy + by + 1, TILE - 8, 3, COLORS.glassDark);
    fillRect(ctx, ox + 4, oy + by + 1, 6, 1, '#90c8e4');
  }
}

function drawMbsSkyparkLeft(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.mbsSky);
  // Infinity pool rounds off to the left starting at x=6
  fillRect(ctx, ox + 6, oy, TILE - 6, 3, COLORS.mbsPoolBlue);
  fillRect(ctx, ox + 2, oy + 1, 4, 2, COLORS.mbsPoolBlue);
  pixel(ctx, ox + 14, oy + 1, COLORS.mbsPoolLight);
  pixel(ctx, ox + 24, oy + 1, COLORS.mbsPoolLight);
  // Sandy deck surface with rounded left end
  fillRect(ctx, ox + 6, oy + 3, TILE - 6, 5, COLORS.mbsDeck);
  fillRect(ctx, ox + 2, oy + 3, 4, 5, COLORS.mbsDeck);
  // Green garden patches on deck
  fillRect(ctx, ox + 16, oy + 4, 6, 3, COLORS.mbsSkypark);
  fillRect(ctx, ox + 24, oy + 4, 5, 3, COLORS.mbsSkypark);
  // Deck front face
  fillRect(ctx, ox + 6, oy + 8, TILE - 6, 9, COLORS.mbsWhite);
  fillRect(ctx, ox + 2, oy + 9, 4, 7, COLORS.mbsWhite);
  fillRect(ctx, ox, oy + 10, 2, 5, COLORS.mbsCurve);
  fillRect(ctx, ox + 6, oy + 8, TILE - 6, 1, COLORS.mbsWhiteDark);
  fillRect(ctx, ox + 6, oy + 16, TILE - 6, 1, COLORS.mbsWhiteDark);
  fillRect(ctx, ox + 6, oy + 12, TILE - 6, 1, COLORS.mbsCurve);
  fillRect(ctx, ox, oy + 17, TILE, TILE - 17, COLORS.mbsSky);
}

function drawMbsSkyparkMid(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.mbsSky);
  // Infinity pool — deep blue strip at very top
  fillRect(ctx, ox, oy, TILE, 3, COLORS.mbsPoolBlue);
  for (let i = 4; i < TILE; i += 8) pixel(ctx, ox + i, oy + 1, COLORS.mbsPoolLight);
  // Sandy deck surface
  fillRect(ctx, ox, oy + 3, TILE, 5, COLORS.mbsDeck);
  // Green garden patches on deck
  fillRect(ctx, ox + 2, oy + 4, 5, 3, COLORS.mbsSkypark);
  fillRect(ctx, ox + 14, oy + 4, 5, 3, COLORS.mbsSkypark);
  fillRect(ctx, ox + 25, oy + 4, 5, 3, COLORS.mbsSkypark);
  // Deck front face (white slab visible from below)
  fillRect(ctx, ox, oy + 8, TILE, 9, COLORS.mbsWhite);
  fillRect(ctx, ox, oy + 8, TILE, 1, COLORS.mbsWhiteDark);
  fillRect(ctx, ox, oy + 12, TILE, 1, COLORS.mbsCurve);
  fillRect(ctx, ox, oy + 16, TILE, 1, COLORS.mbsWhiteDark);
  // Below deck — sky/air gap
  fillRect(ctx, ox, oy + 17, TILE, TILE - 17, COLORS.mbsSky);
}

function drawMbsSkyparkRight(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.mbsSky);
  // Infinity pool rounds off to the right ending at x=TILE-6
  fillRect(ctx, ox, oy, TILE - 6, 3, COLORS.mbsPoolBlue);
  fillRect(ctx, ox + TILE - 6, oy + 1, 4, 2, COLORS.mbsPoolBlue);
  pixel(ctx, ox + 4, oy + 1, COLORS.mbsPoolLight);
  pixel(ctx, ox + 16, oy + 1, COLORS.mbsPoolLight);
  // Sandy deck surface with rounded right end
  fillRect(ctx, ox, oy + 3, TILE - 6, 5, COLORS.mbsDeck);
  fillRect(ctx, ox + TILE - 6, oy + 3, 4, 5, COLORS.mbsDeck);
  // Green garden patches on deck
  fillRect(ctx, ox + 2, oy + 4, 6, 3, COLORS.mbsSkypark);
  fillRect(ctx, ox + 14, oy + 4, 6, 3, COLORS.mbsSkypark);
  // Deck front face
  fillRect(ctx, ox, oy + 8, TILE - 6, 9, COLORS.mbsWhite);
  fillRect(ctx, ox + TILE - 6, oy + 9, 4, 7, COLORS.mbsWhite);
  fillRect(ctx, ox + TILE - 2, oy + 10, 2, 5, COLORS.mbsCurve);
  fillRect(ctx, ox, oy + 8, TILE - 6, 1, COLORS.mbsWhiteDark);
  fillRect(ctx, ox, oy + 16, TILE - 6, 1, COLORS.mbsWhiteDark);
  fillRect(ctx, ox, oy + 12, TILE - 6, 1, COLORS.mbsCurve);
  fillRect(ctx, ox, oy + 17, TILE, TILE - 17, COLORS.mbsSky);
}

// --- Restaurant --------------------------------------------------------

function drawRestaurantTable(ctx: Ctx, ox: number, oy: number) {
  drawPlaza(ctx, ox, oy);
  fillRect(ctx, ox + 4, oy + 8, 4, 4, COLORS.restaurantTable);
  fillRect(ctx, ox + 24, oy + 8, 4, 4, COLORS.restaurantTable);
  fillRect(ctx, ox + 4, oy + 20, 4, 4, COLORS.restaurantTable);
  fillRect(ctx, ox + 24, oy + 20, 4, 4, COLORS.restaurantTable);
  ctx.fillStyle = COLORS.restaurantTable;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 16, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.restaurantTableLight;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 15, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  pixel(ctx, ox + 16, oy + 14, COLORS.restaurantTable);
}

function drawRestaurantUmbrella(ctx: Ctx, ox: number, oy: number) {
  drawPlaza(ctx, ox, oy);
  ctx.fillStyle = COLORS.umbrellaRed;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 14, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  fillRect(ctx, ox + 4, oy + 13, 24, 1, COLORS.umbrellaWhite);
  for (let i = 0; i < 4; i++) {
    fillRect(ctx, ox + 6 + i * 6, oy + 6, 1, 14, COLORS.umbrellaWhite);
  }
  fillRect(ctx, ox + 15, oy + 14, 2, 14, COLORS.lampPole);
  pixel(ctx, ox + 16, oy + 4, COLORS.umbrellaWhite);
}

// --- Supertree ---------------------------------------------------------

function drawSupertree(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.grass);
  for (let i = 0; i < 18; i++) {
    const px = ox + Math.floor(prand(ox + i, oy + i * 7, 47) * TILE);
    const py = oy + Math.floor(prand(ox * 3 + i, oy + i, 48) * TILE);
    pixel(ctx, px, py, COLORS.grassDark);
  }
  fillRect(ctx, ox + 14, oy + 14, 4, 18, COLORS.supertreeTrunk);
  fillRect(ctx, ox + 13, oy + 30, 6, 2, COLORS.supertreeTrunk);
  fillRect(ctx, ox + 13, oy + 18, 6, 1, COLORS.supertreeBranch);
  fillRect(ctx, ox + 13, oy + 24, 6, 1, COLORS.supertreeBranch);
  pixel(ctx, ox + 12, oy + 21, COLORS.supertreeBranch);
  pixel(ctx, ox + 19, oy + 21, COLORS.supertreeBranch);
  const canopy: Array<[number, number, number, number]> = [
    [10, 0, 12, 4],
    [6, 4, 20, 4],
    [4, 8, 24, 4],
    [8, 12, 16, 2],
  ];
  for (const [x, y, w, h] of canopy) {
    fillRect(ctx, ox + x, oy + y, w, h, COLORS.supertreeCanopy);
  }
  fillRect(ctx, ox + 12, oy + 2, 8, 1, COLORS.supertreeCanopyHi);
  fillRect(ctx, ox + 8, oy + 6, 16, 1, COLORS.supertreeCanopyHi);
  fillRect(ctx, ox + 6, oy + 10, 4, 1, COLORS.supertreeCanopyHi);
  fillRect(ctx, ox + 22, oy + 10, 4, 1, COLORS.supertreeCanopyHi);
  pixel(ctx, ox + 16, oy + 5, '#ffffff');
  pixel(ctx, ox + 10, oy + 9, '#ffffff');
  pixel(ctx, ox + 22, oy + 9, '#ffffff');
}

// --- Peranakan shophouses ---------------------------------------------

function peranakanShop(ctx: Ctx, ox: number, oy: number, body: string, shade: string) {
  fillRect(ctx, ox, oy, TILE, TILE, body);
  for (let x = 0; x < TILE; x += 6) {
    fillRect(ctx, ox + x, oy, 2, TILE, shade);
  }
  fillRect(ctx, ox, oy + 4, TILE, 1, COLORS.peraTrim);
  fillRect(ctx, ox, oy + 5, TILE, 1, shade);
  fillRect(ctx, ox + 8, oy + 12, 16, 14, COLORS.peraArch);
  ctx.fillStyle = COLORS.peraArch;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 12, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  fillRect(ctx, ox + 9, oy + 13, 14, 12, COLORS.windowGlass);
  ctx.fillStyle = COLORS.windowGlass;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 12, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  fillRect(ctx, ox + 15, oy + 10, 2, 16, COLORS.peraArch);
  fillRect(ctx, ox + 9, oy + 17, 14, 1, COLORS.peraArch);
  fillRect(ctx, ox + 6, oy + 25, 20, 2, COLORS.peraTrim);
  fillRect(ctx, ox, oy + TILE - 2, TILE, 2, shade);
}

function drawPeranakanPink(ctx: Ctx, ox: number, oy: number) {
  peranakanShop(ctx, ox, oy, COLORS.peraPink, COLORS.peraPinkShade);
}

function drawPeranakanBlue(ctx: Ctx, ox: number, oy: number) {
  peranakanShop(ctx, ox, oy, COLORS.peraBlue, COLORS.peraBlueShade);
}

function drawPeranakanMint(ctx: Ctx, ox: number, oy: number) {
  peranakanShop(ctx, ox, oy, COLORS.peraMint, COLORS.peraMintShade);
}

function drawPeranakanRoof(ctx: Ctx, ox: number, oy: number) {
  fillRect(ctx, ox, oy, TILE, TILE, COLORS.peraRoof);
  for (let y = 0; y < TILE; y += 4) {
    fillRect(ctx, ox, oy + y, TILE, 1, COLORS.peraRoofDark);
    const offset = ((y / 4) | 0) % 2 === 0 ? 0 : 4;
    for (let x = offset; x < TILE; x += 8) {
      fillRect(ctx, ox + x, oy + y, 1, 4, COLORS.peraRoofDark);
    }
  }
  fillRect(ctx, ox, oy, TILE, 2, COLORS.peraTrim);
}

// --- Suntec fountain (static) -----------------------------------------

function drawSuntecFountain(ctx: Ctx, ox: number, oy: number) {
  drawPlaza(ctx, ox, oy);
  ctx.fillStyle = COLORS.stoneDark;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 18, 14, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.water;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 17, 11, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.waterLight;
  ctx.beginPath();
  ctx.ellipse(ox + 14, oy + 15, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  fillRect(ctx, ox + 14, oy + 14, 4, 6, COLORS.stoneDark);
  fillRect(ctx, ox + 15, oy + 11, 2, 4, COLORS.stone);
  pixel(ctx, ox + 16, oy + 9, '#ffffff');
  pixel(ctx, ox + 16, oy + 10, COLORS.waterLight);
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
  drawSuntecWall,
  drawSuntecWindow,
  drawHdbWall,
  drawHdbWindow,
  drawWhiteBrick,
  drawWhiteBrickWindow,
  drawWhiteBrickDoor,
  drawFusionWall,
  drawFusionWindow,
  drawAstarWall,
  drawMbsWall,
  drawMbsWindow,
  drawMbsSkyparkLeft,
  drawMbsSkyparkMid,
  drawMbsSkyparkRight,
  drawRestaurantTable,
  drawRestaurantUmbrella,
  drawSupertree,
  drawPeranakanPink,
  drawPeranakanBlue,
  drawPeranakanMint,
  drawPeranakanRoof,
  drawSuntecFountain,
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
  SUNTEC_WALL: 32,
  SUNTEC_WINDOW: 33,
  HDB_WALL: 34,
  HDB_WINDOW: 35,
  WHITE_BRICK: 36,
  WHITE_BRICK_WINDOW: 37,
  WHITE_BRICK_DOOR: 38,
  FUSION_WALL: 39,
  FUSION_WINDOW: 40,
  ASTAR_WALL: 41,
  MBS_WALL: 42,
  MBS_WINDOW: 43,
  MBS_SKYPARK_LEFT: 44,
  MBS_SKYPARK_MID: 45,
  MBS_SKYPARK_RIGHT: 46,
  RESTAURANT_TABLE: 47,
  RESTAURANT_UMBRELLA: 48,
  SUPERTREE: 49,
  PERANAKAN_PINK: 50,
  PERANAKAN_BLUE: 51,
  PERANAKAN_MINT: 52,
  PERANAKAN_ROOF: 53,
  SUNTEC_FOUNTAIN: 54,
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
