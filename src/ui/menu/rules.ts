import { AIM, ANOMALIES, EDGE_MODES, type Anomaly, type EdgeMode } from '../../sim/config';
import { KILLCAM_MODES, RULES, type KillcamMode } from '../../data/roomRules';
import type { GameMode } from '../../sim/modes';
import { t, type Key } from '../../platform/i18n';
import type { RoomRules } from '../../net/net';
import { POWER_UP_KINDS, type PowerUpKind } from '../../sim/powerups';
import { twistedRules } from '../../game/mayhem';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../../render/powerup-art';
import { ANOMALY_COLORS, drawAnomalySymbol } from '../../render/anomaly-art';
import type { MenuItem } from './menu';

/** The blocks the setup screen and the lobby sort the rules into. */
export type RuleGroup = 'match' | 'field' | 'shots' | 'twists' | 'anomalies' | 'powerups' | 'online';

export const RULE_GROUPS: readonly RuleGroup[] = ['match', 'field', 'shots', 'twists', 'anomalies', 'powerups', 'online'];

/** The two columns of the rules page, balanced by height: the match and its field on the left, the shots and the power-ups on the right, with the online-only rules under them. The anomalies open their own picker from a menu entry below the twists. */
export const RULE_COLUMNS: readonly (readonly RuleGroup[])[] = [['match', 'field', 'twists', 'anomalies'], ['shots', 'powerups', 'online']];

export const groupTitle = (group: RuleGroup): string => t(`setup.group.${group}`);

/** Mobile navigation tabs always place anomalies last so they don't interrupt the core rule categories. */
export function orderRulesForMobile<T extends { id: string }>(groups: readonly T[]): T[] {
  return [...groups.filter((g) => g.id !== 'rules-anomalies'), ...groups.filter((g) => g.id === 'rules-anomalies')];
}

/**
 * Height score for a column's rules to balance the two columns on desktop.
 * Each section title counts as 1 unit, regular rows count as 1, and the power-up tile grid counts as 3.
 */
export function columnHeightScore(columnGroups: readonly RuleGroup[], rules: readonly { group: RuleGroup; item: MenuItem }[]): number {
  let score = 0;
  for (const group of columnGroups) {
    if (group === 'anomalies') continue;
    const groupItems = rules.filter((r) => r.group === group);
    if (!groupItems.length) continue;
    score += 1;
    for (const { item } of groupItems) {
      if (item.kind === 'tiles') {
        score += 3;
      } else {
        const isHidden = item.hidden?.() ?? false;
        const isReserved = ('reserve' in item && typeof item.reserve === 'function') ? item.reserve() : false;
        if (!isHidden || isReserved) score += 1;
      }
    }
  }
  return score;
}

/** Balance rule columns for desktop display, placing anomalies on whichever side has enough room. */
export function balanceRuleColumns(columns: RuleGroup[][], rules: readonly { group: RuleGroup; item: MenuItem }[]): RuleGroup[][] {
  const result = columns.map((col) => [...col]);
  const anomalyColumn = result.find((groups) => groups.includes('anomalies'));
  const powerUpColumn = result.find((groups) => groups.includes('powerups'));
  if (!anomalyColumn || !powerUpColumn) return result;

  const leftScore = columnHeightScore(result[0] ?? [], rules);
  const rightScore = columnHeightScore(result[1] ?? [], rules);

  if (leftScore > 13 && leftScore > rightScore) {
    anomalyColumn.splice(anomalyColumn.indexOf('anomalies'), 1);
    powerUpColumn.splice(powerUpColumn.indexOf('powerups') + 1, 0, 'anomalies');
  }
  return result;
}

// ————————————————————————————— Shot power —————————————————————————————

/** How a game limits shot power: not at all, with a cap, or by giving every shot the same power. */
export type PowerMode = 'free' | 'cap' | 'fixed';

const POWER_MODES: readonly PowerMode[] = ['free', 'cap', 'fixed'];

/** The cap a game gets when it is first limited. */
export const DEFAULT_CAP = 70;

/** The stops of the cap's slider: every cap below "no cap", which is a mode of its own. */
export const CAP_STOPS: readonly number[] = RULES.maxPower.options.filter((n) => n < AIM.MAX_POWER);

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

export interface RuleRow {
  key: keyof RoomRules;
  label: string;
  /** Every value the rule can take — for a slider, its stops from lowest to highest. */
  options: { value: number | boolean | PowerMode | PowerUpKind | KillcamMode | EdgeMode | Anomaly; label: string }[];
  /** Switches for on/off rules, sliders for numbers, a segmented bar for a choice between a few words, tiles for several that can each be on or off. */
  control: 'toggle' | 'slider' | 'segmented' | 'tiles';
  group: RuleGroup;
  /** The game modes the rule exists in; every mode when left out. */
  modes?: readonly GameMode[];
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
    { key: 'rounds', group: 'match', control: 'slider', label: t('settings.rounds'), options: numbers([...RULES.rounds.options.filter((n) => n > 0), 0], (n) => (n ? String(n) : t('settings.endless'))) },
    // Only while Mayhem is on: the Mayhem preset turns it on, every other preset off, so the strength is never "off" here.
    { key: 'mayhem', group: 'match', control: 'segmented', label: t('settings.mayhem'), options: numbers(RULES.mayhem.options.filter((n) => n > 0), (n) => t(`settings.mayhem.${n}` as Key)), when: (r) => r.mayhem > 0 },
    { key: 'shotTime', group: 'match', control: 'slider', label: t('settings.shotTime'), options: numbers(RULES.shotTime.options, seconds) },
    { key: 'killcam', group: 'match', control: 'segmented', label: t('settings.killcam'), options: KILLCAM_MODES.map((value) => ({ value, label: t(`settings.killcam.${value}`) })) },
    { key: 'maxPlanets', group: 'field', control: 'slider', label: t('settings.maxPlanets'), options: numbers(RULES.maxPlanets.options) },
    { key: 'invisiblePlanets', group: 'field', control: 'toggle', label: t('settings.invisible'), options: [], modes: RULES.invisiblePlanets.modes },
    { key: 'edges', group: 'field', control: 'segmented', label: t('settings.edges'), options: EDGE_MODES.map((value) => ({ value, label: t(`settings.edges.${value}`) })) },
    {
      key: 'fixedPower',
      group: 'shots',
      control: 'segmented',
      label: t('settings.power'),
      options: POWER_MODES.map((value) => ({ value, label: t(`settings.power.${value}`) })),
    },
    // One slot for the limit: the cap, or (with fixed power) the fixed level's row. Free shows the cap dimmed, so nothing moves.
    { key: 'maxPower', group: 'shots', control: 'slider', label: t('settings.maxPower'), options: numbers(CAP_STOPS), when: (r) => powerModeOf(r) !== 'fixed', inactive: (r) => powerModeOf(r) === 'free' },
    { key: 'fixedPowerLevel', group: 'shots', control: 'slider', label: t('settings.fixedPower'), options: numbers(RULES.fixedPowerLevel.options), when: (r) => powerModeOf(r) === 'fixed' },
    { key: 'styleBonuses', group: 'shots', control: 'toggle', label: t('settings.styleBonuses'), options: [], modes: RULES.styleBonuses.modes },
    { key: 'simultaneousShots', group: 'shots', control: 'toggle', label: t('settings.simultaneousShots'), options: [], modes: RULES.simultaneousShots.modes },
    { key: 'neighborGrace', group: 'twists', control: 'slider', label: t('settings.neighborGrace'), options: numbers(RULES.neighborGrace.options, (n) => (n ? t(n === 1 ? 'settings.oneRound' : 'settings.nRounds', { n }) : t('common.off'))) },
    { key: 'hiddenAim', group: 'twists', control: 'toggle', label: t('settings.hiddenAim'), options: [] },
    { key: 'suddenDeath', group: 'twists', control: 'toggle', label: t('settings.suddenDeath'), options: [], modes: RULES.suddenDeath.modes },
    { key: 'fadingTrails', group: 'twists', control: 'slider', label: t('settings.fadingTrails'), options: numbers(RULES.fadingTrails.options, (n) => (n ? seconds(n) : t('common.off'))) },
    { key: 'betting', group: 'online', control: 'toggle', label: t('settings.betting'), options: [], onlineOnly: true },
    { key: 'chatPlayersOnly', group: 'online', control: 'toggle', label: t('settings.chatPlayersOnly'), options: [], onlineOnly: true },
    { key: 'anomalies', group: 'anomalies', control: 'tiles', label: t('anomalies.kinds'), options: ANOMALIES.map((anomaly) => ({ value: anomaly, label: t(`anomaly.${anomaly}`) })) },
    { key: 'powerUpKinds', group: 'powerups', control: 'tiles', label: t('powerups.kinds'), options: POWER_UP_KINDS.map((kind) => ({ value: kind, label: capital(t(`powerup.${kind}`)) })) },
    { key: 'powerUpAmount', group: 'powerups', control: 'segmented', label: t('powerups.amount'), options: numbers(RULES.powerUpAmount.options), when: (r) => r.powerUps, reserve: (r) => r.mayhem > 0 },
  ];
}

/** A rule's value in words: the stop it sits on, on or off, the strength of a cap, or how many power-ups are in. */
export function ruleValueText(row: RuleRow, rules: RoomRules): string {
  const option = (value: unknown) => row.options.find((o) => o.value === value)?.label ?? String(value);
  if (row.key === 'fixedPower') {
    const mode = powerModeOf(rules);
    return mode === 'cap' ? `${option(mode)} ${rules.maxPower}` : mode === 'fixed' ? `${option(mode)} ${rules.fixedPowerLevel}` : option(mode);
  }
  if (row.key === 'powerUpKinds') return rules.powerUps ? `${rules.powerUpKinds.length}/${POWER_UP_KINDS.length}` : t('common.off');
  if (row.key === 'anomalies') return rules.anomalies.length ? rules.anomalies.map((anomaly) => t(`anomaly.${anomaly}`)).join(', ') : t('common.off');
  if (row.control === 'toggle') return t(rules[row.key] ? 'common.on' : 'common.off');
  return option(rules[row.key]);
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The rows that apply to a game mode — and, for the rules of a room, the ones that only an online game has. */
export const rulesFor = (mode: GameMode, online = false): RuleRow[] =>
  ruleRows().filter((row) => (!row.modes || row.modes.includes(mode)) && (online || !row.onlineOnly));

// ————————————————————————————— Mayhem's twists —————————————————————————————

/** Rows that stand for several rules the twists lay over: the shot power is three of them, the power-ups three more. */
const POWER_RULES = ['fixedPower', 'fixedPowerLevel', 'maxPower'];
const POWER_UP_RULES = ['powerUps', 'powerUpKinds', 'powerUpAmount'];
const TWIST_RULES: Partial<Record<keyof RoomRules, readonly string[]>> = {
  fixedPower: POWER_RULES, fixedPowerLevel: POWER_RULES, maxPower: POWER_RULES,
  powerUpKinds: POWER_UP_RULES, powerUpAmount: POWER_UP_RULES,
};

/**
 * Whether Mayhem's twists may play another value than the one set here in some rounds (never while Mayhem is off).
 *
 * Design decision: these rules are marked, not greyed out, and nothing is hidden. A twist overrules a rule for one round only,
 * so the value set here is still the base that most rounds play by (and that the twists are drawn against: a twist that
 * would change nothing is skipped). Greying a row out would say "this has no effect", which is false for every rule here,
 * and would lock a control players legitimately tune; a toast on change would be gone before it is read. A permanent sign
 * on the row stays truthful and can be read before and after editing. The list is derived from the twist data, so it
 * cannot drift from what the engine does, and it follows the strength (mild never draws the harsh twists).
 */
export function twistedRule(key: keyof RoomRules, mode: GameMode, rules: Pick<RoomRules, 'mayhem'>): boolean {
  if (rules.mayhem <= 0) return false;
  const twisted: ReadonlySet<string> = twistedRules(mode, rules.mayhem);
  return (TWIST_RULES[key] ?? [key]).some((k) => twisted.has(k));
}

/** Whether any row of a mode's rules carries the sign: the cue to show what it means. */
export const anyTwisted = (mode: GameMode, rules: Pick<RoomRules, 'mayhem'>, online = false): boolean =>
  rulesFor(mode, online).some((row) => twistedRule(row.key, mode, rules));

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
export function ruleItems(mode: GameMode, source: RuleSource, online = false): { key: keyof RuleValues; group: RuleGroup; item: RuleItem }[] {
  /** The cap to come back to after trying another power mode. */
  let lastCap = source.get().maxPower < AIM.MAX_POWER ? source.get().maxPower : DEFAULT_CAP;
  const commit = source.commit;
  return rulesFor(mode, online).map((row): { key: keyof RuleValues; group: RuleGroup; item: RuleItem } => {
    const hidden = row.when ? () => !row.when!(source.get()) : undefined;
    const reserve = row.reserve ? () => row.reserve!(source.get()) : undefined;
    const inactive = row.inactive ? () => row.inactive!(source.get()) : undefined;
    const twisted = () => twistedRule(row.key, mode, source.get());
    if (row.control === 'toggle') {
      return {
        key: row.key,
        group: row.group,
        item: { kind: 'toggle', label: row.label, hidden, twisted, commit, get: () => source.get()[row.key] as boolean, set: (v) => source.patch({ [row.key]: v }) },
      };
    }
    if (row.control === 'tiles' && row.key === 'anomalies') {
      return {
        key: row.key,
        group: row.group,
        item: {
          kind: 'tiles',
          label: row.label,
          allowEmpty: true,
          quick: { all: t('powerups.all'), none: t('powerups.none') },
          hidden,
          reserve,
          twisted,
          commit,
          tiles: (row.options as { value: Anomaly; label: string }[]).map((o) => ({
            value: o.value,
            label: o.label,
            hint: t(`anomaly.${o.value}.hint`),
            color: ANOMALY_COLORS[o.value],
            draw: (ctx, r) => drawAnomalySymbol(ctx, o.value, 0, 0, r),
          })),
          get: () => source.get().anomalies,
          set: (list) => source.patch({ anomalies: ANOMALIES.filter((anomaly) => list.includes(anomaly)) }),
        },
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
          quick: { all: t('powerups.all'), none: t('powerups.none') },
          hidden,
          reserve,
          twisted,
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
          twisted,
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
        twisted,
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
