import { t } from '../platform/i18n';
import type { NetworkCpuLevel } from '../net/net';

/**
 * Looking through a pretend player's eyes (dev build): a new tab opened with `?as=…` takes the bot's seat and its
 * tournament person over with their tokens, the way a dropped connection comes back, and shows the room, the bracket
 * and the game as the bot sees them. The tab says it is a pretend player too, so in the game the host still plays it.
 */
export interface Impersonation {
  name: string;
  /** The relay, as the game's own address (without `?bot=`). */
  relay: string;
  level: NetworkCpuLevel;
  /** The seat's token, while the bot sits in a room. */
  seat: string | null;
  /** The person's token, while the bot is in a tournament. */
  tournament: string | null;
}

export const IMPERSONATE_PARAM = 'as';

/** The address of a tab that takes the bot over. */
export function impersonationUrl(who: Impersonation): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('nointro', '');
  url.searchParams.set('debug', '');
  url.searchParams.set(IMPERSONATE_PARAM, btoa(encodeURIComponent(JSON.stringify(who))));
  return url.toString().replace(/=(?=&|$)/g, '');
}

export function readImpersonation(search: string): Impersonation | null {
  const raw = new URLSearchParams(search).get(IMPERSONATE_PARAM);
  if (!raw) return null;
  try {
    const who = JSON.parse(decodeURIComponent(atob(raw))) as Partial<Impersonation>;
    if (typeof who.name !== 'string' || typeof who.relay !== 'string' || typeof who.level !== 'string') return null;
    return { name: who.name, relay: who.relay, level: who.level, seat: who.seat ?? null, tournament: who.tournament ?? null };
  } catch {
    return null;
  }
}

/** The relay address a pretend player connects on: the dev relay plays its seat as a CPU of this level. */
export function botAddress(relay: string, level: NetworkCpuLevel): string {
  const address = new URL(relay);
  address.searchParams.set('bot', level);
  return address.toString();
}

/** A chip in the corner: whose eyes this tab looks through. */
export function showImpersonationChip(who: Impersonation): void {
  const chip = document.createElement('div');
  chip.className = 'dev-as-chip';
  chip.textContent = t('dev.bots.as', { name: who.name });
  document.body.append(chip);
  document.title = `[${who.name}] ${document.title}`;
}
