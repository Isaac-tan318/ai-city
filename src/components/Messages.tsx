import clsx from 'clsx';
import { Doc, Id } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { MessageInput } from './MessageInput';
import { Player } from '../../convex/aiTown/player';
import { Conversation } from '../../convex/aiTown/conversation';
import { useEffect, useRef } from 'react';
import { formatGameTimestamp } from '../../convex/aiTown/gameTime';
import { CharacterIcon } from './CharacterIcon';
import { ServerGame } from '../hooks/serverGame';

export function Messages({
  worldId,
  engineId,
  conversation,
  inConversationWithMe,
  humanPlayer,
  scrollViewRef,
  worldStartTime,
  game,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  conversation:
    | { kind: 'active'; doc: Conversation }
    | { kind: 'archived'; doc: Doc<'archivedConversations'> };
  inConversationWithMe: boolean;
  humanPlayer?: Player;
  scrollViewRef: React.RefObject<HTMLDivElement>;
  worldStartTime?: number;
  // Used to correlate an active scenario conversation with its scenario so task /
  // goal completion markers can be dropped into the chat timeline.
  game?: ServerGame;
}) {
  const humanPlayerId = humanPlayer?.id;
  const descriptions = useQuery(api.world.gameDescriptions, { worldId });
  const messages = useQuery(api.messages.listMessages, {
    worldId,
    conversationId: conversation.doc.id,
  });
  let currentlyTyping = conversation.kind === 'active' ? conversation.doc.isTyping : undefined;
  if (messages !== undefined && currentlyTyping) {
    if (messages.find((m) => m.messageUuid === currentlyTyping!.messageUuid)) {
      currentlyTyping = undefined;
    }
  }
  const currentlyTypingDesc =
    currentlyTyping &&
    descriptions?.playerDescriptions.find((p) => p.playerId === currentlyTyping?.playerId);
  const currentlyTypingName = currentlyTypingDesc?.name;

  const scrollView = scrollViewRef.current;
  const isScrolledToBottom = useRef(false);
  useEffect(() => {
    if (!scrollView) return undefined;

    const onScroll = () => {
      isScrolledToBottom.current = !!(
        scrollView && scrollView.scrollHeight - scrollView.scrollTop - 50 <= scrollView.clientHeight
      );
    };
    scrollView.addEventListener('scroll', onScroll);
    return () => scrollView.removeEventListener('scroll', onScroll);
  }, [scrollView]);
  useEffect(() => {
    if (isScrolledToBottom.current) {
      scrollViewRef.current?.scrollTo({
        top: scrollViewRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, currentlyTyping]);

  if (messages === undefined) {
    return null;
  }
  if (messages.length === 0 && !inConversationWithMe) {
    return null;
  }
  const messageNodes: { time: number; node: React.ReactNode }[] = messages.map((m) => {
    const node = (
      <div key={`text-${m._id}`} className="leading-tight mb-6">
        <div className="flex gap-2 items-center">
          <CharacterIcon character={m.authorCharacter} name={m.authorName} size={28} />
          <span className="uppercase flex-grow">{m.authorName}</span>
          <time dateTime={m._creationTime.toString()}>
            {formatGameTimestamp(m._creationTime, worldStartTime)}
          </time>
        </div>
        <div className={clsx('bubble', m.author === humanPlayerId && 'bubble-mine')}>
          <p className="bg-white -mx-3 -my-1">{m.text}</p>
        </div>
      </div>
    );
    return { node, time: m._creationTime };
  });
  const lastMessageTs = messages.map((m) => m._creationTime).reduce((a, b) => Math.max(a, b), 0);

  const membershipNodes: typeof messageNodes = [];
  if (conversation.kind === 'active') {
    for (const [playerId, m] of conversation.doc.participants) {
      const playerName = descriptions?.playerDescriptions.find((p) => p.playerId === playerId)
        ?.name;
      let started;
      if (m.status.kind === 'participating') {
        started = m.status.started;
      }
      if (started) {
        membershipNodes.push({
          node: (
            <div key={`joined-${playerId}`} className="leading-tight mb-6">
              <p className="text-brown-700 text-center">{playerName} joined the conversation.</p>
            </div>
          ),
          time: started,
        });
      }
    }
  } else {
    for (const playerId of conversation.doc.participants) {
      const playerName = descriptions?.playerDescriptions.find((p) => p.playerId === playerId)
        ?.name;
      const started = conversation.doc.created;
      membershipNodes.push({
        node: (
          <div key={`joined-${playerId}`} className="leading-tight mb-6">
            <p className="text-brown-700 text-center">{playerName} joined the conversation.</p>
          </div>
        ),
        time: started,
      });
      const ended = conversation.doc.ended;
      membershipNodes.push({
        node: (
          <div key={`left-${playerId}`} className="leading-tight mb-6">
            <p className="text-brown-700 text-center">{playerName} left the conversation.</p>
          </div>
        ),
        // Always sort all "left" messages after the last message.
        // TODO: We can remove this once we want to support more than two participants per conversation.
        time: Math.max(lastMessageTs + 1, ended),
      });
    }
  }
  // Scenario progress markers: drop an inline chip into the timeline at the moment
  // each task was substantively covered and when the overall goal was achieved.
  const scenarioMarkerNodes: typeof messageNodes = [];
  if (conversation.kind === 'active' && game) {
    // This conversation's scenario: its participants share an agent `scenarioId`.
    let scenarioId: string | undefined;
    for (const [playerId] of conversation.doc.participants) {
      const agent = [...game.world.agents.values()].find((a) => a.playerId === playerId);
      if (agent?.scenarioId) {
        scenarioId = agent.scenarioId;
        break;
      }
    }
    const scenario = scenarioId
      ? (game.world.activeScenarios ?? []).find((s) => s.id === scenarioId)
      : undefined;
    if (scenario) {
      const topics = scenario.topics ?? [];
      const doneAt = scenario.topicsDoneAt ?? [];
      topics.forEach((topic, i) => {
        const at = doneAt[i];
        if (at && at > 0) {
          scenarioMarkerNodes.push({
            time: at,
            node: (
              <div key={`task-${i}`} className="mb-6 text-center">
                <span className="inline-block text-xs sm:text-sm font-semibold text-green-900 bg-green-300/80 rounded-full px-3 py-1">
                  ✅ Task completed: {topic}
                </span>
              </div>
            ),
          });
        }
      });
      if (scenario.goalMet && scenario.goalMetAt) {
        scenarioMarkerNodes.push({
          time: scenario.goalMetAt,
          node: (
            <div key="goal-met" className="mb-6 text-center">
              <span className="inline-block text-sm sm:text-base font-bold text-amber-950 bg-amber-300 rounded-full px-4 py-1.5 shadow-solid">
                🎯 Goal achieved!
              </span>
            </div>
          ),
        });
      }
    }
  }

  const nodes = [...messageNodes, ...membershipNodes, ...scenarioMarkerNodes];
  nodes.sort((a, b) => a.time - b.time);

  // Build a roster of participating members so the user can see everyone present
  // and who currently holds (typing) or is next to hold (nextSpeaker) the floor.
  const roster: { playerId: string; name?: string; character?: string | null }[] = [];
  let nextSpeakerId: string | undefined;
  if (conversation.kind === 'active') {
    nextSpeakerId = conversation.doc.nextSpeaker;
    for (const [playerId, m] of conversation.doc.participants) {
      if (m.status.kind !== 'participating') continue;
      const desc = descriptions?.playerDescriptions.find((p) => p.playerId === playerId);
      roster.push({ playerId, name: desc?.name, character: desc?.character });
    }
  }

  return (
    <div className="chats text-base sm:text-sm">
      <div className="bg-brown-200 text-black p-2">
        {roster.length > 1 && (
          <div className="flex flex-wrap gap-3 justify-center mb-4 pb-3 border-b border-brown-500">
            {roster.map((p) => {
              const isTypingNow = currentlyTyping?.playerId === p.playerId;
              const isNext = !isTypingNow && nextSpeakerId === p.playerId;
              return (
                <div
                  key={`roster-${p.playerId}`}
                  className="flex flex-col items-center gap-1"
                  style={{ width: 48 }}
                >
                  <div
                    className={clsx(
                      'rounded-full',
                      isTypingNow && 'ring-2 ring-green-500',
                      isNext && 'ring-2 ring-amber-400',
                    )}
                  >
                    <CharacterIcon character={p.character} name={p.name} size={36} />
                  </div>
                  <span className="text-xs text-center leading-none truncate w-full">{p.name}</span>
                  {isTypingNow && <span className="text-[10px] text-green-700">typing…</span>}
                  {isNext && <span className="text-[10px] text-amber-700">next</span>}
                </div>
              );
            })}
          </div>
        )}
        {nodes.length > 0 && nodes.map((n) => n.node)}
        {currentlyTyping && currentlyTyping.playerId !== humanPlayerId && (
          <div key="typing" className="leading-tight mb-6">
            <div className="flex gap-2 items-center">
              <CharacterIcon
                character={currentlyTypingDesc?.character}
                name={currentlyTypingName}
                size={28}
              />
              <span className="uppercase flex-grow">{currentlyTypingName}</span>
              <time dateTime={currentlyTyping.since.toString()}>
                {formatGameTimestamp(currentlyTyping.since, worldStartTime)}
              </time>
            </div>
            <div className={clsx('bubble')}>
              <p className="bg-white -mx-3 -my-1">
                <i>typing...</i>
              </p>
            </div>
          </div>
        )}
        {humanPlayer && inConversationWithMe && conversation.kind === 'active' && (
          <MessageInput
            worldId={worldId}
            engineId={engineId}
            conversation={conversation.doc}
            humanPlayer={humanPlayer}
          />
        )}
      </div>
    </div>
  );
}
