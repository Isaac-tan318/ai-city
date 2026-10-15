import { useAction } from 'convex/react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import { GameId } from '../../convex/aiTown/ids';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { toast } from 'react-toastify';

// Ask a character questions without joining their world.
//
// This is not a conversation: nothing here is sent to the engine, so the agent
// is not pulled off their schedule, nothing is written to their memory and their
// feelings about anyone are unchanged. The transcript below lives in this
// component's state and nowhere else — it is handed back to the server with each
// question purely so the character can follow the thread, and it is gone the
// moment the panel closes. See convex/interview.ts for the server half.
type Turn = { role: 'interviewer' | 'subject'; text: string };

// A few openers, so the panel isn't a blank box with a cursor in it.
const SUGGESTIONS = [
  'Tell me about yourself.',
  'How has your week been?',
  'Who around here do you trust most, and why?',
  'What would you change about your life if you could?',
];

export function InterviewPopup({
  worldId,
  playerId,
  name,
  escapeEnabled = true,
  onClose,
}: {
  worldId: Id<'worlds'>;
  playerId: GameId<'players'>;
  name: string;
  // False while something is stacked on top, so one Esc doesn't close both.
  escapeEnabled?: boolean;
  onClose: () => void;
}) {
  useEscapeKey(onClose, escapeEnabled);
  const ask = useAction(api.interview.ask);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Stick to the newest answer as the interview grows.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [turns, pending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    // The history the server sees is the transcript as it stood BEFORE this
    // question, which is exactly what's on screen.
    const history = turns;
    setTurns([...history, { role: 'interviewer', text: trimmed }]);
    setQuestion('');
    setPending(true);
    try {
      const { answer } = await ask({ worldId, playerId, question: trimmed, history });
      setTurns((t) => [...t, { role: 'subject', text: answer }]);
    } catch (error: any) {
      toast.error(error.message);
      // Put the question back in the box rather than losing what they typed.
      setTurns(history);
      setQuestion(trimmed);
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Esc belongs to the popup, and every other key to the textarea — without
    // this the map's own keyboard handlers see whatever is typed here.
    if (e.key !== 'Escape') e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(question);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-6 pointer-events-none">
      <div
        className="pointer-events-auto bg-brown-800 text-brown-100 w-[96vw] max-w-[760px] h-[80vh] flex flex-col box overflow-hidden shadow-2xl"
        role="dialog"
        aria-label={`Interview: ${name}`}
      >
        {/* Header */}
        <div className="bg-brown-700 px-4 py-3 flex items-center gap-3 shrink-0">
          <h2 className="font-display tracking-widest text-lg flex-1 uppercase shadow-solid truncate">
            <span aria-hidden className="mr-2">
              🎤
            </span>
            Interview: {name}
          </h2>
          <span className="shrink-0 text-[10px] uppercase tracking-widest rounded-full bg-black/30 px-2 py-1 text-brown-300">
            off the record
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

        {/* Transcript */}
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          <p className="text-[11px] leading-snug text-white/50">
            Ask {name} anything. They answer in character, from what they know and how they
            currently feel — but this happens outside the simulation: {name} won&rsquo;t remember it,
            it won&rsquo;t interrupt their day, and it changes nothing about them. Close the panel
            and the interview is gone.
          </p>
          {turns.length === 0 && !pending && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-widest text-amber-300/90">
                Try asking
              </div>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="text-left rounded border border-amber-200/20 bg-black/20 px-3 py-2 text-sm text-white/75 hover:border-amber-300/60 hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {turns.map((turn, i) => (
            <div
              key={i}
              className={turn.role === 'interviewer' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={
                  'max-w-[80%] rounded px-3 py-2 text-sm leading-snug whitespace-pre-wrap ' +
                  (turn.role === 'interviewer'
                    ? 'bg-clay-700 text-white'
                    : 'bg-brown-900 text-white/85')
                }
              >
                <div className="mb-1 text-[10px] uppercase tracking-widest text-white/40">
                  {turn.role === 'interviewer' ? 'You' : name}
                </div>
                {turn.text}
              </div>
            </div>
          ))}
          {pending && (
            <div className="flex justify-start">
              <div className="rounded bg-brown-900 px-3 py-2 text-sm text-white/50">
                {name} is thinking…
              </div>
            </div>
          )}
        </div>

        {/* Ask box */}
        <div className="shrink-0 border-t border-white/10 p-3 flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder={`Ask ${name} a question…`}
              className="flex-1 resize-none rounded border border-amber-200/25 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-amber-300"
            />
            <button
              type="button"
              onClick={() => void send(question)}
              disabled={pending || !question.trim()}
              className="button min-w-0 text-white shadow-solid text-sm cursor-pointer pointer-events-auto disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="h-full flex items-center bg-clay-700 px-4 py-2">
                {pending ? 'Asking…' : 'Ask'}
              </div>
            </button>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-white/40">
            <span>Enter to ask · Shift+Enter for a new line</span>
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => setTurns([])}
                disabled={pending}
                className="ml-auto uppercase tracking-widest hover:text-white/70 disabled:opacity-40"
              >
                Start over
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
