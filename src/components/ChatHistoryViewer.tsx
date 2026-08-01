import { useQuery, useConvex } from 'convex/react';
import { useMemo, useState } from 'react';
import { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import closeImg from '../../assets/close.svg';
import { CharacterIcon } from './CharacterIcon';

function ConversationMessages({
  worldId,
  conversationId,
}: {
  worldId: Id<'worlds'>;
  conversationId: string;
}) {
  const messages = useQuery(api.messages.listMessages, { worldId, conversationId });

  if (!messages) {
    return <div className="py-6 text-brown-300 text-sm italic text-center">Loading...</div>;
  }
  if (messages.length === 0) {
    return (
      <div className="py-6 text-brown-300 text-sm italic text-center">No messages recorded.</div>
    );
  }
  return (
    <div className="space-y-4">
      {messages.map((m) => (
        <div key={m._id} className="flex gap-3">
          <CharacterIcon character={m.authorCharacter} name={m.authorName} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3 mb-1">
              <span className="uppercase font-bold text-brown-200 text-sm">{m.authorName}</span>
              <span className="text-xs text-brown-400">
                {new Date(m._creationTime).toLocaleString()}
              </span>
            </div>
            <p className="bg-brown-900 px-4 py-2 rounded-lg text-brown-100 inline-block max-w-2xl">
              {m.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatHistoryViewer({
  worldId,
  onClose,
}: {
  worldId: Id<'worlds'>;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const convex = useConvex();

  const conversations = useQuery(api.messages.listAllConversations, { worldId });

  // Derive every unique player that appears in any conversation.
  const allPlayers = useMemo(() => {
    if (!conversations) return [];
    const map = new Map<string, { id: string; name: string; character: string | null }>();
    for (const conv of conversations) {
      conv.participants.forEach((id, i) => {
        if (!map.has(id)) {
          map.set(id, {
            id,
            name: conv.participantNames[i] ?? id,
            character: conv.participantCharacters[i] ?? null,
          });
        }
      });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [conversations]);

  const togglePlayer = (id: string) =>
    setSelectedPlayerIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id); // deselect
      if (prev.length < 2) return [...prev, id];                  // add (slot available)
      return [prev[1], id];                                        // drop oldest, add new
    });

  const filtered = conversations?.filter((c) => {
    if (search && !c.participantNames.some((n) => n.toLowerCase().includes(search.toLowerCase())))
      return false;
    // 1 selected → conversations that include that character
    // 2 selected → conversations where BOTH participated together
    if (selectedPlayerIds.length > 0 && !selectedPlayerIds.every((id) => c.participants.includes(id)))
      return false;
    return true;
  });

  const selected = filtered?.find((c) => c.id === selectedId);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJSON = async () => {
    setExporting(true);
    try {
      const data = await convex.query(api.messages.exportAllConversations, { worldId });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `chat-history-${new Date().toISOString().slice(0, 10)}.json`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportMarkdown = async () => {
    setExporting(true);
    try {
      const data = await convex.query(api.messages.exportAllConversations, { worldId });
      const date = new Date().toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const sections: string[] = [
        `# AI Town — Chat History`,
        `*Exported: ${date}*`,
        `*${data.length} conversation${data.length !== 1 ? 's' : ''}*`,
      ];
      for (const conv of data) {
        const names = conv.participants.map((p) => p.name).join(' & ');
        const started = new Date(conv.created).toLocaleString();
        const ended = new Date(conv.ended).toLocaleString();
        sections.push(`\n---\n`);
        sections.push(`## ${names}`);
        sections.push(`*${started} → ${ended} · ${conv.numMessages} message${conv.numMessages !== 1 ? 's' : ''}*\n`);
        for (const msg of conv.messages) {
          const time = new Date(msg.timestamp).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          });
          sections.push(`**[${time}] ${msg.author}:**`);
          sections.push(`${msg.text}\n`);
        }
      }
      const md = sections.join('\n');
      const blob = new Blob([md], { type: 'text/plain' });
      downloadBlob(blob, `chat-history-${new Date().toISOString().slice(0, 10)}.txt`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const data = await convex.query(api.messages.exportAllConversations, { worldId });
      const rows: string[][] = [
        ['Conversation ID', 'Started', 'Ended', 'Participants', 'Author', 'Message', 'Timestamp'],
      ];
      for (const conv of data) {
        const participants = conv.participants.map((p) => p.name).join(' & ');
        if (conv.messages.length === 0) {
          rows.push([conv.id, conv.created, conv.ended, participants, '', '', '']);
        }
        for (const msg of conv.messages) {
          rows.push([
            conv.id,
            conv.created,
            conv.ended,
            participants,
            msg.author,
            msg.text,
            msg.timestamp,
          ]);
        }
      }
      const csv = rows
        .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      downloadBlob(blob, `chat-history-${new Date().toISOString().slice(0, 10)}.csv`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6 pointer-events-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-brown-800 text-brown-100 w-[96vw] h-[92vh] max-w-[1400px] flex flex-col box overflow-hidden">
        {/* Header */}
        <div className="bg-brown-700 px-4 py-3 flex items-center gap-2 shrink-0">
          <h2 className="font-display tracking-widest text-lg flex-1 uppercase shadow-solid">
            Chat History
          </h2>
          <button
            className="button text-white shadow-solid text-sm cursor-pointer pointer-events-auto"
            onClick={handleExportMarkdown}
            disabled={exporting}
            type="button"
            title="Export as readable Markdown"
          >
            <div className="h-full bg-clay-700 flex items-center px-2">
              {exporting ? '...' : 'MD'}
            </div>
          </button>
          <button
            className="button text-white shadow-solid text-sm cursor-pointer pointer-events-auto"
            onClick={handleExportJSON}
            disabled={exporting}
            type="button"
            title="Export all conversations as JSON"
          >
            <div className="h-full bg-clay-700 flex items-center px-2">
              {exporting ? '...' : 'JSON'}
            </div>
          </button>
          <button
            className="button text-white shadow-solid text-sm cursor-pointer pointer-events-auto"
            onClick={handleExportCSV}
            disabled={exporting}
            type="button"
            title="Export all conversations as CSV"
          >
            <div className="h-full bg-clay-700 flex items-center px-2">
              {exporting ? '...' : 'CSV'}
            </div>
          </button>
          <button
            className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            <h2 className="h-full bg-clay-700">
              <img className="w-4 h-4" src={closeImg} alt="Close" />
            </h2>
          </button>
        </div>

        {/* Two-pane body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: conversation list */}
          <div className="w-[300px] lg:w-[360px] shrink-0 border-r-4 border-brown-900 flex flex-col">
            {/* Character face filter */}
            {allPlayers.length > 0 && (
              <div className="px-3 pt-3 pb-1 border-b border-brown-700">
                <div className="text-xs text-brown-400 uppercase tracking-widest mb-2">
                  Filter by character
                </div>
                <div className="flex flex-wrap gap-2">
                  {allPlayers.map((p) => {
                    const active = selectedPlayerIds.includes(p.id);
                    const anyActive = selectedPlayerIds.length > 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        title={p.name}
                        onClick={() => togglePlayer(p.id)}
                        className="flex flex-col items-center gap-1 transition-opacity focus:outline-none"
                        style={{ opacity: anyActive && !active ? 0.35 : 1 }}
                      >
                        <div
                          className="rounded-full transition-all"
                          style={{
                            outline: active ? '3px solid #d97757' : '3px solid transparent',
                            outlineOffset: '2px',
                          }}
                        >
                          <CharacterIcon character={p.character} name={p.name} size={38} />
                        </div>
                        <span
                          className="text-xs leading-none max-w-[48px] truncate"
                          style={{ color: active ? '#d97757' : '#a09080' }}
                        >
                          {p.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {selectedPlayerIds.length > 0 && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-brown-400 hover:text-brown-200 underline transition-colors"
                    onClick={() => setSelectedPlayerIds([])}
                  >
                    Clear filter
                  </button>
                )}
              </div>
            )}

            <div className="px-3 pt-3 pb-2">
              <input
                className="w-full bg-brown-900 border border-brown-700 text-brown-100 px-3 py-1.5 text-sm rounded placeholder:text-brown-500 focus:outline-none focus:border-brown-300"
                placeholder="Search by participant name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="pt-2 text-xs text-brown-300 uppercase tracking-widest">
                {filtered
                  ? `${filtered.length} conversation${filtered.length !== 1 ? 's' : ''}`
                  : 'Loading...'}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
              {!filtered && (
                <div className="text-center py-8 text-brown-300 italic">Loading...</div>
              )}
              {filtered?.length === 0 && (
                <div className="text-center py-8 text-brown-300 italic">No conversations found.</div>
              )}
              {filtered?.map((conv) => {
                const isSelected = selectedId === conv.id;
                return (
                  <button
                    key={conv.id}
                    className={`w-full text-left px-3 py-2.5 rounded flex items-center gap-3 transition-colors ${
                      isSelected ? 'bg-clay-700' : 'bg-brown-700 hover:bg-brown-500'
                    }`}
                    onClick={() => setSelectedId(conv.id)}
                    type="button"
                  >
                    <div className="flex -space-x-3 shrink-0">
                      {conv.participantCharacters.slice(0, 3).map((char, i) => (
                        <CharacterIcon
                          key={i}
                          character={char}
                          name={conv.participantNames[i]}
                          size={36}
                        />
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-brown-100 truncate">
                        {conv.participantNames.join(' & ')}
                      </div>
                      <div className="text-xs text-brown-300 mt-0.5">
                        {new Date(conv.ended).toLocaleDateString()} &middot; {conv.numMessages} msg
                        {conv.numMessages !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: selected conversation */}
          <div className="flex-1 min-w-0 flex flex-col">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-brown-400 italic">
                Select a conversation to read it.
              </div>
            ) : (
              <>
                <div className="px-6 py-4 border-b-4 border-brown-900 shrink-0 flex items-center gap-3">
                  <div className="flex -space-x-3 shrink-0">
                    {selected.participantCharacters.map((char, i) => (
                      <CharacterIcon
                        key={i}
                        character={char}
                        name={selected.participantNames[i]}
                        size={44}
                      />
                    ))}
                  </div>
                  <div>
                    <div className="font-display tracking-wide text-lg uppercase">
                      {selected.participantNames.join(' & ')}
                    </div>
                    <div className="text-xs text-brown-300">
                      {new Date(selected.created).toLocaleString()} &ndash;{' '}
                      {new Date(selected.ended).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <ConversationMessages worldId={worldId} conversationId={selected.id} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
