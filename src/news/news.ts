import { SETTINGS_KEY } from '../settings';
import { NEWS } from './items';
import type { NewsBundle } from './types';

/** The tag of the newest bundle the player has been shown. */
export const NEWS_KEY = 'slingshot.news.seen';

/** More than this many unread release bundles at once would be a wall of text; the newest win. */
export const MAX_SHOWN = 4;

/**
 * What a player is told about now: the bundles newer than the last tag they saw.
 * A first-time visitor has nothing to catch up on; a returning one who has never seen the dialog
 * (the update that brought it) gets the newest items.
 */
export function pendingNews(bundles: readonly NewsBundle[], seen: string | null, returning: boolean): NewsBundle[] {
  if (seen === null && !returning) return [];
  const seenAt = seen === null ? -1 : bundles.findIndex((bundle) => bundle.tag === seen);
  const unseen = seenAt < 0 ? bundles : bundles.slice(0, seenAt);
  return unseen.slice(0, MAX_SHOWN);
}

/** Whether this browser has played before: it has saved settings. Ask before the game saves any itself. */
export function isReturningPlayer(): boolean {
  try {
    return localStorage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
}

/** What `pendingNews` makes of this browser's storage; nothing when storage is blocked. */
export function newsForThisPlayer(returning: boolean, bundles: readonly NewsBundle[] = NEWS): NewsBundle[] {
  try {
    return pendingNews(bundles, localStorage.getItem(NEWS_KEY), returning);
  } catch {
    return [];
  }
}

/** Remember that the player knows everything up to the newest release bundle. */
export function markNewsSeen(bundles: readonly NewsBundle[] = NEWS): void {
  if (!bundles.length) return;
  try {
    localStorage.setItem(NEWS_KEY, bundles[0].tag);
  } catch {
    // Not fatal: they will see it once more.
  }
}
