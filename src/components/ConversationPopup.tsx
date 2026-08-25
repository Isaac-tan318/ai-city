import { useMemo, useRef } from 'react';
import { Doc, Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import { Messages } from './Messages';
import { Player } from '../../convex/aiTown/player';
import { Conversation } from '../../convex/aiTown/conversation';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';
import { useEscapeKey } from '../hooks/useEscapeKey';

// A conversation is the thing people actually want to read, and the 24rem
// inspector column wrapped every bubble after a handful of words. This lifts the
// transcript out into a wide panel.
//
// Unlike the other overlays in the app this one is deliberately NON-modal: no
// dimmed backdrop, and the positioning layer is pointer-events-none so the town
// keeps running and stays clickable around the panel. That also means no
// click-outside-to-close — it would fight with clicking the map — so Esc and the
// close button are the only ways out.
export function ConversationPopup({
  worldId,
  engineId,
  game,
  conversation,
  humanPlayer,
  inConversationWithMe,
  escapeEnabled = true,
  onClose,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  conversation:
    | { kind: 'active'; doc: Conversation }
    | { kind: 'archived'; doc: Doc<'archivedConversations'> };
  humanPlayer?: Player;
  inConversationWithMe: boolean;
  // False while a modal is stacked on top, so one Esc doesn't close both.
  escapeEnabled?: boolean;
  onClose: () => void;
}) {
  useEscapeKey(onClose, escapeEnabled);

  // The popup body is its own scroll container, so `Messages` sticks to the
  // newest line in here rather than in the sidebar column it used to live in.
  const bodyRef = useRef<HTMLDivElement>(null);

  const title = useMemo(() => {
    // Archived docs carry plain string ids; live ones carry branded GameIds.
    const ids: string[] =
      conversation.kind === 'active'
        ? [...conversation.doc.participants.keys()]
        : conversation.doc.participants;
    const names = ids.map(
      (id) => game.playerDescriptions.get(id as GameId<'players'>)?.name ?? 'Someone',
    );
    return names.length > 0 ? names.join(' & ') : 'Conversation';
  }, [conversation, game]);

  const isLive = conversation.kind === 'active';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-6 pointer-events-none">
      <div
        className="pointer-events-auto bg-brown-800 text-brown-100 w-[96vw] max-w-[900px] max-h-[80vh] flex flex-col box overflow-hidden shadow-2xl"
        role="dialog"
        aria-label={`Conversation: ${title}`}
      >
        {/* Header */}
        <div className="bg-brown-700 px-4 py-3 flex items-center gap-3 shrink-0">
          <h2 className="font-display tracking-widest text-lg flex-1 uppercase shadow-solid truncate">
            <span aria-hidden className="mr-2">
              💬
            </span>
            {title}
          </h2>
          <span
            className={
              'shrink-0 text-[10px] uppercase tracking-widest rounded-full px-2 py-1 ' +
              (isLive ? 'bg-green-500/20 text-green-300' : 'bg-black/30 text-brown-300')
            }
          >
            {isLive ? 'live' : 'ended'}
          </span>
          <button
            className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            <span className="block h-full bg-clay-700">
              <img className="w-4 h-4" src={closeImg} alt="Close" />
            </span>
          </button>
        </div>

        {/* The transcript itself, unchanged — roster, bubbles, scenario markers and
            the human's message input all come along. */}
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto">
          <Messages
            worldId={worldId}
            engineId={engineId}
            conversation={conversation}
            inConversationWithMe={inConversationWithMe}
            humanPlayer={humanPlayer}
            scrollViewRef={bodyRef}
            worldStartTime={game.world.worldStartTime}
            game={game}
            chatFrame={false}
          />
        </div>
      </div>
    </div>
  );
}
