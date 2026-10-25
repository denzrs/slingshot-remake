import { t } from '../../platform/i18n';
import type { GameMode } from '../../sim/modes';
import { h } from '../menu/menu';
import { modeName } from '../menu/mode-name';

export type ModeTransition = 'next' | 'previous';

export function modePagerHeader(current: GameMode, transition?: ModeTransition): HTMLElement {
  return pagePagerHeader(modeName(current), t('launcher.switchMode'), transition);
}

export function pagePagerHeader(title: string, label: string, transition?: ModeTransition): HTMLElement {
  return h('div.mode-carousel', null,
    h('h2.mode-pager__semantic-title', { 'aria-live': 'polite', 'aria-atomic': 'true' }, title),
    h('div.mode-pager__viewport', null,
      h('nav.items.items--row.mode-pager', {
        'data-section': 'mode-pager', 'data-transition': transition ?? '', 'aria-label': label,
      }),
    ),
    h('div.mode-pager__keys', { 'aria-hidden': 'true' },
      h('span', null, '‹ (Q)'),
      h('span', null, '(E) ›'),
    ),
  );
}

/** Place the selected mode at a stable anchor after the menu has mounted its button rows. */
export function positionModeCarousel(root: HTMLElement): () => void {
  const viewport = root.querySelector<HTMLElement>('.mode-pager__viewport');
  const track = root.querySelector<HTMLElement>('.mode-pager');
  if (!viewport || !track) return () => {};

  let frame = 0;
  let settleFrame = 0;
  const targetOffset = (): number => {
    const active = track.querySelector<HTMLElement>('.is-selected');
    if (!active) return 0;
    const configuredAnchor = Number.parseFloat(getComputedStyle(viewport).getPropertyValue('--mode-anchor'));
    const anchorPercent = Number.isFinite(configuredAnchor) ? configuredAnchor : 0;
    const anchor = viewport.clientWidth * anchorPercent / 100;
    return anchor - active.offsetLeft;
  };
  const position = (): void => {
    if (!track.isConnected) return;
    const target = targetOffset();
    if (!track.classList.contains('is-positioned')) {
      const entering = track.dataset.transition;
      const entranceOffset = entering === 'next' ? 72 : entering === 'previous' ? -72 : 0;
      track.style.transform = `translate3d(${target + entranceOffset}px, 0, 0)`;
      if (!settleFrame) {
        settleFrame = requestAnimationFrame(() => {
          settleFrame = 0;
          if (!track.isConnected) return;
          track.classList.add('is-positioned');
          track.style.transform = `translate3d(${targetOffset()}px, 0, 0)`;
        });
      }
      return;
    }
    track.style.transform = `translate3d(${target}px, 0, 0)`;
  };
  const schedulePosition = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      position();
    });
  };
  const observer = new ResizeObserver(schedulePosition);
  observer.observe(viewport);
  observer.observe(track);
  schedulePosition();

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    if (settleFrame) cancelAnimationFrame(settleFrame);
  };
}

/** The same Q/E, focused arrows and horizontal swipe on every page carousel. */
export function enablePagerNavigation(root: HTMLElement, step: (direction: ModeTransition) => void, ignoreTouch?: string): () => void {
  const listeners = new AbortController();
  const { signal } = listeners;
  let start: { x: number; y: number } | null = null;
  root.addEventListener('touchstart', (event: TouchEvent) => {
    if (event.touches.length !== 1) { start = null; return; }
    const target = event.target;
    if (target instanceof Element && (target.closest('input, select, textarea, [contenteditable="true"]') || (ignoreTouch && target.closest(ignoreTouch)))) {
      start = null;
      return;
    }
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true, signal });
  root.addEventListener('touchend', (event: TouchEvent) => {
    if (!start || event.changedTouches.length !== 1) { start = null; return; }
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    const direction = dx < 0 ? 'next' : 'previous';
    event.preventDefault();
    step(direction);
  }, { passive: false, signal });
  root.addEventListener('touchcancel', () => { start = null; }, { signal });
  // Background clicks leave focus on the document body, outside the page's event path.
  root.ownerDocument.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!root.isConnected) return;
    const target = event.target;
    if (!(target instanceof Element) || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const shortcut = key === 'q' || key === 'e';
    if (target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (!shortcut && ((key !== 'arrowleft' && key !== 'arrowright') || !root.contains(target) || !target.closest('.mode-pager'))) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const direction = key === 'arrowright' || key === 'e' ? 'next' : 'previous';
    step(direction);
  }, { capture: true, signal });
  return () => listeners.abort();
}
