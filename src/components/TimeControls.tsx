import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { CYCLE_MS, DAY_MS, computeGameTime, cycleProgressForHour } from '../../convex/aiTown/gameTime';

export function TimeControls({
  historicalTime,
  worldStartTime,
}: {
  historicalTime: number | undefined;
  worldStartTime: number | undefined;
}) {
  const stopAllowed = useQuery(api.testing.stopAllowed) ?? false;
  const defaultWorld = useQuery(api.world.defaultWorldStatus);
  const frozen = defaultWorld?.status === 'stoppedByDeveloper';

  const stop = useMutation(api.testing.stop);
  const resume = useMutation(api.testing.resume);
  const skipTime = useMutation(api.testing.skipTime);

  const cycleProgress = (() => {
    if (!historicalTime || !worldStartTime) return 0;
    const elapsed = historicalTime - worldStartTime;
    return ((elapsed % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  })();

  const skipToDay = () => {
    // Advance to next 6 AM (start of day phase = cycleProgress 0)
    const ms = cycleProgress === 0 ? CYCLE_MS : CYCLE_MS - cycleProgress;
    skipTime({ skipMs: ms });
  };

  const skipToNight = () => {
    // Advance to next 6 PM (start of night phase = cycleProgress DAY_MS)
    const ms = cycleProgress < DAY_MS ? DAY_MS - cycleProgress : CYCLE_MS - cycleProgress + DAY_MS;
    skipTime({ skipMs: ms });
  };

  const skipOneHour = () => {
    // One game-hour is now a different number of real-ms during the day vs. the
    // night, so derive the skip from the current game time rather than a constant.
    if (!historicalTime || !worldStartTime) return;
    const gt = computeGameTime(historicalTime, worldStartTime);
    let ms = cycleProgressForHour(gt.hour + 1) - cycleProgressForHour(gt.hour);
    if (ms <= 0) ms += CYCLE_MS; // wrapped past 6 AM into the next cycle
    skipTime({ skipMs: ms });
  };

  if (!stopAllowed) return null;

  return (
    <div className="absolute bottom-2 left-2 z-10 flex gap-1.5 pointer-events-auto">
      <button
        onClick={() => (frozen ? resume() : stop())}
        className="bg-black/60 text-white text-xs font-mono px-2 py-1 rounded hover:bg-black/80 transition-colors"
        title={frozen ? 'Resume simulation' : 'Pause simulation'}
      >
        {frozen ? '▶ Resume' : '⏸ Pause'}
      </button>
      <button
        onClick={skipToDay}
        className="bg-black/60 text-white text-xs font-mono px-2 py-1 rounded hover:bg-black/80 transition-colors"
        title="Skip to next dawn (6 AM)"
      >
        ☀️ Day
      </button>
      <button
        onClick={skipToNight}
        className="bg-black/60 text-white text-xs font-mono px-2 py-1 rounded hover:bg-black/80 transition-colors"
        title="Skip to next dusk (6 PM)"
      >
        🌙 Night
      </button>
      <button
        onClick={skipOneHour}
        className="bg-black/60 text-white text-xs font-mono px-2 py-1 rounded hover:bg-black/80 transition-colors"
        title="Skip forward 1 in-game hour (~35s by day, ~15s by night)"
      >
        ⏩ +1h
      </button>
    </div>
  );
}
