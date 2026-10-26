import { t } from '../../platform/i18n';
import { POWER_UP_KINDS, type PowerUpKind } from '../../sim/powerups';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../../render/powerup-art';
import { h } from '../dom';
import { twistedRule } from '../menu/rules';
import { twistMark } from '../menu/controls';
import { attachTooltip } from '../menu/tooltip';
import type { GameMode } from '../../sim/modes';

/** All power-up kinds stay in place as a compact picker; Mayhem twists can use any kind when normal pickups are off. */
export function powerUpSummary(
  getRules: () => { powerUps: boolean; powerUpKinds: readonly PowerUpKind[]; mayhem: number },
  options: {
    /** The mode the rules are for: it decides which twists can lay other power-ups over them. */
    mode: GameMode;
    /** Guests can see the host's choices, but cannot change them. */
    canChange?: () => boolean;
    patch?: (values: { powerUps: boolean; powerUpKinds: PowerUpKind[] }) => void;
  },
): { el: HTMLElement; update: () => void } {
  const label = h('span.briefing__powerups-label', null, t('settings.powerUps'), twistMark());
  const value = h('span.briefing__powerup-list', { 'aria-live': 'polite' });
  const el = h('div.briefing__powerups', { role: 'group', 'aria-label': t('settings.powerUps') }, label, value);
  const badges = new Map(POWER_UP_KINDS.map((kind) => [kind, powerUpIcon(kind)] as const));
  value.replaceChildren(...badges.values());
  for (const [kind, badge] of badges) {
    badge.addEventListener('click', () => {
      if (!options.patch || (options.canChange && !options.canChange())) return;
      const rules = getRules();
      const selected = new Set(rules.powerUps ? rules.powerUpKinds : []);
      if (selected.has(kind)) selected.delete(kind);
      else selected.add(kind);
      options.patch({
        powerUps: selected.size > 0,
        powerUpKinds: selected.size ? POWER_UP_KINDS.filter((candidate) => selected.has(candidate)) : [...rules.powerUpKinds],
      });
      update();
    });
  }

  const update = (): void => {
    const rules = getRules();
    el.classList.toggle('is-twisted', twistedRule('powerUpKinds', options.mode, rules));
    const viaTwists = !rules.powerUps && rules.mayhem > 0;
    const canChange = !!options.patch && (options.canChange?.() ?? true);
    for (const kind of POWER_UP_KINDS) {
      const badge = badges.get(kind)!;
      const selected = rules.powerUps && rules.powerUpKinds.includes(kind);
      badge.setAttribute('aria-pressed', String(selected));
      badge.classList.toggle('is-inactive', !selected && !viaTwists);
      badge.disabled = !canChange;
    }
  };

  update();
  return { el, update };
}

function powerUpIcon(kind: PowerUpKind): HTMLButtonElement {
  const name = t(`powerup.${kind}`);
  const canvasSize = 28;
  const dpr = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const canvas = h('canvas.briefing__powerup-icon', {
    width: String(Math.round(canvasSize * dpr)),
    height: String(Math.round(canvasSize * dpr)),
    'aria-hidden': 'true',
  }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = ctx.fillStyle = POWER_UP_COLORS[kind];
    ctx.lineWidth = 1.8;
    ctx.lineCap = ctx.lineJoin = 'round';
    drawPowerUpSymbol(ctx, kind, canvasSize / 2, canvasSize / 2, 7.5);
  }
  const badge = h('button.briefing__powerup', {
    type: 'button',
    'aria-label': name,
    'aria-pressed': 'false',
  }, canvas) as HTMLButtonElement;
  badge.style.setProperty('--powerup-tone', POWER_UP_COLORS[kind]);
  attachTooltip(badge, name);
  return badge;
}
