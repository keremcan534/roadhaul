import type { FrameScheduler } from '../../core/time/GameLoop';

/**
 * requestAnimationFrame-backed scheduler. Browsers stop animation frames in
 * background tabs, so the game pauses automatically when hidden.
 */
export const animationFrameScheduler: FrameScheduler = Object.freeze({
  request: (callback: (timestampMs: number) => void) => requestAnimationFrame(callback),
  cancel: (handle: number) => cancelAnimationFrame(handle),
});
