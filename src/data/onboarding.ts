/** Bump only when a new introduction should be offered to everybody again. */
export const ONBOARDING_KEY = 'slingshot.onboarding.v1';

export function needsOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== 'done';
  } catch {
    return true;
  }
}

/** The address parameter that leaves the introduction out for this visit: `?nointro`. */
export const NO_INTRO_PARAM = 'nointro';

/**
 * Whether the page address asks to start without the introduction. For automated runs and agents, which open a fresh
 * browser every time: nothing is saved, so the next visit without it is offered the introduction as ever.
 */
export function introSkipped(search: string): boolean {
  return new URLSearchParams(search).has(NO_INTRO_PARAM);
}

/** Skipping is also a deliberate end to the introduction. */
export function finishOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'done');
  } catch {
    // The game remains playable with storage blocked.
  }
}
