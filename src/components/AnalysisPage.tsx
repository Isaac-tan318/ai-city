import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { CharacterIcon } from './CharacterIcon';
import { affinityColor, affinityEmoji, affinityLabel } from '../../convex/aiTown/affinity';

type GraphNode = {
  id: string;
  name: string;
  character: string | null;
  conversations: number;
  avgAffinity?: number;
};
type GraphLink = {
  source: string;
  target: string;
  count: number;
  lastEnded: number;
  affinityAB: number;
  affinityBA: number;
  affinity: number;
  family: boolean;
};

const GRAPH_SIZE = 640;
const CENTER = GRAPH_SIZE / 2;
const RING_RADIUS = GRAPH_SIZE / 2 - 80;

export default function AnalysisPage() {
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const graph = useQuery(api.messages.conversationGraph, worldId ? { worldId } : 'skip');
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-brown-900 text-brown-100 font-body">
      <header className="bg-brown-700 px-6 py-4 flex items-center gap-4">
        <h1 className="font-display tracking-widest text-2xl uppercase flex-1">
          Conversation Analysis
        </h1>
        <Link
          to="/"
          className="button text-white shadow-solid text-sm cursor-pointer pointer-events-auto"
        >
          <div className="h-full bg-clay-700 flex items-center px-3">Back to Town</div>
        </Link>
      </header>

      {!graph ? (
        <div className="p-10 text-center text-brown-300 italic">Loading relationships...</div>
      ) : graph.nodes.length === 0 ? (
        <div className="p-10 text-center text-brown-300 italic">
          No conversations recorded yet.
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_320px] gap-6 p-6">
          <RelationshipGraph
            nodes={graph.nodes}
            links={graph.links}
            hovered={hovered}
            setHovered={setHovered}
          />
          <SidePanel nodes={graph.nodes} links={graph.links} hovered={hovered} />
        </div>
      )}
    </main>
  );
}

function usePositions(nodes: GraphNode[]) {
  return useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      map.set(n.id, {
        x: CENTER + RING_RADIUS * Math.cos(angle),
        y: CENTER + RING_RADIUS * Math.sin(angle),
      });
    });
    return map;
  }, [nodes]);
}

function RelationshipGraph({
  nodes,
  links,
  hovered,
  setHovered,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  hovered: string | null;
  setHovered: (id: string | null) => void;
}) {
  const positions = usePositions(nodes);
  const maxLink = Math.max(1, ...links.map((l) => l.count));
  const maxConv = Math.max(1, ...nodes.map((n) => n.conversations));

  const isConnected = (id: string) =>
    hovered === null ||
    hovered === id ||
    links.some(
      (l) =>
        (l.source === hovered && l.target === id) ||
        (l.target === hovered && l.source === id),
    );

  return (
    <div className="bg-brown-800 box overflow-hidden">
      {/* Aspect-ratio wrapper keeps the coordinate space square */}
      <div className="relative w-full" style={{ paddingBottom: '100%' }}>
        {/* SVG layer — edges only */}
        <svg
          viewBox={`0 0 ${GRAPH_SIZE} ${GRAPH_SIZE}`}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
        >
          {links.map((l) => {
            const a = positions.get(l.source)!;
            const b = positions.get(l.target)!;
            const active = hovered === null || hovered === l.source || hovered === l.target;
            // Thickness encodes how often they talk; colour encodes how they feel.
            return (
              <line
                key={`${l.source}-${l.target}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? affinityColor(l.affinity) : '#5a4a42'}
                strokeWidth={1 + (l.count / maxLink) * 7}
                strokeOpacity={active ? 0.9 : 0.18}
                strokeDasharray={l.family ? '2 6' : undefined}
                strokeLinecap="round"
              />
            );
          })}
        </svg>

        {/* HTML layer — face nodes */}
        {nodes.map((n) => {
          const p = positions.get(n.id)!;
          const active = isConnected(n.id);
          // Icon size scales modestly with activity (44–60px)
          const iconSize = Math.round(44 + (n.conversations / maxConv) * 16);

          return (
            <div
              key={n.id}
              className="absolute flex flex-col items-center gap-1 transition-opacity"
              style={{
                left: `${(p.x / GRAPH_SIZE) * 100}%`,
                top: `${(p.y / GRAPH_SIZE) * 100}%`,
                transform: 'translate(-50%, -50%)',
                opacity: active ? 1 : 0.25,
                cursor: 'pointer',
                zIndex: hovered === n.id ? 10 : 1,
              }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className="rounded-full transition-all"
                style={{
                  // Ring colour reflects the agent's average warmth toward the
                  // people they talk to; thickens on hover.
                  outline:
                    n.avgAffinity !== undefined
                      ? `3px solid ${affinityColor(n.avgAffinity)}`
                      : '3px solid transparent',
                  outlineOffset: '2px',
                  boxShadow: hovered === n.id ? '0 0 0 3px #d97757' : undefined,
                  borderRadius: '9999px',
                }}
              >
                <CharacterIcon character={n.character} name={n.name} size={iconSize} />
              </div>
              <span
                className="text-xs font-bold whitespace-nowrap select-none"
                style={{
                  color: hovered === n.id ? '#d97757' : '#c8b8a8',
                  textShadow: '0 1px 3px #0008',
                }}
              >
                {n.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Small coloured affinity pill: emoji + numeric score, tinted to the score.
function AffinityBadge({ value, title }: { value: number; title?: string }) {
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold tabular-nums"
      style={{ color: affinityColor(value), backgroundColor: '#0003' }}
      title={title ?? `${affinityLabel(value)} (${value}/100)`}
    >
      {affinityEmoji(value)} {value}
    </span>
  );
}

function SidePanel({
  nodes,
  links,
  hovered,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  hovered: string | null;
}) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const topPairs = [...links].sort((a, b) => b.count - a.count).slice(0, 8);
  // Strongest mutual bonds and sourest pairs, by average affinity.
  const closest = [...links].sort((a, b) => b.affinity - a.affinity).slice(0, 6);
  const tensions = [...links]
    .filter((l) => l.affinity < 45)
    .sort((a, b) => a.affinity - b.affinity)
    .slice(0, 6);

  // When an agent is hovered, focus the panel on their directional relationships.
  const hoveredNode = hovered ? nodeMap.get(hovered) : undefined;
  const hoveredRels = hovered
    ? links
        .filter((l) => l.source === hovered || l.target === hovered)
        .map((l) => {
          const otherId = l.source === hovered ? l.target : l.source;
          // `outward` = how the hovered agent feels; `inward` = how the other does.
          const outward = l.source === hovered ? l.affinityAB : l.affinityBA;
          const inward = l.source === hovered ? l.affinityBA : l.affinityAB;
          return { other: nodeMap.get(otherId), outward, inward, count: l.count, family: l.family };
        })
        .sort((a, b) => b.outward - a.outward)
    : [];

  const PairRow = ({ l }: { l: GraphLink }) => {
    const a = nodeMap.get(l.source);
    const b = nodeMap.get(l.target);
    return (
      <li className="flex items-center gap-2">
        <div className="flex -space-x-2 shrink-0">
          <CharacterIcon character={a?.character} name={a?.name} size={28} />
          <CharacterIcon character={b?.character} name={b?.name} size={28} />
        </div>
        <span className="flex-1 truncate text-sm text-brown-100">
          {a?.name} &amp; {b?.name}
          {l.family && <span className="text-brown-400"> · family</span>}
        </span>
        <AffinityBadge value={l.affinity} />
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {hoveredNode && (
        <div className="bg-brown-800 box p-4">
          <h2 className="font-display uppercase tracking-widest text-sm text-clay-500 mb-3 flex items-center gap-2">
            <CharacterIcon
              character={hoveredNode.character}
              name={hoveredNode.name}
              size={26}
            />
            {hoveredNode.name}
          </h2>
          <ul className="space-y-2">
            {hoveredRels.map((r) => (
              <li key={r.other?.id} className="flex items-center gap-2">
                <CharacterIcon character={r.other?.character} name={r.other?.name} size={26} />
                <span className="flex-1 truncate text-sm text-brown-100">
                  {r.other?.name}
                  {r.family && <span className="text-brown-400"> · family</span>}
                </span>
                <AffinityBadge
                  value={r.outward}
                  title={`${hoveredNode.name} → ${r.other?.name}: ${affinityLabel(r.outward)} (${r.outward}/100)`}
                />
                <span className="text-brown-500 text-xs shrink-0">↔</span>
                <AffinityBadge
                  value={r.inward}
                  title={`${r.other?.name} → ${hoveredNode.name}: ${affinityLabel(r.inward)} (${r.inward}/100)`}
                />
              </li>
            ))}
          </ul>
          <p className="text-xs text-brown-400 mt-2">
            Left badge: how {hoveredNode.name} feels · right badge: how they feel back.
          </p>
        </div>
      )}

      <div className="bg-brown-800 box p-4">
        <h2 className="font-display uppercase tracking-widest text-sm text-brown-200 mb-3">
          Most active agents
        </h2>
        <ul className="space-y-2">
          {nodes.slice(0, 8).map((n) => (
            <li
              key={n.id}
              className={`flex items-center gap-2 ${hovered === n.id ? 'opacity-100' : 'opacity-80'}`}
            >
              <CharacterIcon character={n.character} name={n.name} size={30} />
              <span
                className={`flex-1 truncate text-sm ${hovered === n.id ? 'text-clay-500 font-bold' : 'text-brown-100'}`}
              >
                {n.name}
              </span>
              {n.avgAffinity !== undefined && (
                <AffinityBadge
                  value={n.avgAffinity}
                  title={`Average warmth toward connections: ${affinityLabel(n.avgAffinity)} (${n.avgAffinity}/100)`}
                />
              )}
              <span className="text-brown-300 shrink-0 text-sm tabular-nums">{n.conversations}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-brown-800 box p-4">
        <h2 className="font-display uppercase tracking-widest text-sm text-brown-200 mb-3">
          Closest bonds
        </h2>
        <ul className="space-y-2">
          {closest.map((l) => (
            <PairRow key={`${l.source}-${l.target}`} l={l} />
          ))}
        </ul>
      </div>

      {tensions.length > 0 && (
        <div className="bg-brown-800 box p-4">
          <h2 className="font-display uppercase tracking-widest text-sm text-brown-200 mb-3">
            Tensions
          </h2>
          <ul className="space-y-2">
            {tensions.map((l) => (
              <PairRow key={`${l.source}-${l.target}`} l={l} />
            ))}
          </ul>
        </div>
      )}

      <div className="bg-brown-800 box p-4">
        <h2 className="font-display uppercase tracking-widest text-sm text-brown-200 mb-3">
          Top pairings
        </h2>
        <ul className="space-y-2">
          {topPairs.map((l) => {
            const a = nodeMap.get(l.source);
            const b = nodeMap.get(l.target);
            return (
              <li key={`${l.source}-${l.target}`} className="flex items-center gap-2">
                <div className="flex -space-x-2 shrink-0">
                  <CharacterIcon character={a?.character} name={a?.name} size={28} />
                  <CharacterIcon character={b?.character} name={b?.name} size={28} />
                </div>
                <span className="flex-1 truncate text-sm text-brown-100">
                  {a?.name} &amp; {b?.name}
                </span>
                <AffinityBadge value={l.affinity} />
                <span className="text-brown-300 shrink-0 text-sm tabular-nums">{l.count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="text-xs text-brown-400 px-1 space-y-1">
        <p>
          Line <span className="text-brown-200">thickness</span> = conversation count;{' '}
          <span className="text-brown-200">colour</span> = affinity (
          <span style={{ color: affinityColor(85) }}>warm</span> →{' '}
          <span style={{ color: affinityColor(50) }}>neutral</span> →{' '}
          <span style={{ color: affinityColor(15) }}>hostile</span>); dashed lines are family ties.
        </p>
        <p>Node ring colour shows each agent's average warmth. Hover an agent for details.</p>
      </div>
    </div>
  );
}
