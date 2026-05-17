import { PixiComponent, applyDefaultProps } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { AnimatedSprite, WorldMap } from '../../convex/aiTown/worldMap';
import * as campfire from '../../data/animations/campfire.json';
import * as gentlesparkle from '../../data/animations/gentlesparkle.json';
import * as gentlewaterfall from '../../data/animations/gentlewaterfall.json';
import * as gentlesplash from '../../data/animations/gentlesplash.json';
import * as windmill from '../../data/animations/windmill.json';
import {
  CITY_FOUNTAIN_SHEET,
  CITY_TILESET_URL,
  CITY_TRAFFICLIGHT_SHEET,
  FOUNTAIN_SPRITESHEET,
  TRAFFIC_LIGHT_SPRITESHEET,
  createCityTilesetCanvas,
  createFountainCanvas,
  createTrafficLightCanvas,
} from '../cityTileset';

type SheetEntry = { spritesheet: any; url?: string; canvas?: HTMLCanvasElement };

const animations: Record<string, SheetEntry> = {
  'campfire.json': { spritesheet: campfire, url: '/ai-town/assets/spritesheets/campfire.png' },
  'gentlesparkle.json': {
    spritesheet: gentlesparkle,
    url: '/ai-town/assets/spritesheets/gentlesparkle32.png',
  },
  'gentlewaterfall.json': {
    spritesheet: gentlewaterfall,
    url: '/ai-town/assets/spritesheets/gentlewaterfall32.png',
  },
  'windmill.json': { spritesheet: windmill, url: '/ai-town/assets/spritesheets/windmill.png' },
  'gentlesplash.json': {
    spritesheet: gentlesplash,
    url: '/ai-town/assets/spritesheets/gentlewaterfall32.png',
  },
  [CITY_TRAFFICLIGHT_SHEET]: { spritesheet: TRAFFIC_LIGHT_SPRITESHEET },
  [CITY_FOUNTAIN_SHEET]: { spritesheet: FOUNTAIN_SPRITESHEET },
};

export const PixiStaticMap = PixiComponent('StaticMap', {
  create: (props: { map: WorldMap; [k: string]: any }) => {
    const map = props.map;
    const numxtiles = Math.floor(map.tileSetDimX / map.tileDim);
    const numytiles = Math.floor(map.tileSetDimY / map.tileDim);
    const tileSetSource: string | HTMLCanvasElement =
      map.tileSetUrl === CITY_TILESET_URL ? createCityTilesetCanvas() : map.tileSetUrl;
    const bt = PIXI.BaseTexture.from(tileSetSource as any, {
      scaleMode: PIXI.SCALE_MODES.NEAREST,
    });

    const tiles = [];
    for (let x = 0; x < numxtiles; x++) {
      for (let y = 0; y < numytiles; y++) {
        tiles[x + y * numxtiles] = new PIXI.Texture(
          bt,
          new PIXI.Rectangle(x * map.tileDim, y * map.tileDim, map.tileDim, map.tileDim),
        );
      }
    }
    const screenxtiles = map.bgTiles[0].length;
    const screenytiles = map.bgTiles[0][0].length;

    const container = new PIXI.Container();
    const allLayers = [...map.bgTiles, ...map.objectTiles];

    const FLIP_H = 0x80000000;
    const FLIP_V = 0x40000000;
    const FLIP_D = 0x20000000;

    // blit bg & object layers of map onto canvas
    for (let i = 0; i < screenxtiles * screenytiles; i++) {
      const x = i % screenxtiles;
      const y = Math.floor(i / screenxtiles);
      const xPx = x * map.tileDim;
      const yPx = y * map.tileDim;

      // Add all layers of backgrounds.
      for (const layer of allLayers) {
        const stored = layer[x][y];
        // Some layers may not have tiles at this location.
        if (stored === -1) continue;

        const tileIndex = stored & 0x1FFFFFFF;
        const ctile = new PIXI.Sprite(tiles[tileIndex]);

        const fh = (stored & FLIP_H) !== 0;
        const fv = (stored & FLIP_V) !== 0;
        const fd = (stored & FLIP_D) !== 0;

        if (!fh && !fv && !fd) {
          ctile.x = xPx;
          ctile.y = yPx;
        } else if (!fd) {
          // Pure mirror — offset so scale pivot lands at tile corner
          ctile.x = xPx + (fh ? map.tileDim : 0);
          ctile.y = yPx + (fv ? map.tileDim : 0);
          ctile.scale.x = fh ? -1 : 1;
          ctile.scale.y = fv ? -1 : 1;
        } else {
          // Rotation (diagonal flag set) — rotate around tile center
          ctile.anchor.set(0.5, 0.5);
          ctile.x = xPx + map.tileDim / 2;
          ctile.y = yPx + map.tileDim / 2;
          if (fh && fv) {
            // D+H+V = 270° CW
            ctile.rotation = Math.PI / 2;
            ctile.scale.y = -1;
          } else if (fh) {
            // D+H = 90° CW
            ctile.rotation = Math.PI / 2;
          } else if (fv) {
            // D+V = 90° CCW
            ctile.rotation = -Math.PI / 2;
          } else {
            // D only = anti-diagonal transpose
            ctile.rotation = Math.PI / 2;
            ctile.scale.x = -1;
          }
        }

        container.addChild(ctile);
      }
    }

    // TODO: Add layers.
    const spritesBySheet = new Map<string, AnimatedSprite[]>();
    for (const sprite of map.animatedSprites) {
      const sheet = sprite.sheet;
      if (!spritesBySheet.has(sheet)) {
        spritesBySheet.set(sheet, []);
      }
      spritesBySheet.get(sheet)!.push(sprite);
    }
    for (const [sheet, sprites] of spritesBySheet.entries()) {
      const animation = (animations as any)[sheet];
      if (!animation) {
        console.error('Could not find animation', sheet);
        continue;
      }
      const { spritesheet, url } = animation;
      const source: string | HTMLCanvasElement =
        sheet === CITY_TRAFFICLIGHT_SHEET
          ? createTrafficLightCanvas()
          : sheet === CITY_FOUNTAIN_SHEET
            ? createFountainCanvas()
            : url!;
      const texture = PIXI.BaseTexture.from(source as any, {
        scaleMode: PIXI.SCALE_MODES.NEAREST,
      });
      const spriteSheet = new PIXI.Spritesheet(texture, spritesheet);
      spriteSheet.parse().then(() => {
        for (const sprite of sprites) {
          const pixiAnimation = spriteSheet.animations[sprite.animation];
          if (!pixiAnimation) {
            console.error('Failed to load animation', sprite);
            continue;
          }
          const pixiSprite = new PIXI.AnimatedSprite(pixiAnimation);
          pixiSprite.animationSpeed = 0.1;
          pixiSprite.autoUpdate = true;
          pixiSprite.x = sprite.x;
          pixiSprite.y = sprite.y;
          pixiSprite.width = sprite.w;
          pixiSprite.height = sprite.h;
          container.addChild(pixiSprite);
          pixiSprite.play();
        }
      });
    }

    container.x = 0;
    container.y = 0;

    // Set the hit area manually to ensure `pointerdown` events are delivered to this container.
    container.interactive = true;
    container.hitArea = new PIXI.Rectangle(
      0,
      0,
      screenxtiles * map.tileDim,
      screenytiles * map.tileDim,
    );

    return container;
  },

  applyProps: (instance, oldProps, newProps) => {
    applyDefaultProps(instance, oldProps, newProps);
  },
});
