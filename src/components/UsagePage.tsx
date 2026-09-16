import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

// Relative windows are anchored to a clock that only ticks every REFRESH_MS, so
// the Convex subscription isn't torn down and re-established every render. New
// rows still show up immediately — the query re-runs when the table changes.
const REFRESH_MS = 10_000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PRESETS: { label: string; ms: number | null }[] = [
  { label: '15m', ms: 15 * MINUTE },
  { label: '1h', ms: HOUR },
  { label: '6h', ms: 6 * HOUR },
  { label: '24h', ms: DAY },
  { label: '7d', ms: 7 * DAY },
  { label: 'All', ms: null },
];

type KindFilter = 'all' | 'chat' | 'embedding';
type Grouping = 'operation' | 'model' | 'subject' | 'kind';

const GROUPINGS: { key: Grouping; label: string }[] = [
  { key: 'operation', label: 'By operation' },
  { key: 'model', label: 'By model' },
  { key: 'subject', label: 'By agent' },
  { key: 'kind', label: 'By kind' },
];

export default function UsagePage() {
  const [presetMs, setPresetMs] = useState<number | null>(HOUR);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [operation, setOperation] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [grouping, setGrouping] = useState<Grouping>('operation');
  const [search, setSearch] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [rowLimit, setRowLimit] = useState(100);
  const [anchor, setAnchor] = useState(() => roundToRefresh(Date.now()));

  const usingCustom = !!(customFrom || customTo);
  useEffect(() => {
    if (usingCustom) return;
    const id = setInterval(() => setAnchor(roundToRefresh(Date.now())), REFRESH_MS);
    return () => clearInterval(id);
  }, [usingCustom]);

  // `until: undefined` lets the server use its own now, so the newest call is
  // never a few seconds outside the window because of a stale anchor.
  const range = useMemo(() => {
    if (usingCustom) {
      return {
        since: customFrom ? new Date(customFrom).getTime() : 0,
        until: customTo ? new Date(customTo).getTime() : undefined,
      };
    }
    return { since: presetMs === null ? 0 : anchor - presetMs, until: undefined };
  }, [usingCustom, customFrom, customTo, presetMs, anchor]);

  const filters = {
    since: range.since,
    until: range.until,
    operation: operation || undefined,
    kind: kind === 'all' ? undefined : kind,
  };

  const summary = useQuery(api.llmUsage.summary, { ...filters, buckets: 60 });
  const calls = useQuery(api.llmUsage.calls, {
    ...filters,
    search: search.trim() || undefined,
    onlyFailed: onlyFailed || undefined,
    limit: rowLimit,
  });
  const clear = useMutation(api.llmUsage.clear);

  const totals = summary?.totals;

  return (
    <main className="min-h-screen bg-brown-900 text-brown-100 font-body">
      <header className="bg-brown-700 px-6 py-4 flex items-center gap-4 flex-wrap">
        <h1 className="font-display tracking-widest text-2xl uppercase flex-1">LLM Usage</h1>
        <button
          type="button"
          className="text-xs uppercase tracking-widest text-brown-200 hover:text-brown-100 underline"
          onClick={() => {
            if (
              !confirm(
                'Delete every logged LLM call? The simulation is unaffected, but this usage history is gone for good.',
              )
            ) {
              return;
            }
            void clear({});
          }}
        >
          Clear log
        </button>
        <Link to="/" className="button text-white shadow-solid text-sm cursor-pointer">
          <div className="h-full bg-clay-700 flex items-center px-3">Back to Town</div>
        </Link>
      </header>

      <div className="p-6 flex flex-col gap-6">
        <Filters
          presetMs={presetMs}
          setPresetMs={(ms) => {
            setPresetMs(ms);
            setCustomFrom('');
            setCustomTo('');
            setAnchor(roundToRefresh(Date.now()));
          }}
          usingCustom={usingCustom}
          customFrom={customFrom}
          setCustomFrom={setCustomFrom}
          customTo={customTo}
          setCustomTo={setCustomTo}
          operation={operation}
          setOperation={setOperation}
          operations={summary?.operations ?? []}
          kind={kind}
          setKind={setKind}
        />

        {!summary ? (
          <div className="p-10 text-center text-brown-300 italic">Loading usage...</div>
        ) : totals && totals.calls === 0 ? (
          <div className="bg-brown-800 box p-8 text-center text-brown-300">
            <p className="mb-2">No LLM calls logged in this window.</p>
            <p className="text-xs">
              Calls are recorded as the town makes them. Widen the window, or let the simulation
              run.
            </p>
          </div>
        ) : (
          <>
            {summary.truncated && (
              <p className="text-xs text-brown-300 bg-brown-800 box px-4 py-3">
                This window holds more than {summary.scanCap.toLocaleString()} calls. Everything
                below describes the most recent {summary.scanCap.toLocaleString()} of them — narrow
                the window for exact totals.
              </p>
            )}

            <TotalsRow totals={totals!} />
            <TokenChart
              series={summary.series}
              bucketWidth={summary.bucketWidth}
              seriesStart={summary.seriesStart}
              until={summary.until}
            />

            <section className="bg-brown-800 box p-4">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <h2 className="font-display uppercase tracking-widest text-sm text-brown-200 flex-1">
                  Breakdown
                </h2>
                {GROUPINGS.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setGrouping(g.key)}
                    className={`px-2 py-1 text-xs uppercase tracking-wider border ${
                      grouping === g.key
                        ? 'bg-clay-700 border-clay-500 text-white'
                        : 'border-brown-700 text-brown-300 hover:text-brown-100'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <BreakdownTable
                rows={
                  grouping === 'operation'
                    ? summary.byOperation
                    : grouping === 'model'
                      ? summary.byModel
                      : grouping === 'subject'
                        ? summary.bySubject
                        : summary.byKind
                }
                grandTotal={totals!.totalTokens}
                label={grouping === 'subject' ? 'Agent' : GROUPINGS.find((g) => g.key === grouping)!.label.replace('By ', '')}
                onSelect={grouping === 'operation' ? setOperation : undefined}
              />
            </section>

            <CallsTable
              calls={calls}
              search={search}
              setSearch={setSearch}
              onlyFailed={onlyFailed}
              setOnlyFailed={setOnlyFailed}
              rowLimit={rowLimit}
              setRowLimit={setRowLimit}
            />
          </>
        )}
      </div>
    </main>
  );
}

function roundToRefresh(ms: number) {
  return Math.floor(ms / REFRESH_MS) * REFRESH_MS;
}

function Filters(props: {
  presetMs: number | null;
  setPresetMs: (ms: number | null) => void;
  usingCustom: boolean;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
  operation: string;
  setOperation: (v: string) => void;
  operations: string[];
  kind: KindFilter;
  setKind: (v: KindFilter) => void;
}) {
  return (
    <section className="bg-brown-800 box p-4 flex flex-wrap items-end gap-x-6 gap-y-4">
      <div>
        <Label>Window</Label>
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => props.setPresetMs(p.ms)}
              className={`px-3 py-1 text-xs uppercase tracking-wider border ${
                !props.usingCustom && props.presetMs === p.ms
                  ? 'bg-clay-700 border-clay-500 text-white'
                  : 'border-brown-700 text-brown-300 hover:text-brown-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>From / to (overrides the window)</Label>
        <div className="flex gap-2 items-center">
          <input
            type="datetime-local"
            value={props.customFrom}
            onChange={(e) => props.setCustomFrom(e.target.value)}
            className="bg-brown-900 border border-brown-700 text-brown-100 text-xs px-2 py-1"
          />
          <span className="text-brown-300 text-xs">to</span>
          <input
            type="datetime-local"
            value={props.customTo}
            onChange={(e) => props.setCustomTo(e.target.value)}
            className="bg-brown-900 border border-brown-700 text-brown-100 text-xs px-2 py-1"
          />
          {props.usingCustom && (
            <button
              type="button"
              className="text-xs text-brown-300 underline hover:text-brown-100"
              onClick={() => {
                props.setCustomFrom('');
                props.setCustomTo('');
              }}
            >
              clear
            </button>
          )}
        </div>
      </div>

      <div>
        <Label>Operation</Label>
        <select
          value={props.operation}
          onChange={(e) => props.setOperation(e.target.value)}
          className="bg-brown-900 border border-brown-700 text-brown-100 text-xs px-2 py-1 min-w-[12rem]"
        >
          <option value="">All operations</option>
          {props.operations.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label>Kind</Label>
        <select
          value={props.kind}
          onChange={(e) => props.setKind(e.target.value as KindFilter)}
          className="bg-brown-900 border border-brown-700 text-brown-100 text-xs px-2 py-1"
        >
          <option value="all">All</option>
          <option value="chat">Chat</option>
          <option value="embedding">Embedding</option>
        </select>
      </div>
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[0.65rem] uppercase tracking-widest text-brown-300 mb-1">{children}</div>
  );
}

function TotalsRow({
  totals,
}: {
  totals: {
    calls: number;
    failed: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    ms: number;
    estimatedCalls: number;
    retries: number;
  };
}) {
  const avgTokens = totals.calls > 0 ? Math.round(totals.totalTokens / totals.calls) : 0;
  const avgMs = totals.calls > 0 ? Math.round(totals.ms / totals.calls) : 0;
  return (
    <section className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      <Stat label="Total tokens" value={totals.totalTokens.toLocaleString()} emphasis />
      <Stat label="Prompt tokens" value={totals.promptTokens.toLocaleString()} />
      <Stat label="Completion tokens" value={totals.completionTokens.toLocaleString()} />
      <Stat
        label="Calls"
        value={totals.calls.toLocaleString()}
        note={totals.failed > 0 ? `${totals.failed} failed` : undefined}
      />
      <Stat label="Avg tokens / call" value={avgTokens.toLocaleString()} />
      <Stat
        label="Avg latency"
        value={`${avgMs.toLocaleString()} ms`}
        note={totals.retries > 0 ? `${totals.retries} retries` : undefined}
      />
      {totals.estimatedCalls > 0 && (
        <p className="col-span-full text-xs text-brown-300">
          {totals.estimatedCalls.toLocaleString()} of {totals.calls.toLocaleString()} calls came
          back without a usage block from the provider; their token counts are estimated at roughly
          four characters per token.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-brown-800 box p-3">
      <div className="text-[0.65rem] uppercase tracking-widest text-brown-300">{label}</div>
      <div
        className={`tabular-nums ${emphasis ? 'text-3xl text-brown-200' : 'text-2xl'} leading-tight`}
      >
        {value}
      </div>
      {note && <div className="text-[0.65rem] text-brown-300 mt-1">{note}</div>}
    </div>
  );
}

// Tokens over the window, split prompt vs completion. Plain SVG: the shape only
// has to answer "when did it spend" at a glance, which does not justify a chart
// dependency.
function TokenChart({
  series,
  bucketWidth,
  seriesStart,
  until,
}: {
  series: { t: number; calls: number; totalTokens: number; promptTokens: number }[];
  bucketWidth: number;
  seriesStart: number;
  until: number;
}) {
  const width = 1000;
  const height = 160;
  const peak = Math.max(1, ...series.map((s) => s.totalTokens));
  const slot = width / Math.max(1, series.length);
  const barWidth = Math.max(1, slot - 1);

  return (
    <section className="bg-brown-800 box p-4">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h2 className="font-display uppercase tracking-widest text-sm text-brown-200">
          Tokens over time
        </h2>
        <span className="text-xs text-brown-300 tabular-nums">
          peak {peak.toLocaleString()} tokens per {formatDuration(bucketWidth)} bucket
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-40"
        preserveAspectRatio="none"
        role="img"
        aria-label="Token usage over the selected window"
      >
        {series.map((point, i) => {
          const total = (point.totalTokens / peak) * (height - 4);
          const prompt = (point.promptTokens / peak) * (height - 4);
          const x = i * slot;
          return (
            <g key={point.t}>
              <title>
                {`${formatTime(point.t)} — ${point.totalTokens.toLocaleString()} tokens, ${point.calls} calls`}
              </title>
              <rect x={x} y={height - total} width={barWidth} height={total} fill="#E4A672" />
              <rect x={x} y={height - prompt} width={barWidth} height={prompt} fill="#B86F50" />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[0.65rem] text-brown-300 mt-1">
        <span>{formatTime(seriesStart)}</span>
        <span className="flex gap-3">
          <Swatch color="#B86F50" label="prompt" />
          <Swatch color="#E4A672" label="completion" />
        </span>
        <span>{formatTime(until)}</span>
      </div>
    </section>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function BreakdownTable({
  rows,
  grandTotal,
  label,
  onSelect,
}: {
  rows: {
    key: string;
    calls: number;
    failed: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    ms: number;
  }[];
  grandTotal: number;
  label: string;
  onSelect?: (key: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-brown-300 italic">Nothing to group in this window.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-[0.65rem] uppercase tracking-widest text-brown-300 text-left">
            <th className="py-1 pr-3 font-normal">{label}</th>
            <th className="py-1 px-3 font-normal text-right">Calls</th>
            <th className="py-1 px-3 font-normal text-right">Prompt</th>
            <th className="py-1 px-3 font-normal text-right">Completion</th>
            <th className="py-1 px-3 font-normal text-right">Total</th>
            <th className="py-1 px-3 font-normal text-right">Avg / call</th>
            <th className="py-1 px-3 font-normal text-right">Avg ms</th>
            <th className="py-1 pl-3 font-normal w-32">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brown-700">
          {rows.map((row) => {
            const share = grandTotal > 0 ? row.totalTokens / grandTotal : 0;
            return (
              <tr key={row.key} className="hover:bg-brown-900/40">
                <td className="py-1 pr-3">
                  {onSelect ? (
                    <button
                      type="button"
                      className="underline decoration-dotted hover:text-brown-200 text-left"
                      onClick={() => onSelect(row.key)}
                      title="Filter to this operation"
                    >
                      {row.key}
                    </button>
                  ) : (
                    row.key
                  )}
                  {row.failed > 0 && (
                    <span className="ml-2 text-[0.65rem] text-brown-300">{row.failed} failed</span>
                  )}
                </td>
                <td className="py-1 px-3 text-right">{row.calls.toLocaleString()}</td>
                <td className="py-1 px-3 text-right">{row.promptTokens.toLocaleString()}</td>
                <td className="py-1 px-3 text-right">{row.completionTokens.toLocaleString()}</td>
                <td className="py-1 px-3 text-right text-brown-200">
                  {row.totalTokens.toLocaleString()}
                </td>
                <td className="py-1 px-3 text-right">
                  {Math.round(row.totalTokens / Math.max(1, row.calls)).toLocaleString()}
                </td>
                <td className="py-1 px-3 text-right">
                  {Math.round(row.ms / Math.max(1, row.calls)).toLocaleString()}
                </td>
                <td className="py-1 pl-3">
                  <span className="flex items-center gap-2">
                    <span className="flex-1 h-2 bg-brown-900">
                      <span
                        className="block h-2 bg-brown-300"
                        style={{ width: `${Math.round(share * 100)}%` }}
                      />
                    </span>
                    <span className="text-[0.65rem] text-brown-300 w-9 text-right">
                      {(share * 100).toFixed(1)}%
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CallsTable({
  calls,
  search,
  setSearch,
  onlyFailed,
  setOnlyFailed,
  rowLimit,
  setRowLimit,
}: {
  calls:
    | {
        rows: {
          _id: string;
          at: number;
          kind: 'chat' | 'embedding';
          operation: string;
          model: string;
          subject?: string;
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          estimated: boolean;
          ms: number;
          retries: number;
          ok: boolean;
          error?: string;
        }[];
        matched: number;
        truncated: boolean;
      }
    | undefined;
  search: string;
  setSearch: (v: string) => void;
  onlyFailed: boolean;
  setOnlyFailed: (v: boolean) => void;
  rowLimit: number;
  setRowLimit: (v: number) => void;
}) {
  return (
    <section className="bg-brown-800 box p-4">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <h2 className="font-display uppercase tracking-widest text-sm text-brown-200 flex-1">
          Individual calls
        </h2>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="operation, agent or model"
          className="bg-brown-900 border border-brown-700 text-brown-100 text-xs px-2 py-1 w-56"
        />
        <label className="text-xs text-brown-300 flex items-center gap-1">
          <input
            type="checkbox"
            checked={onlyFailed}
            onChange={(e) => setOnlyFailed(e.target.checked)}
            className="bg-brown-900 border-brown-700"
          />
          failed only
        </label>
        <select
          value={rowLimit}
          onChange={(e) => setRowLimit(Number(e.target.value))}
          className="bg-brown-900 border border-brown-700 text-brown-100 text-xs px-2 py-1"
        >
          {[50, 100, 250, 500].map((n) => (
            <option key={n} value={n}>
              {n} rows
            </option>
          ))}
        </select>
      </div>

      {!calls ? (
        <p className="text-xs text-brown-300 italic">Loading calls...</p>
      ) : calls.rows.length === 0 ? (
        <p className="text-xs text-brown-300 italic">No calls match these filters.</p>
      ) : (
        <>
          <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 bg-brown-800">
                <tr className="text-[0.65rem] uppercase tracking-widest text-brown-300 text-left">
                  <th className="py-1 pr-3 font-normal">Time</th>
                  <th className="py-1 px-3 font-normal">Operation</th>
                  <th className="py-1 px-3 font-normal">Agent</th>
                  <th className="py-1 px-3 font-normal">Model</th>
                  <th className="py-1 px-3 font-normal text-right">Prompt</th>
                  <th className="py-1 px-3 font-normal text-right">Completion</th>
                  <th className="py-1 px-3 font-normal text-right">Total</th>
                  <th className="py-1 pl-3 font-normal text-right">ms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brown-700">
                {calls.rows.map((row) => (
                  <tr key={row._id} className={row.ok ? 'hover:bg-brown-900/40' : 'bg-brown-700/40'}>
                    <td className="py-1 pr-3 whitespace-nowrap text-brown-300">
                      {formatTime(row.at)}
                    </td>
                    <td className="py-1 px-3">
                      {row.operation}{' '}
                      {row.kind === 'embedding' && (
                        <span className="ml-2 text-[0.65rem] text-brown-300">embedding</span>
                      )}
                      {!row.ok && (
                        <span className="ml-2 text-[0.65rem] text-brown-200" title={row.error}>
                          failed
                        </span>
                      )}
                    </td>
                    <td className="py-1 px-3 text-brown-200">{row.subject ?? '—'}</td>
                    <td className="py-1 px-3 text-brown-300 max-w-[14rem] truncate" title={row.model}>
                      {row.model}
                    </td>
                    <td className="py-1 px-3 text-right">{row.promptTokens.toLocaleString()}</td>
                    <td className="py-1 px-3 text-right">
                      {row.completionTokens.toLocaleString()}
                    </td>
                    <td className="py-1 px-3 text-right text-brown-200">
                      {row.totalTokens.toLocaleString()}
                      {row.estimated && row.totalTokens > 0 && (
                        <span title="Estimated: the provider returned no usage block">~</span>
                      )}
                    </td>
                    <td className="py-1 pl-3 text-right text-brown-300">
                      {row.ms.toLocaleString()}
                      {row.retries > 0 && (
                        <span className="ml-1 text-[0.65rem]">+{row.retries}r</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-brown-300 mt-2">
            Showing {calls.rows.length.toLocaleString()} of {calls.matched.toLocaleString()} matching
            calls, newest first.
            {calls.truncated && ' Older matches exist beyond the scan limit — narrow the window.'}
          </p>
        </>
      )}
    </section>
  );
}

function formatTime(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < MINUTE) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  return `${Math.round(ms / DAY)}d`;
}
