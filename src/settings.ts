import type { CpuLevel } from './ai';

export interface Settings {
  opponent: 'human' | 'cpu';
  cpuLevel: CpuLevel;
  /** 0 = endless match. */
  rounds: number;
  maxPlanets: number;
  invisiblePlanets: boolean;
  bounce: boolean;
  fixedPower: boolean;
  /** Seconds before a shot fizzles out. */
  shotTime: number;
  contours: boolean;
  particles: boolean;
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  opponent: 'human',
  cpuLevel: 'medium',
  rounds: 5,
  maxPlanets: 4,
  invisiblePlanets: false,
  bounce: false,
  fixedPower: false,
  shotTime: 20,
  contours: true,
  particles: true,
  sound: true,
};

const KEY = 'slingshot.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage blocked or corrupt — fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal: settings just won't survive a reload.
  }
}
