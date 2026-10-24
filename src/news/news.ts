import { SETTINGS_KEY } from '../settings';
import { NEWS } from './items';
import type { NewsItem } from './types';

/** The id of the newest item the player has been shown. */
export const NEWS_KEY = 'slingshot.news.seen';

/** More than this many unread items at once would be a wall of text; the newest win. */
export const MAX_SHOWN = 4;

/**
 * What a player is told about now: the items above the one they last saw, newest first.
 * A first-time visitor has nothing to catch up on; a returning one who has never seen the dialog
 * (the update that brought it) gets the newest items.
 */
export function pendingNews(items: readonly NewsItem[], seen: string | null, returning: boolean): NewsItem[] {
  if (seen === null && !returning) return [];
  const seenAt = seen === null ? -1 : items.findIndex((item) => item.id === seen);
  const unseen = seenAt < 0 ? items : items.slice(0, seenAt);
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
export function newsForThisPlayer(returning: boolean, items: readonly NewsItem[] = NEWS): NewsItem[] {
  try {
    return pendingNews(items, localStorage.getItem(NEWS_KEY), returning);
  } catch {
    return [];
  }
}

/** Remember that the player knows everything up to the newest item. */
export function markNewsSeen(items: readonly NewsItem[] = NEWS): void {
  if (!items.length) return;
  try {
    localStorage.setItem(NEWS_KEY, items[0].id);
  } catch {
    // Not fatal: they will see it once more.
  }
}
