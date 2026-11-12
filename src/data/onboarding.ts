/** Bump only when a new introduction should be offered to everybody again. */
export const ONBOARDING_KEY = 'slingshot.onboarding.v1';

export function needsOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== 'done';
  } catch {
    return true;
  }
}

/** Skipping is also a deliberate end to the introduction. */
export function finishOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'done');
  } catch {
    // The game remains playable with storage blocked.
  }
}
