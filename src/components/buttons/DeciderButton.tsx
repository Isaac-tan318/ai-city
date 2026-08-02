import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { DeciderViewer } from '../DeciderViewer.tsx';

// Footer button that opens the Decider panel. Self-contained (fetches the default
// world itself) so it can sit next to the Chats and Analysis buttons rather than
// inside the Game panel — same shape as ChatHistoryButton.
export default function DeciderButton() {
  const [show, setShow] = useState(false);
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  return (
    <>
      <button
        type="button"
        className="button text-white shadow-solid text-xl pointer-events-auto"
        onClick={() => setShow(true)}
        title="How the Decider framed each group decision, and what it has worked out about people"
      >
        <div className="inline-block bg-clay-700">
          <span>
            <div className="inline-flex h-full items-center gap-4 px-4">Decider</div>
          </span>
        </div>
      </button>
      {show && worldId && <DeciderViewer worldId={worldId} onClose={() => setShow(false)} />}
    </>
  );
}
