import { t } from '../i18n';
import { POWER_UP_KINDS, type PowerUpKind } from '../powerups';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../render/powerup-art';
import { h } from './dom';

let powerUpTooltip: HTMLElement | null = null;
let tooltipTarget: HTMLElement | null = null;
/** Watches for the badge being taken out of the page: its pointerleave and blur never fire then, and the tooltip would stay. */
let tooltipWatch: MutationObserver | null = null;

/** All power-up kinds stay in place as a compact picker; Mayhem twists can use any kind when normal pickups are off. */
export function powerUpSummary(
  getRules: () => { powerUps: boolean; powerUpKinds: readonly PowerUpKind[]; mayhem: number },
  options: {
    /** Guests can see the host's choices, but cannot change them. */
    canChange?: () => boolean;
    patch?: (values: { powerUps: boolean; powerUpKinds: PowerUpKind[] }) => void;
  } = {},
): { el: HTMLElement; update: () => void } {
  const label = h('span.briefing__powerups-label', null, t('settings.powerUps'));
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
  tooltipWatch ??= new MutationObserver(() => {
    if (tooltipTarget && !tooltipTarget.isConnected) hidePowerUpTooltip(tooltipTarget);
  });
  tooltipWatch.observe(document.body, { childList: true, subtree: true });
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
  tooltipWatch?.disconnect();
  powerUpTooltip?.classList.remove('is-visible');
}
