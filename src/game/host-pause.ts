import { PAUSE_COUNTDOWN } from './match-types';

export type PauseState = { resumeIn: number | null } | null;

/**
 * The host's pause, online only: while it is set nothing moves anywhere (no clocks, no shots, no CPUs) and no input is taken.
 * `resumeIn` is null while the game waits for the host, then the seconds of the 3-2-1 left before play goes on.
 * It rides along in the snapshot, so the guests and the stands see it too.
 */
export class HostPause {
  state: PauseState = null;

  /** Host only: stop the game for everybody until it is resumed (`allowed`: this screen is the host's, in an online game that is played). */
  stop(allowed: boolean): void {
    if (allowed && !this.state) this.state = { resumeIn: null };
  }

  /** Host only: start the countdown that ends the pause. */
  resume(): void {
    if (this.state && this.state.resumeIn === null) this.state = { resumeIn: PAUSE_COUNTDOWN };
  }

  /** The countdown runs while the game is stopped. */
  tick(dt: number): void {
    const pause = this.state;
    if (!pause || pause.resumeIn === null) return;
    // A new object each time: the sync sends a field that changed, and compares it by value.
    const left = pause.resumeIn - dt;
    this.state = left > 0 ? { resumeIn: left } : null;
  }
}
