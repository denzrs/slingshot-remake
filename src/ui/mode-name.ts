import { t } from '../i18n';
import type { GameMode } from '../modes';

/** A game mode's name, with Mayhem behind it when its rounds have twists. */
export const modeName = (mode: GameMode, mayhem = false): string => {
  const name = t(`mode.${mode}`);
  return mayhem ? `${name} · ${t('mode.mayhem')}` : name;
};
