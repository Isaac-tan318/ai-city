import { useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import interactImg from '../../assets/interact.svg';
import { SelectElement } from './Player';
import { ConversationPopup } from './ConversationPopup';
import { ScenarioCreator } from './ScenarioCreator';
import { toastOnError } from '../toasts';
import { useSendInput } from '../hooks/sendInput';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';
import { computeGameTime } from '../../convex/aiTown/gameTime';
import {
  affinityColor,
  affinityEmoji,
  affinityLabel,
  affinityToward,
} from '../../convex/aiTown/affinity';
import {
  buildShortTermSnapshot,
  gaugeColor,
  SHORT_TERM_EMOJI,
  type ShortTermComponent,
} from '../../convex/aiTown/shortTerm';
// Compact "how long ago" label for relationship-event sub-lines. Also used by
// the agents popup's memory list, so it's exported rather than duplicated.
export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Fallback description when an event has no LLM reason snippet.
function eventFallbackText(kind: string): string {
  switch (kind) {
    case 'inviteDeclined':
      return 'brushed off an invite';
    case 'groupExit':
      return 'left their group early';
    case 'decisionOutcome':
      return 'after how a group decision went';
    default:
      return 'after a conversation';
  }
}

// Percent-complete of a timed task activity (0–100), from `startedAt`..`until`.
function taskProgressPct(activity: { startedAt?: number; until: number }, now: number): number {
  if (activity.startedAt === undefined) return 0;
  const total = activity.until - activity.startedAt;
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((now - activity.startedAt) / total) * 100)));
}

export default function PlayerDetails({
  worldId,
  engineId,
  game,
  playerId,
  setSelectedElement,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  playerId?: GameId<'players'>;
  setSelectedElement: SelectElement;
}) {
  const humanTokenIdentifier = useQuery(api.world.userStatus, { worldId });

  // Ticks once a second so timed-task progress bars animate between server updates.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const players = useMemo(() => [...game.world.players.values()], [game]);
  const humanPlayer = players.find((p) => p.human === humanTokenIdentifier);
  const humanConversation = humanPlayer ? game.world.playerConversation(humanPlayer) : undefined;
  const getPlayerLabel = (agent: (typeof players)[number]) => {
    const description = game.playerDescriptions.get(agent.id);
    return description?.name ?? agent.name ?? agent.human ?? agent.id;
  };
  // Always select the other player if we're in a conversation with them.
  if (humanPlayer && humanConversation) {
    const otherPlayerIds = [...humanConversation.participants.keys()].filter(
      (p) => p !== humanPlayer.id,
    );
    playerId = otherPlayerIds[0];
  }

  const player = playerId && game.world.players.get(playerId);
  const playerConversation = player && game.world.playerConversation(player);
  // Hoisted above the early returns below so the chat-popup hooks can depend on it.
  const isMe = !!(player && humanPlayer && player.id === humanPlayer.id);
  // The conversation this player is actually *in* right now, as opposed to one
  // they've only been invited to or are still walking over to.
  const liveConversation =
    playerConversation &&
    playerId &&
    playerConversation.participants.get(playerId)?.status.kind === 'participating'
      ? playerConversation
      : undefined;
  const liveConversationId = !isMe && liveConversation ? liveConversation.id : undefined;

  // All the scenario-picking state now lives inside ScenarioCreator; this only
  // owns whether the modal is open.
  const [injectorOpen, setInjectorOpen] = useState(false);

  // Transcripts are read in a floating popup rather than at the bottom of this
  // column. Selecting someone mid-conversation is a request to read it, so open
  // it for them. Keyed on the (player, conversation) pair: closing the popup
  // doesn't re-trigger this, but switching to someone else's chat does.
  const [chatOpen, setChatOpen] = useState(false);
  useEffect(() => {
    if (liveConversationId) setChatOpen(true);
  }, [playerId, liveConversationId]);

  const previousConversation = useQuery(
    api.world.previousConversation,
    playerId ? { worldId, playerId } : 'skip',
  );

  const playerDescription = playerId && game.playerDescriptions.get(playerId);
  const agentForPlayer = useMemo(() => {
    if (!playerId) return undefined;
    for (const a of game.world.agents.values()) {
      if (a.playerId === playerId) return a;
    }
    return undefined;
  }, [game, playerId]);
  const agentDescription = agentForPlayer
    ? game.agentDescriptions.get(agentForPlayer.id)
    : undefined;
  // Recent relationship events for this agent (newest first), so each
  // relationship row can show how it got where it is.
  const relationshipEvents = useQuery(
    api.world.relationshipEventsForPlayer,
    playerId && agentForPlayer ? { worldId, playerId } : 'skip',
  );
  const eventsByTarget = useMemo(() => {
    const byTarget = new Map<string, NonNullable<typeof relationshipEvents>>();
    for (const event of relationshipEvents ?? []) {
      if (!event.target) continue;
      let list = byTarget.get(event.target);
      if (!list) {
        list = [];
        byTarget.set(event.target, list);
      }
      list.push(event);
    }
    return byTarget;
  }, [relationshipEvents]);
  // Build the relationship rows for the inspector: authored family ties first
  // (shown even before any interaction has moved affinity), then anyone else this
  // agent has formed an opinion about. Affinity is resolved through the same
  // family-aware default helper used by the engine.
  const relationships = useMemo(() => {
    if (!agentForPlayer) return [];
    const family = agentDescription?.family ?? [];
    const affinities = agentForPlayer.affinities ?? {};
    const nameToId = new Map<string, GameId<'players'>>();
    for (const [pid, desc] of game.playerDescriptions.entries()) {
      nameToId.set(desc.name, pid);
    }
    const rows = new Map<
      string,
      { name: string; relation?: string; affinity: number; pid?: string }
    >();
    for (const tie of family) {
      const pid = nameToId.get(tie.name);
      rows.set(tie.name, {
        name: tie.name,
        relation: tie.relation,
        affinity: affinityToward({
          affinities,
          otherPlayerId: pid ?? '',
          family,
          otherName: tie.name,
        }),
        pid,
      });
    }
    for (const [pid, value] of Object.entries(affinities)) {
      const name = game.playerDescriptions.get(pid as GameId<'players'>)?.name;
      if (!name || rows.has(name)) continue;
      rows.set(name, { name, affinity: value, pid });
    }
    return [...rows.values()];
  }, [agentForPlayer, agentDescription, game]);
  const gameNow = computeGameTime(Date.now(), game.world.worldStartTime);
  const formatScheduleTime = (mins: number) => {
    const h24 = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const h12 = h24 % 12 || 12;
    const ampm = h24 < 12 ? 'AM' : 'PM';
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  const startConversation = useSendInput(engineId, 'startConversation');
  const acceptInvite = useSendInput(engineId, 'acceptInvite');
  const rejectInvite = useSendInput(engineId, 'rejectInvite');
  const leaveConversation = useSendInput(engineId, 'leaveConversation');

  const scenarioButton = (
    <button
      className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
      onClick={() => setInjectorOpen(true)}
      type="button"
    >
      <div className="h-full bg-clay-700 flex items-center gap-2 px-3">
        <img className="w-5 h-5 shrink-0" src={interactImg} alt="Scenario" />
        <div className="leading-none">scenario creator</div>
      </div>
    </button>
  );

  // The creator is a full-screen modal (src/components/ScenarioCreator.tsx) rather
  // than an inline panel: the sidebar is ~24rem wide, which left the catalogue as a
  // cramped grid of truncated titles with nowhere to show what each scenario is.
  const scenarioInjector = injectorOpen && (
    <ScenarioCreator
      worldId={worldId}
      engineId={engineId}
      onClose={() => setInjectorOpen(false)}
    />
  );


  if (!playerId) {
    // Only pad vertically: the column already pads horizontally, and doubling it
    // squeezed the injector panel.
    return (
      <div
        className={
          'h-full w-full flex flex-col text-center items-center py-4 gap-4 ' +
          // Centring a panel taller than the sidebar clips its top out of reach,
          // so only centre the empty state.
          (injectorOpen ? 'justify-start' : 'justify-center')
        }
      >
        {scenarioButton}
        {!injectorOpen && (
          <div className="px-4 text-xl">Click on an agent on the map to see chat history.</div>
        )}
        {scenarioInjector}
      </div>
    );
  }
  if (!player) {
    return null;
  }
  const canInvite = !isMe && !playerConversation && humanPlayer && !humanConversation;
  const sameConversation =
    !isMe &&
    humanPlayer &&
    humanConversation &&
    playerConversation &&
    humanConversation.id === playerConversation.id;

  const humanStatus =
    humanPlayer && humanConversation && humanConversation.participants.get(humanPlayer.id)?.status;
  const playerStatus = playerConversation && playerConversation.participants.get(playerId)?.status;

  const haveInvite = sameConversation && humanStatus?.kind === 'invited';
  const waitingForAccept =
    sameConversation && playerConversation.participants.get(playerId)?.status.kind === 'invited';
  const waitingForNearby =
    sameConversation && playerStatus?.kind === 'walkingOver' && humanStatus?.kind === 'walkingOver';

  const inConversationWithMe =
    sameConversation &&
    playerStatus?.kind === 'participating' &&
    humanStatus?.kind === 'participating';

  const onStartConversation = async () => {
    if (!humanPlayer || !playerId) {
      return;
    }
    console.log(`Starting conversation`);
    await toastOnError(startConversation({ playerId: humanPlayer.id, invitee: playerId }));
  };
  const onAcceptInvite = async () => {
    if (!humanPlayer || !humanConversation || !playerId) {
      return;
    }
    await toastOnError(
      acceptInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onRejectInvite = async () => {
    if (!humanPlayer || !humanConversation) {
      return;
    }
    await toastOnError(
      rejectInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onLeaveConversation = async () => {
    if (!humanPlayer || !inConversationWithMe || !humanConversation) {
      return;
    }
    await toastOnError(
      leaveConversation({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  // const pendingSuffix = (inputName: string) =>
  //   [...inflightInputs.values()].find((i) => i.name === inputName) ? ' opacity-50' : '';

  const pendingSuffix = (s: string) => '';

  // Short-term wellbeing snapshot for the inspector panel (combines the new gauges
  // with the derived financial pressure and existing health).
  const wellbeing = agentForPlayer
    ? buildShortTermSnapshot({
        shortTerm: agentForPlayer.shortTerm,
        balance: agentForPlayer.balance,
        health: agentForPlayer.health,
        now: nowMs,
      })
    : undefined;
  const wellbeingGauges: {
    key: ShortTermComponent | 'financialPressure';
    label: string;
    value: number;
  }[] = wellbeing
    ? [
        { key: 'mood', label: 'Mood', value: wellbeing.mood },
        { key: 'stress', label: 'Stress', value: wellbeing.stress },
        { key: 'fatigue', label: 'Fatigue', value: wellbeing.fatigue },
        { key: 'hunger', label: 'Hunger', value: wellbeing.hunger },
        { key: 'financialPressure', label: 'Money stress', value: wellbeing.financialPressure },
      ]
    : [];
  // What the popup reads: the live conversation if this player is in one, else
  // their last archived thread. Mirrors the two conditions the transcript used to
  // render under inline. If a live conversation ends while the popup is open it
  // falls through to the archived doc, so the finished thread stays readable.
  const chatConversation = !isMe && liveConversation
    ? ({ kind: 'active', doc: liveConversation } as const)
    : !playerConversation && previousConversation
      ? ({ kind: 'archived', doc: previousConversation } as const)
      : undefined;

  return (
    <>
      <div className="flex gap-4">
        <div className="box w-3/4 sm:w-full mr-auto">
          <h2 className="bg-brown-700 p-2 font-display text-2xl sm:text-4xl tracking-wider shadow-solid text-center">
            {playerDescription?.name}
          </h2>
        </div>
        <a
          className="button text-white shadow-solid text-2xl cursor-pointer pointer-events-auto"
          onClick={() => setSelectedElement(undefined)}
        >
          <h2 className="h-full bg-clay-700">
            <img className="w-4 h-4 sm:w-5 sm:h-5" src={closeImg} />
          </h2>
        </a>
      </div>
      <div className="mt-4 flex flex-col gap-3 items-center">
        {scenarioButton}
        {chatConversation && (
          <button
            className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={() => setChatOpen(true)}
            type="button"
          >
            <div className="h-full bg-clay-700 flex items-center gap-2 px-3">
              <span aria-hidden className="shrink-0">
                💬
              </span>
              <div className="leading-none">
                {chatConversation.kind === 'active' ? 'read conversation' : 'read last conversation'}
              </div>
              {chatConversation.kind === 'active' && (
                <span className="shrink-0 text-[10px] uppercase tracking-widest text-green-300">
                  live
                </span>
              )}
            </div>
          </button>
        )}
        {scenarioInjector}
      </div>
      {canInvite && (
        <a
          className={
            'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('startConversation')
          }
          onClick={onStartConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>Start conversation</span>
          </div>
        </a>
      )}
      {waitingForAccept && (
        <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>Waiting for accept...</span>
          </div>
        </a>
      )}
      {waitingForNearby && (
        <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>Walking over...</span>
          </div>
        </a>
      )}
      {inConversationWithMe && (
        <a
          className={
            'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('leaveConversation')
          }
          onClick={onLeaveConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>Leave conversation</span>
          </div>
        </a>
      )}
      {haveInvite && (
        <>
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('acceptInvite')
            }
            onClick={onAcceptInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Accept</span>
            </div>
          </a>
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('rejectInvite')
            }
            onClick={onRejectInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Reject</span>
            </div>
          </a>
        </>
      )}
      {!playerConversation && player.activity && player.activity.until > nowMs && (
        <div className="box flex-grow mt-6">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center">
            {player.activity.emoji ? `${player.activity.emoji} ` : ''}
            {player.activity.description}
          </h2>
          {player.activity.startedAt !== undefined && (
            <div className="bg-brown-700 px-3 pb-3 pt-1">
              <div
                className="h-2 w-full rounded overflow-hidden bg-black/30"
                role="meter"
                aria-valuenow={taskProgressPct(player.activity, nowMs)}
                aria-valuemin={0}
                aria-valuemax={100}
                title="Task progress"
              >
                <div
                  className="h-full rounded bg-amber-400 transition-all"
                  style={{ width: `${taskProgressPct(player.activity, nowMs)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
      <div className="desc my-6">
        <p className="leading-tight -m-4 bg-brown-700 text-base sm:text-sm">
          {!isMe && playerDescription?.description}
          {isMe && <i>This is you!</i>}
          {!isMe && inConversationWithMe && (
            <>
              <br />
              <br />(<i>Conversing with you!</i>)
            </>
          )}
        </p>
      </div>
      {!isMe && relationships.length > 0 && (
        <div className="box flex-grow mb-4">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center px-2 py-1">Relationships</h2>
          <ul className="bg-brown-700 text-sm leading-snug px-3 pb-3 pt-2 flex flex-col gap-2">
            {relationships.map((r) => {
              const events = (r.pid && eventsByTarget.get(r.pid)) || [];
              // Net direction of the last few shifts: is this relationship
              // currently warming or souring?
              const recentNet = events.slice(0, 3).reduce((sum, e) => sum + (e.delta ?? 0), 0);
              const trend = recentNet > 0 ? '↗' : recentNet < 0 ? '↘' : undefined;
              return (
                <li key={r.name} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0">{affinityEmoji(r.affinity)}</span>
                    <span className="flex-1">
                      {r.name}
                      {r.relation && <span className="text-white/60"> · {r.relation}</span>}
                    </span>
                    {trend && (
                      <span
                        className={`shrink-0 font-bold ${
                          recentNet > 0 ? 'text-green-300' : 'text-red-300'
                        }`}
                        title={`Recently ${recentNet > 0 ? 'warming' : 'souring'} (${
                          recentNet > 0 ? '+' : ''
                        }${recentNet} over the last few events)`}
                      >
                        {trend}
                      </span>
                    )}
                    <span className="text-white/70 shrink-0">
                      {affinityLabel(r.affinity)} ({r.affinity})
                    </span>
                  </div>
                  <div
                    className="h-2 w-full rounded overflow-hidden bg-black/30"
                    role="meter"
                    aria-valuenow={r.affinity}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    title={`Affinity ${r.affinity}/100`}
                  >
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${r.affinity}%`,
                        backgroundColor: affinityColor(r.affinity),
                      }}
                    />
                  </div>
                  {events.slice(0, 2).map((e) => (
                    <div
                      key={e._id}
                      className="text-xs text-white/60 leading-snug pl-6"
                      title={e.reason ?? eventFallbackText(e.kind)}
                    >
                      <span className="line-clamp-2">
                        “{e.reason ?? eventFallbackText(e.kind)}”{' '}
                        {e.delta !== undefined && (
                          <span className={e.delta < 0 ? 'text-red-300' : 'text-green-300'}>
                            ({e.delta > 0 ? `+${e.delta}` : e.delta})
                          </span>
                        )}{' '}
                        · {relativeTime(e.at, nowMs)}
                      </span>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!isMe && wellbeing && (
        <div className="box flex-grow mb-4">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center px-2 py-1">
            Wellbeing{wellbeing.health === 'sick' ? ' · 🤒 unwell' : ''}
          </h2>
          <ul className="bg-brown-700 text-sm leading-snug px-3 pb-3 pt-2 flex flex-col gap-2">
            {wellbeingGauges.map((g) => (
              <li key={g.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="shrink-0">{SHORT_TERM_EMOJI[g.key]}</span>
                  <span className="flex-1">{g.label}</span>
                  <span className="text-white/70 shrink-0">{g.value}</span>
                </div>
                <div
                  className="h-2 w-full rounded overflow-hidden bg-black/30"
                  role="meter"
                  aria-valuenow={g.value}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  title={`${g.label} ${g.value}/100`}
                >
                  <div
                    className="h-full rounded transition-all"
                    style={{ width: `${g.value}%`, backgroundColor: gaugeColor(g.key, g.value) }}
                  />
                </div>
              </li>
            ))}
            <li className="text-xs text-white/60 pt-1">
              💵 Savings:{' '}
              {wellbeing.balance < 0 ? `-$${-wellbeing.balance}` : `$${wellbeing.balance}`}
            </li>
            {agentForPlayer?.learnedTraits && agentForPlayer.learnedTraits.length > 0 && (
              <li className="flex flex-col gap-1 pt-1">
                <div className="text-[10px] uppercase tracking-widest text-white/50">
                  Learned about self
                </div>
                <ul className="list-disc pl-5 flex flex-col gap-0.5 text-xs text-white/70">
                  {agentForPlayer.learnedTraits.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        </div>
      )}
      {!isMe && agentForPlayer?.schedule && agentForPlayer.schedule.length > 0 && (
        <div className="box flex-grow mb-4">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center px-2 py-1">
            Today's schedule · Day {gameNow.dayNumber}
          </h2>
          <ul className="bg-brown-700 text-sm leading-snug px-3 pb-3 pt-2 flex flex-col gap-1">
            {agentForPlayer.schedule.map((step, idx) => {
              const next = agentForPlayer.schedule![idx + 1];
              const isCurrent =
                gameNow.minutesIntoDay >= step.startMinute &&
                (!next || gameNow.minutesIntoDay < next.startMinute);
              const isPast = next ? gameNow.minutesIntoDay >= next.startMinute : false;
              return (
                <li
                  key={idx}
                  className={
                    'flex items-start gap-2 ' +
                    (isCurrent
                      ? 'text-amber-200 font-semibold'
                      : isPast
                        ? 'text-white/50 line-through'
                        : 'text-white/90')
                  }
                >
                  <span className="font-mono text-xs shrink-0 w-16">
                    {formatScheduleTime(step.startMinute)}
                  </span>
                  <span className="shrink-0">{step.emoji ?? '·'}</span>
                  <span className="flex-1">{step.description || step.activity}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {chatOpen && chatConversation && (
        <ConversationPopup
          worldId={worldId}
          engineId={engineId}
          game={game}
          conversation={chatConversation}
          humanPlayer={humanPlayer}
          inConversationWithMe={
            chatConversation.kind === 'active' && (inConversationWithMe ?? false)
          }
          escapeEnabled={!injectorOpen}
          onClose={() => setChatOpen(false)}
        />
      )}
    </>
  );
}
