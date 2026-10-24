import { AIM, GRACE, MAYHEM, TRAIL_FADE } from '../config';
import { KILLCAM_MODES, type KillcamMode } from '../settings';
import type { VersusMode } from '../game';
import { t, type Key } from '../i18n';
import type { RoomRules } from '../net';
import { POWER_UP, POWER_UP_KINDS, type PowerUpKind } from '../powerups';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../render/powerup-art';
import type { MenuItem } from './menu';

/** The blocks the setup screen and the lobby sort the rules into. */
type RuleGroup = 'match' | 'field' | 'shots' | 'twists' | 'powerups';

export const RULE_GROUPS: readonly RuleGroup[] = ['match', 'field', 'shots', 'twists', 'powerups'];

export const groupTitle = (group: RuleGroup): string => t(`setup.group.${group}` as Key);

// ————————————————————————————— Shot power —————————————————————————————

/** How a game limits shot power: not at all, with a cap, or by giving every shot the same power. */
export type PowerMode = 'free' | 'cap' | 'fixed';

const POWER_MODES: readonly PowerMode[] = ['free', 'cap', 'fixed'];

/** The cap a game gets when it is first limited. */
export const DEFAULT_CAP = 70;

/** The stops of the cap's slider: every cap below "no cap", which is a mode of its own. */
export const CAP_STOPS: readonly number[] = AIM.CAP_OPTIONS.filter((n) => n < AIM.MAX_POWER);

/** A cap and a fixed power never apply together: `fixedPower` wins, then any cap below the top. */
export function powerModeOf(r: Pick<RoomRules, 'fixedPower' | 'maxPower'>): PowerMode {
  if (r.fixedPower) return 'fixed';
  return r.maxPower < AIM.MAX_POWER ? 'cap' : 'free';
}

/** The rules that change when the power mode does; `cap` is the cap to return to. */
export function powerModePatch(mode: PowerMode, cap: number = DEFAULT_CAP): Pick<RoomRules, 'fixedPower' | 'maxPower'> {
  switch (mode) {
    case 'free':
      return { fixedPower: false, maxPower: AIM.MAX_POWER };
    case 'cap':
      return { fixedPower: false, maxPower: cap };
    case 'fixed':
      // The cap goes: a fixed shot is never held back by it.
      return { fixedPower: true, maxPower: AIM.MAX_POWER };
  }
}

// ————————————————————————————— The rules —————————————————————————————

interface RuleRow {
  key: keyof RoomRules;
  label: string;
  /** Every value the rule can take — for a slider, its stops from lowest to highest. */
  options: { value: number | boolean | PowerMode | PowerUpKind | KillcamMode; label: string }[];
  /** Switches for on/off rules, sliders for numbers, a segmented bar for a choice between a few words, tiles for several that can each be on or off. */
  control: 'toggle' | 'slider' | 'segmented' | 'tiles';
  group: RuleGroup;
  /** Only meaningful in Classic (Event Horizon always shows its planets and scores trick shots anyway). */
  classicOnly?: boolean;
  /** Only meaningful in an online game (there is nobody to wait for offline). */
  onlineOnly?: boolean;
  /** Shown only while this holds, e.g. the cap's slider while shot power is capped. */
  when?: (rules: RoomRules) => boolean;
  /** While hidden and this holds, the row keeps its space, so the block doesn't grow and shrink. */
  reserve?: (rules: RoomRules) => boolean;
  /** Shown but dimmed and unchangeable while this holds, e.g. the cap's slider while shot power is free. */
  inactive?: (rules: RoomRules) => boolean;
}

const numbers = (values: readonly number[], label: (n: number) => string = String) => values.map((n) => ({ value: n, label: label(n) }));

/** The rules of a game, in the order the setup screen and the multiplayer lobby list them. */
export function ruleRows(): RuleRow[] {
  const seconds = (n: number) => t('settings.seconds', { n });
  return [
    { key: 'rounds', group: 'match', control: 'slider', label: t('settings.rounds'), options: numbers([1, 3, 5, 7, 10, 15, 20, 0], (n) => (n ? String(n) : t('settings.endless'))) },
    // Only while Mayhem is on: the Mayhem preset turns it on, every other preset off, so the strength is never "off" here.
    { key: 'mayhem', group: 'match', control: 'segmented', label: t('settings.mayhem'), options: numbers(MAYHEM.LEVELS.filter((n) => n > 0), (n) => t(`settings.mayhem.${n}` as Key)), when: (r) => r.mayhem > 0 },
    { key: 'shotTime', group: 'match', control: 'slider', label: t('settings.shotTime'), options: numbers([10, 20, 30, 60], seconds) },
    { key: 'killcam', group: 'match', control: 'segmented', label: t('settings.killcam'), options: KILLCAM_MODES.map((value) => ({ value, label: t(`settings.killcam.${value}` as Key) })) },
    { key: 'maxPlanets', group: 'field', control: 'slider', label: t('settings.maxPlanets'), options: numbers([1, 2, 3, 4, 5, 6, 7, 8]) },
    { key: 'invisiblePlanets', group: 'field', control: 'toggle', label: t('settings.invisible'), options: [], classicOnly: true },
    { key: 'bounce', group: 'field', control: 'toggle', label: t('settings.bounce'), options: [] },
    {
      key: 'fixedPower',
      group: 'shots',
      control: 'segmented',
      label: t('settings.power'),
      options: POWER_MODES.map((value) => ({ value, label: t(`settings.power.${value}` as Key) })),
    },
    // One slot for the limit: the cap, or (with fixed power) the fixed level's row. Free shows the cap dimmed, so nothing moves.
    { key: 'maxPower', group: 'shots', control: 'slider', label: t('settings.maxPower'), options: numbers(CAP_STOPS), when: (r) => powerModeOf(r) !== 'fixed', inactive: (r) => powerModeOf(r) === 'free' },
    { key: 'fixedPowerLevel', group: 'shots', control: 'slider', label: t('settings.fixedPower'), options: numbers(AIM.FIXED_OPTIONS), when: (r) => powerModeOf(r) === 'fixed' },
    { key: 'styleBonuses', group: 'shots', control: 'toggle', label: t('settings.styleBonuses'), options: [], classicOnly: true },
    { key: 'simultaneousShots', group: 'shots', control: 'toggle', label: t('settings.simultaneousShots'), options: [], classicOnly: true },
    { key: 'neighborGrace', group: 'twists', control: 'slider', label: t('settings.neighborGrace'), options: numbers(GRACE.OPTIONS, (n) => (n ? t(n === 1 ? 'settings.oneRound' : 'settings.nRounds', { n }) : t('common.off'))) },
    { key: 'hiddenAim', group: 'twists', control: 'toggle', label: t('settings.hiddenAim'), options: [] },
    { key: 'fadingTrails', group: 'twists', control: 'slider', label: t('settings.fadingTrails'), options: numbers(TRAIL_FADE.OPTIONS, (n) => (n ? seconds(n) : t('common.off'))) },
    { key: 'betting', group: 'twists', control: 'toggle', label: t('settings.betting'), options: [], onlineOnly: true },
    { key: 'chatPlayersOnly', group: 'twists', control: 'toggle', label: t('settings.chatPlayersOnly'), options: [], onlineOnly: true },
    { key: 'powerUpKinds', group: 'powerups', control: 'tiles', label: t('powerups.kinds'), options: POWER_UP_KINDS.map((kind) => ({ value: kind, label: capital(t(`powerup.${kind}` as Key)) })) },
    { key: 'powerUpAmount', group: 'powerups', control: 'segmented', label: t('powerups.amount'), options: numbers(POWER_UP.AMOUNTS), when: (r) => r.powerUps },
  ];
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The rows that apply to a game mode — and, for the rules of a room, the ones that only an online game has. */
export const rulesFor = (mode: VersusMode, online = false): RuleRow[] =>
  ruleRows().filter((row) => (mode !== 'horizon' || !row.classicOnly) && (online || !row.onlineOnly));

// ————————————————————————————— As controls —————————————————————————————

/** Every rule a row can change. */
export type RuleValues = RoomRules;

/** Where a set of rules lives: the settings of this device, or the draft of an online room. */
export interface RuleSource {
  get(): RuleValues;
  /** Change some of the rules. */
  patch(values: Partial<RuleValues>): void;
  /** An edit is over (a slider let go of, a switch flipped): save it, send it on. */
  commit?(): void;
}

type RuleItem = Extract<MenuItem, { kind: 'slider' | 'toggle' | 'segmented' | 'tiles' }>;

/** The controls for the rules of a game mode, each with the block it belongs to. */
export function ruleItems(mode: VersusMode, source: RuleSource, online = false): { key: keyof RuleValues; group: RuleGroup; item: RuleItem }[] {
  /** The cap to come back to after trying another power mode. */
  let lastCap = source.get().maxPower < AIM.MAX_POWER ? source.get().maxPower : DEFAULT_CAP;
  const commit = source.commit;
  return rulesFor(mode, online).map((row): { key: keyof RuleValues; group: RuleGroup; item: RuleItem } => {
    const hidden = row.when ? () => !row.when!(source.get()) : undefined;
    const reserve = row.reserve ? () => row.reserve!(source.get()) : undefined;
    const inactive = row.inactive ? () => row.inactive!(source.get()) : undefined;
    if (row.control === 'toggle') {
      return {
        key: row.key,
        group: row.group,
        item: { kind: 'toggle', label: row.label, hidden, commit, get: () => source.get()[row.key] as boolean, set: (v) => source.patch({ [row.key]: v }) },
      };
    }
    if (row.control === 'tiles') {
      return {
        key: row.key,
        group: row.group,
        item: {
          kind: 'tiles',
          label: row.label,
          allowEmpty: true,
          hidden,
          reserve,
          commit,
          tiles: (row.options as { value: PowerUpKind; label: string }[]).map((o) => ({
            value: o.value,
            label: o.label,
            color: POWER_UP_COLORS[o.value],
            draw: (ctx, r) => drawPowerUpSymbol(ctx, o.value, 0, 0, r),
          })),
          get: () => source.get().powerUps ? source.get().powerUpKinds : [],
          set: (kinds) => kinds.length
            ? source.patch({ powerUps: true, powerUpKinds: POWER_UP_KINDS.filter((k) => kinds.includes(k)) })
            : source.patch({ powerUps: false }),
        },
      };
    }
    if (row.control === 'segmented') {
      // The shot power mode is three rules at once; any other bar is one rule with the options it lists.
      const mode = row.key === 'fixedPower';
      return {
        key: row.key,
        group: row.group,
        item: {
          kind: 'segmented',
          label: row.label,
          options: row.options,
          hidden,
          reserve,
          commit,
          get: () => (mode ? powerModeOf(source.get()) : source.get()[row.key]),
          set: (v) => source.patch(mode ? powerModePatch(v as PowerMode, lastCap) : { [row.key]: v }),
        },
      };
    }
    return {
      key: row.key,
      group: row.group,
      item: {
        kind: 'slider',
        label: row.label,
        steps: row.options,
        hidden,
        reserve,
        inactive,
        commit,
        get: () => source.get()[row.key],
        set: (v) => {
          if (row.key === 'maxPower') lastCap = v as number;
          source.patch({ [row.key]: v });
        },
      },
    };
  });
}
