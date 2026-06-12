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

const scenarioOptions = [
  {
    id: 'park',
    title: 'Park Meetup',
    text: 'Meet at the park!',
    requiresTwoAgents: false,
  },
  {
    id: 'hawker-lunch',
    title: 'Hawker Lunch Rush',
    text: "Everyone's hungry — meet at the Hawker Centre and sort out lunch together.",
    requiresTwoAgents: false,
  },
  {
    id: 'late-night-ride',
    title: 'Late-Night Ride Home',
    text:
      'Trains have stopped — gather at the Marina Bay Sands taxi stand to share a ride home.',
    requiresTwoAgents: false,
  },
  {
    id: 'hdb-noise',
    title: 'HDB Noise Complaint',
    text: "Someone's blasting music late at night — gather at the HDB Estate to settle it.",
    requiresTwoAgents: false,
  },
  {
    id: 'medical-emergency',
    title: 'Medical Emergency',
    text: 'Someone has collapsed — rush to Changi General Hospital to help.',
    requiresTwoAgents: false,
  },
  {
    id: 'custom',
    title: 'Custom Scenario',
    text: '',
    requiresTwoAgents: false,
  },
];

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
  const startScenarioMeetAtPark = useSendInput(engineId, 'startScenarioMeetAtPark');
  const startCustomScenario = useSendInput(engineId, 'startCustomScenario');
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

  const scenarioPreview = scenarioText.trim()
    ? scenarioText.trim()
    : 'Select a scenario or write a custom one below.';

  const onStartScenario = async () => {
    if (!selectedScenarioId) {
      toast.error('Select a scenario to start.');
      return;
    }
    if (selectedScenarioId === 'park') {
      await toastOnError(startScenarioMeetAtPark({}));
      setInjectorOpen(false);
      return;
    }
    // Both the free-form "custom" option and the preset scenarios (Hawker Lunch,
    // Late-Night Ride, etc.) feed their instruction text to the same injector.
    // The text is editable in the textarea, so presets act as starting points the
    // user can tweak before launching.
    if (!scenarioText.trim()) {
      toast.error('Write your scenario instructions before starting.');
      return;
    }
    await toastOnError(startCustomScenario({ instruction: scenarioText.trim() }));
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
          <div className="text-xs uppercase tracking-widest text-amber-200/80">Defaults</div>
          <div className="scenario-scroll grid items-start gap-2 sm:grid-cols-2 max-h-56 overflow-y-auto pr-1">
            {scenarioOptions.map((scenario) => {
              const isActive = scenario.id === selectedScenarioId;
              const isCustom = scenario.id === 'custom';
              return (
                <button
                  key={scenario.id}
                  className={
                    'rounded border px-3 py-2 text-left transition ' +
                    (isActive
                      ? 'border-amber-300 bg-amber-200/10 text-amber-100'
                      : isCustom
                        ? 'border-dashed border-white/30 bg-white/5 hover:border-amber-300/60'
                        : 'border-white/10 bg-white/5 hover:border-white/30')
                  }
                  type="button"
                  onClick={() => onSelectScenario(scenario.id)}
                >
                  <div className="font-display text-sm sm:text-base leading-tight tracking-wider">
                    {isCustom ? '✏️ ' : ''}{scenario.title}
                  </div>
                  <div className="text-xs leading-snug text-white/70">
                    {isCustom ? 'Write your own instructions below' : scenario.text}
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

        <div className="rounded border border-amber-200/20 bg-black/30 p-3">
          <div className="text-xs uppercase tracking-widest text-amber-200/80">Preview</div>
          <p className="text-sm sm:text-base leading-relaxed text-white/90">{scenarioPreview}</p>
        </div>

        <div
          className={
            'rounded border p-3 transition ' +
            (selectedScenarioId === 'custom'
              ? 'border-amber-300/60 bg-black/50'
              : 'border-white/15 bg-black/50')
          }
        >
          <div className="text-xs uppercase tracking-widest text-amber-200/80">
            {selectedScenarioId === 'custom'
              ? 'Your custom instructions'
              : 'Scenario chatbox'}
          </div>
          <textarea
            className={
              'mt-2 w-full resize-none rounded border px-3 py-2 text-sm sm:text-base bg-black/30 ' +
              (selectedScenarioId === 'custom'
                ? 'border-amber-300/40 focus:border-amber-300 outline-none'
                : 'border-white/10')
            }
            placeholder={
              selectedScenarioId === 'custom'
                ? 'e.g. "Everyone is secretly a spy who must not reveal their identity"'
                : 'Describe the scenario you want to inject...'
            }
            rows={selectedScenarioId === 'custom' ? 4 : 3}
            autoFocus={selectedScenarioId === 'custom'}
            value={scenarioText}
            onChange={(event) => setScenarioText(event.target.value)}
          />
        </div>

        <div className="flex justify-between gap-3">
          <button
            className="button text-white shadow-solid text-sm cursor-pointer pointer-events-auto opacity-70 hover:opacity-100"
            type="button"
            onClick={onClearScenario}
            title="Remove any active scenario from all agents"
          >
            <div className="h-full bg-clay-700 px-3 py-2 text-center">Clear scenario</div>
          </button>
          <button
            className="button text-white shadow-solid text-base sm:text-lg cursor-pointer pointer-events-auto"
            type="button"
            onClick={onStartScenario}
          >
            <div className="h-full bg-clay-700 px-4 py-2 text-center">Start scenario</div>
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
      {!playerConversation && player.activity && player.activity.until > Date.now() && (
        <div className="box flex-grow mt-6">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center">
            {player.activity.description}
          </h2>
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
