import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { ChatHistoryViewer } from '../ChatHistoryViewer.tsx';

// Footer button that opens the full chat-history browser. Self-contained (fetches
// the default world itself) so it can live next to the Analysis button in the
// footer rather than inside the Game panel.
export default function ChatHistoryButton() {
  const [show, setShow] = useState(false);
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  return (
    <>
      <button
        type="button"
        className="button text-white shadow-solid text-xl pointer-events-auto"
        onClick={() => setShow(true)}
        title="Browse past conversations"
      >
        <div className="inline-block bg-clay-700">
          <span>
            <div className="inline-flex h-full items-center gap-4 px-4">Chats</div>
          </span>
        </div>
      </button>
      {show && worldId && <ChatHistoryViewer worldId={worldId} onClose={() => setShow(false)} />}
    </>
  );
}
