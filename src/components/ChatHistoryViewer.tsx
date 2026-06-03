import { useQuery, useConvex } from 'convex/react';
import { useState } from 'react';
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
  const convex = useConvex();

  const conversations = useQuery(api.messages.listAllConversations, { worldId });

  const filtered = conversations?.filter(
    (c) =>
      !search || c.participantNames.some((n) => n.toLowerCase().includes(search.toLowerCase())),
  );

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6"
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
