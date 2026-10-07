import { AIM, GRACE, TRAIL_FADE } from '../config';
import { t } from '../i18n';
import type { RoomRules } from '../net';

export interface RuleRow {
  key: keyof RoomRules;
  label: string;
  options: { value: number | boolean; label: string }[];
  /** Only meaningful in Classic (Event Horizon always shows its planets and scores trick shots anyway). */
  classicOnly?: boolean;
}

const onOff = () => [
  { value: true, label: t('common.on') },
  { value: false, label: t('common.off') },
];

/** The rules of a game, in the order the setup screen and the multiplayer lobby list them. */
export function ruleRows(): RuleRow[] {
  return [
    { key: 'rounds', label: t('settings.rounds'), options: [1, 3, 5, 7, 10, 15, 20, 0].map((n) => ({ value: n, label: n ? String(n) : t('settings.endless') })) },
    { key: 'maxPlanets', label: t('settings.maxPlanets'), options: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) })) },
    { key: 'invisiblePlanets', label: t('settings.invisible'), options: onOff(), classicOnly: true },
    { key: 'bounce', label: t('settings.bounce'), options: onOff() },
    { key: 'fixedPower', label: t('settings.fixedPower'), options: onOff() },
    { key: 'maxPower', label: t('settings.maxPower'), options: AIM.CAP_OPTIONS.map((n) => ({ value: n, label: String(n) })) },
    { key: 'shotTime', label: t('settings.shotTime'), options: [10, 20, 30, 60].map((n) => ({ value: n, label: t('settings.seconds', { n }) })) },
    { key: 'styleBonuses', label: t('settings.styleBonuses'), options: onOff(), classicOnly: true },
    { key: 'neighborGrace', label: t('settings.neighborGrace'), options: GRACE.OPTIONS.map((n) => ({ value: n, label: n ? t(n === 1 ? 'settings.oneRound' : 'settings.nRounds', { n }) : t('common.off') })) },
    { key: 'simultaneousShots', label: t('settings.simultaneousShots'), options: onOff(), classicOnly: true },
    { key: 'hiddenAim', label: t('settings.hiddenAim'), options: onOff() },
    { key: 'fadingTrails', label: t('settings.fadingTrails'), options: TRAIL_FADE.OPTIONS.map((n) => ({ value: n, label: n ? t('settings.seconds', { n }) : t('common.off') })) },
  ];
}

/** The rows that apply to a game mode. */
export const rulesFor = (mode: 'classic' | 'horizon'): RuleRow[] => ruleRows().filter((row) => mode === 'classic' || !row.classicOnly);

/** The label of the option a rule currently has, e.g. "20 s" or "On". */
export function ruleLabel(row: RuleRow, value: number | boolean): string {
  return row.options.find((o) => o.value === value)?.label ?? String(value);
}
