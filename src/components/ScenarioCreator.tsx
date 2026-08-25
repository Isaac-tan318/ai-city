import { useEffect, useMemo, useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { toast } from 'react-toastify';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import { toastOnError } from '../toasts';
import { useSendInput } from '../hooks/sendInput';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type { GeneratedScenarioDraft } from '../../convex/scenarioGen';
import type { SerializedGeneratedScenario } from '../../convex/aiTown/generatedScenario';
import { ALL_SCENARIOS } from '../../data/scenarios';
import { getLocationById } from '../../data/cityLocations';

// The creator offers the same catalogue the automatic system draws from
// (data/scenarios.ts) — universal town-wide events plus the work/local ones —
// rather than a separate bespoke list. Work scenarios no longer fire randomly (see
// convex/aiTown/scenarios.ts) but remain available here for manual injection. A
// free-form "Custom Scenario" stays at the end.
//
// Every field the detail pane shows is carried through, so picking a scenario
// shows you what it actually is instead of just an emoji and a truncated title.
type ScenarioOption = {
  id: string;
  emoji: string;
  name: string;
  text: string;
  scope?: 'universal' | 'local';
  locationId?: string;
  outcome?: 'tasks' | 'decision';
  whatHappens: string;
  background: string;
  relationships?: string;
  context?: string;
  conflict?: string;
  topics?: string[];
  completionGoal?: string;
};

const CUSTOM_SCENARIO: ScenarioOption = {
  id: 'custom',
  emoji: '✏️',
  name: 'Custom Scenario',
  text: '',
  whatHappens:
    'Whatever you write below. Every agent reacts to it in character and reshapes their day around it.',
  background:
    'A custom scenario you injected. It overrides everyone’s normal routine for the rest of the in-game day.',
};

const SCENARIO_OPTIONS: ScenarioOption[] = [
  ...ALL_SCENARIOS.map(
    (s): ScenarioOption => ({
      id: s.id,
      emoji: s.emoji,
      name: s.name,
      text: s.instruction,
      scope: s.scope,
      locationId: s.locationId,
      outcome: s.outcome,
      whatHappens: s.whatHappens,
      background: s.background,
      relationships: s.relationships,
      context: s.context,
      conflict: s.conflict,
      topics: s.topics,
      completionGoal: s.completionGoal,
    }),
  ),
  CUSTOM_SCENARIO,
];

// Strip the panel-only fields the engine's input validator doesn't accept.
function toWireScenario(draft: GeneratedScenarioDraft): SerializedGeneratedScenario {
  const { reasoning: _reasoning, groundedIn: _groundedIn, ...rest } = draft;
  return rest;
}

function scopeLabel(scenario: ScenarioOption): string {
  if (scenario.id === 'custom') return 'Custom';
  if (scenario.scope === 'local') {
    return getLocationById(scenario.locationId ?? '')?.name ?? 'Workplace';
  }
  return 'Town-wide';
}

function Section({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-1">{title}</div>
      <p className="text-brown-100 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

// One row in the left-hand picker. Shows enough of the scenario to choose between
// them at a glance — the old sidebar version was a two-column grid of bare emoji
// and truncated titles, which told you nothing about what you were about to run.
function ScenarioRow({
  scenario,
  isActive,
  onSelect,
}: {
  scenario: ScenarioOption;
  isActive: boolean;
  onSelect: () => void;
}) {
  const isCustom = scenario.id === 'custom';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      className={
        'scenario-card group relative flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition ' +
        (isActive
          ? 'border-amber-300 bg-amber-300/15 ring-1 ring-amber-300/60'
          : isCustom
            ? 'border-dashed border-amber-200/40 bg-white/5 hover:border-amber-300/70 hover:bg-amber-300/5'
            : 'border-white/10 bg-white/5 hover:border-white/40 hover:bg-white/10')
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-lg leading-none" aria-hidden>
          {scenario.emoji}
        </span>
        <span
          className={
            'min-w-0 flex-1 font-display text-sm leading-tight tracking-wide ' +
            (isActive ? 'text-amber-100' : 'text-white/90')
          }
        >
          {scenario.name}
        </span>
        <span className="shrink-0 rounded-full bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
          {scopeLabel(scenario)}
        </span>
      </div>
      <p className="line-clamp-2 text-[11px] leading-snug text-white/50">{scenario.whatHappens}</p>
    </button>
  );
}

// Full-screen scenario creator. Lives in its own modal rather than the ~24rem
// sidebar it used to be crammed into, so the catalogue is browsable and each
// scenario's description is actually readable before you fire it.
export function ScenarioCreator({
  worldId,
  engineId,
  onClose,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  onClose: () => void;
}) {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    SCENARIO_OPTIONS[0]?.id ?? 'custom',
  );
  const [scenarioText, setScenarioText] = useState(SCENARIO_OPTIONS[0]?.text ?? '');
  const [generatedDraft, setGeneratedDraft] = useState<GeneratedScenarioDraft | null>(null);
  const [generating, setGenerating] = useState(false);

  const startCustomScenario = useSendInput(engineId, 'startCustomScenario');
  const startGeneratedScenario = useSendInput(engineId, 'startGeneratedScenario');
  const startCatalogScenario = useSendInput(engineId, 'startCatalogScenario');
  const clearScenario = useSendInput(engineId, 'clearScenario');
  const draftScenario = useAction(api.scenarioGen.draftScenario);

  const selected = useMemo(
    () => SCENARIO_OPTIONS.find((s) => s.id === selectedScenarioId) ?? null,
    [selectedScenarioId],
  );

  // Preset and generated instructions run several lines long; grow the box to fit
  // them (up to a cap) instead of leaving the text hidden behind a scrollbar.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }, [scenarioText, selectedScenarioId]);

  useEscapeKey(onClose);

  const onSelectScenario = (scenarioId: string) => {
    const scenario = SCENARIO_OPTIONS.find((entry) => entry.id === scenarioId);
    // Picking from the catalogue discards a pending generated draft — otherwise
    // Start would quietly fire the generated one instead of what's selected.
    setGeneratedDraft(null);
    setSelectedScenarioId(scenarioId);
    setScenarioText(scenario?.text ?? '');
  };

  // Ask the Decider to invent a situation from the town's actual state. It only
  // drafts — firing it stays a separate, deliberate click, so a bad premise can be
  // edited or thrown away first.
  const onGenerateScenario = async () => {
    setGenerating(true);
    try {
      const draft = await draftScenario({ worldId });
      if (!draft) {
        toast.error("The Decider couldn't come up with anything usable. Try again.");
        return;
      }
      setGeneratedDraft(draft);
      setScenarioText(draft.instruction);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const onStartScenario = async () => {
    if (!scenarioText.trim()) {
      toast.error('Write your scenario instructions before starting.');
      return;
    }
    // A generated scenario carries its own topics, conflict and completion goal,
    // so it runs the full decision pipeline rather than the free-text injector.
    if (generatedDraft) {
      await toastOnError(
        startGeneratedScenario({
          scenario: { ...toWireScenario(generatedDraft), instruction: scenarioText.trim() },
          manual: true,
        }),
      );
      setGeneratedDraft(null);
      onClose();
      return;
    }
    if (!selected) {
      toast.error('Select a scenario to start.');
      return;
    }
    if (selected.id !== 'custom') {
      // EVERY catalogue scenario runs the real pipeline — universal ones too, not
      // just workplace/local ones. The town-wide injector below builds a bare
      // `manual` entry with no outcome, topics or deliberation and never sets
      // `scenarioId` on the agents, so a decision scenario picked here (e.g.
      // "What's for Dinner?") had its whole Decider/Focal/Evaluator pipeline
      // silently skipped: no focal agent, no options, no decision, ever.
      await toastOnError(
        startCatalogScenario({ scenarioId: selected.id, instruction: scenarioText.trim() }),
      );
    } else {
      // Only the free-form custom scenario uses the town-wide injector — it has no
      // catalogue definition to run the structured pipeline against.
      await toastOnError(
        startCustomScenario({
          instruction: scenarioText.trim(),
          name: selected.name,
          emoji: selected.emoji,
          background: selected.background,
        }),
      );
    }
    onClose();
  };

  const onClearScenario = async () => {
    await toastOnError(clearScenario({}));
    toast.success('Scenario cleared — agents will resume normal behaviour.');
  };

  const isCustom = selected?.id === 'custom';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="scenario-injector bg-brown-800 text-brown-100 w-[96vw] max-w-[1040px] h-[88vh] flex flex-col box overflow-hidden">
        {/* Header */}
        <div className="bg-brown-700 px-5 py-4 flex items-center gap-3 shrink-0">
          <span className="text-2xl leading-none" aria-hidden>
            🎬
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display tracking-widest text-lg uppercase shadow-solid leading-tight">
              Scenario Creator
            </h2>
            <div className="text-xs text-brown-300 mt-0.5">
              Pick a situation to drop on the town, or write your own.
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

        {/* Body: catalogue on the left, the selected scenario in full on the right. */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="scenario-scroll flex min-h-0 shrink-0 flex-col gap-2 overflow-y-auto border-b border-white/10 p-4 md:w-[38%] md:border-b-0 md:border-r">
            <div className="text-xs uppercase tracking-widest text-amber-300/90">
              Choose a scenario
            </div>
            {SCENARIO_OPTIONS.map((scenario) => (
              <ScenarioRow
                key={scenario.id}
                scenario={scenario}
                isActive={scenario.id === selectedScenarioId}
                onSelect={() => onSelectScenario(scenario.id)}
              />
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
            {selected && (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl leading-none" aria-hidden>
                    {selected.emoji}
                  </span>
                  <h3 className="font-display text-base uppercase tracking-widest text-amber-100">
                    {selected.name}
                  </h3>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-brown-900 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brown-100">
                    {scopeLabel(selected)}
                  </span>
                  {selected.outcome === 'decision' && (
                    <span
                      className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300"
                      title="The group deliberates and commits to one option, then gets scored against hidden ground truth."
                    >
                      Decision
                    </span>
                  )}
                </div>
              </div>
            )}

            <Section title="What's happening" body={selected?.whatHappens} />
            <Section title="Background" body={selected?.background} />
            <Section title="Relationships" body={selected?.relationships} />
            <Section title="Current context" body={selected?.context} />
            <Section title="Where they disagree" body={selected?.conflict} />

            {selected?.topics && selected.topics.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-1.5">
                  {selected.outcome === 'decision' ? 'Considerations' : 'Talking points'}
                </div>
                <ul className="space-y-1 text-sm text-brown-100">
                  {selected.topics.map((t, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300/70" aria-hidden />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Section
              title={selected?.outcome === 'decision' ? 'Decision' : 'Goal'}
              body={selected?.completionGoal}
            />

            {/* A scenario the Decider invented from what has actually happened here,
                staged for review before it fires. */}
            {generatedDraft && (
              <div className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2">
                <div className="text-sm font-bold text-amber-100">
                  {generatedDraft.emoji} {generatedDraft.name}
                </div>
                {generatedDraft.reasoning && (
                  <p className="mt-1 text-[11px] leading-snug text-white/60">
                    {generatedDraft.reasoning}
                  </p>
                )}
                {generatedDraft.groundedIn.length > 0 && (
                  <p className="mt-1 text-[11px] leading-snug text-white/40">
                    Built on: {generatedDraft.groundedIn.join('; ')}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-2 pt-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="scenario-instructions"
                  className="text-xs uppercase tracking-widest text-amber-300/90"
                >
                  {isCustom ? 'Your instructions' : 'What gets injected'}
                </label>
                <span className="text-[10px] uppercase tracking-widest text-white/35">
                  {scenarioText.trim().length} chars
                </span>
              </div>
              <textarea
                id="scenario-instructions"
                ref={textareaRef}
                className={
                  'w-full min-h-[6rem] resize-y rounded-lg border px-3 py-2 text-sm bg-black/40 text-white/90 placeholder:text-white/30 transition outline-none ' +
                  'border-amber-200/25 focus:border-amber-300 focus:ring-1 focus:ring-amber-300/50'
                }
                placeholder={
                  isCustom
                    ? 'e.g. "Everyone is secretly a spy who must not reveal their identity"'
                    : 'Describe the scenario you want to inject...'
                }
                rows={5}
                value={scenarioText}
                onChange={(event) => setScenarioText(event.target.value)}
              />
              <p className="text-[11px] leading-snug text-white/40">
                Every agent reacts to this in character, then reshapes their day around it.
              </p>
            </div>
          </div>
        </div>

        {/* Outside the scrolling body so the actions stay reachable. */}
        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-white/10 p-4">
          <button
            className="button min-w-0 text-white shadow-solid text-sm cursor-pointer pointer-events-auto opacity-80 hover:opacity-100"
            type="button"
            onClick={onClearScenario}
            title="Remove any active scenario from all agents"
          >
            <div className="h-full flex items-center justify-center truncate bg-clay-700 px-3 py-2">
              Clear
            </div>
          </button>
          <button
            className="button min-w-0 text-white shadow-solid text-sm cursor-pointer pointer-events-auto opacity-80 hover:opacity-100 disabled:opacity-40 disabled:cursor-not-allowed"
            type="button"
            onClick={onGenerateScenario}
            disabled={generating}
            title="Have the Decider invent a new situation from what has happened in town"
          >
            <div className="h-full flex items-center justify-center truncate bg-clay-700 px-3 py-2">
              {generating ? 'Thinking…' : '✨ Generate'}
            </div>
          </button>
          <button
            className="button min-w-0 text-white shadow-solid text-sm cursor-pointer pointer-events-auto disabled:opacity-40 disabled:cursor-not-allowed"
            type="button"
            onClick={onStartScenario}
            disabled={!scenarioText.trim()}
          >
            <div className="h-full flex items-center justify-center gap-2 truncate bg-clay-700 px-4 py-2">
              <span aria-hidden>▶</span> Start scenario
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
