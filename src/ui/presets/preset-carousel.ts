import { t } from '../../platform/i18n';
import { h } from '../menu/menu';

/** Native scrolling on phones; the preset at rest is the active one. The creation card still needs an explicit tap. */
export function presetCarousel(cards: HTMLElement) {
  const narrow = matchMedia('(max-width: 760px)');
  const previous = h('button.preset-carousel__arrow', { type: 'button', 'aria-label': t('preset.previous') }, '‹') as HTMLButtonElement;
  const next = h('button.preset-carousel__arrow', { type: 'button', 'aria-label': t('preset.next') }, '›') as HTMLButtonElement;
  const counter = h('span.preset-carousel__count', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  const restore = h('button.preset-carousel__action.preset-carousel__action--restore', { type: 'button', 'aria-label': t('preset.resetAction') }) as HTMLButtonElement;
  const save = h('button.preset-carousel__action.preset-carousel__action--save', { type: 'button', 'aria-label': t('preset.custom.save') }) as HTMLButtonElement;
  restore.disabled = save.disabled = true;
  const tools = h('div.preset-carousel__tools', null, restore, save);
  const navigation = h('nav.preset-carousel__nav', { 'aria-label': t('preset.choose') }, tools, previous, counter, next);
  const listeners = new AbortController();
  let restoreSource: HTMLButtonElement | null = null;
  let saveSource: HTMLButtonElement | null = null;
  let frame = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let dragging = false;
  let selected: Element | null = null;
  const leftOf = (slide: HTMLElement) => Math.max(0, Math.min(cards.scrollWidth - cards.clientWidth,
    slide.getBoundingClientRect().left - cards.getBoundingClientRect().left + cards.scrollLeft - parseFloat(getComputedStyle(cards).paddingLeft)));
  const slides = () => Array.from(cards.querySelectorAll<HTMLElement>(':scope > .briefing__preset-shell, :scope > .item--card, :scope > .briefing__own > *')).sort((a, b) => leftOf(a) - leftOf(b));
  const nearest = (all: HTMLElement[]) => all.reduce((best, slide, index) => Math.abs(leftOf(slide) - cards.scrollLeft) < Math.abs(leftOf(all[best]) - cards.scrollLeft) ? index : best, 0);
  const move = (direction: number) => {
    const all = slides();
    if (!all.length) return;
    const index = Math.max(0, Math.min(all.length - 1, nearest(all) + direction));
    cards.scrollTo({ left: leftOf(all[index]), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  const update = () => {
    frame = 0;
    navigation.hidden = !narrow.matches;
    if (!narrow.matches || !cards.isConnected) return;
    // Menu rows are inserted after their section placeholders. Keep DOM order and swipe order identical,
    // rather than relying on CSS order through display:contents (which can put the first cards out of reach).
    const own = cards.querySelector<HTMLElement>(':scope > .briefing__own');
    if (own && own !== cards.lastElementChild) cards.append(own);
    const all = slides();
    if (!all.length) return;
    const chosen = cards.querySelector('[aria-pressed="true"]');
    // External selection (a tap or a reopened briefing) brings that card into view.
    if (chosen !== selected) {
      selected = chosen;
      const slide = all.find((el) => el === chosen || (chosen && el.contains(chosen)));
      if (slide) cards.scrollLeft = leftOf(slide);
    }
    const index = nearest(all);
    counter.textContent = t('preset.position', { n: index + 1, total: all.length });
    previous.disabled = index === 0;
    next.disabled = index === all.length - 1;
    // Reuse the actual card actions in a fixed-size toolbar. Showing edits never adds a row to the page.
    const active = all[index].querySelector('.item[aria-pressed="true"]');
    const shell = active?.closest('.briefing__preset-shell');
    restoreSource = shell?.querySelector<HTMLButtonElement>(':scope > .item__status-reset') ?? null;
    saveSource = shell?.querySelector<HTMLButtonElement>(':scope > .item__status-save') ?? null;
    restore.disabled = !restoreSource || !!restoreSource.hidden;
    save.disabled = !saveSource || !!saveSource.hidden;
    const label = restoreSource?.title || t('preset.resetAction');
    restore.setAttribute('aria-label', label);
    restore.title = label;
    save.title = t('preset.custom.save');
    restore.classList.toggle('is-edit', !!active?.closest('.briefing__own') && !active.classList.contains('is-modified'));
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const settle = () => {
    clearTimeout(settleTimer);
    if (!narrow.matches || dragging || !cards.isConnected) return;
    const all = slides();
    if (!all.length) return;
    const card = all[nearest(all)].querySelector<HTMLButtonElement>('.item[aria-pressed]');
    if (card && card.getAttribute('aria-pressed') !== 'true' && card.getAttribute('aria-disabled') !== 'true') {
      selected = card;
      card.click();
    }
  };
  const afterScroll = () => {
    schedule();
    clearTimeout(settleTimer);
    // Also handles browsers without scrollend, after momentum and snapping have stopped.
    settleTimer = setTimeout(settle, 180);
  };
  previous.addEventListener('click', () => move(-1), { signal: listeners.signal });
  next.addEventListener('click', () => move(1), { signal: listeners.signal });
  restore.addEventListener('click', () => { if (!restore.disabled) restoreSource?.click(); }, { signal: listeners.signal });
  save.addEventListener('click', () => { if (!save.disabled) saveSource?.click(); }, { signal: listeners.signal });
  cards.addEventListener('scroll', afterScroll, { passive: true, signal: listeners.signal });
  cards.addEventListener('scrollend', settle, { signal: listeners.signal });
  cards.addEventListener('pointerdown', () => { dragging = true; }, { passive: true, signal: listeners.signal });
  const release = () => { dragging = false; afterScroll(); };
  cards.addEventListener('pointerup', release, { passive: true, signal: listeners.signal });
  cards.addEventListener('pointercancel', release, { passive: true, signal: listeners.signal });
  const observer = new MutationObserver(schedule);
  observer.observe(cards, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'hidden'] });
  const size = new ResizeObserver(schedule);
  size.observe(cards);
  narrow.addEventListener('change', schedule);
  schedule();
  return {
    navigation,
    dispose: () => {
      listeners.abort();
      observer.disconnect();
      size.disconnect();
      narrow.removeEventListener('change', schedule);
      clearTimeout(settleTimer);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
