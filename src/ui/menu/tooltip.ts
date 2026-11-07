import { h } from '../dom';

let tip: HTMLElement | null = null;
let tipTarget: HTMLElement | null = null;
/** Watches for the target being taken out of the page: its pointerleave and blur never fire then, and the tooltip would stay. */
let tipWatch: MutationObserver | null = null;

/** A small tooltip over `target` while the pointer is on it or it has the focus. `dx` moves the point it hangs from to the side. */
export function attachTooltip(target: HTMLElement, text: string, dx = 0, title?: string): void {
  target.addEventListener('pointerenter', () => showTooltip(target, text, dx, title));
  target.addEventListener('pointerleave', () => {
    if (!target.matches(':focus')) hideTooltip(target);
  });
  target.addEventListener('focus', () => showTooltip(target, text, dx, title));
  target.addEventListener('blur', () => {
    if (!target.matches(':hover')) hideTooltip(target);
  });
}

/** Hides the active tooltip if one is currently visible (e.g. when dialogs or screens close). */
export function hideActiveTooltip(): void {
  if (tipTarget) hideTooltip(tipTarget);
}

function showTooltip(target: HTMLElement, text: string, dx: number, title?: string): void {
  tip ??= h('div.powerup-tooltip', { role: 'tooltip' });
  tipTarget = target;
  tipWatch ??= new MutationObserver(() => {
    if (tipTarget && !tipTarget.isConnected) hideTooltip(tipTarget);
  });
  tipWatch.observe(document.body, { childList: true, subtree: true });
  if (title) {
    tip.replaceChildren(
      h('div.powerup-tooltip__title', null, title),
      h('div.powerup-tooltip__body', null, text),
    );
  } else {
    tip.textContent = text;
  }
  if (!tip.isConnected) document.body.append(tip);

  tip.classList.add('is-visible');
  const anchor = target.getBoundingClientRect();
  const size = tip.getBoundingClientRect();
  const inset = 12;
  const left = Math.max(inset, Math.min(anchor.left + dx + anchor.width / 2 - size.width / 2, window.innerWidth - size.width - inset));
  const above = anchor.top - size.height - 8;
  const top = above >= inset ? above : Math.min(anchor.bottom + 8, window.innerHeight - size.height - inset);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTooltip(target: HTMLElement): void {
  if (tipTarget !== target) return;
  tipTarget = null;
  tipWatch?.disconnect();
  tip?.classList.remove('is-visible');
}
