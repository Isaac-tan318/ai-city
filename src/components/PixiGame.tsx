import * as PIXI from 'pixi.js';
import { useApp, useTick } from '@pixi/react';
import { Player, SelectElement } from './Player.tsx';
import { MutableRefObject, useEffect, useRef, useState } from 'react';
import { PixiStaticMap } from './PixiStaticMap.tsx';
import PixiViewport from './PixiViewport.tsx';
import { Viewport } from 'pixi-viewport';
import { Id } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api.js';
import { useSendInput } from '../hooks/sendInput.ts';
import { toastOnError } from '../toasts.ts';
import { DebugPath } from './DebugPath.tsx';
import { PositionIndicator } from './PositionIndicator.tsx';
import { SHOW_DEBUG_UI } from './Game.tsx';
import { ServerGame } from '../hooks/serverGame.ts';
import { CYCLE_MS, cycleProgressForHour } from '../../convex/aiTown/gameTime';
import { ScenarioMarker } from './ScenarioMarker.tsx';

// Lighting thresholds expressed as real-ms offsets within a cycle (p=0 → 6 AM,
// p=CYCLE_MS → 6 AM next day). Derived via cycleProgressForHour so they track the
// non-uniform day/night speeds — these all fall in the (compressed) night half.
// Dusk runs 9 PM → 10 PM; dawn runs 5 AM → 6 AM.
const DUSK_START_MS = cycleProgressForHour(21); // 9 PM
const DUSK_END_MS   = cycleProgressForHour(22); // 10 PM (fully dark)
const DAWN_START_MS = cycleProgressForHour(5);  // 5 AM  (starts brightening)
// Dawn ends at CYCLE_MS (= 6 AM, p wraps to 0).

function nightAlpha(historicalTime: number, worldStartTime: number): number {
  const elapsed = historicalTime - worldStartTime;
  const p = ((elapsed % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;

  if (p < DUSK_START_MS) {
    // 6 AM → 9 PM: full daylight
    return 0;
  } else if (p < DUSK_END_MS) {
    // 9 PM → 10 PM: dusk — ramp up to full night
    return 0.3 * ((p - DUSK_START_MS) / (DUSK_END_MS - DUSK_START_MS));
  } else if (p < DAWN_START_MS) {
    // 10 PM → 5 AM: full night
    return 0.3;
  } else {
    // 5 AM → 6 AM: dawn — fade back to day
    return 0.3 * (1 - (p - DAWN_START_MS) / (CYCLE_MS - DAWN_START_MS));
  }
}

export const PixiGame = (props: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  historicalTime: number | undefined;
  width: number;
  height: number;
  setSelectedElement: SelectElement;
  onSelectScenario?: (id: string) => void;
  viewportRef?: MutableRefObject<Viewport | undefined>;
}) => {
  // PIXI setup.
  const pixiApp = useApp();
  const localViewportRef = useRef<Viewport | undefined>();
  const viewportRef = props.viewportRef ?? localViewportRef;

  const humanTokenIdentifier = useQuery(api.world.userStatus, { worldId: props.worldId }) ?? null;
  const humanPlayerId = [...props.game.world.players.values()].find(
    (p) => p.human === humanTokenIdentifier,
  )?.id;

  const moveTo = useSendInput(props.engineId, 'moveTo');

  // Interaction for clicking on the world to navigate.
  const dragStart = useRef<{ screenX: number; screenY: number } | null>(null);
  const onMapPointerDown = (e: any) => {
    // https://pixijs.download/dev/docs/PIXI.FederatedPointerEvent.html
    dragStart.current = { screenX: e.screenX, screenY: e.screenY };
  };

  const [lastDestination, setLastDestination] = useState<{
    x: number;
    y: number;
    t: number;
  } | null>(null);
  const onMapPointerUp = async (e: any) => {
    if (dragStart.current) {
      const { screenX, screenY } = dragStart.current;
      dragStart.current = null;
      const [dx, dy] = [screenX - e.screenX, screenY - e.screenY];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 10) {
        console.log(`Skipping navigation on drag event (${dist}px)`);
        return;
      }
    }
    if (!humanPlayerId) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const gameSpacePx = viewport.toWorld(e.screenX, e.screenY);
    const tileDim = props.game.worldMap.tileDim;
    const gameSpaceTiles = {
      x: gameSpacePx.x / tileDim,
      y: gameSpacePx.y / tileDim,
    };
    setLastDestination({ t: Date.now(), ...gameSpaceTiles });
    const roundedTiles = {
      x: Math.floor(gameSpaceTiles.x),
      y: Math.floor(gameSpaceTiles.y),
    };
    console.log(`Moving to ${JSON.stringify(roundedTiles)}`);
    await toastOnError(moveTo({ playerId: humanPlayerId, destination: roundedTiles }));
  };
  const { width, height, tileDim } = props.game.worldMap;
  const players = [...props.game.world.players.values()];

  // Zoom on the user's avatar when it is created
  useEffect(() => {
    if (!viewportRef.current || humanPlayerId === undefined) return;

    const humanPlayer = props.game.world.players.get(humanPlayerId)!;
    viewportRef.current.animate({
      position: new PIXI.Point(humanPlayer.position.x * tileDim, humanPlayer.position.y * tileDim),
      scale: 1.5,
    });
  }, [humanPlayerId]);

  // Night overlay — a screen-space PIXI.Graphics added directly to the stage
  // so it covers the full canvas and doesn't scroll with the viewport.
  const overlayRef = useRef<PIXI.Graphics | null>(null);
  useEffect(() => {
    const g = new PIXI.Graphics();
    pixiApp.stage.addChild(g);
    overlayRef.current = g;
    return () => {
      pixiApp.stage.removeChild(g);
      g.destroy();
      overlayRef.current = null;
    };
  }, [pixiApp]);

  useTick(() => {
    const g = overlayRef.current;
    const worldStartTime = props.game.world.worldStartTime;
    if (!g || !props.historicalTime || !worldStartTime) return;

    const alpha = nightAlpha(props.historicalTime, worldStartTime);
    g.clear();
    if (alpha > 0) {
      g.beginFill(0x001530, alpha);
      g.drawRect(0, 0, props.width, props.height);
      g.endFill();
    }
  });

  return (
    <PixiViewport
      app={pixiApp}
      screenWidth={props.width}
      screenHeight={props.height}
      worldWidth={width * tileDim}
      worldHeight={height * tileDim}
      viewportRef={viewportRef}
    >
      <PixiStaticMap
        map={props.game.worldMap}
        onpointerup={onMapPointerUp}
        onpointerdown={onMapPointerDown}
      />
      {players.map(
        (p) =>
          // Only show the path for the human player in non-debug mode.
          (SHOW_DEBUG_UI || p.id === humanPlayerId) && (
            <DebugPath key={`path-${p.id}`} player={p} tileDim={tileDim} />
          ),
      )}
      {lastDestination && <PositionIndicator destination={lastDestination} tileDim={tileDim} />}
      {players.map((p) => (
        <Player
          key={`player-${p.id}`}
          game={props.game}
          player={p}
          isViewer={p.id === humanPlayerId}
          onClick={props.setSelectedElement}
          historicalTime={props.historicalTime}
        />
      ))}
      {props.onSelectScenario &&
        (props.game.world.activeScenarios ?? [])
          .filter((s) => s.scope === 'local')
          .map((s) => (
            <ScenarioMarker
              key={`scenario-${s.id}`}
              scenario={s}
              tileDim={tileDim}
              onSelect={props.onSelectScenario!}
            />
          ))}
    </PixiViewport>
  );
};
export default PixiGame;
