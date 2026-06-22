import { useEffect, useState } from 'react';
import { SerializedActiveScenario } from '../../convex/aiTown/world';
import { getLocationById } from '../../data/cityLocations';
import closeImg from '../../assets/close.svg';

function locationName(locationId?: string): string | undefined {
  return locationId ? getLocationById(locationId)?.name : undefined;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Top-right stack of active-scenario chips plus a countdown to the next scenario.
// Click a chip to open its detail.
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
    <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1.5 pointer-events-auto">
      <div className="text-[10px] uppercase tracking-widest text-white/70 font-display shadow-solid pr-1">
        Scenarios
      </div>
      {ordered.map((s) => (
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
            <span className="text-white text-xs font-bold leading-tight truncate max-w-[170px]">
              {s.name}
            </span>
            <span className="text-[10px] leading-tight text-white/60 truncate max-w-[170px]">
              {s.scope === 'local' ? locationName(s.locationId) ?? 'Local' : 'Town-wide'}
            </span>
          </span>
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
        </button>
      ))}
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

// Full detail modal for one active scenario.
export function ScenarioDetail({
  scenario,
  onClose,
}: {
  scenario: SerializedActiveScenario;
  onClose: () => void;
}) {
  const loc = locationName(scenario.locationId);
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
              {scenario.scope === 'local'
                ? `Local scenario${loc ? ` · ${loc}` : ''}`
                : 'Town-wide scenario'}
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

          <DetailSection title="What's happening" body={scenario.whatHappens} />
          <DetailSection title="Background" body={scenario.background} />
          <DetailSection title="Relationships" body={scenario.relationships} />
          <DetailSection title="Current context" body={scenario.context} />
          <DetailSection title="Goals & tasks" body={scenario.goals} />
        </div>
      </div>
    </div>
  );
}
