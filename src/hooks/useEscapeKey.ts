import { useEffect } from 'react';

// Esc closes. Shared by the overlays so they all dismiss the same way.
//
// `enabled` lets an overlay stand down while a modal is stacked on top of it —
// otherwise one Esc dismisses the whole pile at once.
export function useEscapeKey(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, enabled]);
}
