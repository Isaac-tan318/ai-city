import { Fragment, useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { SerializedActiveScenario } from '../../convex/aiTown/world';
import { getLocationById } from '../../data/cityLocations';
import { ServerGame } from '../hooks/serverGame';
import { GameId } from '../../convex/aiTown/ids';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
// convex/scoring.ts is pure maths with no Convex imports, so the panel evaluates
// the stopping criteria exactly the way the engine does rather than reimplementing
// the thresholds here and letting the two drift apart.
import { checkStoppingCriteria, describeBlockers, DimensionFactors } from '../../convex/scoring';
import { MAX_FOCAL_QUESTIONS } from '../../convex/constants';
import closeImg from '../../assets/close.svg';

// Find a currently-participating member of the scenario's live conversation, so a
// "view conversation" link can focus it — selecting that player surfaces the chat
// in the details pane. Matches on the scenario's own participant list (works for
// both automatic scenarios and manual town-wide ones). Returns undefined while the
// scenario has no active conversation (e.g. still gathering).
function scenarioConversationTarget(
  game: ServerGame,
  scenario: SerializedActiveScenario,
): GameId<'players'> | undefined {
  const participantIds = new Set<string>(scenario.participantIds);
  for (const conversation of game.world.conversations.values()) {
    for (const [playerId, member] of conversation.participants) {
      if (member.status.kind === 'participating' && participantIds.has(playerId)) {
        return playerId;
      }
    }
  }
  return undefined;
}

function locationName(locationId?: string): string | undefined {
  return locationId ? getLocationById(locationId)?.name : undefined;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Stack of active-scenario chips plus a countdown to the next scenario, rendered
// inside the shared top-right corner stack in Game.tsx. Click a chip to open its
// detail.
export function ScenariosPanel({
  scenarios,
  nextScenarioTime,
  onSelect,
}: {
  scenarios: SerializedActiveScenario[];
  nextScenarioTime?: number;
  onSelect: (id: string) => void;
}) {
  // Re-render once a second so the countdown ticks.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (scenarios.length === 0 && nextScenarioTime === undefined) return null;
  // Universal first, then local — universal events set the tone for the town.
  const ordered = [...scenarios].sort((a, b) =>
    a.scope === b.scope ? 0 : a.scope === 'universal' ? -1 : 1,
  );
  const remaining = nextScenarioTime !== undefined ? nextScenarioTime - nowMs : undefined;
  return (
    <div className="flex flex-col items-end gap-1.5 pointer-events-auto">
      <div className="text-[10px] uppercase tracking-widest text-white/70 font-display shadow-solid pr-1">
        Scenarios
      </div>
      {ordered.map((s) => {
        // Once a local scenario has delegated concrete tasks, count those; otherwise
        // fall back to the talk-based topics.
        const tasks = s.tasks ?? [];
        const itemCount = tasks.length > 0 ? tasks.length : (s.topics ?? []).length;
        const doneCount =
          tasks.length > 0
            ? tasks.filter((t) => t.doneAt).length
            : (s.topicsDone ?? []).filter(Boolean).length;
        const waiting = s.phase === 'waiting';
        const gathering = s.phase === 'gathering';
        const pending = waiting || gathering;
        const complete = !!s.goalMet;
        // A universal scenario enlists a group, not the whole cast (see
        // pickScenarioParticipants), so label it with who's actually in it rather
        // than claiming "town-wide" for something three people are doing.
        const subLabel = waiting
          ? 'Waiting till they’re free…'
          : gathering
            ? 'Gathering…'
            : s.viaText
              ? `📱 Texting · ${s.participantIds.length}`
              : s.scope === 'local'
                ? locationName(s.locationId) ?? 'Local'
                : `${s.participantIds.length} ${s.participantIds.length === 1 ? 'resident' : 'residents'}`;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            title={`${s.name} — click for details`}
            className="group flex items-center gap-2 rounded bg-black/65 hover:bg-black/85 transition-colors pl-2 pr-2.5 py-1.5 max-w-[220px] shadow"
          >
            <span className="text-base leading-none" aria-hidden>
              {s.emoji}
            </span>
            <span className="flex flex-col items-start min-w-0">
              <span className="text-white text-xs font-bold leading-tight truncate max-w-[150px]">
                {s.name}
              </span>
              <span
                className={`text-[10px] leading-tight truncate max-w-[150px] ${
                  pending ? 'text-sky-300/90' : 'text-white/60'
                }`}
              >
                {subLabel}
              </span>
            </span>
            <span className="flex items-center gap-1.5 shrink-0 ml-auto">
              {!pending && itemCount > 0 && (
                <span
                  className={`text-[10px] leading-none tabular-nums ${
                    complete ? 'text-green-300' : 'text-white/65'
                  }`}
                  title={`${doneCount} of ${itemCount} tasks done`}
                >
                  {doneCount}/{itemCount}
                </span>
              )}
              {complete ? (
                <span
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-black leading-none"
                  title="Goal achieved"
                  aria-label="Goal achieved"
                >
                  ✓
                </span>
              ) : (
                <span
                  className="relative flex h-2 w-2"
                  aria-label={waiting ? 'Waiting' : gathering ? 'Gathering' : 'In progress'}
                >
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      pending ? 'bg-sky-400' : 'bg-amber-400'
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      pending ? 'bg-sky-500' : 'bg-amber-500'
                    }`}
                  />
                </span>
              )}
            </span>
          </button>
        );
      })}
      {remaining !== undefined && (
        <div
          className="flex items-center gap-1.5 rounded bg-black/55 pl-2 pr-2.5 py-1 text-white/80"
          title="Time until the next scenario starts"
        >
          <span className="text-xs leading-none" aria-hidden>
            ⏳
          </span>
          <span className="text-[11px] font-mono leading-none tabular-nums">
            {remaining > 0 ? `Next in ${formatCountdown(remaining)}` : 'Next: soon…'}
          </span>
        </div>
      )}
    </div>
  );
}

function DetailSection({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-1">{title}</div>
      <p className="text-brown-100 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

// Small pill summarising the scenario's live status: queued, gathering, in
// progress, or goal achieved.
function StatusBadge({ scenario }: { scenario: SerializedActiveScenario }) {
  const waiting = scenario.phase === 'waiting';
  const gathering = scenario.phase === 'gathering';
  const working = scenario.phase === 'working';
  const complete = !!scenario.goalMet;
  const cls = complete
    ? 'bg-green-500 text-black'
    : waiting || gathering
      ? 'bg-sky-500/20 text-sky-300'
      : 'bg-amber-500/20 text-amber-300';
  const label = complete
    ? 'Goal achieved'
    : waiting
      ? 'Waiting for a free moment'
      : gathering
        ? 'Gathering participants'
        : working
          ? 'Working on tasks'
          : scenario.viaText
            ? 'Texting from work'
            : 'In progress';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}
    >
      <span aria-hidden>
        {complete ? '✓' : waiting ? '🕒' : gathering ? '⏳' : scenario.viaText ? '📱' : '●'}
      </span>
      {label}
    </span>
  );
}

// Percent-complete of a delegated task (0–100), from `startedAt`..`startedAt+durationMs`.
function scenarioTaskProgressPct(
  task: { startedAt?: number; durationMs: number; doneAt?: number },
  now: number,
): number {
  if (task.doneAt) return 100;
  if (task.startedAt === undefined || task.durationMs <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((now - task.startedAt) / task.durationMs) * 100)));
}

// The completion-goal badge + text, shared by the task and topic views.
function GoalRow({
  goal,
  goalMet,
  label = 'Goal',
}: {
  goal: string;
  goalMet: boolean;
  label?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-1.5">{label}</div>
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            goalMet ? 'bg-green-500 text-black' : 'bg-amber-500/20 text-amber-300'
          }`}
        >
          {goalMet ? 'Achieved ✓' : 'In progress'}
        </span>
        <p className="text-brown-100 text-sm leading-relaxed">{goal}</p>
      </div>
    </div>
  );
}

// Structured tasks/goal, driven by live completion tracking. For a local scenario
// that has delegated concrete tasks, shows each task with its assignee and a live
// progress bar; otherwise falls back to the talk-based topics checklist (universal /
// manual scenarios) or the narrative blurb.
function TasksAndGoalSection({ scenario }: { scenario: SerializedActiveScenario }) {
  const tasks = scenario.tasks ?? [];
  const topics = scenario.topics ?? [];
  const goalMet = !!scenario.goalMet;

  // Tick for the live task progress bars (only while there are tasks to animate).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (tasks.length === 0) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [tasks.length]);

  if (tasks.length === 0 && topics.length === 0 && !scenario.completionGoal) {
    return <DetailSection title="Goals & tasks" body={scenario.goals} />;
  }

  // Delegated-tasks view.
  if (tasks.length > 0) {
    const doneCount = tasks.filter((t) => t.doneAt).length;
    return (
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs uppercase tracking-widest text-amber-300/90">Tasks</div>
            <div className="text-[11px] text-brown-300 tabular-nums">
              {doneCount}/{tasks.length} done
            </div>
          </div>
          <ul className="space-y-2">
            {tasks.map((t, i) => {
              const isDone = !!t.doneAt;
              const pct = scenarioTaskProgressPct(t, nowMs);
              return (
                <li key={i} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0" aria-hidden>
                      {t.emoji}
                    </span>
                    <span
                      className={`flex-1 ${isDone ? 'text-brown-300 line-through' : 'text-brown-100'}`}
                    >
                      {t.label}
                    </span>
                    {t.assigneeName && (
                      <span className="shrink-0 text-[11px] text-amber-300/90">
                        {t.assigneeName}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 h-2 w-full rounded overflow-hidden bg-black/30">
                    <div
                      className={`h-full rounded transition-all ${
                        isDone ? 'bg-green-500' : 'bg-amber-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        {scenario.completionGoal && <GoalRow goal={scenario.completionGoal} goalMet={goalMet} />}
      </div>
    );
  }

  // Talk-based topics checklist (universal / manual / decision scenarios). Decision
  // scenarios reframe these as "considerations" leading to a "decision".
  const isDecision = scenario.outcome === 'decision';
  const done = scenario.topicsDone ?? [];
  const doneCount = done.filter(Boolean).length;
  return (
    <div className="space-y-3">
      {topics.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs uppercase tracking-widest text-amber-300/90">
              {isDecision ? 'Considerations' : 'Tasks'}
            </div>
            <div className="text-[11px] text-brown-300 tabular-nums">
              {doneCount}/{topics.length} done
            </div>
          </div>
          <ul className="space-y-1.5">
            {topics.map((t, i) => {
              const isDone = !!done[i];
              return (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none ${
                      isDone ? 'bg-green-500 text-black' : 'border border-brown-400 text-transparent'
                    }`}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className={isDone ? 'text-brown-300 line-through' : 'text-brown-100'}>
                    {t}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {scenario.completionGoal && (
        <GoalRow
          goal={scenario.completionGoal}
          goalMet={goalMet}
          label={isDecision ? 'Decision' : 'Goal'}
        />
      )}
    </div>
  );
}

// --- Decision scenarios: live deliberation + post-hoc scorecard ---------------

// The focal agent's live view: the options on the table, what it currently thinks
// each is worth, and which stopping criterion is still keeping it from committing.
// Reads straight from the world doc via `scenario.deliberation` — no extra query.
function DeliberationSection({ scenario }: { scenario: SerializedActiveScenario }) {
  const deliberation = scenario.deliberation;
  if (!deliberation || deliberation.options.length === 0) return null;

  const nameFor = (playerId: string) => {
    const i = scenario.participantIds.indexOf(playerId);
    return i >= 0 ? scenario.participantNames[i] : undefined;
  };
  const focalName = nameFor(deliberation.focalPlayerId) ?? 'Someone';
  const estimates = deliberation.estimates ?? [];
  const byOption = new Map(estimates.map((e) => [e.optionId, e]));
  const check = checkStoppingCriteria(estimates, deliberation.topScoreHistory ?? []);
  const resolvedId = deliberation.resolvedOptionId;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest text-amber-300/90">Deliberation</div>
        <div className="text-[11px] text-brown-300 tabular-nums">
          {focalName} · {deliberation.questionsAsked ?? 0}/{MAX_FOCAL_QUESTIONS} questions
        </div>
      </div>

      <ul className="space-y-2">
        {deliberation.options.map((option) => {
          const estimate = byOption.get(option.optionId);
          const score = estimate?.estimatedScore;
          const isLeader = !resolvedId && check.top?.optionId === option.optionId;
          const isChosen = resolvedId === option.optionId;
          const riskyNames = (estimate?.riskyForPlayerIds ?? [])
            .map(nameFor)
            .filter((n): n is string => !!n);
          const atRisk = !!estimate?.tabooRisk || riskyNames.length > 0;
          return (
            <li key={option.optionId} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span
                  className={`flex-1 ${isChosen || isLeader ? 'text-brown-100' : 'text-brown-300'}`}
                >
                  {isChosen && <span aria-hidden>✓ </span>}
                  {option.title}
                </span>
                <span className="shrink-0 text-[11px] text-amber-300/90 tabular-nums">
                  {score === undefined ? '—' : score}
                </span>
              </div>
              <div className="mt-1 h-2 w-full rounded overflow-hidden bg-black/30">
                <div
                  className={`h-full rounded transition-all ${
                    isChosen ? 'bg-green-500' : atRisk ? 'bg-red-500/70' : 'bg-amber-400'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }}
                />
              </div>
              {atRisk && (
                <div className="mt-1 text-[11px] text-red-300">
                  ⚠ may break a hard limit
                  {riskyNames.length > 0 ? ` for ${riskyNames.join(', ')}` : ''}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="text-[11px] text-brown-300">
        {resolvedId ? (
          <>
            Committed{deliberation.forcedDecision ? ' (ran out of time to keep asking)' : ''}.
          </>
        ) : estimates.length === 0 ? (
          <>Waiting on {focalName}&rsquo;s first read of the options.</>
        ) : (
          <>
            <span className="text-amber-300/90">Still deciding:</span> {describeBlockers(check)}
          </>
        )}
      </div>
    </div>
  );
}

const DIMENSION_LABELS: { key: keyof DimensionFactors; label: string }[] = [
  { key: 'essentialNeeds', label: 'Need' },
  { key: 'preferenceMatch', label: 'Pref' },
  { key: 'costTimeBurden', label: 'Cost' },
  { key: 'fairness', label: 'Fair' },
  { key: 'socialComfort', label: 'Ease' },
  { key: 'relationshipImpact', label: 'Rel' },
];

// What the choice was actually worth, scored against the hidden ground truth
// nobody in the conversation could see. Appears a few seconds after the group
// commits, once the evaluator has finished.
function ScorecardSection({
  worldId,
  scenario,
}: {
  worldId: Id<'worlds'>;
  scenario: SerializedActiveScenario;
}) {
  const evaluation = useQuery(api.world.evaluationForScenario, {
    worldId,
    scenarioId: scenario.id,
  });
  const resolved = !!scenario.deliberation?.resolvedOptionId;
  if (!resolved && !evaluation) return null;

  if (!evaluation) {
    return (
      <div>
        <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-1.5">
          Ground truth
        </div>
        <p className="text-brown-300 text-sm italic">Scoring the outcome&hellip;</p>
      </div>
    );
  }

  const perfect = evaluation.regret === 0;
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-widest text-amber-300/90">Ground truth</div>

      {/* The headline: how much better they could have done. */}
      <div className={`rounded px-3 py-2 ${perfect ? 'bg-green-900/40' : 'bg-black/30'}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-brown-100">
            {perfect ? 'Best available option' : 'Regret'}
          </span>
          <span className="text-lg font-bold tabular-nums text-amber-300">
            {perfect ? '0' : `−${evaluation.regret}`}
          </span>
        </div>
        <div className="text-[11px] text-brown-300 mt-0.5">
          Chose {evaluation.selectedOptionTitle} at {evaluation.aggregatedGroupUtility}/100
          {perfect ? '' : `; ${evaluation.bestOptionTitle} would have scored ${evaluation.bestGroupUtility}`}
          {evaluation.forcedDecision ? ' · decided on the clock' : ''}
        </div>
      </div>

      {/* True group utility per option. */}
      <ul className="space-y-1.5">
        {evaluation.optionScores.map((option) => {
          const isChosen = option.optionId === evaluation.selectedOptionId;
          const isBest = option.optionId === evaluation.bestOptionId;
          return (
            <li key={option.optionId} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className={`flex-1 ${isChosen ? 'text-brown-100' : 'text-brown-300'}`}>
                  {option.title}
                  {isBest && <span className="text-green-400"> ★</span>}
                  {isChosen && <span className="text-amber-300/90"> (chosen)</span>}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-amber-300/90">
                  {option.groupUtility}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded overflow-hidden bg-black/30">
                <div
                  className={`h-full rounded ${isBest ? 'bg-green-500' : 'bg-amber-400/60'}`}
                  style={{ width: `${Math.max(0, Math.min(100, option.groupUtility))}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {/* Per-person breakdown for the option they actually took. */}
      <div>
        <div className="text-[11px] text-brown-300 mb-1.5">
          How {evaluation.selectedOptionTitle} scored for each of them:
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-brown-300">
                <th className="text-left font-normal pb-1">Who</th>
                <th className="text-right font-normal pb-1 pr-2">U</th>
                {DIMENSION_LABELS.map((d) => (
                  <th key={d.key} className="text-right font-normal pb-1 pl-1.5">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {evaluation.agentScores.map((agent) => (
                <Fragment key={agent.playerId}>
                  <tr className={agent.hardTabooViolated ? 'text-red-300' : 'text-brown-100'}>
                    <td className="text-left py-0.5">
                      {agent.name}
                      {agent.hardTabooViolated && <span aria-hidden> ⛔</span>}
                    </td>
                    <td className="text-right pr-2">{agent.totalIndividualUtility}</td>
                    {DIMENSION_LABELS.map((d) => (
                      <td key={d.key} className="text-right pl-1.5 text-brown-300">
                        {agent.dimensionFactors[d.key]}
                      </td>
                    ))}
                  </tr>
                  {/* The evaluator's own one-line account of what drove this score.
                      The numbers say how much; this says why. It already comes back
                      with every evaluation (see convex/evaluator.ts), so showing it
                      costs nothing extra. */}
                  {agent.reason && (
                    <tr>
                      <td
                        colSpan={2 + DIMENSION_LABELS.length}
                        className={`pb-1.5 pl-2 text-left text-[10px] font-normal leading-snug ${
                          agent.hardTabooViolated ? 'text-red-300/80' : 'text-brown-300'
                        }`}
                      >
                        {agent.reason}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {evaluation.agentScores
          .filter((a) => a.hardTabooViolated)
          .map((a) => (
            <div key={a.playerId} className="mt-1.5 text-[11px] text-red-300">
              ⛔ {a.name}: {a.violatedTaboo ?? 'a hard limit was overridden'}
            </div>
          ))}
      </div>
    </div>
  );
}

// Full detail modal for one active scenario.
export function ScenarioDetail({
  scenario,
  game,
  worldId,
  onClose,
  onViewConversation,
}: {
  scenario: SerializedActiveScenario;
  game: ServerGame;
  worldId: Id<'worlds'>;
  onClose: () => void;
  onViewConversation: (playerId: GameId<'players'>) => void;
}) {
  const loc = locationName(scenario.locationId);
  const conversationTarget = scenarioConversationTarget(game, scenario);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-brown-800 text-brown-100 w-[96vw] max-w-[640px] max-h-[90vh] flex flex-col box overflow-hidden">
        {/* Header */}
        <div className="bg-brown-700 px-5 py-4 flex items-start gap-3 shrink-0">
          <span className="text-3xl leading-none" aria-hidden>
            {scenario.emoji}
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display tracking-widest text-lg uppercase shadow-solid leading-tight">
              {scenario.name}
            </h2>
            <div className="text-xs text-brown-300 mt-0.5">
              {scenario.viaText
                ? `📱 Group text · ${scenario.participantIds.length} of the town, sorting it out from work`
                : scenario.scope === 'local'
                  ? `Local scenario${loc ? ` · ${loc}` : ''}`
                  : `Group scenario · ${scenario.participantIds.length} of the town`}
            </div>
            <div className="mt-1.5">
              <StatusBadge scenario={scenario} />
            </div>
          </div>
          <button
            className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto shrink-0"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            <span className="block h-full bg-clay-700">
              <img className="w-4 h-4" src={closeImg} alt="Close" />
            </span>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {/* Participants */}
          <div>
            <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-1.5">
              Participants
            </div>
            {scenario.participantNames.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {scenario.participantNames.map((n, i) => (
                  <span
                    key={i}
                    className="bg-brown-900 text-brown-100 text-xs rounded-full px-2.5 py-1"
                  >
                    {n}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-brown-300 text-sm italic">No participants yet.</p>
            )}
          </div>

          {/* Jump to the scenario's live conversation. */}
          {conversationTarget ? (
            <button
              type="button"
              onClick={() => onViewConversation(conversationTarget)}
              className="w-full flex items-center justify-center gap-2 rounded bg-clay-700 hover:bg-clay-600 transition-colors text-white px-3 py-2 text-sm font-bold cursor-pointer pointer-events-auto"
            >
              <span aria-hidden>💬</span> View the conversation
            </button>
          ) : (
            <p className="text-brown-300 text-xs italic text-center">
              No live conversation yet — participants are{' '}
              {scenario.viaText
                ? 'about to open the group text'
                : scenario.phase === 'waiting'
                ? 'asleep or on shift; this starts once they’re free'
                : scenario.phase === 'gathering'
                  ? 'still gathering'
                  : 'still getting started'}
              .
            </p>
          )}

          <TasksAndGoalSection scenario={scenario} />
          <DeliberationSection scenario={scenario} />
          <ScorecardSection worldId={worldId} scenario={scenario} />
          {scenario.conflict && (
            <DetailSection title="Where they disagree" body={scenario.conflict} />
          )}
          <DetailSection title="What's happening" body={scenario.whatHappens} />
          <DetailSection title="Background" body={scenario.background} />
          <DetailSection title="Relationships" body={scenario.relationships} />
          <DetailSection title="Current context" body={scenario.context} />
        </div>
      </div>
    </div>
  );
}
