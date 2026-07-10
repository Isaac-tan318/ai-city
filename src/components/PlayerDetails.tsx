import { useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import interactImg from '../../assets/interact.svg';
import { SelectElement } from './Player';
import { Messages } from './Messages';
import { toast } from 'react-toastify';
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
import { ALL_SCENARIOS } from '../../data/scenarios';

// The scenario generator offers the same catalogue the automatic system draws
// from (data/scenarios.ts) — universal town-wide events plus the work/local ones —
// rather than a separate bespoke list. Work scenarios no longer fire randomly (see
// convex/aiTown/scenarios.ts) but remain available here for manual injection. A
// free-form "Custom Scenario" stays at the end.
const scenarioOptions = [
  ...ALL_SCENARIOS.map((s) => ({
    id: s.id,
    emoji: s.emoji,
    title: s.name,
    text: s.instruction,
    name: s.name,
    background: s.background,
    // Local/workplace scenarios run through the automatic pipeline (correct
    // workers + gathering phase); universal ones use the town-wide injector.
    scope: s.scope as 'universal' | 'local' | undefined,
    requiresTwoAgents: false,
  })),
  {
    id: 'custom',
    emoji: '✏️',
    title: 'Custom Scenario',
    text: '',
    name: 'Custom Scenario',
    background:
      'A custom scenario you injected. It overrides everyone’s normal routine for the rest of the in-game day.',
    scope: undefined as 'universal' | 'local' | undefined,
    requiresTwoAgents: false,
  },
];

// Compact "how long ago" label for relationship-event sub-lines.
function relativeTime(at: number, now: number): string {
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
  scrollViewRef,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  playerId?: GameId<'players'>;
  setSelectedElement: SelectElement;
  scrollViewRef: React.RefObject<HTMLDivElement>;
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

  const [injectorOpen, setInjectorOpen] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(
    scenarioOptions[0]?.id ?? null,
  );
  const [scenarioText, setScenarioText] = useState(scenarioOptions[0]?.text ?? '');
  const [targetAgent1, setTargetAgent1] = useState<GameId<'players'> | ''>('');
  const [targetAgent2, setTargetAgent2] = useState<GameId<'players'> | ''>('');

  const activeScenario = useMemo(
    () => scenarioOptions.find((scenario) => scenario.id === selectedScenarioId) ?? null,
    [selectedScenarioId],
  );
  const showTargetSelectors = activeScenario?.requiresTwoAgents ?? false;

  useEffect(() => {
    if (playerId) {
      setTargetAgent1(playerId);
      if (targetAgent2 === playerId) {
        const nextAgent = players.find((p) => p.id !== playerId)?.id ?? '';
        setTargetAgent2(nextAgent);
      }
    }
  }, [playerId, game, targetAgent2, players]);

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
        affinity: affinityToward({ affinities, otherPlayerId: pid ?? '', family, otherName: tie.name }),
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
  const startCustomScenario = useSendInput(engineId, 'startCustomScenario');
  const startCatalogScenario = useSendInput(engineId, 'startCatalogScenario');
  const clearScenario = useSendInput(engineId, 'clearScenario');

  const setDefaultSecondTarget = (primaryTarget: GameId<'players'> | '') => {
    if (!primaryTarget) {
      setTargetAgent2('');
      return;
    }
    const nextAgent = players.find((p) => p.id !== primaryTarget)?.id ?? '';
    setTargetAgent2(nextAgent);
  };

  const onOpenInjector = (primaryTarget?: GameId<'players'>) => {
    setInjectorOpen(true);
    if (!selectedScenarioId && scenarioOptions[0]) {
      setSelectedScenarioId(scenarioOptions[0].id);
      setScenarioText(scenarioOptions[0].text ?? '');
    }
    if (primaryTarget) {
      setTargetAgent1(primaryTarget);
      if (targetAgent2 === primaryTarget || !targetAgent2) {
        setDefaultSecondTarget(primaryTarget);
      }
    }
  };

  const onSelectScenario = (scenarioId: string) => {
    const scenario = scenarioOptions.find((entry) => entry.id === scenarioId);
    setSelectedScenarioId(scenarioId);
    setScenarioText(scenario?.text ?? '');
    if (scenario?.requiresTwoAgents) {
      const primaryTarget = targetAgent1 || (player?.id ?? '');
      if (primaryTarget) {
        if (!targetAgent2 || targetAgent2 === primaryTarget) {
          setDefaultSecondTarget(primaryTarget);
        }
      }
    }
  };

  const onStartScenario = async () => {
    if (!selectedScenarioId) {
      toast.error('Select a scenario to start.');
      return;
    }
    if (!scenarioText.trim()) {
      toast.error('Write your scenario instructions before starting.');
      return;
    }
    const scenario = scenarioOptions.find((entry) => entry.id === selectedScenarioId);
    if (scenario?.scope === 'local') {
      // Workplace scenarios run the real pipeline: only the workplace's workers
      // take part and they gather there first, just like a randomly-fired one.
      await toastOnError(
        startCatalogScenario({ scenarioId: scenario.id, instruction: scenarioText.trim() }),
      );
    } else {
      // Universal and free-form custom scenarios use the town-wide injector,
      // carrying the scenario's name/emoji/background so the panel reflects it.
      await toastOnError(
        startCustomScenario({
          instruction: scenarioText.trim(),
          name: scenario?.name,
          emoji: scenario?.emoji,
          background: scenario?.background,
        }),
      );
    }
    setInjectorOpen(false);
  };

  const onClearScenario = async () => {
    await toastOnError(clearScenario({}));
    toast.success('Scenario cleared — agents will resume normal behaviour.');
  };

  const scenarioButton = (
    <button
      className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
      onClick={() => onOpenInjector(player?.id)}
      type="button"
    >
      <div className="h-full bg-clay-700 flex items-center gap-2 px-3">
        <img className="w-5 h-5 shrink-0" src={interactImg} alt="Scenario" />
        <div className="leading-none">scenario creator</div>
      </div>
    </button>
  );

  const scenarioInjector = injectorOpen && (
    <div
      className={
        'scenario-injector w-full box bg-gradient-to-br from-[#2d2438] to-[#1d1826] ' +
        'sm:w-[calc(100%+2rem)] sm:-mx-4 ' +
        (playerId ? 'mt-4' : 'mt-[calc(9rem+75px)] pt-3')
      }
    >
      <div className="bg-brown-700 p-3 flex items-center justify-between text-lg sm:text-xl font-display tracking-widest">
        <span className="flex-1 text-center">Scenario Injector</span>
        <button
          className="button text-white shadow-solid text-2xl cursor-pointer pointer-events-auto"
          type="button"
          onClick={() => setInjectorOpen(false)}
          aria-label="Close scenario injector"
        >
          <h2 className="h-full bg-clay-700">
            <img className="w-4 h-4 sm:w-5 sm:h-5" src={closeImg} alt="" />
          </h2>
        </button>
      </div>
      <div className="p-4 flex flex-col gap-4 text-sm sm:text-base">
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-widest text-amber-200/80">
            Choose a scenario
          </div>
          <div className="scenario-scroll grid grid-cols-2 auto-rows-auto gap-2 max-h-72 overflow-y-auto pr-1">
            {scenarioOptions.map((scenario) => {
              const isActive = scenario.id === selectedScenarioId;
              const isCustom = scenario.id === 'custom';
              return (
                <button
                  key={scenario.id}
                  className={
                    'scenario-card group relative flex h-full flex-col gap-1 rounded-lg border p-3 text-left transition ' +
                    (isActive
                      ? 'border-amber-300 bg-amber-300/15 ring-1 ring-amber-300/60 shadow-[0_0_12px_-2px_rgba(252,211,77,0.5)]'
                      : isCustom
                        ? 'border-dashed border-amber-200/40 bg-white/5 hover:border-amber-300/70 hover:bg-amber-300/5'
                        : 'border-white/10 bg-white/5 hover:border-white/40 hover:bg-white/10')
                  }
                  type="button"
                  onClick={() => onSelectScenario(scenario.id)}
                  aria-pressed={isActive}
                >
                  {isActive && (
                    <span className="absolute right-2 top-2 text-amber-300" aria-hidden>
                      ✓
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none" aria-hidden>
                      {scenario.emoji}
                    </span>
                    <span
                      className={
                        'font-display text-sm leading-tight tracking-wide ' +
                        (isActive ? 'text-amber-100' : 'text-white/90')
                      }
                    >
                      {scenario.title}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {showTargetSelectors && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs uppercase tracking-widest text-amber-200/80">
              Agent 1
              <select
                className="scenario-select rounded bg-black/40 border border-white/20 px-3 py-2 text-sm"
                value={targetAgent1}
                onChange={(event) => {
                  const value = event.target.value as GameId<'players'>;
                  setTargetAgent1(value);
                  if (value === targetAgent2) {
                    setDefaultSecondTarget(value);
                  }
                }}
              >
                <option value="">Select agent</option>
                {players.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {getPlayerLabel(agent)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-widest text-amber-200/80">
              Agent 2
              <select
                className="scenario-select rounded bg-black/40 border border-white/20 px-3 py-2 text-sm"
                value={targetAgent2}
                onChange={(event) => setTargetAgent2(event.target.value as GameId<'players'>)}
              >
                <option value="">Select agent</option>
                {players
                  .filter((agent) => !targetAgent1 || agent.id !== targetAgent1)
                  .map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {getPlayerLabel(agent)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="scenario-instructions"
              className="text-xs uppercase tracking-widest text-amber-200/80"
            >
              {selectedScenarioId === 'custom' ? 'Your instructions' : 'What gets injected'}
            </label>
            <span className="text-[10px] uppercase tracking-widest text-white/35">
              {scenarioText.trim().length} chars
            </span>
          </div>
          <textarea
            id="scenario-instructions"
            className={
              'w-full resize-none rounded-lg border px-3 py-2 text-sm sm:text-base bg-black/40 text-white/90 placeholder:text-white/30 transition outline-none ' +
              'border-amber-200/25 focus:border-amber-300 focus:ring-1 focus:ring-amber-300/50'
            }
            placeholder={
              selectedScenarioId === 'custom'
                ? 'e.g. "Everyone is secretly a spy who must not reveal their identity"'
                : 'Describe the scenario you want to inject...'
            }
            rows={4}
            autoFocus={selectedScenarioId === 'custom'}
            value={scenarioText}
            onChange={(event) => setScenarioText(event.target.value)}
          />
          <p className="text-[11px] leading-snug text-white/40">
            Every agent reacts to this in character, then reshapes their day around it.
          </p>
        </div>

        <div className="flex items-stretch gap-3 pt-1">
          <button
            className="button text-white shadow-solid text-sm cursor-pointer pointer-events-auto opacity-80 hover:opacity-100"
            type="button"
            onClick={onClearScenario}
            title="Remove any active scenario from all agents"
          >
            <div className="h-full flex items-center justify-center whitespace-nowrap bg-clay-700 px-4 py-2">
              Clear
            </div>
          </button>
          <button
            className="button flex-1 min-w-0 text-white shadow-solid text-sm sm:text-base cursor-pointer pointer-events-auto disabled:opacity-40 disabled:cursor-not-allowed"
            type="button"
            onClick={onStartScenario}
            disabled={!scenarioText.trim()}
          >
            <div className="h-full flex items-center justify-center gap-2 whitespace-nowrap truncate bg-clay-700 px-3 py-2">
              <span aria-hidden>▶</span> Start scenario
            </div>
          </button>
        </div>
      </div>
    </div>
  );

  if (!playerId) {
    return (
      <div className="h-full flex flex-col text-center items-center justify-center p-4 gap-4">
        {scenarioButton}
        <div className="text-xl">Click on an agent on the map to see chat history.</div>
        {scenarioInjector}
      </div>
    );
  }
  if (!player) {
    return null;
  }
  const isMe = humanPlayer && player.id === humanPlayer.id;
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
              const recentNet = events
                .slice(0, 3)
                .reduce((sum, e) => sum + (e.delta ?? 0), 0);
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
                      style={{ width: `${r.affinity}%`, backgroundColor: affinityColor(r.affinity) }}
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
      {!isMe && playerConversation && playerStatus?.kind === 'participating' && (
        <Messages
          worldId={worldId}
          engineId={engineId}
          inConversationWithMe={inConversationWithMe ?? false}
          conversation={{ kind: 'active', doc: playerConversation }}
          humanPlayer={humanPlayer}
          scrollViewRef={scrollViewRef}
          worldStartTime={game.world.worldStartTime}
          game={game}
        />
      )}
      {!playerConversation && previousConversation && (
        <>
          <div className="box flex-grow">
            <h2 className="bg-brown-700 text-lg text-center">Previous conversation</h2>
          </div>
          <Messages
            worldId={worldId}
            engineId={engineId}
            inConversationWithMe={false}
            conversation={{ kind: 'archived', doc: previousConversation }}
            humanPlayer={humanPlayer}
            scrollViewRef={scrollViewRef}
            worldStartTime={game.world.worldStartTime}
          />
        </>
      )}
    </>
  );
}
