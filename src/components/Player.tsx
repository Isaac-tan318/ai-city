import { Character } from './Character.tsx';
import { orientationDegrees } from '../../convex/util/geometry.ts';
import { characters } from '../../data/characters.ts';
import { toast } from 'react-toastify';
import { Player as ServerPlayer } from '../../convex/aiTown/player.ts';
import { GameId } from '../../convex/aiTown/ids.ts';
import { Id } from '../../convex/_generated/dataModel';
import { Location, locationFields, playerLocation } from '../../convex/aiTown/location.ts';
import { useHistoricalValue } from '../hooks/useHistoricalValue.ts';
import { PlayerDescription } from '../../convex/aiTown/playerDescription.ts';
import { WorldMap } from '../../convex/aiTown/worldMap.ts';
import { ServerGame } from '../hooks/serverGame.ts';
import {
  AFFINITY_INDICATOR_MS,
  HOSTILE_AFFINITY_THRESHOLD,
  MEMORY_GAIN_INDICATOR_MS,
  QUESTION_INDICATOR_MS,
} from '../../convex/constants.ts';
import { affinityToward } from '../../convex/aiTown/affinity.ts';

export type SelectedElement = {
  kind: 'player';
  id: GameId<'players'>;
  // Set when the selection came from clicking someone on the map, which is also a
  // request to read whatever they're currently saying.
  openChat?: boolean;
};

export type SelectElement = (element?: SelectedElement) => void;

const logged = new Set<string>();

export const Player = ({
  game,
  isViewer,
  player,
  onClick,
  historicalTime,
}: {
  game: ServerGame;
  isViewer: boolean;
  player: ServerPlayer;

  onClick: SelectElement;
  historicalTime?: number;
}) => {
  const playerCharacter = game.playerDescriptions.get(player.id)?.character;
  if (!playerCharacter) {
    throw new Error(`Player ${player.id} has no character`);
  }
  const character = characters.find((c) => c.name === playerCharacter);

  const locationBuffer = game.world.historicalLocations?.get(player.id);
  const historicalLocation = useHistoricalValue<Location>(
    locationFields,
    historicalTime,
    playerLocation(player),
    locationBuffer,
  );
  if (!character) {
    if (!logged.has(playerCharacter)) {
      logged.add(playerCharacter);
      toast.error(`Unknown character ${playerCharacter}`);
    }
    return null;
  }

  if (!historicalLocation) {
    return null;
  }

  // The 💬 bubble means talking out loud — a text reply gets typing dots instead
  // (see isTextTyping below), so exclude text threads here.
  const isSpeaking = !![...game.world.conversations.values()].find(
    (c) => !c.isText && c.isTyping?.playerId === player.id,
  );
  // ...but composing a text still counts as being busy, so the 💭 thinking bubble
  // shouldn't fight the typing dots either.
  const isComposing = !![...game.world.conversations.values()].find(
    (c) => c.isTyping?.playerId === player.id,
  );
  const agentForPlayer = [...game.world.agents.values()].find((a) => a.playerId === player.id);
  const isThinking = !isComposing && !!agentForPlayer?.inProgressOperation;
  // Right after a conversation, flash a 💗/💔 above the character for a few seconds
  // to show whether their affinity just rose or fell. `at` is wall-clock ms, so we
  // gate on Date.now(); the marker hides itself once the window lapses.
  const recentAffinity = agentForPlayer?.lastAffinityChange;
  const affinityChange =
    recentAffinity && Date.now() - recentAffinity.at < AFFINITY_INDICATOR_MS
      ? recentAffinity.net > 0
        ? 'up'
        : 'down'
      : undefined;
  // Persistent 💢 while this agent is mid-conflict: either arguing out a
  // scenario's point of disagreement, or stuck in a conversation with someone
  // they're hostile toward.
  const conversationForPlayer = [...game.world.conversations.values()].find(
    (c) => c.participants.get(player.id)?.status.kind === 'participating',
  );
  // Texting has no other on-screen tell — the resident carries on with their shift
  // and never walks anywhere — so the 📱 badge is the only way to see it's
  // happening. `isTextTyping` narrows that to whoever currently holds the floor.
  const isTexting = !!conversationForPlayer?.isText;
  const isTextTyping = isTexting && conversationForPlayer?.isTyping?.playerId === player.id;
  let inConflict = false;
  if (agentForPlayer) {
    const conversation = conversationForPlayer;
    if (conversation) {
      if (agentForPlayer.scenarioConflict) {
        inConflict = true;
      } else {
        const family = game.agentDescriptions.get(agentForPlayer.id)?.family;
        for (const [otherId, member] of conversation.participants.entries()) {
          if (otherId === player.id || member.status.kind !== 'participating') continue;
          const affinity = affinityToward({
            affinities: agentForPlayer.affinities,
            otherPlayerId: otherId,
            family,
            otherName: game.playerDescriptions.get(otherId)?.name,
          });
          if (affinity < HOSTILE_AFFINITY_THRESHOLD) {
            inConflict = true;
            break;
          }
        }
      }
    }
  }
  // Decision-pipeline role cues. A resident's part in a live deliberation is not
  // visible from their sprite otherwise — you can watch a whole scenario play out
  // without knowing who was actually running it.
  const deliberation = (game.world.activeScenarios ?? []).find(
    (s) => s.deliberation && s.participantIds.includes(player.id) && !s.deliberation.resolvedAt,
  )?.deliberation;
  const isFocalAgent = deliberation?.focalPlayerId === player.id;
  const lastQuestion = deliberation?.lastQuestion;
  const isBeingAsked =
    !!lastQuestion &&
    lastQuestion.targetPlayerId === player.id &&
    Date.now() - lastQuestion.at < QUESTION_INDICATOR_MS &&
    // The question is answered once they've spoken since it was asked.
    !(conversationForPlayer?.lastMessage && conversationForPlayer.lastMessage.author === player.id);
  const lastExtraction = deliberation?.lastExtraction;
  const memoryGain =
    isFocalAgent && lastExtraction && Date.now() - lastExtraction.at < MEMORY_GAIN_INDICATOR_MS
      ? lastExtraction
      : undefined;

  const tileDim = game.worldMap.tileDim;
  const historicalFacing = { dx: historicalLocation.dx, dy: historicalLocation.dy };
  return (
    <>
      <Character
        x={historicalLocation.x * tileDim + tileDim / 2}
        y={historicalLocation.y * tileDim + tileDim / 2}
        orientation={orientationDegrees(historicalFacing)}
        isMoving={historicalLocation.speed > 0}
        isThinking={isThinking}
        isSpeaking={isSpeaking}
        affinityChange={affinityChange}
        inConflict={inConflict}
        isFocalAgent={isFocalAgent}
        isBeingAsked={isBeingAsked}
        memoryGain={memoryGain}
        isTexting={isTexting}
        isTextTyping={isTextTyping}
        emoji={
          player.activity && player.activity.until > (historicalTime ?? Date.now())
            ? player.activity?.emoji
            : undefined
        }
        isViewer={isViewer}
        textureUrl={character.textureUrl}
        spritesheetData={character.spritesheetData}
        speed={character.speed}
        onClick={() => {
          onClick({ kind: 'player', id: player.id, openChat: true });
        }}
      />
    </>
  );
};
