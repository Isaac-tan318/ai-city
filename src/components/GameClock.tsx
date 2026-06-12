import { computeGameTime, dayOfWeekName } from '../../convex/aiTown/gameTime';

export function GameClock({
  historicalTime,
  worldStartTime,
}: {
  historicalTime: number | undefined;
  worldStartTime: number | undefined;
}) {
  if (!historicalTime || !worldStartTime) return null;

  const { dayNumber, timeStr, isDay } = computeGameTime(historicalTime, worldStartTime);
  const weekday = dayOfWeekName(dayNumber);

  return (
    <div className="absolute top-2 left-2 z-10 pointer-events-none select-none">
      <div className="bg-black/50 text-white text-sm font-mono px-2 py-1 rounded flex items-center gap-1.5">
        <span>{isDay ? '☀️' : '🌙'}</span>
        <span>{weekday} · Day {dayNumber} · {timeStr}</span>
      </div>
    </div>
  );
}
