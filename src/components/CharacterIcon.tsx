import { characters } from '../../data/characters';

// The region of a 32x32 "down"-facing sprite frame that contains the head/face.
const FACE = { x: 6, y: 2, w: 20, h: 20 };

export function CharacterIcon({
  character,
  name,
  size = 40,
}: {
  character?: string | null;
  name?: string;
  size?: number;
}) {
  const def = character ? characters.find((c) => c.name === character) : undefined;
  const down = def?.spritesheetData.frames.down?.frame;

  // Fallback: a colored circle with the first initial.
  if (!def || !down) {
    const initial = (name ?? '?').charAt(0).toUpperCase();
    return (
      <div
        className="flex items-center justify-center rounded-full bg-clay-700 text-white font-bold shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
        title={name}
      >
        {initial}
      </div>
    );
  }

  const srcX = down.x + FACE.x;
  const srcY = down.y + FACE.y;
  const scale = size / FACE.w;

  return (
    <div
      className="rounded-full overflow-hidden shrink-0 bg-brown-900 border-2 border-brown-600"
      style={{ width: size, height: size }}
      title={name}
    >
      <img
        src={def.textureUrl}
        alt={name ?? character ?? ''}
        style={{
          position: 'relative',
          left: -srcX * scale,
          top: -srcY * scale,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          imageRendering: 'pixelated',
          maxWidth: 'none',
        }}
      />
    </div>
  );
}
