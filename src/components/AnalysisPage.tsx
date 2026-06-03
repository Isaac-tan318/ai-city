import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

type GraphNode = { id: string; name: string; conversations: number };
type GraphLink = { source: string; target: string; count: number; lastEnded: number };

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
  const size = 640;
  const center = size / 2;
  const radius = size / 2 - 90;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      map.set(n.id, {
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle),
      });
    });
    return map;
  }, [nodes, center, radius]);

  const maxLink = Math.max(1, ...links.map((l) => l.count));
  const maxNode = Math.max(1, ...nodes.map((n) => n.conversations));

  const isActive = (id: string) =>
    hovered === null ||
    hovered === id ||
    links.some(
      (l) =>
        (l.source === hovered && l.target === id) ||
        (l.target === hovered && l.source === id),
    );

  return (
    <div className="bg-brown-800 box overflow-hidden">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto">
        {links.map((l) => {
          const a = positions.get(l.source)!;
          const b = positions.get(l.target)!;
          const active = hovered === null || hovered === l.source || hovered === l.target;
          return (
            <line
              key={`${l.source}-${l.target}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={active ? '#d97757' : '#5a4a42'}
              strokeWidth={1 + (l.count / maxLink) * 7}
              strokeOpacity={active ? 0.85 : 0.25}
            />
          );
        })}
        {nodes.map((n) => {
          const p = positions.get(n.id)!;
          const r = 6 + (n.conversations / maxNode) * 16;
          const active = isActive(n.id);
          return (
            <g
              key={n.id}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
              opacity={active ? 1 : 0.3}
            >
              <circle cx={p.x} cy={p.y} r={r} fill="#d97757" stroke="#231421" strokeWidth={2} />
              <text
                x={p.x}
                y={p.y - r - 6}
                textAnchor="middle"
                fontSize={13}
                fill="#e8ddd4"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {n.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
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
  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;
  const topPairs = [...links].sort((a, b) => b.count - a.count).slice(0, 12);

  return (
    <div className="space-y-6">
      <div className="bg-brown-800 box p-4">
        <h2 className="font-display uppercase tracking-widest text-sm text-brown-200 mb-3">
          Most active agents
        </h2>
        <ul className="space-y-1.5 text-sm">
          {nodes.slice(0, 12).map((n) => (
            <li
              key={n.id}
              className={`flex justify-between ${hovered === n.id ? 'text-clay-500 font-bold' : 'text-brown-100'}`}
            >
              <span className="truncate">{n.name}</span>
              <span className="text-brown-300 shrink-0 ml-2">{n.conversations}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-brown-800 box p-4">
        <h2 className="font-display uppercase tracking-widest text-sm text-brown-200 mb-3">
          Top pairings
        </h2>
        <ul className="space-y-1.5 text-sm">
          {topPairs.map((l) => (
            <li key={`${l.source}-${l.target}`} className="flex justify-between">
              <span className="truncate">
                {nameOf(l.source)} &amp; {nameOf(l.target)}
              </span>
              <span className="text-brown-300 shrink-0 ml-2">{l.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-brown-400 px-1">
        Node size and link thickness scale with the number of recorded conversations. Hover an
        agent to isolate its connections.
      </p>
    </div>
  );
}
