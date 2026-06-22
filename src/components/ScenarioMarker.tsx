import { Container, Graphics, Text } from '@pixi/react';
import { Graphics as PixiGraphics } from 'pixi.js';
import { useCallback } from 'react';
import { SerializedActiveScenario } from '../../convex/aiTown/world';

// A clickable beacon rendered in world space at a local scenario's location.
export function ScenarioMarker({
  scenario,
  tileDim,
  onSelect,
}: {
  scenario: SerializedActiveScenario;
  tileDim: number;
  onSelect: (id: string) => void;
}) {
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      // Outer halo ring.
      g.lineStyle(2, 0xffc24b, 0.5);
      g.drawCircle(0, 0, tileDim * 0.95);
      // Inner beacon dot.
      g.lineStyle(0);
      g.beginFill(0xffc24b, 0.9);
      g.drawCircle(0, 0, tileDim * 0.2);
      g.endFill();
    },
    [tileDim],
  );

  if (scenario.x === undefined || scenario.y === undefined) return null;
  const px = scenario.x * tileDim + tileDim / 2;
  const py = scenario.y * tileDim + tileDim / 2;

  const handle = (e: any) => {
    // Don't let the click also navigate the human player.
    e?.stopPropagation?.();
    onSelect(scenario.id);
  };

  return (
    <Container
      x={px}
      y={py}
      interactive={true}
      pointerdown={handle}
      pointertap={handle}
      cursor="pointer"
    >
      <Graphics draw={draw} />
      <Text
        text={scenario.emoji}
        anchor={{ x: 0.5, y: 0.5 }}
        y={-tileDim * 1.15}
        scale={1.1}
      />
    </Container>
  );
}
