import { useMutation, useQuery } from 'convex/react';
import { useEffect } from 'react';
import { api } from '../../convex/_generated/api';
import { WORLD_HEARTBEAT_INTERVAL, WORLD_RELEASE_DELAY } from '../../convex/constants';

// Keeps the world alive while someone is actually watching it, and stops it as
// soon as nobody is.
//
// The heartbeat is what holds a world open: `heartbeatWorld` refreshes
// `lastViewed` and restarts an inactive world, and the idle cron only reaps a
// world once that timestamp goes stale. Crucially this used to run on a plain
// interval regardless of whether the tab was visible — and background timer
// throttling floors out at roughly once a minute, exactly the heartbeat rate. So
// a tab left open behind other windows kept a world simulating at one step per
// second indefinitely: ~86k steps a day, the whole world document rewritten each
// time, plus every agent's LLM calls, for nobody.
//
// Now: heartbeat only while visible, and release the world when we stop looking.
export function useWorldHeartbeat() {
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;

  const heartbeat = useMutation(api.world.heartbeatWorld);
  const release = useMutation(api.world.releaseWorld);

  useEffect(() => {
    if (!worldId) {
      return;
    }
    // Cleared whenever we become visible again, so flicking to another tab and
    // straight back doesn't stop and restart the engine.
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;

    const cancelRelease = () => {
      if (releaseTimer !== undefined) {
        clearTimeout(releaseTimer);
        releaseTimer = undefined;
      }
    };

    const sendHeartBeat = () => {
      // A hidden tab is not a viewer. `heartbeatWorld` already skips the write
      // when `lastViewed` is recent, so this costs nothing when it's redundant.
      if (document.visibilityState !== 'visible') {
        return;
      }
      void heartbeat({ worldId });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        cancelRelease();
        sendHeartBeat();
      } else {
        cancelRelease();
        releaseTimer = setTimeout(() => void release({ worldId }), WORLD_RELEASE_DELAY);
      }
    };

    // Tab closing or navigating away: release straight away, no grace period.
    // Best-effort — the connection may be torn down before the mutation lands,
    // which is what the idle-timeout cron remains a backstop for.
    const onPageHide = () => {
      cancelRelease();
      void release({ worldId });
    };

    sendHeartBeat();
    const id = setInterval(sendHeartBeat, WORLD_HEARTBEAT_INTERVAL);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(id);
      cancelRelease();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
    // Rerun if the `worldId` changes but not `worldStatus`, since we don't want to
    // resend the heartbeat whenever its last viewed timestamp changes.
  }, [worldId, heartbeat, release]);
}
