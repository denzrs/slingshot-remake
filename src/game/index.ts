import type { Challenge } from '../challenge';
import type { Settings } from '../settings';
import { ChallengeMatch } from './challenge';
import { ClassicMatch } from './classic';
import { HorizonMatch } from './horizon';
import { SolarMatch } from './solar';
import type { Match, MatchOptions } from './match';
import type { GameMode } from '../modes';

export { ChallengeMatch, type ChallengeResult, type SectorResult, type ShotLog } from './challenge';
export { ClassicMatch } from './classic';
export { HorizonMatch } from './horizon';
export { SolarMatch } from './solar';
export * from './match';

export function createMatch(mode: GameMode, settings: Settings, options: MatchOptions = {}): Match {
  const match = mode === 'horizon' ? new HorizonMatch(settings, options) : mode === 'solar' ? new SolarMatch(settings, options) : new ClassicMatch(settings, options);
  match.newMatch();
  return match;
}

export function createChallenge(settings: Settings, challenge: Challenge): ChallengeMatch {
  const match = new ChallengeMatch(settings, challenge);
  match.newMatch();
  return match;
}
