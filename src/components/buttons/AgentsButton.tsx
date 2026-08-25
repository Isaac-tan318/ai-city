import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { AgentsPanel } from '../AgentsPanel.tsx';

// Footer button that opens the agents roster. Self-contained (fetches the default
// world itself) so it can sit next to Chats and Decider rather than inside the
// Game panel, the same way ChatHistoryButton does.
export default function AgentsButton() {
  const [show, setShow] = useState(false);
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const engineId = worldStatus?.engineId;
  return (
    <>
      <button
        type="button"
        className="button text-white shadow-solid text-xl pointer-events-auto"
        onClick={() => setShow(true)}
        title="Inspect and edit every character"
      >
        <div className="inline-block bg-clay-700">
          <span>
            <div className="inline-flex h-full items-center gap-4 px-4">Agents</div>
          </span>
        </div>
      </button>
      {show && worldId && engineId && (
        <AgentsPanel worldId={worldId} engineId={engineId} onClose={() => setShow(false)} />
      )}
    </>
  );
}
