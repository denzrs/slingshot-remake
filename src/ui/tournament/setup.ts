import { t } from '../../platform/i18n';
import { TEMPLATE_STAGES } from '../../data/tournamentTemplates';
import type { TournamentStage } from '../../net/net';
import { RULE_KEYS, type RoomRules } from '../../data/roomRules';
import type { GameMode } from '../../sim/modes';
import { presetLabelKey, presetRules, presetsForMode, type MatchPreset } from '../presets/match-presets';

/** The levels of a bracket counted from the final, as the relay takes their games: final, semi-finals, quarter-finals, round of 16. */
export const STAGES = TEMPLATE_STAGES;
/** A level by its place in the bracket: Round 1, 2, … and the final. `depth` is how many levels the bracket has, so the first played is Round 1 however big it grows. */
export const stageName = (stage: number, depth: number): string => stage <= 0 ? t('tournament.stage.final') : t('tournament.stage.round', { n: Math.max(1, depth - stage) });

/** How many rounds a match may last. */
export const ROUND_CHOICES = [1, 3, 5, 7, 10] as const;

/** A level's game as the page shows it: a mode, the preset its rules are (or come nearest), and how many rounds a match lasts. */
export interface StagePick {
  mode: GameMode;
  /** None only for a mode without presets. */
  preset: MatchPreset | null;
  rounds: number;
}

/** A level's game as the relay takes it. */
export function stageOf(pick: { mode: GameMode; preset: MatchPreset; rounds: number }): TournamentStage {
  return { gameMode: pick.mode, rules: { ...presetRules(pick.preset, pick.mode), rounds: pick.rounds } };
}

const sameRule = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The rules the level's dialog sets beside the preset, as the setup page does: changing them keeps the preset. */
export const QUICK_RULES: readonly (keyof RoomRules)[] = ['rounds', 'shotTime', 'powerUps', 'powerUpKinds'];

/** How many rules differ from a preset's, the quick rules and Mayhem's strength aside. */
function distance(rules: RoomRules, expected: RoomRules): number {
  return RULE_KEYS.filter((key) => !QUICK_RULES.includes(key)
    && !(key === 'mayhem' ? (rules.mayhem > 0) === (expected.mayhem > 0) : sameRule(rules[key], expected[key]))).length;
}

/** Which preset a level's rules are, or the nearest when rules were changed beyond the preset's. */
export function pickOf(stage: TournamentStage): StagePick {
  const rules = stage.rules as RoomRules;
  let preset: MatchPreset | null = null;
  let best = Infinity;
  for (const candidate of presetsForMode(stage.gameMode)) {
    const d = distance(rules, presetRules(candidate, stage.gameMode));
    if (d < best) { best = d; preset = candidate; }
  }
  return { mode: stage.gameMode, preset, rounds: rules.rounds };
}

/** "Classic · All at once": a level's game in a few words. */
export function pickLabel(pick: StagePick): string {
  const mode = t(`mode.${pick.mode}`);
  return pick.preset ? `${mode} · ${t(presetLabelKey(pick.preset, pick.mode))}` : mode;
}

/** What a new tournament plays: quick early levels, a longer final. */
export function defaultStages(): TournamentStage[] {
  return Array.from({ length: STAGES }, (_, stage) => stageOf({ mode: 'classic', preset: 'simultaneous', rounds: stage === 0 ? 5 : 3 }));
}

/** How many levels a bracket for `teams` teams has. */
export const levelsFor = (teams: number): number => Math.max(1, Math.ceil(Math.log2(Math.max(2, teams))));
