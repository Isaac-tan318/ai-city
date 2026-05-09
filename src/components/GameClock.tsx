const CYCLE_MS = 10 * 60 * 1000;
const DAY_MS = 5 * 60 * 1000;

function computeGameTime(historicalTime: number, worldStartTime: number) {
  const elapsed = historicalTime - worldStartTime;
  const cycleProgress = ((elapsed % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  const isDay = cycleProgress < DAY_MS;
  const dayNumber = Math.floor(elapsed / CYCLE_MS) + 1;

  const rawHours = isDay
    ? 6 + (cycleProgress / DAY_MS) * 12
    : 18 + ((cycleProgress - DAY_MS) / DAY_MS) * 12;
  const normalised = rawHours % 24;
  const h12 = Math.floor(normalised) % 12 || 12;
  const minutes = Math.floor((normalised % 1) * 60);
  const ampm = normalised < 12 ? 'AM' : 'PM';
  const timeStr = `${h12}:${minutes.toString().padStart(2, '0')} ${ampm}`;

  return { dayNumber, timeStr, isDay };
}

export function GameClock({
  historicalTime,
  worldStartTime,
}: {
  historicalTime: number | undefined;
  worldStartTime: number | undefined;
}) {
  if (!historicalTime || !worldStartTime) return null;

  const { dayNumber, timeStr, isDay } = computeGameTime(historicalTime, worldStartTime);

  return (
    <div className="absolute top-2 left-2 z-10 pointer-events-none select-none">
      <div className="bg-black/50 text-white text-sm font-mono px-2 py-1 rounded flex items-center gap-1.5">
        <span>{isDay ? '☀️' : '🌙'}</span>
        <span>Day {dayNumber} · {timeStr}</span>
      </div>
    </div>
  );
}
