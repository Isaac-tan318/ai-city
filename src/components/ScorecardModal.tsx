import { useQuery } from 'convex/react';
import { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import closeImg from '../../assets/close.svg';
import { CharacterIcon } from './CharacterIcon';
import { UTILITY_WEIGHTS } from '../../convex/scoring';

// The end-of-scenario scorecard: what the group actually chose, and what it was
// worth to each person once the Evaluator scored it against their hidden
// constraints.
//
// The per-resident bar is the utility formula drawn to scale. Each segment is one
// dimension's weighted contribution (35 x essential, 20 x preference, 15 x cost,
// 15 x fairness, 10 x comfort, 5 x relationship), so the bar's total length IS the
// satisfaction score — you read both the result and its composition from the same
// mark. A hard taboo zeroes the whole score, so that row shows no bar at all;
// drawing a stub would imply partial credit the formula does not give.

// Slots 1-6 of the reference categorical palette, stepped for a dark surface and
// validated as a set against this modal's #181425 rows: lightness band, chroma
// floor, adjacent CVD separation (worst 8.4), normal-vision floor (worst 19.3),
// and >= 3:1 contrast all pass.
const DIMENSIONS = [
  { key: 'essentialNeeds', label: 'Essential needs', color: '#3987e5' },
  { key: 'preferenceMatch', label: 'Preference match', color: '#008300' },
  { key: 'costTimeBurden', label: 'Cost & time', color: '#d55181' },
  { key: 'fairness', label: 'Fairness', color: '#c98500' },
  { key: 'socialComfort', label: 'Social comfort', color: '#199e70' },
  { key: 'relationshipImpact', label: 'Relationships', color: '#d95926' },
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]['key'];

export type ScorecardEvaluation = {
  _id: string;
  scenarioId: string;
  scenarioName: string;
  focalName: string;
  selectedOptionTitle: string;
  aggregatedGroupUtility: number;
  bestOptionTitle: string;
  bestGroupUtility: number;
  regret: number;
  questionsAsked: number;
  forcedDecision: boolean;
  commentary: string;
  agentScores: {
    playerId: string;
    name: string;
    hardTabooViolated: boolean;
    violatedTaboo?: string;
    reason?: string;
    dimensionFactors: Record<DimensionKey, number>;
    totalIndividualUtility: number;
  }[];
};

function satisfactionTone(score: number): string {
  if (score >= 75) return 'text-green-400';
  if (score >= 50) return 'text-amber-300';
  return 'text-red-300';
}

function ResidentRow({
  score,
  character,
}: {
  score: ScorecardEvaluation['agentScores'][number];
  character: string | null;
}) {
  const violated = score.hardTabooViolated;
  return (
    <li className="bg-brown-900 rounded px-3 py-3">
      <div className="flex items-start gap-3">
        <CharacterIcon character={character} name={score.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="flex-1 text-sm font-bold text-brown-100 truncate">{score.name}</span>
            <span
              className={`shrink-0 text-lg font-bold tabular-nums ${
                violated ? 'text-red-400' : satisfactionTone(score.totalIndividualUtility)
              }`}
            >
              {Math.round(score.totalIndividualUtility)}%
            </span>
          </div>

          {violated ? (
            <div className="mt-1.5 flex items-start gap-1.5 rounded bg-red-500/15 border border-red-500/40 px-2 py-1.5">
              <span aria-hidden="true" className="text-sm leading-none mt-0.5">
                ❌
              </span>
              <span className="text-xs text-red-200">
                <span className="font-bold uppercase tracking-wide">Hard taboo violated</span>
                {score.violatedTaboo ? `: ${score.violatedTaboo}` : ''}
              </span>
            </div>
          ) : (
            <div
              className="mt-2 flex h-3 w-full items-stretch overflow-hidden rounded-sm"
              role="img"
              aria-label={`${score.name} scored ${Math.round(
                score.totalIndividualUtility,
              )} out of 100`}
            >
              {DIMENSIONS.map((dimension, i) => {
                const factor = score.dimensionFactors[dimension.key] ?? 0;
                const points = UTILITY_WEIGHTS[dimension.key] * factor;
                if (points <= 0) return null;
                const isLast = DIMENSIONS.slice(i + 1).every(
                  (d) => (UTILITY_WEIGHTS[d.key] * (score.dimensionFactors[d.key] ?? 0)) <= 0,
                );
                return (
                  <div
                    key={dimension.key}
                    // 2px surface gap between segments, and a rounded data-end on
                    // the last one so the bar reads as a single measured length.
                    style={{
                      width: `${points}%`,
                      background: dimension.color,
                      marginRight: isLast ? 0 : 2,
                      borderTopRightRadius: isLast ? 4 : 0,
                      borderBottomRightRadius: isLast ? 4 : 0,
                    }}
                    title={`${dimension.label}: ${factor} × ${
                      UTILITY_WEIGHTS[dimension.key]
                    } = ${Math.round(points * 10) / 10} pts`}
                  />
                );
              })}
            </div>
          )}

          {score.reason && (
            <p className="mt-1.5 text-xs text-brown-300">{score.reason}</p>
          )}
        </div>
      </div>
    </li>
  );
}

export function ScorecardModal({
  worldId,
  evaluation,
  onClose,
}: {
  worldId: Id<'worlds'>;
  evaluation: ScorecardEvaluation;
  onClose: () => void;
}) {
  const descriptions = useQuery(api.world.gameDescriptions, { worldId });
  const characterOf = (playerId: string) =>
    descriptions?.playerDescriptions.find((d) => d.playerId === playerId)?.character ?? null;

  const violations = evaluation.agentScores.filter((s) => s.hardTabooViolated);
  const sorted = [...evaluation.agentScores].sort(
    (a, b) => a.totalIndividualUtility - b.totalIndividualUtility,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6 pointer-events-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-brown-800 text-brown-100 w-[96vw] max-w-[720px] max-h-[92vh] flex flex-col box overflow-hidden">
        {/* Header */}
        <div className="bg-brown-700 px-4 py-3 flex items-center gap-2 shrink-0">
          <h2 className="font-display tracking-widest text-lg flex-1 uppercase shadow-solid">
            Scorecard
          </h2>
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

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* What they chose, and what it was worth. */}
          <div>
            <div className="text-xs uppercase tracking-widest text-brown-400">
              {evaluation.scenarioName} · {evaluation.focalName} decided
            </div>
            <div className="mt-1 flex items-end gap-3">
              <h3 className="flex-1 text-xl font-bold text-brown-100 leading-tight">
                {evaluation.selectedOptionTitle}
              </h3>
              <div className="shrink-0 text-right">
                <div
                  className={`text-3xl font-bold tabular-nums leading-none ${satisfactionTone(
                    evaluation.aggregatedGroupUtility,
                  )}`}
                >
                  {Math.round(evaluation.aggregatedGroupUtility)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-brown-400">
                  group score
                </div>
              </div>
            </div>
            <p className="mt-1 text-xs text-brown-300">
              After {evaluation.questionsAsked} question
              {evaluation.questionsAsked === 1 ? '' : 's'}
              {evaluation.forcedDecision ? ' (forced by the clock)' : ''}.{' '}
              {evaluation.regret === 0 ? (
                <span className="text-green-400">Best available choice.</span>
              ) : (
                <>
                  <span className="text-brown-200">{evaluation.bestOptionTitle}</span> would have
                  scored {Math.round(evaluation.bestGroupUtility)} — regret{' '}
                  <span className="text-amber-300 tabular-nums">{evaluation.regret}</span>.
                </>
              )}
            </p>
          </div>

          {violations.length > 0 && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2">
              <p className="text-xs text-red-200">
                <span className="font-bold uppercase tracking-wide">
                  {violations.length} hard limit{violations.length === 1 ? '' : 's'} broken
                </span>{' '}
                — {violations.map((v) => v.name).join(', ')} scored zero regardless of everything
                else this option got right.
              </p>
            </div>
          )}

          {/* Per-resident breakdown, worst first — the failures are the point. */}
          <ul className="space-y-2">
            {sorted.map((score) => (
              <ResidentRow
                key={score.playerId}
                score={score}
                character={characterOf(score.playerId)}
              />
            ))}
          </ul>

          {/* Legend: identity is never carried by color alone. */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-brown-400 mb-1.5">
              Bar segments — weighted contribution to the score
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {DIMENSIONS.map((dimension) => (
                <li key={dimension.key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ background: dimension.color }}
                  />
                  <span className="text-[11px] text-brown-300">
                    {dimension.label}{' '}
                    <span className="text-brown-400 tabular-nums">
                      ×{UTILITY_WEIGHTS[dimension.key]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {evaluation.commentary && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-brown-400 mb-1">
                Evaluator notes
              </div>
              <p className="text-xs text-brown-300 whitespace-pre-line leading-relaxed">
                {evaluation.commentary}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
