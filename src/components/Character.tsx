import { BaseTexture, ISpritesheetData, Spritesheet } from 'pixi.js';
import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatedSprite, Container, Graphics, Text, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { MEMORY_GAIN_INDICATOR_MS } from '../../convex/constants';

export const Character = ({
  textureUrl,
  spritesheetData,
  x,
  y,
  orientation,
  isMoving = false,
  isThinking = false,
  isSpeaking = false,
  affinityChange,
  inConflict = false,
  isFocalAgent = false,
  isBeingAsked = false,
  memoryGain,
  emoji = '',
  isViewer = false,
  speed = 0.1,
  onClick,
}: {
  // Path to the texture packed image.
  textureUrl: string;
  // The data for the spritesheet.
  spritesheetData: ISpritesheetData;
  // The pose of the NPC.
  x: number;
  y: number;
  orientation: number;
  isMoving?: boolean;
  // Shows a thought bubble if true.
  isThinking?: boolean;
  // Shows a speech bubble if true.
  isSpeaking?: boolean;
  // Briefly flashes a 💗 (affinity rose) or 💔 (affinity fell) after a conversation.
  affinityChange?: 'up' | 'down';
  // Persistent 💢 while the character is mid-conflict (arguing a scenario
  // disagreement, or conversing with someone they're hostile toward).
  inConflict?: boolean;
  // --- Decision-pipeline roles (convex/focal.ts, convex/decider.ts) ---
  // This resident is running the current decision: they ask the questions and
  // make the final call. Marked with a crown and a glow at their feet.
  isFocalAgent?: boolean;
  // The focal agent has just put a question to this resident and is waiting on
  // the answer — a pulsing "?" while they're on the spot.
  isBeingAsked?: boolean;
  // The Decider just pulled new facts out of the conversation. Floats a
  // "💡 +N memory" above the focal agent, then fades.
  memoryGain?: { count: number; at: number };
  emoji?: string;
  // Highlights the player.
  isViewer?: boolean;
  // The speed of the animation. Can be tuned depending on the side and speed of the NPC.
  speed?: number;
  onClick: () => void;
}) => {
  const [spriteSheet, setSpriteSheet] = useState<Spritesheet>();
  useEffect(() => {
    const parseSheet = async () => {
      const sheet = new Spritesheet(
        BaseTexture.from(textureUrl, {
          scaleMode: PIXI.SCALE_MODES.NEAREST,
        }),
        spritesheetData,
      );
      await sheet.parse();
      setSpriteSheet(sheet);
    };
    void parseSheet();
  }, []);

  // The first "left" is "right" but reflected.
  const roundedOrientation = Math.floor(orientation / 90);
  const direction = ['right', 'down', 'left', 'up'][roundedOrientation];

  // Prevents the animation from stopping when the texture changes
  // (see https://github.com/pixijs/pixi-react/issues/359)
  const ref = useRef<PIXI.AnimatedSprite | null>(null);
  useEffect(() => {
    if (isMoving) {
      ref.current?.play();
    }
  }, [direction, isMoving]);

  if (!spriteSheet) return null;

  let blockOffset = { x: 0, y: 0 };
  switch (roundedOrientation) {
    case 2:
      blockOffset = { x: -20, y: 0 };
      break;
    case 0:
      blockOffset = { x: 20, y: 0 };
      break;
    case 3:
      blockOffset = { x: 0, y: -20 };
      break;
    case 1:
      blockOffset = { x: 0, y: 20 };
      break;
  }

  return (
    <Container x={x} y={y} interactive={true} pointerdown={onClick} cursor="pointer">
      {/* Drawn before the sprite so the glow sits under the character's feet. */}
      {isFocalAgent && <FocalAura />}
      {isThinking && (
        // TODO: We'll eventually have separate assets for thinking and speech animations.
        <Text x={-20} y={-10} scale={{ x: -0.8, y: 0.8 }} text={'💭'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isSpeaking && (
        // TODO: We'll eventually have separate assets for thinking and speech animations.
        <Text x={18} y={-10} scale={0.8} text={'💬'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isViewer && <ViewerIndicator />}
      <AnimatedSprite
        ref={ref}
        isPlaying={isMoving}
        textures={spriteSheet.animations[direction]}
        animationSpeed={speed}
        anchor={{ x: 0.5, y: 0.5 }}
      />
      {emoji && (
        <Text x={0} y={-24} scale={{ x: -0.8, y: 0.8 }} text={emoji} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {affinityChange && (
        <Text
          x={0}
          y={-40}
          scale={0.9}
          text={affinityChange === 'up' ? '💗' : '💔'}
          anchor={{ x: 0.5, y: 0.5 }}
        />
      )}
      {inConflict && (
        <Text x={-16} y={-40} scale={0.7} text={'💢'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isFocalAgent && (
        <Text x={16} y={-30} scale={0.65} text={'👑'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isBeingAsked && <QuestionPulse />}
      {memoryGain && <MemoryGainFloater key={memoryGain.at} count={memoryGain.count} at={memoryGain.at} />}
    </Container>
  );
};

// A soft gold glow at the focal agent's feet. Pulses slowly so it reads as a
// standing state rather than a momentary event.
function FocalAura() {
  const [phase, setPhase] = useState(0);
  useTick((delta) => setPhase((prev) => prev + delta * 0.05));
  const pulse = 0.5 + 0.5 * Math.sin(phase);
  const draw = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      g.beginFill(0xffc93c, 0.12 + 0.13 * pulse);
      g.drawEllipse(0, 16, 20 + 3 * pulse, 8 + 1.5 * pulse);
      g.endFill();
      g.lineStyle(1.5, 0xffc93c, 0.35 + 0.3 * pulse);
      g.drawEllipse(0, 16, 20 + 3 * pulse, 8 + 1.5 * pulse);
      g.lineStyle(0);
    },
    [pulse],
  );
  return <Graphics draw={draw} />;
}

// A "?" over whoever the focal agent just questioned, pulsing until they answer.
function QuestionPulse() {
  const [phase, setPhase] = useState(0);
  useTick((delta) => setPhase((prev) => prev + delta * 0.11));
  const pulse = 0.5 + 0.5 * Math.sin(phase);
  return (
    <Text
      x={0}
      y={-38 - 2 * pulse}
      scale={0.75 + 0.14 * pulse}
      alpha={0.65 + 0.35 * pulse}
      text={'❓'}
      anchor={{ x: 0.5, y: 0.5 }}
    />
  );
}

// "💡 +N memory" drifting up from the focal agent's head as the Decider banks
// what it just learned. Self-expiring: once the animation is past its window the
// component renders nothing, so a stale timestamp in the world doc can't leave a
// permanent floater on the map.
function MemoryGainFloater({ count, at }: { count: number; at: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - at);
  useTick(() => setElapsed(Date.now() - at));
  const progress = elapsed / MEMORY_GAIN_INDICATOR_MS;
  if (progress >= 1 || progress < 0) return null;
  return (
    <Text
      x={0}
      y={-32 - 26 * progress}
      scale={0.42}
      alpha={Math.min(1, (1 - progress) * 2.5)}
      text={`💡 +${count} memory`}
      anchor={{ x: 0.5, y: 0.5 }}
      style={
        new PIXI.TextStyle({
          fontSize: 24,
          fill: '#ffe8a3',
          stroke: '#181425',
          strokeThickness: 5,
          fontWeight: 'bold',
        })
      }
    />
  );
}

function ViewerIndicator() {
  const draw = useCallback((g: PIXI.Graphics) => {
    g.clear();
    g.beginFill(0xffff0b, 0.5);
    g.drawRoundedRect(-10, 10, 20, 10, 100);
    g.endFill();
  }, []);

  return <Graphics draw={draw} />;
}
