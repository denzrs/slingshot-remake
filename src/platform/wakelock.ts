/**
 * Keeps the screen on while a match is on screen, so a phone does not dim between two shots. The browser lets go of a
 * wake lock whenever the page is hidden, so it is asked for again when the page comes back.
 */

type WakeApi = { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } };
type PageVisibility = Pick<Document, 'visibilityState' | 'addEventListener'>;

export class ScreenWake {
  private lock: WakeLockSentinel | null = null;
  private wanted = false;
  private asking = false;

  constructor(
    private readonly nav: WakeApi | undefined = globalThis.navigator,
    private readonly page: PageVisibility | undefined = globalThis.document,
  ) {
    page?.addEventListener('visibilitychange', () => void this.acquire());
  }

  get supported(): boolean {
    return !!this.nav?.wakeLock;
  }

  /** Whether the screen is being held on right now. */
  get held(): boolean {
    return this.lock !== null;
  }

  /** Ask for the screen to stay on, or let it go. Cheap to call every frame with the same answer. */
  set(wanted: boolean): void {
    if (wanted === this.wanted) return;
    this.wanted = wanted;
    if (wanted) void this.acquire();
    else this.release();
  }

  private release(): void {
    const lock = this.lock;
    this.lock = null;
    void lock?.release().catch(() => {});
  }

  private async acquire(): Promise<void> {
    if (!this.wanted || this.lock || this.asking || !this.nav?.wakeLock || this.page?.visibilityState === 'hidden') return;
    this.asking = true;
    try {
      const lock = await this.nav.wakeLock.request('screen');
      if (!this.wanted) {
        void lock.release().catch(() => {});
        return;
      }
      this.lock = lock;
      lock.addEventListener('release', () => {
        if (this.lock === lock) this.lock = null;
      });
    } catch {
      // Refused (a low battery, a policy): the screen dims as it always did.
    } finally {
      this.asking = false;
    }
  }
}
