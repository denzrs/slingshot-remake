/**
 * Invite links: instead of passing a room code around, the host copies one link that opens the client
 * and puts the guest straight into the room. The link carries the room code and, for a room the host
 * locked, its password in the URL fragment — plus the relay the room runs on when the build has none of its own.
 */

/** Where the room code and relay ride in the URL. */
const ROOM_PARAM = 'join';
const PASSWORD_PARAM = 'pw';
const SERVER_PARAM = 'server';

/** A room code: the relay's are short, and the join field takes no longer ones. */
const ROOM_CODE = /^[A-Za-z0-9_-]{1,16}$/;
/** A relay address a client could connect to. */
const RELAY_ADDRESS = /^wss?:\/\/\S+$/;

export interface Invite {
  roomId: string;
  /** The room's password, when the link was made by somebody who had it. */
  password?: string;
  /** The relay the room lives on, when the link names one. */
  server?: string;
}

/**
 * The link that invites somebody into a room: the client's own address, so it opens the same build.
 * Without a room code (or with an unusable relay address) there is no link to share.
 */
export function inviteLink(client: string, roomId: string, server?: string, password?: string): string {
  if (!ROOM_CODE.test(roomId)) return '';
  const url = new URL(client);
  url.searchParams.set(ROOM_PARAM, roomId);
  if (server && RELAY_ADDRESS.test(server)) url.searchParams.set(SERVER_PARAM, server);
  if (password) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.set(PASSWORD_PARAM, password);
    url.hash = fragment.toString();
  }
  return url.toString();
}

/** The invite a page was opened with, or null for a plain visit. */
export function readInvite(search: string, hash = ''): Invite | null {
  const params = new URLSearchParams(search);
  const roomId = params.get(ROOM_PARAM)?.trim() ?? '';
  if (!ROOM_CODE.test(roomId)) return null;
  const server = params.get(SERVER_PARAM)?.trim() ?? '';
  // Accept the old query parameter for links already shared, but new links keep secrets in the fragment.
  const password = new URLSearchParams(hash.replace(/^#/, '')).get(PASSWORD_PARAM) ?? params.get(PASSWORD_PARAM) ?? '';
  return {
    roomId,
    ...(RELAY_ADDRESS.test(server) ? { server } : {}),
    ...(password ? { password } : {}),
  };
}

/** Whether an invite may connect on arrival without switching the player's saved relay. */
export function shouldAutoConnectInvite(invite: Invite | null, savedServer: string): boolean {
  return !invite || !invite.server || invite.server === savedServer;
}

/** Guests in a locked room don't know its password, so only its host can copy a join-ready link. */
export function canCopyInvite(roomLocked: boolean, isHost: boolean): boolean {
  return !roomLocked || isHost;
}

/** The auto-join decision made once the invite's relay is connected. */
export function inviteJoinAttempt(
  invite: Invite | null,
  pending: boolean,
  connected: boolean,
  playerName: string,
): { kind: 'wait' | 'name-required' | 'join'; pending: boolean; roomId?: string; name?: string; password?: string } {
  if (!invite || !pending || !connected) return { kind: 'wait', pending };
  const name = playerName.trim();
  if (!name) return { kind: 'name-required', pending: false };
  return { kind: 'join', pending: false, roomId: invite.roomId, name, password: invite.password };
}

/** Remove just the invite secret after reading it, leaving a failed invite available for retry. */
export function withoutInvitePassword(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(PASSWORD_PARAM);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.has(PASSWORD_PARAM)) {
    fragment.delete(PASSWORD_PARAM);
    url.hash = fragment.size ? fragment.toString() : '';
  }
  return url.toString();
}

/** The same URL with the invite parameters taken out, so a reload doesn't bring the invitation up again. */
export function withoutInvite(href: string): string {
  const url = new URL(withoutInvitePassword(href));
  for (const param of [ROOM_PARAM, SERVER_PARAM]) url.searchParams.delete(param);
  return url.toString();
}
