import type { Mode } from '../../game';
import type { GameMode } from '../../sim/modes';
import type { StatsReplay } from '../../net/net';
import type { Settings } from '../../data/settings';
import type { LobbyEntry } from '../lobby';
import type { Menu } from '../menu/menu';

export interface App {
  menu: Menu;
  settings: Settings;
  settingsChanged(): void;
  /** The mode being played right now, null on the title screen. */
  readonly mode: Mode | null;
  /** Whether the game on screen is a Mayhem game. */
  readonly mayhem: boolean;
  /** Today's date key — the real one, unless the URL asks for another day. */
  today(): string;
  start(mode: GameMode): void;
  startDaily(): void;
  /** True while an online match is on screen. */
  readonly online: boolean;
  /** True while a recorded game is being flown again. */
  readonly replaying: boolean;
  watchReplay(data: StatsReplay): void;
  /** Fly the replay on screen again from the start. */
  watchAgain(): void;
  /** Back to the statistics, from a replay. */
  leaveReplay(): void;
  openLobby(entry?: LobbyEntry): void;
  /** Host only: end the online game and bring the whole room back to its lobby. */
  backToLobby(): void;
  /** Leave the online game and its room for the room list, still connected. */
  leaveOnlineRoom(): void;
  resume(): void;
  rematch(): void;
  /** What the pause menu offers about skipping the round: nothing, to skip it, to call a vote, or to answer the open one. */
  readonly skipOffer: 'skip' | 'call' | 'answer' | null;
  /** Skips the round (offline) or calls the vote (online host). */
  skipRound(): void;
  /** Answers the open vote to skip the round. */
  answerSkip(yes: boolean): void;
  toTitle(): void;
  toggleFullscreen(): void;
  isFullscreen(): boolean;
}
