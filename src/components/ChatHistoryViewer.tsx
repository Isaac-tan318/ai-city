import { useQuery, useConvex } from 'convex/react';
import { useState } from 'react';
import { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import closeImg from '../../assets/close.svg';

function ConversationMessages({
  worldId,
  conversationId,
}: {
  worldId: Id<'worlds'>;
  conversationId: string;
}) {
  const messages = useQuery(api.messages.listMessages, { worldId, conversationId });

  if (!messages) {
    return <div className="py-2 text-brown-300 text-sm italic">Loading...</div>;
  }
  if (messages.length === 0) {
    return <div className="py-2 text-brown-300 text-sm italic">No messages recorded.</div>;
  }
  return (
    <div className="mt-2 space-y-2">
      {messages.map((m) => (
        <div key={m._id} className="text-sm">
          <div className="flex gap-3 text-xs text-brown-300 mb-0.5">
            <span className="uppercase font-bold text-brown-200">{m.authorName}</span>
            <span>{new Date(m._creationTime).toLocaleString()}</span>
          </div>
          <p className="bg-brown-900 px-3 py-1.5 rounded text-brown-100">{m.text}</p>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const convex = useConvex();

  const conversations = useQuery(api.messages.listAllConversations, { worldId });

  const filtered = conversations?.filter(
    (c) =>
      !search ||
      c.participantNames.some((n) => n.toLowerCase().includes(search.toLowerCase())),
  );

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-brown-800 text-brown-100 w-full max-w-2xl max-h-[85vh] flex flex-col box overflow-hidden">
        {/* Header */}
        <div className="bg-brown-700 px-4 py-3 flex items-center gap-2">
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

        {/* Search */}
        <div className="px-4 pt-3 pb-1">
          <input
            className="w-full bg-brown-900 border border-brown-700 text-brown-100 px-3 py-1.5 text-sm rounded placeholder:text-brown-500 focus:outline-none focus:border-brown-300"
            placeholder="Search by participant name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Count */}
        <div className="px-4 pb-2 text-xs text-brown-300 uppercase tracking-widest">
          {filtered
            ? `${filtered.length} conversation${filtered.length !== 1 ? 's' : ''}`
            : 'Loading...'}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {!filtered && (
            <div className="text-center py-8 text-brown-300 italic">Loading conversations...</div>
          )}
          {filtered?.length === 0 && (
            <div className="text-center py-8 text-brown-300 italic">No conversations found.</div>
          )}
          {filtered?.map((conv) => {
            const isExpanded = expandedId === conv.id;
            return (
              <div key={conv.id} className="bg-brown-700 rounded overflow-hidden">
                <button
                  className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-brown-500 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : conv.id)}
                  type="button"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-brown-200 truncate">
                      {conv.participantNames.join(' & ')}
                    </div>
                    <div className="text-xs text-brown-300 mt-0.5">
                      {new Date(conv.ended).toLocaleString()} &middot;{' '}
                      {conv.numMessages} msg{conv.numMessages !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className="text-brown-300 text-xs shrink-0">{isExpanded ? '▲' : '▼'}</span>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-brown-800">
                    <ConversationMessages worldId={worldId} conversationId={conv.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
