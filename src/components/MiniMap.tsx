import { MutableRefObject, useEffect, useRef } from 'react';
import { Viewport } from 'pixi-viewport';
import * as PIXI from 'pixi.js';
import { ServerGame } from '../hooks/serverGame';

// Pre-rendered minimap background — a screenshot of the city, saved to
// public/assets/minimap.png. Loaded once and drawn scaled into the canvas.
const MINIMAP_BG_URL = '/ai-town/assets/minimap.png';

// 32x32folk.png sprite sheet — each character has a 32x32 "down-facing" frame
// at a known offset. We blit that frame onto the minimap as the player's icon.
const FOLK_URL = '/ai-town/assets/32x32folk.png';
const FOLK_FRAME_BY_CHARACTER: Record<string, { x: number; y: number }> = {
  f1: { x: 0, y: 0 },
  f2: { x: 96, y: 0 },
  f3: { x: 192, y: 0 },
  f4: { x: 288, y: 0 },
  f5: { x: 0, y: 128 },
  f6: { x: 96, y: 128 },
  f7: { x: 192, y: 128 },
  f8: { x: 288, y: 128 },
};
const FOLK_FRAME_SIZE = 32;

const MINIMAP_WIDTH = 180;
const ICON_SIZE = 20;

export function MiniMap({
  game,
  viewportRef,
}: {
  game: ServerGame;
  viewportRef: MutableRefObject<Viewport | undefined>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const folkImgRef = useRef<HTMLImageElement | null>(null);
  const folkReadyRef = useRef(false);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const bgReadyRef = useRef(false);

  // Preload the folk sheet + the static background once.
  useEffect(() => {
    const folk = new Image();
    folk.src = FOLK_URL;
    folk.onload = () => {
      folkReadyRef.current = true;
    };
    folkImgRef.current = folk;

    const bg = new Image();
    bg.src = MINIMAP_BG_URL;
    bg.onload = () => {
      bgReadyRef.current = true;
    };
    bgImgRef.current = bg;
  }, []);

  const { width: mapW, height: mapH, tileDim } = game.worldMap;
  const worldPxW = mapW * tileDim;
  const worldPxH = mapH * tileDim;
  const minimapHeight = Math.round((MINIMAP_WIDTH * worldPxH) / worldPxW);
  const scaleX = MINIMAP_WIDTH / worldPxW;
  const scaleY = minimapHeight / worldPxH;

  // Animation loop: redraw every frame so character positions + viewport
  // rectangle stay in sync with PIXI.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, MINIMAP_WIDTH, minimapHeight);

      // Background — use bilinear smoothing here so the photo-style minimap
      // image downscales cleanly; we turn it back off before drawing icons.
      const bg = bgImgRef.current;
      if (bgReadyRef.current && bg) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bg, 0, 0, MINIMAP_WIDTH, minimapHeight);
      } else {
        ctx.fillStyle = 'rgba(40, 25, 15, 0.85)';
        ctx.fillRect(0, 0, MINIMAP_WIDTH, minimapHeight);
      }

      // Viewport indicator — semi-transparent yellow rectangle showing the
      // portion of the world currently visible on screen.
      const vp = viewportRef.current;
      if (vp) {
        const bounds = vp.getVisibleBounds();
        const vx = bounds.x * scaleX;
        const vy = bounds.y * scaleY;
        const vw = bounds.width * scaleX;
        const vh = bounds.height * scaleY;
        ctx.fillStyle = 'rgba(255, 220, 120, 0.18)';
        ctx.fillRect(vx, vy, vw, vh);
        ctx.strokeStyle = 'rgba(255, 220, 120, 0.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vx + 0.5, vy + 0.5, vw - 1, vh - 1);
      }

      // Characters — blit the folk frame for each player's sprite. Disable
      // smoothing so the pixel-art icons stay crisp on the small canvas.
      const folk = folkImgRef.current;
      const folkReady = folkReadyRef.current && folk;
      ctx.imageSmoothingEnabled = false;
      for (const player of game.world.players.values()) {
        const cx = player.position.x * tileDim * scaleX;
        const cy = player.position.y * tileDim * scaleY;
        const desc = game.playerDescriptions.get(player.id);
        const characterKey = desc?.character ?? 'f1';
        const frame = FOLK_FRAME_BY_CHARACTER[characterKey] ?? FOLK_FRAME_BY_CHARACTER.f1;
        // Dark shadow disc so the icon pops against any background.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.beginPath();
        ctx.arc(cx, cy, ICON_SIZE / 2 + 3, 0, Math.PI * 2);
        ctx.fill();

        if (folkReady) {
          ctx.drawImage(
            folk!,
            frame.x,
            frame.y,
            FOLK_FRAME_SIZE,
            FOLK_FRAME_SIZE,
            cx - ICON_SIZE / 2,
            cy - ICON_SIZE / 2,
            ICON_SIZE,
            ICON_SIZE,
          );
        } else {
          ctx.fillStyle = '#ffdd88';
          ctx.beginPath();
          ctx.arc(cx, cy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game, viewportRef, minimapHeight, scaleX, scaleY, tileDim]);

  // Recenter the viewport when the user clicks/drags on the minimap.
  const recenterFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const worldX = (px / MINIMAP_WIDTH) * worldPxW;
    const worldY = (py / minimapHeight) * worldPxH;
    vp.animate({ position: new PIXI.Point(worldX, worldY), time: 200 });
  };

  const draggingRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    recenterFromEvent(e);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    recenterFromEvent(e);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      className="fixed bottom-3 right-3 z-50 select-none"
      style={{ width: MINIMAP_WIDTH }}
    >
      <canvas
        ref={canvasRef}
        width={MINIMAP_WIDTH}
        height={minimapHeight}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="block rounded border-2 border-amber-200/70 shadow-lg cursor-pointer pointer-events-auto"
      />
    </div>
  );
}
