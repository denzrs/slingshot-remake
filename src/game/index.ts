import type { Settings } from '../settings';
import { ClassicMatch } from './classic';
import { HorizonMatch } from './horizon';
import type { Match, MatchOptions, Mode } from './match';

export { ClassicMatch } from './classic';
export { HorizonMatch } from './horizon';
export * from './match';

export function createMatch(mode: Mode, settings: Settings, options: MatchOptions = {}): Match {
  const match = mode === 'horizon' ? new HorizonMatch(settings, options) : new ClassicMatch(settings, options);
  match.newMatch();
  return match;
}
