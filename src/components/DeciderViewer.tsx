import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import closeImg from '../../assets/close.svg';

// The Decider's working: how it framed each group decision before anyone spoke,
// and what it has since worked out about the people involved.
//
// Two things are worth seeing side by side here. The framing is written with only
// public knowledge — the Decider is never shown data/groundTruth.ts — so its
// "riskNote" guess at who an option won't suit is a genuine prediction. The
// evaluator later scores the same option against the hidden truth. Where those two
// disagree is where the interesting failures live.

type Trace = {
  _id: string;
  scenarioId: string;
  scenarioName: string;
  participantNames: string[];
  reasoning: string;
  options: {
    optionId: string;
    title: string;
    details: string;
    rationale: string;
    riskNote: string;
  }[];
  at: number;
};

type Evaluation = {
  scenarioId: string;
  selectedOptionId: string;
  selectedOptionTitle: string;
  aggregatedGroupUtility: number;
  bestOptionId: string;
  bestOptionTitle: string;
  bestGroupUtility: number;
  regret: number;
  questionsAsked: number;
  forcedDecision: boolean;
  focalName: string;
  optionScores: { optionId: string; title: string; groupUtility: number }[];
  agentScores: { name: string; hardTabooViolated: boolean; violatedTaboo?: string }[];
};

// Did the Decider name the person whose hard limit the group's choice actually
// broke? A substring match on the free-text riskNote — good enough to be
// informative, not good enough to present as anything but a heuristic, which is
// why the UI says "named ... in advance" rather than claiming a score.
function warnedAbout(riskNote: string, names: string[]): boolean {
  const note = riskNote.toLowerCase();
  return names.some((n) => note.includes(n.toLowerCase()));
}

function relativeTime(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SummaryStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-brown-900 rounded px-3 py-2 min-w-[9rem]">
      <div className="text-lg font-bold text-amber-300 tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] text-brown-300 uppercase tracking-wider">{label}</div>
      {hint && <div className="text-[10px] text-brown-400 mt-0.5">{hint}</div>}
    </div>
  );
}

// One framing: the reasoning, the options with their rationale, and — once the
// evaluator has run — what each option was actually worth.
function TraceDetail({ trace, evaluation }: { trace: Trace; evaluation?: Evaluation }) {
  const scoreFor = (optionId: string) =>
    evaluation?.optionScores.find((o) => o.optionId === optionId)?.groupUtility;
  const violatedNames =
    evaluation?.agentScores.filter((a) => a.hardTabooViolated).map((a) => a.name) ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-display uppercase tracking-widest text-sm text-brown-200">
          {trace.scenarioName}
        </h3>
        <div className="text-xs text-brown-400 mt-0.5">
          {trace.participantNames.join(', ') || 'no participants recorded'} ·{' '}
          {relativeTime(trace.at)}
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-1.5">
          How it framed the choice
        </div>
        {trace.reasoning ? (
          <p className="text-sm text-brown-100 leading-relaxed">{trace.reasoning}</p>
        ) : (
          <p className="text-sm text-brown-300 italic">
            No reasoning recorded — this framing predates the trace, or generation fell back to the
            scenario&rsquo;s authored talking points.
          </p>
        )}
      </div>

      <div>
        <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-2">
          Options it put on the table
        </div>
        <ul className="space-y-3">
          {trace.options.map((option) => {
            const trueScore = scoreFor(option.optionId);
            const isChosen = evaluation?.selectedOptionId === option.optionId;
            const isBest = evaluation?.bestOptionId === option.optionId;
            // Only the chosen option gets a per-person breakdown from the
            // evaluator, so a warning can only be checked against that one.
            const warned = isChosen && violatedNames.length > 0
              ? warnedAbout(option.riskNote, violatedNames)
              : undefined;
            return (
              <li key={option.optionId} className="bg-brown-900 rounded px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 text-sm text-brown-100 font-bold">
                    {option.title}
                    {isBest && <span className="text-green-400 font-normal"> ★ best</span>}
                    {isChosen && (
                      <span className="text-amber-300/90 font-normal"> · they chose this</span>
                    )}
                  </span>
                  {trueScore !== undefined && (
                    <span
                      className="shrink-0 text-xs tabular-nums text-amber-300"
                      title="True group utility, scored against hidden ground truth"
                    >
                      {trueScore}
                    </span>
                  )}
                </div>
                <p className="text-xs text-brown-300 mt-1">{option.details}</p>
                {option.rationale && (
                  <p className="text-xs text-brown-200 mt-1.5">
                    <span className="text-brown-400">Why: </span>
                    {option.rationale}
                  </p>
                )}
                {option.riskNote && (
                  <p className="text-xs text-brown-200 mt-1">
                    <span className="text-brown-400">Suspected it wouldn&rsquo;t suit: </span>
                    {option.riskNote}
                  </p>
                )}
                {warned === true && (
                  <p className="text-xs text-green-400 mt-1.5">
                    ✓ It named {violatedNames.join(', ')} in advance — and that limit was the one
                    the group broke.
                  </p>
                )}
                {warned === false && (
                  <p className="text-xs text-red-300 mt-1.5">
                    ✗ It never flagged {violatedNames.join(', ')}, whose hard limit this broke.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {evaluation ? (
        <div className="bg-brown-900 rounded px-3 py-2.5">
          <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-1">Outcome</div>
          <p className="text-sm text-brown-100">
            {evaluation.focalName} committed to{' '}
            <span className="font-bold">{evaluation.selectedOptionTitle}</span> after{' '}
            {evaluation.questionsAsked} question{evaluation.questionsAsked === 1 ? '' : 's'}
            {evaluation.forcedDecision ? ' (on the clock)' : ''}, scoring{' '}
            <span className="tabular-nums">{evaluation.aggregatedGroupUtility}</span>/100.
          </p>
          <p className="text-xs text-brown-300 mt-1">
            {evaluation.regret === 0 ? (
              <span className="text-green-400">
                That was the best option this framing offered.
              </span>
            ) : (
              <>
                {evaluation.bestOptionTitle} would have scored{' '}
                <span className="tabular-nums">{evaluation.bestGroupUtility}</span> — regret{' '}
                <span className="text-amber-300 tabular-nums">{evaluation.regret}</span>.
              </>
            )}
          </p>
        </div>
      ) : (
        <p className="text-sm text-brown-300 italic">
          Not yet scored — the evaluator runs once the group commits.
        </p>
      )}
    </div>
  );
}

// What each focal agent has actually managed to infer, and what it still doesn't
// know. Sorted least-confident first: the top of each list is what its next
// question should be about.
function BeliefsTab({ worldId }: { worldId: Id<'worlds'> }) {
  const beliefs = useQuery(api.decider.deciderBeliefs, { worldId });

  if (!beliefs) {
    return <div className="py-8 text-center text-brown-300 italic text-sm">Loading&hellip;</div>;
  }
  if (beliefs.length === 0) {
    return (
      <div className="py-8 text-center text-brown-300 italic text-sm">
        Nothing learned yet. Beliefs are built up from what people say during a decision scenario.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <p className="text-xs text-brown-400">
        What each organiser has worked out from conversation alone. They are never shown anyone&rsquo;s
        real constraints — an empty list means nobody has mentioned one, not that none exists.
      </p>
      {beliefs.map((focal) => (
        <div key={focal.focalPlayerId}>
          <h3 className="font-display uppercase tracking-widest text-sm text-brown-200 mb-2">
            What {focal.focalName} has figured out
          </h3>
          <ul className="space-y-2">
            {focal.targets.map((t) => (
              <li key={t.targetPlayerId} className="bg-brown-900 rounded px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 text-sm text-brown-100 font-bold">{t.targetName}</span>
                  <span
                    className="shrink-0 text-[11px] text-brown-300 tabular-nums"
                    title="How well it believes it understands this person"
                  >
                    {Math.round(t.confidenceScore * 100)}% sure
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 w-full rounded overflow-hidden bg-black/40"
                  role="meter"
                  aria-valuenow={Math.round(t.confidenceScore * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Confidence in understanding ${t.targetName}`}
                >
                  <div
                    className="h-full rounded bg-amber-400"
                    style={{ width: `${Math.round(t.confidenceScore * 100)}%` }}
                  />
                </div>
                <dl className="mt-2 space-y-1 text-xs">
                  <div>
                    <dt className="inline text-brown-400">Hard limits it knows of: </dt>
                    <dd className="inline text-brown-100">
                      {t.knownTaboos.length ? t.knownTaboos.join('; ') : 'none mentioned'}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-brown-400">What they seem to want: </dt>
                    <dd className="inline text-brown-100">
                      {t.knownPreferences.length ? t.knownPreferences.join('; ') : 'nothing yet'}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-brown-400">Still unclear: </dt>
                    <dd className="inline text-brown-200">
                      {t.uncertainties.length ? t.uncertainties.join('; ') : 'nothing flagged'}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function DeciderViewer({
  worldId,
  onClose,
}: {
  worldId: Id<'worlds'>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'framings' | 'beliefs'>('framings');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const traces = useQuery(api.decider.recentDeciderTraces, { worldId, limit: 50 }) as
    | Trace[]
    | undefined;
  const evaluations = useQuery(api.world.recentEvaluations, { worldId, limit: 50 }) as
    | Evaluation[]
    | undefined;

  const evaluationByScenario = useMemo(() => {
    const map = new Map<string, Evaluation>();
    for (const e of evaluations ?? []) {
      if (!map.has(e.scenarioId)) map.set(e.scenarioId, e);
    }
    return map;
  }, [evaluations]);

  // Aggregate across every framing that has since been scored.
  const summary = useMemo(() => {
    if (!traces) return undefined;
    const optionCount = traces.reduce((acc, t) => acc + t.options.length, 0);
    let scored = 0;
    let regretTotal = 0;
    let breaks = 0;
    let breaksWarned = 0;
    for (const trace of traces) {
      const evaluation = evaluationByScenario.get(trace.scenarioId);
      if (!evaluation) continue;
      scored++;
      regretTotal += evaluation.regret;
      const violated = evaluation.agentScores
        .filter((a) => a.hardTabooViolated)
        .map((a) => a.name);
      if (violated.length === 0) continue;
      breaks++;
      const chosen = trace.options.find((o) => o.optionId === evaluation.selectedOptionId);
      if (chosen && warnedAbout(chosen.riskNote, violated)) breaksWarned++;
    }
    return {
      framings: traces.length,
      optionCount,
      scored,
      meanRegret: scored ? Math.round((regretTotal / scored) * 100) / 100 : undefined,
      breaks,
      breaksWarned,
    };
  }, [traces, evaluationByScenario]);

  const selected = traces?.find((t) => t._id === selectedId) ?? traces?.[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6 pointer-events-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-brown-800 text-brown-100 w-[96vw] h-[92vh] max-w-[1200px] flex flex-col box overflow-hidden">
        {/* Header */}
        <div className="bg-brown-700 px-4 py-3 flex items-center gap-2 shrink-0">
          <h2 className="font-display tracking-widest text-lg flex-1 uppercase shadow-solid">
            Decider
          </h2>
          <button
            type="button"
            onClick={() => setTab('framings')}
            className={`button text-white shadow-solid text-sm cursor-pointer pointer-events-auto ${
              tab === 'framings' ? '' : 'opacity-60'
            }`}
          >
            <div className="h-full bg-clay-700 flex items-center px-3">Framings</div>
          </button>
          <button
            type="button"
            onClick={() => setTab('beliefs')}
            className={`button text-white shadow-solid text-sm cursor-pointer pointer-events-auto ${
              tab === 'beliefs' ? '' : 'opacity-60'
            }`}
          >
            <div className="h-full bg-clay-700 flex items-center px-3">Beliefs</div>
          </button>
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

        {/* Summary strip */}
        {summary && summary.framings > 0 && (
          <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-brown-700 shrink-0">
            <SummaryStat label="Decisions framed" value={String(summary.framings)} />
            <SummaryStat
              label="Options written"
              value={String(summary.optionCount)}
              hint={`across ${summary.framings} framing${summary.framings === 1 ? '' : 's'}`}
            />
            <SummaryStat
              label="Mean regret"
              value={summary.meanRegret === undefined ? '—' : String(summary.meanRegret)}
              hint={`${summary.scored} scored`}
            />
            <SummaryStat
              label="Hard limits broken"
              value={
                summary.breaks === 0 ? '0' : `${summary.breaksWarned}/${summary.breaks} foreseen`
              }
              hint={summary.breaks === 0 ? 'none so far' : 'named before the choice'}
            />
          </div>
        )}

        {/* Body */}
        {tab === 'beliefs' ? (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <BeliefsTab worldId={worldId} />
          </div>
        ) : !traces ? (
          <div className="flex-1 flex items-center justify-center text-brown-300 italic text-sm">
            Loading&hellip;
          </div>
        ) : traces.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-8 text-center text-brown-300 italic text-sm">
            No decisions framed yet. The Decider writes the options whenever a scenario with a
            group decision starts.
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* Scenario list */}
            <div className="w-64 shrink-0 border-r border-brown-700 overflow-y-auto">
              {traces.map((trace) => {
                const evaluation = evaluationByScenario.get(trace.scenarioId);
                const isSelected = selected?._id === trace._id;
                return (
                  <button
                    key={trace._id}
                    type="button"
                    onClick={() => setSelectedId(trace._id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-brown-700/60 transition-colors ${
                      isSelected ? 'bg-brown-700' : 'hover:bg-brown-700/50'
                    }`}
                  >
                    <div className="text-sm text-brown-100 truncate">{trace.scenarioName}</div>
                    <div className="text-[11px] text-brown-400 mt-0.5 flex items-center gap-1.5">
                      <span>{relativeTime(trace.at)}</span>
                      <span>·</span>
                      <span>{trace.options.length} options</span>
                      {evaluation && (
                        <>
                          <span>·</span>
                          <span
                            className={
                              evaluation.regret === 0 ? 'text-green-400' : 'text-amber-300'
                            }
                          >
                            {evaluation.regret === 0 ? 'optimal' : `−${evaluation.regret}`}
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Detail */}
            <div className="flex-1 overflow-y-auto px-5 py-4 min-w-0">
              {selected && (
                <TraceDetail
                  trace={selected}
                  evaluation={evaluationByScenario.get(selected.scenarioId)}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
