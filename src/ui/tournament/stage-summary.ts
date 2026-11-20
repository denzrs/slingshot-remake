import { t } from '../../platform/i18n';
import type { RoomRules, TournamentStage } from '../../net/net';
import { loadCustomPresets } from '../../data/customPresets';
import { rulesOf } from '../../data/roomRules';
import type { PresetSelection } from '../presets/preset-cards';
import { POWER_UP_KINDS } from '../../sim/powerups';
import { POWER_UP_COLORS } from '../../render/powerup-art';
import { ANOMALY_COLORS } from '../../render/anomaly-art';
import { changedRules, handpickedPresets, pickOfTheDay, presetLabelKey, presetRules, samePick } from '../presets/match-presets';
import { pickName } from '../presets/pick-of-day';
import { ruleValueText } from '../menu/rules';
import { h } from '../menu/menu';
import { pickOf, QUICK_RULES } from './setup';

/** The small line-drawn signs of the facts line: the rounds a match lasts, the shot clock, the power-ups. */
const ICONS = {
  rounds: '<path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v3h3" />',
  time: '<circle cx="8" cy="9" r="5"/><path d="M8 6.5V9l1.8 1.3M6.5 2h3" />',
  power: '<path d="M9 1.5 4 9h4l-1 5.5L12 7H8z" />',
  // A rift: a star torn through the middle.
  anomaly: '<path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.6 3.6l2 2M10.4 10.4l2 2M12.4 3.6l-2 2M5.6 10.4l-2 2" /><path d="M6.6 6.2 9.4 7.4 6.8 8.8 9.2 9.9" />',
} as const;

function icon(kind: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ts-sum__icon');
  svg.innerHTML = ICONS[kind];
  return svg;
}

/** The rules that differ from `baseline`, the quick ones (shown anyway) and Mayhem's strength aside. */
const differences = (rules: RoomRules, baseline: RoomRules, stage: TournamentStage) =>
  changedRules(rules, baseline, stage.gameMode, true).filter(({ key }) => !QUICK_RULES.includes(key) && key !== 'mayhem');

/** What a level plays, as a card: one of the player's own presets, a handpicked one, else the preset it is or comes nearest. */
function stageBase(stage: TournamentStage) {
  const rules = stage.rules as RoomRules;
  const mode = stage.gameMode;
  const own = loadCustomPresets(mode).find((preset) => differences(rules, preset.rules, stage).length === 0);
  if (own) return { id: `custom:${own.id}`, name: own.name, rules: own.rules };
  const pick = handpickedPresets(mode).find((candidate) => differences(rules, candidate.rules, stage).length === 0);
  if (pick) return { id: 'handpicked', pick, name: pickName(pick), rules: pick.rules };
  const { preset } = pickOf(stage);
  if (!preset) return undefined;
  return { id: preset as string, name: t(presetLabelKey(preset, mode)), rules: presetRules(preset, mode) };
}

/**
 * The card a level's dialog starts on, and the rules its edits count from, with the quick rules as they are. A handpicked preset
 * is a card there only on the day it is the pick.
 */
export function stageCard(stage: TournamentStage, today: string): PresetSelection | undefined {
  const rules = stage.rules as RoomRules;
  const base = stageBase(stage);
  if (!base || (base.pick && !samePick(base.pick, pickOfTheDay(stage.gameMode, today)))) return undefined;
  const quick = Object.fromEntries(QUICK_RULES.map((key) => [key, rules[key]]));
  const mayhem = base.rules.mayhem > 0 && rules.mayhem > 0 ? rules.mayhem : base.rules.mayhem;
  return { id: base.id, mode: stage.gameMode, rules: rulesOf({ ...base.rules, ...quick, mayhem, betting: rules.betting, chatPlayersOnly: rules.chatPlayersOnly }) };
}

/** What a level plays, by name (the player's own presets only the browser that keeps them knows), with the rules that differ from it. */
function stageGame(stage: TournamentStage): { name: string; changes: { label: string; value: string }[] } {
  const rules = stage.rules as RoomRules;
  const base = stageBase(stage);
  // The anomalies show as dots of their own, so they are no change to list.
  const changes = differences(rules, base?.rules ?? presetRules('standard', stage.gameMode), stage)
    .filter(({ key }) => key !== 'anomalies')
    .map((row) => ({ label: row.label, value: ruleValueText(row, rules) }));
  return { name: base?.name ?? '', changes };
}

/**
 * A level's game in a block as wide as the bracket's column: the mode and the preset, and a line of what a match is — the rounds,
 * the shot clock, a dot per power-up and per anomaly in play. The rest is in its tooltip, and all of it in the level's dialog,
 * which the block opens.
 */
export function stageSummary(stage: TournamentStage): HTMLElement {
  const rules = stage.rules as RoomRules;
  const game = stageGame(stage);
  const kinds = rules.powerUps ? POWER_UP_KINDS.filter((kind) => rules.powerUpKinds.includes(kind)) : [];
  const dot = (color: string) => {
    const el = h('i.ts-sum__dot', null);
    el.style.background = color;
    el.style.color = color;
    return el;
  };
  const dots = h('span.ts-sum__dots', null, ...(kinds.length ? kinds.map((kind) => dot(POWER_UP_COLORS[kind])) : [h('span.ts-sum__off', null, '–')]));
  const anomalies = rules.anomalies ?? [];
  const facts = h('span.ts-sum__facts', null,
    h('span.ts-sum__fact', null, icon('rounds'), h('b', null, String(rules.rounds))),
    h('span.ts-sum__fact', null, icon('time'), h('b', null, String(rules.shotTime)), 's'),
    h('span.ts-sum__fact.ts-sum__fact--power', null, icon('power'), dots),
    // The anomalies in play, like the power-ups: a dot each in its own colour, only when there are any.
    ...(anomalies.length ? [h('span.ts-sum__fact.ts-sum__fact--anomaly', null, icon('anomaly'),
      h('span.ts-sum__dots', null, ...anomalies.map((anomaly) => dot(ANOMALY_COLORS[anomaly]))))] : []),
  );
  const mode = t(`mode.${stage.gameMode}`).replace(/­/g, '');
  const title = [
    game.name ? `${mode} · ${game.name}` : mode,
    `${t('settings.rounds')}: ${rules.rounds}`,
    `${t('settings.shotTime')}: ${rules.shotTime} s`,
    `${t('settings.powerUps')}: ${kinds.length || '–'}`,
    ...(anomalies.length ? [`${t('setup.group.anomalies')}: ${anomalies.map((anomaly) => t(`anomaly.${anomaly}`)).join(', ')}`] : []),
    ...game.changes.map(({ label, value }) => `${label}: ${value}`),
  ].join('\n');
  return h('span.ts-sum', { title },
    h('span.ts-sum__text', null,
      h('span.ts-sum__name', null,
        h('span.ts-sum__mode', null, mode),
        ...(game.name ? [h('span.ts-sum__preset', null, game.name)] : [])),
      facts),
  );
}
