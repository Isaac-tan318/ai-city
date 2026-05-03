import { useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import interactImg from '../../assets/interact.svg';
import { SelectElement } from './Player';
import { Messages } from './Messages';
import { toastOnError } from '../toasts';
import { useSendInput } from '../hooks/sendInput';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';

const scenarioOptions = [
  {
    id: 'restaurant',
    title: 'Dinner Pact',
    text: 'Get the agents to eat together at the restaurant and compare their day.',
    requiresTwoAgents: true,
  },
  {
    id: 'park',
    title: 'Park Meetup',
    text: 'Have the agents meet at the park and share recent discoveries.',
    requiresTwoAgents: true,
  },
  {
    id: 'rain',
    title: 'Sudden Rain',
    text: 'A sudden rainstorm disrupts plans, forcing a quick change in behavior.',
    requiresTwoAgents: false,
  },
  {
    id: 'rumor',
    title: 'Seed a Rumor',
    text: 'Agent 1 plants a rumor with Agent 2 and watches it spread socially.',
    requiresTwoAgents: true,
  },
  {
    id: 'debate',
    title: 'Spark a Debate',
    text: 'Agent 1 challenges Agent 2 to a debate on a polarizing topic.',
    requiresTwoAgents: true,
  },
  {
    id: 'interrogation',
    title: 'Interrogation (Memory Retrieval)',
    text: 'Agent 1 presses Agent 2 for detailed memory of recent actions and conversations.',
    requiresTwoAgents: true,
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
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [scenarioText, setScenarioText] = useState('');
  const [targetAgent1, setTargetAgent1] = useState<GameId<'players'> | ''>('');
  const [targetAgent2, setTargetAgent2] = useState<GameId<'players'> | ''>('');

  const activeScenario = useMemo(
    () => scenarioOptions.find((scenario) => scenario.id === selectedScenarioId) ?? null,
    [selectedScenarioId],
  );
  const showTargetSelectors = activeScenario?.requiresTwoAgents ?? false;

  useEffect(() => {
    if (playerId) {
      setInjectorOpen(true);
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

  const startConversation = useSendInput(engineId, 'startConversation');
  const acceptInvite = useSendInput(engineId, 'acceptInvite');
  const rejectInvite = useSendInput(engineId, 'rejectInvite');
  const leaveConversation = useSendInput(engineId, 'leaveConversation');

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

  const scenarioButton = (
    <button
      className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
      onClick={() => onOpenInjector(player?.id)}
      type="button"
    >
      <div className="h-full bg-clay-700 flex items-center gap-2 px-3">
        <img className="w-5 h-5" src={interactImg} alt="Scenario" />
        <span>scenario creator</span>
      </div>
    </button>
  );

  const scenarioInjector = injectorOpen && (
    <div className="scenario-injector mt-36 w-full box bg-gradient-to-br from-[#2d2438] to-[#1d1826] pt-3">
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
          <div className="scenario-scroll grid gap-2 sm:grid-cols-2 max-h-56 overflow-y-auto pr-1">
            {scenarioOptions.map((scenario) => {
              const isActive = scenario.id === selectedScenarioId;
              return (
                <button
                  key={scenario.id}
                  className={
                    'rounded border px-3 py-2 text-left transition ' +
                    (isActive
                      ? 'border-amber-300 bg-amber-200/10 text-amber-100'
                      : 'border-white/10 bg-white/5 hover:border-white/30')
                  }
                  type="button"
                  onClick={() => onSelectScenario(scenario.id)}
                >
                  <div className="font-display text-sm sm:text-base leading-tight tracking-wider">
                    {scenario.title}
                  </div>
                  <div className="text-xs leading-snug text-white/70">{scenario.text}</div>
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
                className="rounded bg-black/40 border border-white/20 px-3 py-2 text-sm"
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
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-widest text-amber-200/80">
              Agent 2
              <select
                className="rounded bg-black/40 border border-white/20 px-3 py-2 text-sm"
                value={targetAgent2}
                onChange={(event) => setTargetAgent2(event.target.value as GameId<'players'>)}
              >
                <option value="">Select agent</option>
                {players
                  .filter((agent) => !targetAgent1 || agent.id !== targetAgent1)
                  .map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
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

        <div className="rounded border border-white/15 bg-black/50 p-3">
          <div className="text-xs uppercase tracking-widest text-amber-200/80">
            Scenario chatbox
          </div>
          <textarea
            className="mt-2 w-full resize-none rounded bg-black/30 border border-white/10 px-3 py-2 text-sm sm:text-base"
            placeholder="Describe the scenario you want to inject..."
            rows={3}
            value={scenarioText}
            onChange={(event) => setScenarioText(event.target.value)}
          />
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
      {!isMe && playerConversation && playerStatus?.kind === 'participating' && (
        <Messages
          worldId={worldId}
          engineId={engineId}
          inConversationWithMe={inConversationWithMe ?? false}
          conversation={{ kind: 'active', doc: playerConversation }}
          humanPlayer={humanPlayer}
          scrollViewRef={scrollViewRef}
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
          />
        </>
      )}
    </>
  );
}
