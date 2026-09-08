import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import { CharacterIcon } from './CharacterIcon';
import { relativeTime } from './PlayerDetails';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useSendInput } from '../hooks/sendInput';
import { useServerGame } from '../hooks/serverGame';
import { toastOnError } from '../toasts';
import { GameId } from '../../convex/aiTown/ids';
import { CITY_LOCATIONS, nearestLocation } from '../../data/cityLocations';
import {
  financialPressure,
  gaugeColor,
  shortTermOrDefault,
  SHORT_TERM_EMOJI,
  type ShortTermComponent,
} from '../../convex/aiTown/shortTerm';
import { DEFAULT_BALANCE } from '../../convex/constants';

// The four gauges the popup lets you set outright, in the order the inspector
// already shows them.
const GAUGES: { key: ShortTermComponent; label: string }[] = [
  { key: 'mood', label: 'Mood' },
  { key: 'stress', label: 'Stress' },
  { key: 'fatigue', label: 'Fatigue' },
  { key: 'hunger', label: 'Hunger' },
];

const MEMORY_GROUPS: {
  type: 'reflection' | 'conversation' | 'scenarioOutcome' | 'observation' | 'relationship';
  label: string;
  emoji: string;
}[] = [
  // Reflections first: they're the agent's own distilled insights, which is the
  // closest thing to a summary the memory system already produces.
  { type: 'reflection', label: 'Insights', emoji: '💡' },
  { type: 'conversation', label: 'Conversations', emoji: '💬' },
  { type: 'scenarioOutcome', label: 'Takeaways', emoji: '🎬' },
  { type: 'observation', label: 'Noticed', emoji: '👀' },
  { type: 'relationship', label: 'People', emoji: '🤝' },
];

// Everything the editors can change, held as a local draft so dragging a slider
// doesn't fire an engine input per pixel.
type Draft = {
  mood: number;
  stress: number;
  fatigue: number;
  hunger: number;
  balance: number;
  health: 'well' | 'sick';
};

type Row = {
  agentId: GameId<'agents'>;
  playerId: GameId<'players'>;
  name: string;
  character?: string;
  position: { x: number; y: number };
  draft: Draft;
  learnedTraits?: string[];
  // Who they've become, and who they were authored as. Shown side by side so
  // identity drift is inspectable rather than silent.
  selfSummary?: string;
  selfSummaryDay?: number;
  identity: string;
  inScenario: boolean;
  // Set while a manual hold is in effect (see the agentSetLocation input).
  pinnedAt?: string;
};

function draftEquals(a: Draft, b: Draft): boolean {
  return (
    a.mood === b.mood &&
    a.stress === b.stress &&
    a.fatigue === b.fatigue &&
    a.hunger === b.hunger &&
    a.balance === b.balance &&
    a.health === b.health
  );
}

// A labelled 0-100 meter, matching the inspector's bar in PlayerDetails.
function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div
      className="h-2 w-full rounded overflow-hidden bg-black/30"
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded transition-all"
        style={{ width: `${value}%`, backgroundColor: color }}
      />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-widest text-amber-300/90 mb-2">{children}</div>;
}

// Full-screen roster of every agent in town: their mood, money, health and where
// they are, all editable, plus what each of them remembers. The map sidebar
// (PlayerDetails) shows one agent at a time and is read-only; this is the place
// to compare the cast and to nudge any of them.
export function AgentsPanel({
  worldId,
  engineId,
  onClose,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  const game = useServerGame(worldId);

  const setAgentState = useSendInput(engineId, 'agentSetState');
  const setAgentLocation = useSendInput(engineId, 'agentSetLocation');
  const releaseAgentLocation = useSendInput(engineId, 'agentReleaseLocation');

  const [selectedId, setSelectedId] = useState<GameId<'agents'> | undefined>();
  // Draft state, re-seeded whenever the selection changes (see the guarded
  // set-during-render below — the standard React way to reset derived state).
  const [draft, setDraft] = useState<Draft | undefined>();
  const [draftFor, setDraftFor] = useState<GameId<'agents'> | undefined>();
  const [locationDraft, setLocationDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [showMemories, setShowMemories] = useState(false);

  // Only agent-backed players: mood, savings and memories are agent concepts, so
  // a human who has joined the world has nothing to show or edit here.
  const rows: Row[] = useMemo(() => {
    if (!game) return [];
    const now = Date.now();
    const out: Row[] = [];
    for (const agent of game.world.agents.values()) {
      const player = game.world.players.get(agent.playerId);
      if (!player) continue;
      const description = game.playerDescriptions.get(agent.playerId);
      const agentDescription = game.agentDescriptions.get(agent.id);
      const st = shortTermOrDefault(agent.shortTerm, now);
      out.push({
        agentId: agent.id,
        playerId: agent.playerId,
        name: description?.name ?? player.name ?? agent.playerId,
        character: description?.character,
        position: player.position,
        draft: {
          mood: st.mood,
          stress: st.stress,
          fatigue: st.fatigue,
          hunger: st.hunger,
          balance: agent.balance ?? DEFAULT_BALANCE,
          health: agent.health ?? 'well',
        },
        learnedTraits: agent.learnedTraits,
        selfSummary: agentDescription?.selfSummary,
        selfSummaryDay: agentDescription?.selfSummaryDay,
        identity: agentDescription?.identity ?? '',
        inScenario: !!(agent.scenarioId || agent.scenarioInstruction),
        pinnedAt: agent.pin?.locationId,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [game]);

  const selected = rows.find((r) => r.agentId === selectedId) ?? rows[0];

  // Re-seed the drafts when the selection changes. Guarded, so it runs once per
  // selection rather than clobbering edits on every world update.
  if (selected && draftFor !== selected.agentId) {
    setDraftFor(selected.agentId);
    setDraft(selected.draft);
    setLocationDraft(nearestLocation(selected.position).id);
    setShowMemories(false);
  }

  const memories = useQuery(
    api.world.memoriesForPlayer,
    showMemories && selected ? { playerId: selected.playerId } : 'skip',
  );

  const dirty = !!selected && !!draft && !draftEquals(draft, selected.draft);
  const currentLocation = selected ? nearestLocation(selected.position) : undefined;
  // Moving is worth offering even when they're already standing there — it's what
  // puts the hold on, so they stop drifting off with their schedule.
  const movePending = !!selected && !!locationDraft && locationDraft !== selected.pinnedAt;

  const onApply = async () => {
    if (!selected || !draft || !dirty) return;
    const live = selected.draft;
    // Send only what actually changed, so an untouched field is never written.
    const patch = {
      agentId: selected.agentId,
      ...(draft.mood !== live.mood ? { mood: draft.mood } : {}),
      ...(draft.stress !== live.stress ? { stress: draft.stress } : {}),
      ...(draft.fatigue !== live.fatigue ? { fatigue: draft.fatigue } : {}),
      ...(draft.hunger !== live.hunger ? { hunger: draft.hunger } : {}),
      ...(draft.balance !== live.balance ? { balance: draft.balance } : {}),
      ...(draft.health !== live.health ? { health: draft.health } : {}),
    };
    setSaving(true);
    try {
      await toastOnError(setAgentState(patch));
    } finally {
      setSaving(false);
    }
  };

  const onMove = async () => {
    if (!selected || !locationDraft) return;
    setSaving(true);
    try {
      await toastOnError(
        setAgentLocation({ playerId: selected.playerId, locationId: locationDraft }),
      );
    } finally {
      setSaving(false);
    }
  };

  const onRelease = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await toastOnError(releaseAgentLocation({ playerId: selected.playerId }));
    } finally {
      setSaving(false);
    }
  };

  const memoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of memories ?? []) {
      counts.set(m.data.type, (counts.get(m.data.type) ?? 0) + 1);
    }
    return counts;
  }, [memories]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6 pointer-events-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-brown-800 text-brown-100 w-[96vw] max-w-[1100px] h-[90vh] flex flex-col box overflow-hidden">
        {/* Header */}
        <div className="bg-brown-700 px-5 py-4 flex items-center gap-3 shrink-0">
          <span className="text-2xl leading-none" aria-hidden>
            🧑‍🤝‍🧑
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display tracking-widest text-lg uppercase shadow-solid leading-tight">
              Agents
            </h2>
            <div className="text-xs text-brown-300 mt-0.5">
              Inspect and edit every character — mood, money, health and where they are.
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

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Left: the roster. */}
          <div className="scenario-scroll flex min-h-0 shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-white/10 p-3 md:w-[34%] md:border-b-0 md:border-r">
            {rows.length === 0 && (
              <div className="p-4 text-sm text-white/50">
                {game ? 'No agents in this world yet.' : 'Loading…'}
              </div>
            )}
            {rows.map((row) => {
              const isActive = row.agentId === selected?.agentId;
              return (
                <button
                  key={row.agentId}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSelectedId(row.agentId)}
                  className={
                    'flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left transition ' +
                    (isActive ? 'bg-clay-700' : 'bg-brown-700 hover:bg-brown-500')
                  }
                >
                  <CharacterIcon character={row.character} name={row.name} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-sm tracking-wide">
                        {row.name}
                      </span>
                      {row.draft.health === 'sick' && <span title="Unwell">🤒</span>}
                      {row.pinnedAt && <span title="Held in place">📌</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/60">
                      <span title={`Mood ${row.draft.mood}/100`}>
                        {SHORT_TERM_EMOJI.mood} {row.draft.mood}
                      </span>
                      <span title={`Savings $${row.draft.balance}`}>💵 ${row.draft.balance}</span>
                    </div>
                    <div className="truncate text-[11px] text-white/40">
                      📍 {nearestLocation(row.position).name}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: the editors for the selected agent. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5">
            {!selected || !draft ? (
              <div className="text-sm text-white/50">Select an agent on the left.</div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <CharacterIcon character={selected.character} name={selected.name} size={48} />
                  <div className="min-w-0">
                    <h3 className="font-display text-base uppercase tracking-widest text-amber-100">
                      {selected.name}
                    </h3>
                    <div className="text-xs text-white/50">
                      📍 {currentLocation?.name} · {selected.position.x}, {selected.position.y}
                    </div>
                  </div>
                </div>

                {/* Wellbeing */}
                <div>
                  <SectionTitle>Wellbeing</SectionTitle>
                  <ul className="flex flex-col gap-3">
                    {GAUGES.map((g) => (
                      <li key={g.key} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="shrink-0">{SHORT_TERM_EMOJI[g.key]}</span>
                          <label htmlFor={`gauge-${g.key}`} className="flex-1">
                            {g.label}
                          </label>
                          <span className="shrink-0 text-white/70">{draft[g.key]}</span>
                        </div>
                        <Meter value={draft[g.key]} color={gaugeColor(g.key, draft[g.key])} />
                        <input
                          id={`gauge-${g.key}`}
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={draft[g.key]}
                          onChange={(e) => setDraft({ ...draft, [g.key]: Number(e.target.value) })}
                          className="w-full accent-amber-300"
                        />
                      </li>
                    ))}
                    {/* Derived, never stored — so it's shown but not editable. */}
                    <li className="flex flex-col gap-1 opacity-80">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="shrink-0">{SHORT_TERM_EMOJI.financialPressure}</span>
                        <span className="flex-1">
                          Money stress <span className="text-white/40">(from savings)</span>
                        </span>
                        <span className="shrink-0 text-white/70">
                          {financialPressure(draft.balance)}
                        </span>
                      </div>
                      <Meter
                        value={financialPressure(draft.balance)}
                        color={gaugeColor('financialPressure', financialPressure(draft.balance))}
                      />
                    </li>
                  </ul>
                </div>

                {/* Money + health */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <SectionTitle>Money</SectionTitle>
                    <div className="flex items-center gap-2">
                      <span className="text-lg" aria-hidden>
                        💵
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={10}
                        aria-label="Savings"
                        value={draft.balance}
                        onChange={(e) =>
                          setDraft({ ...draft, balance: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="w-32 rounded border border-amber-200/25 bg-black/40 px-2 py-1 text-sm text-white/90 outline-none focus:border-amber-300 focus:ring-1 focus:ring-amber-300/50"
                      />
                      <span className="text-xs text-white/40">savings</span>
                    </div>
                  </div>
                  <div>
                    <SectionTitle>Health</SectionTitle>
                    <div className="flex gap-2">
                      {(['well', 'sick'] as const).map((h) => (
                        <button
                          key={h}
                          type="button"
                          aria-pressed={draft.health === h}
                          onClick={() => setDraft({ ...draft, health: h })}
                          className={
                            'rounded px-3 py-1 text-sm transition ' +
                            (draft.health === h
                              ? 'bg-clay-700 text-white'
                              : 'bg-brown-700 text-white/60 hover:bg-brown-500')
                          }
                        >
                          {h === 'well' ? '🙂 Well' : '🤒 Sick'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Location */}
                <div>
                  <SectionTitle>Location</SectionTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Location"
                      value={locationDraft}
                      onChange={(e) => setLocationDraft(e.target.value)}
                      className="scenario-select min-w-[14rem] rounded border border-amber-200/25 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none focus:border-amber-300"
                    >
                      {CITY_LOCATIONS.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={onMove}
                      disabled={!movePending || saving}
                      className="button min-w-0 text-white shadow-solid text-sm cursor-pointer pointer-events-auto disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="h-full flex items-center bg-clay-700 px-3 py-1.5">
                        Move here
                      </div>
                    </button>
                    {selected.pinnedAt && (
                      <button
                        type="button"
                        onClick={onRelease}
                        disabled={saving}
                        className="button min-w-0 text-white shadow-solid text-sm cursor-pointer pointer-events-auto opacity-80 hover:opacity-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="h-full flex items-center bg-clay-700 px-3 py-1.5">
                          Release
                        </div>
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-white/50">
                    {selected.pinnedAt ? (
                      <>
                        📌 Held at{' '}
                        <span className="text-amber-200/90">
                          {CITY_LOCATIONS.find((l) => l.id === selected.pinnedAt)?.name ??
                            selected.pinnedAt}
                        </span>
                        {selected.inScenario && ' — this overrides the scenario they’re in.'} The
                        hold lifts at the next in-game day, or press Release to hand them back their
                        schedule now.
                      </>
                    ) : (
                      'Moving also holds them there, so they don’t walk straight back to whatever their schedule says.'
                    )}
                  </p>
                </div>

                {/* Memories */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowMemories(!showMemories)}
                    className="flex items-center gap-2 text-xs uppercase tracking-widest text-amber-300/90 hover:text-amber-200"
                  >
                    <span aria-hidden>{showMemories ? '▾' : '▸'}</span>
                    More info about {selected.name}
                  </button>
                  {showMemories && (
                    <div className="mt-3 space-y-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-white/50">
                          {selected.selfSummary
                            ? `Who they are now (day ${selected.selfSummaryDay ?? '?'})`
                            : 'Who they are'}
                        </div>
                        <p className="mt-1 text-xs leading-snug text-white/75">
                          {selected.selfSummary ?? selected.identity}
                        </p>
                        {selected.selfSummary && (
                          <>
                            <div className="mt-2 text-[10px] uppercase tracking-widest text-white/35">
                              Originally written as
                            </div>
                            <p className="mt-1 text-xs leading-snug text-white/40">
                              {selected.identity}
                            </p>
                          </>
                        )}
                      </div>
                      {selected.learnedTraits && selected.learnedTraits.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-white/50">
                            Learned about self
                          </div>
                          <ul className="mt-1 list-disc pl-5 text-xs text-white/70 flex flex-col gap-0.5">
                            {selected.learnedTraits.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {memories === undefined && (
                        <div className="text-sm text-white/50">Loading memories…</div>
                      )}
                      {memories && memories.length === 0 && (
                        <div className="text-sm text-white/50">
                          Nothing remembered yet — memories come from conversations,
                          scenarios, and whatever this character notices around them.
                        </div>
                      )}
                      {memories && memories.length > 0 && (
                        <>
                          <div className="text-[11px] text-white/40">
                            {MEMORY_GROUPS.filter((g) => memoryCounts.get(g.type))
                              .map((g) => `${memoryCounts.get(g.type)} ${g.label.toLowerCase()}`)
                              .join(' · ')}
                          </div>
                          {MEMORY_GROUPS.map((group) => {
                            const items = memories.filter((m) => m.data.type === group.type);
                            if (items.length === 0) return null;
                            return (
                              <div key={group.type}>
                                <div className="text-[10px] uppercase tracking-widest text-white/50">
                                  {group.emoji} {group.label}
                                </div>
                                <ul className="mt-1.5 flex flex-col gap-1.5">
                                  {items.map((m) => (
                                    <li
                                      key={m._id}
                                      className="rounded bg-brown-900 px-3 py-2 text-xs leading-snug text-white/80"
                                    >
                                      <p>{m.description}</p>
                                      <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40">
                                        <span title={`Importance ${m.importance}`}>
                                          ★ {Math.round(m.importance)}
                                        </span>
                                        <span>·</span>
                                        <span>{relativeTime(m._creationTime, Date.now())}</span>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Actions stay outside the scrolling body so they're always reachable. */}
        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-white/10 p-4">
          {dirty && <span className="mr-auto text-xs text-amber-200/80">Unsaved changes</span>}
          <button
            type="button"
            onClick={() => selected && setDraft(selected.draft)}
            disabled={!dirty || saving}
            className="button min-w-0 text-white shadow-solid text-sm cursor-pointer pointer-events-auto opacity-80 hover:opacity-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="h-full flex items-center bg-clay-700 px-3 py-2">Reset</div>
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!dirty || saving}
            className="button min-w-0 text-white shadow-solid text-sm cursor-pointer pointer-events-auto disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="h-full flex items-center bg-clay-700 px-4 py-2">
              {saving ? 'Saving…' : 'Apply changes'}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
