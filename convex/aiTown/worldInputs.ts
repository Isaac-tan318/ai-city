import { v } from 'convex/values';
import { inputHandler } from './inputHandler';

export const worldInputs = {
  skipTime: inputHandler({
    args: { skipMs: v.number() },
    handler: (game, _now, { skipMs }) => {
      if (game.world.worldStartTime !== undefined) {
        game.world.worldStartTime -= skipMs;
      }
      return null;
    },
  }),
};
