/**
 * Invite links: instead of passing a room code around, the host copies one link that opens the client
 * and puts the guest straight into the room. The link carries the room code and, for a room the host
 * locked, its password — plus the relay the room runs on when the build has none of its own.
 */

/** Where the room code, the password and the relay ride in the URL. */
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
  if (password) url.searchParams.set(PASSWORD_PARAM, password);
  return url.toString();
}

/** The invite a page was opened with, or null for a plain visit. */
export function readInvite(search: string): Invite | null {
  const params = new URLSearchParams(search);
  const roomId = params.get(ROOM_PARAM)?.trim() ?? '';
  if (!ROOM_CODE.test(roomId)) return null;
  const server = params.get(SERVER_PARAM)?.trim() ?? '';
  const password = params.get(PASSWORD_PARAM) ?? '';
  return {
    roomId,
    ...(RELAY_ADDRESS.test(server) ? { server } : {}),
    ...(password ? { password } : {}),
  };
}

/** The same URL with the invite parameters taken out, so a reload doesn't bring the invitation up again. */
export function withoutInvite(href: string): string {
  const url = new URL(href);
  for (const param of [ROOM_PARAM, PASSWORD_PARAM, SERVER_PARAM]) url.searchParams.delete(param);
  return url.toString();
}
