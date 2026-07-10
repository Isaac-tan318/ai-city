import { useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { ServerGame } from '../hooks/serverGame';
import { GameId } from '../../convex/aiTown/ids';
import { TENSIONS_FEED_MAX_CHIPS, TENSIONS_FEED_WINDOW_MS } from '../../convex/constants';

// Top-right stack of recent relationship events — conflicts and their
// consequences (affinity shifts, snubbed invites, early group exits) — so the
// social fallout that used to be invisible shows up as it happens. Sits under
// the ScenariosPanel in the same corner stack. Click a chip to open the
// inspector on the character whose feelings changed.
export function TensionsFeed({
  worldId,
  game,
  onSelectPlayer,
}: {
  worldId: Id<'worlds'>;
  game: ServerGame;
  onSelectPlayer: (playerId: GameId<'players'>) => void;
}) {
  const events = useQuery(api.world.recentRelationshipEvents, { worldId });
  // Re-render once a second so chips age out of the window smoothly.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nameOf = (id?: string) =>
    (id && game.playerDescriptions.get(id as GameId<'players'>)?.name) || 'Someone';

  const recent = (events ?? [])
    .filter((e) => nowMs - e.at < TENSIONS_FEED_WINDOW_MS)
    .slice(0, TENSIONS_FEED_MAX_CHIPS);
  if (recent.length === 0) return null;

  return (
    <div className="flex flex-col items-end gap-1.5 pointer-events-auto">
      <div className="text-[10px] uppercase tracking-widest text-white/70 font-display shadow-solid pr-1">
        Tensions
      </div>
      {recent.map((e) => {
        const negative = e.kind !== 'affinityShift' || (e.delta ?? 0) < 0;
        const actorName = nameOf(e.actor);
        const targetName = e.target ? nameOf(e.target) : undefined;
        const headline =
          e.kind === 'groupExit'
            ? `${actorName} left the group`
            : targetName
              ? `${actorName} ↔ ${targetName}`
              : actorName;
        const subLabel =
          e.reason ??
          (e.kind === 'inviteDeclined' ? 'invite turned down' : e.scenarioName ?? 'a conversation');
        return (
          <button
            key={e._id}
            type="button"
            onClick={() => onSelectPlayer(e.actor as GameId<'players'>)}
            title={`${e.reason ?? subLabel} — click to inspect ${actorName}`}
            className={`group flex items-center gap-2 rounded transition-colors pl-2 pr-2.5 py-1.5 max-w-[220px] shadow ${
              negative ? 'bg-red-950/75 hover:bg-red-950/95' : 'bg-black/50 hover:bg-black/75'
            }`}
          >
            <span className="text-base leading-none" aria-hidden>
              {negative ? '💢' : '💗'}
            </span>
            <span className="flex flex-col items-start min-w-0">
              <span className="text-white text-xs font-bold leading-tight truncate max-w-[150px]">
                {headline}
              </span>
              <span className="text-[10px] leading-tight truncate max-w-[150px] text-white/60">
                {subLabel}
              </span>
            </span>
            {e.delta !== undefined && (
              <span
                className={`text-[10px] leading-none tabular-nums shrink-0 ml-auto font-bold ${
                  negative ? 'text-red-300' : 'text-green-300'
                }`}
                title={`Affinity ${e.delta > 0 ? '+' : ''}${e.delta} (now ${e.affinityAfter})`}
              >
                {e.delta > 0 ? `+${e.delta}` : e.delta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
