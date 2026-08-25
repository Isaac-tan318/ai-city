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
  chatFrame = true,
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
  // The sidebar wants the `.chats` pixel frame; the popup supplies its own `box`
  // frame and opts out so the two don't nest.
  chatFrame?: boolean;
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

  // Chats open at the newest line; this flips to false as soon as the reader
  // scrolls up, which stops new messages from yanking them back down.
  const isScrolledToBottom = useRef(true);
  const lastAutoScroll = useRef(0);
  useEffect(() => {
    // Read the ref inside the effect: on the first render the container hasn't
    // been attached yet, so a render-time read would miss it.
    const scrollView = scrollViewRef.current;
    if (!scrollView) return undefined;

    const onScroll = () => {
      // Ignore the events our own pin generates. They land mid-relayout — when a
      // typing bubble is removed, say — and read as "the reader scrolled up",
      // which would silently stop the chat following along.
      if (Date.now() - lastAutoScroll.current < 150) return;
      isScrolledToBottom.current =
        scrollView.scrollHeight - scrollView.scrollTop - 50 <= scrollView.clientHeight;
    };
    scrollView.addEventListener('scroll', onScroll);
    return () => scrollView.removeEventListener('scroll', onScroll);
  }, [scrollViewRef]);
  useEffect(() => {
    const scrollView = scrollViewRef.current;
    if (!scrollView || !isScrolledToBottom.current) return;
    // Instant, not smooth. A smooth scroll issued in the same commit the
    // transcript first lays out is dropped outright, and later ones cancel each
    // other — the typing indicator refires this effect faster than an animation
    // can finish — which left the chat stranded wherever it started.
    lastAutoScroll.current = Date.now();
    scrollView.scrollTo({ top: scrollView.scrollHeight });
    // `conversation.kind` too: when a live chat ends it swaps to its archived
    // form and loses the roster, which shortens the thread under the reader.
  }, [messages, currentlyTyping, conversation.kind]);

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

  // A text thread reads very differently from a face-to-face chat — nobody is in
  // the same place — so say so at the top rather than leaving it to be inferred
  // from the dialogue. Works for archived threads too (the flag is persisted).
  const isTextThread = !!conversation.doc.isText;

  return (
    <div className={clsx(chatFrame && 'chats', 'text-base sm:text-sm')}>
      <div className="bg-brown-200 text-black p-2">
        {isTextThread && (
          <div className="flex items-center justify-center gap-1.5 mb-3 text-[11px] uppercase tracking-widest text-brown-700">
            <span aria-hidden>📱</span> Group text
          </div>
        )}
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
