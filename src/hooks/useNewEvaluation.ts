import { useEffect, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';

// Watches for an evaluation that lands *while you are watching*, so the scorecard
// can pop the moment a scenario resolves.
//
// The first query result is treated as already-seen history rather than news —
// otherwise every page load would open a modal for whatever last happened. Only
// rows that appear after that baseline count as new.
export function useNewEvaluation(worldId: Id<'worlds'> | undefined) {
  const evaluations = useQuery(
    api.world.recentEvaluations,
    worldId ? { worldId, limit: 5 } : 'skip',
  );
  const seen = useRef<Set<string> | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!evaluations) return;
    if (seen.current === null) {
      // Baseline: everything that already existed when we arrived.
      seen.current = new Set(evaluations.map((e) => e._id));
      return;
    }
    const fresh = evaluations.find((e) => !seen.current!.has(e._id));
    if (fresh) {
      for (const e of evaluations) seen.current.add(e._id);
      setPending(fresh._id);
    }
  }, [evaluations]);

  // Reset the baseline when switching worlds, so a wipe doesn't replay old rows.
  useEffect(() => {
    seen.current = null;
    setPending(null);
  }, [worldId]);

  const evaluation = pending ? evaluations?.find((e) => e._id === pending) : undefined;
  return { evaluation, dismiss: () => setPending(null) };
}
