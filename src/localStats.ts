import type { GameEvent, Match } from './game';
import { rulesOf } from './lobbyPrefs';
import { DEFAULT_SERVER } from './multiplayer';
import { NetworkClient, type LocalGameReport } from './net';
import type { RoundReport } from './roundReport';
import { roundReport } from './roundReport';
import type { Settings } from './settings';

/** What it takes to tell the relay: a connection, one message, and a goodbye — the stand-in in tests, or the WebSocket client. */
export type ReportConnection = Pick<NetworkClient, 'connect' | 'send' | 'close'>;

/** Tells the relay of a game, over a connection of its own that lasts as long as it takes. A relay that cannot be reached loses the report: nobody is waiting for it. */
export async function reportLocalGame(report: LocalGameReport, connection: ReportConnection = new NetworkClient(DEFAULT_SERVER)): Promise<void> {
  try {
    await connection.connect();
    connection.send({ type: 'local_game', ...report });
    // The relay reads what was sent before it reads that the socket closed.
    await new Promise((resolve) => setTimeout(resolve, 200));
  } catch {
    // Nothing to do: it is statistics, not a save game.
  } finally {
    connection.close();
  }
}

/**
 * Keeps the rounds of a game played on this device, and tells the relay of the game when it is over. Only a game
 * that was played to its end is told: one that was left halfway has no result worth keeping. A rematch on the
 * same match starts the count over.
 */
export function trackLocalGame(match: Match, rules: Settings, send: (report: LocalGameReport) => void): void {
  let rounds: RoundReport[] = [];
  match.on((event: GameEvent) => {
    if (event.type === 'round' && match.round === 1) rounds = [];
    else if (event.type === 'roundEnd') rounds.push(roundReport(match));
    else if (event.type === 'gameOver' && rounds.length) {
      send({
        gameMode: match.mode === 'horizon' || match.mode === 'solar' ? match.mode : 'classic',
        mode: match.teamMode ? 'team' : 'ffa',
        rules: rulesOf(rules),
        seats: match.players.map((p) => ({ cpu: p.cpu, team: match.teamMode ? ((p.team ?? 0) as 0 | 1) : null })),
        rounds,
      });
      rounds = [];
    }
  });
}
