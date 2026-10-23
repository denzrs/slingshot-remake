import { challengeNumber, shiftDate } from './challenge';
import { CHALLENGE } from './config';
import { DEFAULT_SERVER } from './multiplayer';
import { NetworkClient, type DailyEntry } from './net';

/** A day's leaderboard as the relay hands it over. */
export interface DailyBoard {
  day: string;
  entries: DailyEntry[];
  /** Your own run, wherever it sits; null when you have not posted one for that day. */
  you: DailyEntry | null;
}

/** What the leaderboard needs from a connection — the WebSocket client, or a stand-in in tests. */
export type BoardConnection = Pick<NetworkClient, 'connect' | 'onMessage' | 'send' | 'close'>;

/** How long the relay gets to answer before the leaderboard gives up on it. */
const REPLY_TIMEOUT_MS = 10_000;

/**
 * The relay said no: the run or the name it came with would not do. Its own words are shown to the
 * player, so a refused name can be typed again instead of looking like a broken connection.
 */
export class BoardRejected extends Error {}

/**
 * The daily-challenge leaderboard, over the same relay as the multiplayer games: one short-lived
 * connection per request, so a result screen needs nothing from the lobby to be connected.
 */
export class Leaderboard {
  constructor(private readonly connection: () => BoardConnection = () => new NetworkClient(DEFAULT_SERVER)) {}

  /** A day's board, without posting anything. */
  top(day: string): Promise<DailyBoard> {
    return this.ask({ type: 'daily_top', day }, day);
  }

  /** Post a run under a name, and get the board it landed on back. */
  submit(day: string, name: string, score: number): Promise<DailyBoard> {
    return this.ask({ type: 'daily_submit', day, name, score }, day);
  }

  private async ask(request: Parameters<NetworkClient['send']>[0], day: string): Promise<DailyBoard> {
    const connection = this.connection();
    try {
      await connection.connect();
      const { promise, resolve, reject } = Promise.withResolvers<DailyBoard>();
      const timer = setTimeout(() => reject(new Error('The leaderboard did not answer')), REPLY_TIMEOUT_MS);
      connection.onMessage((message) => {
        if (message.type === 'daily_board' && message.day === day) {
          clearTimeout(timer);
          resolve({ day: message.day, entries: message.entries, you: message.you });
        } else if (message.type === 'error') {
          clearTimeout(timer);
          reject(new BoardRejected(message.message));
        } else if (message.type === 'closed') {
          clearTimeout(timer);
          reject(new Error(message.message));
        }
      });
      connection.send(request);
      return await promise;
    } finally {
      connection.close();
    }
  }
}

/** How many days back the relay keeps a board (`daily.keepDays` in `server/protocol-contract.json`). */
export const BOARD_KEEP_DAYS = 7;

/** The oldest day whose board can still hold runs, seen from `today`; never before the first challenge. */
export function oldestBoardDay(today: string): string {
  const oldest = shiftDate(today, -BOARD_KEEP_DAYS);
  return challengeNumber(oldest) < 1 ? CHALLENGE.EPOCH : oldest;
}
