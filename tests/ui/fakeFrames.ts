// A fake browser for frame-loop tests: tests fire animation frames and visibility changes by hand.
import type { FrameEnvironment } from '../../src/ui/frameLoop';

export class FakeFrames implements FrameEnvironment {
  hidden = false;
  private pending = new Map<number, (timeMs: number) => void>();
  private nextHandle = 1;
  private listener: (() => void) | undefined;
  requestFrame(callback: (timeMs: number) => void) {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    return handle;
  }
  cancelFrame(handle: number) {
    this.pending.delete(handle);
  }
  isHidden() {
    return this.hidden;
  }
  onVisibilityChange(onChange: () => void) {
    this.listener = onChange;
    return () => {
      this.listener = undefined;
    };
  }
  get pendingFrames() {
    return this.pending.size;
  }
  /** Runs every pending frame callback at `timeMs`, as the browser does once per frame. */
  fire(timeMs: number) {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback(timeMs);
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.listener?.();
  }
}
