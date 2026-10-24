import { t, type Key } from '../i18n';
import type { PowerUpKind } from '../powerups';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../render/powerup-art';
import { h } from './dom';

let powerUpTooltip: HTMLElement | null = null;
let tooltipTarget: HTMLElement | null = null;

/** A compact readout for the power-ups that can appear in a match. */
export function powerUpSummary(
  getRules: () => { powerUps: boolean; powerUpKinds: readonly PowerUpKind[] },
  note?: string,
): { el: HTMLElement; update: () => void } {
  const label = h('span.briefing__powerups-label', null, t('settings.powerUps'));
  const hint = note ? h('span.briefing__powerups-note', null, note) : null;
  const value = h('span.briefing__powerup-list', { 'aria-live': 'polite' });
  const el = h('div.briefing__powerups', { role: 'group', 'aria-label': t('settings.powerUps') }, label, ...(hint ? [hint] : []), value);

  const update = (): void => {
    if (tooltipTarget && !tooltipTarget.isConnected) hidePowerUpTooltip(tooltipTarget);
    const rules = getRules();
    if (!rules.powerUps) {
      value.replaceChildren(h('span.briefing__powerup-none', null, t('common.none')));
      return;
    }
    value.replaceChildren(...rules.powerUpKinds.map(powerUpIcon));
  };

  update();
  return { el, update };
}

function powerUpIcon(kind: PowerUpKind): HTMLElement {
  const name = t(`powerup.${kind}` as Key);
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
  const badge = h('span.briefing__powerup', {
    role: 'img',
    tabindex: '0',
    'aria-label': name,
  }, canvas);
  badge.style.setProperty('--powerup-tone', POWER_UP_COLORS[kind]);
  badge.addEventListener('pointerenter', () => showPowerUpTooltip(badge, name));
  badge.addEventListener('pointerleave', () => {
    if (!badge.matches(':focus')) hidePowerUpTooltip(badge);
  });
  badge.addEventListener('focus', () => showPowerUpTooltip(badge, name));
  badge.addEventListener('blur', () => {
    if (!badge.matches(':hover')) hidePowerUpTooltip(badge);
  });
  return badge;
}

function showPowerUpTooltip(target: HTMLElement, name: string): void {
  if (!powerUpTooltip) {
    powerUpTooltip = h('div.powerup-tooltip', { role: 'tooltip' });
  }
  tooltipTarget = target;
  powerUpTooltip.textContent = name;
  if (!powerUpTooltip.isConnected) document.body.append(powerUpTooltip);

  powerUpTooltip.classList.add('is-visible');
  const anchor = target.getBoundingClientRect();
  const tooltip = powerUpTooltip.getBoundingClientRect();
  const inset = 12;
  const left = Math.max(inset, Math.min(anchor.left + anchor.width / 2 - tooltip.width / 2, window.innerWidth - tooltip.width - inset));
  const above = anchor.top - tooltip.height - 8;
  const top = above >= inset ? above : Math.min(anchor.bottom + 8, window.innerHeight - tooltip.height - inset);
  powerUpTooltip.style.left = `${left}px`;
  powerUpTooltip.style.top = `${top}px`;
}

function hidePowerUpTooltip(target: HTMLElement): void {
  if (tooltipTarget !== target) return;
  tooltipTarget = null;
  powerUpTooltip?.classList.remove('is-visible');
}
