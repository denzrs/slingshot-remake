/**
 * A random id this browser keeps and sends with every connection to the relay (`?b=`), so that the
 * people behind one shared address (a VPN, a carrier NAT) are told apart by the relay's abuse limits:
 * one person's wrong passwords or busy statistics page then do not lock out the others.
 *
 * It is for that alone. The relay keeps it in memory for as long as a limit's window lasts and never
 * writes it down, logs it, or puts it in the statistics or on the board. It names nobody: 128 random
 * bits, made here, in the game's own storage, which no other site can read.
 */

const KEY = 'slingshot.browser.v1';
const ID = /^[A-Za-z0-9_-]{22}$/;

/** The id when storage cannot hold it (private windows, blocked storage): new for every page load. */
let unsaved: string | null = null;

export function browserId(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null && ID.test(stored)) return stored;
  } catch {
    // No storage: the id lasts as long as the page.
  }
  unsaved ??= newId();
  try {
    localStorage.setItem(KEY, unsaved);
  } catch {
    // As above.
  }
  return unsaved;
}

/** The relay address to open a socket on: `url` with this browser's id added, or `url` as it is. */
export function withBrowserId(url: string): string {
  try {
    const address = new URL(url);
    address.searchParams.set('b', browserId());
    return address.toString();
  } catch {
    return url;
  }
}

function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
