import { h, type MenuItem } from './menu';
import { menuGroup } from './menu-page';

export interface SheetSelection { current?: string }
interface SheetGroup { id: string; title: string }
let nextId = 0;

/** A desktop overview becomes one subject at a time on phones, without losing any controls or their conditions. */
export function mobileSheet(columns: SheetGroup[][], label: string, changed: () => void, selection: SheetSelection = {}) {
  const narrow = matchMedia('(max-width: 760px)');
  const groups = columns.flat();
  const prefix = `sheet-${++nextId}`;
  if (!groups.some(({ id }) => id === selection.current)) selection.current = groups[0]?.id;
  const panels = new Map(groups.map(({ id, title }) => {
    const panel = menuGroup(title, id);
    panel.id = `${prefix}-${id}`;
    return [id, panel];
  }));
  const buttons = groups.map(({ id, title }) => {
    const button = h('button.sheet-nav__button', { type: 'button', 'aria-controls': `${prefix}-${id}` }, title);
    button.addEventListener('click', () => {
      selection.current = id;
      paint();
      changed();
    });
    button.addEventListener('keydown', (event) => {
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const next = buttons[(groups.findIndex((group) => group.id === id) + direction + groups.length) % groups.length];
      next.click();
      next.focus({ preventScroll: true });
      revealTab(next);
    });
    return button;
  });
  const tabs = h('div.sheet-nav__tabs', null, ...buttons);
  const navigation = h('nav.sheet-nav', { 'aria-label': label }, tabs);
  const updateOverflow = () => {
    const maxScroll = tabs.scrollWidth - tabs.clientWidth;
    navigation.classList.toggle('sheet-nav--more-left', tabs.scrollLeft > 1);
    navigation.classList.toggle('sheet-nav--more-right', maxScroll > 1 && tabs.scrollLeft < maxScroll - 1);
  };
  const revealTab = (button: HTMLElement) => {
    const tabsRect = tabs.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (buttonRect.left < tabsRect.left) tabs.scrollLeft -= tabsRect.left - buttonRect.left;
    else if (buttonRect.right > tabsRect.right) tabs.scrollLeft += buttonRect.right - tabsRect.right;
    updateOverflow();
  };
  tabs.addEventListener('scroll', updateOverflow, { passive: true });
  window.addEventListener('resize', updateOverflow);
  const el = h('div.sheet.sheet--mobile-categories', null, ...columns.map((column) => h('div.sheet__col', null, ...column.map(({ id }) => panels.get(id)!))));
  const isHidden = (id: string) => narrow.matches && selection.current !== id;
  let scrollFrame = 0;
  const paint = () => {
    navigation.hidden = !narrow.matches;
    groups.forEach(({ id }, i) => {
      panels.get(id)!.hidden = isHidden(id);
      buttons[i].setAttribute('aria-pressed', String(selection.current === id));
    });
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (!narrow.matches || !navigation.isConnected) return;
      updateOverflow();
    });
  };
  const resize = () => {
    if (narrow.matches) for (const [id, panel] of panels) {
      if (document.activeElement && panel.contains(document.activeElement)) selection.current = id;
    }
    paint();
    changed();
  };
  narrow.addEventListener('change', resize);
  paint();
  return {
    el, navigation,
    /** Hidden rows must also leave the menu's arrow-key navigation; keep each row's own conditional logic. */
    bind<T extends MenuItem>(item: T): T {
      const id = item.section;
      if (!id || !panels.has(id)) return item;
      return {
        ...item,
        hidden: () => isHidden(id) || (item.hidden?.() ?? false),
        ...('reserve' in item ? { reserve: () => !isHidden(id) && (item.reserve?.() ?? false) } : {}),
      };
    },
    dispose: () => {
      narrow.removeEventListener('change', resize);
      tabs.removeEventListener('scroll', updateOverflow);
      window.removeEventListener('resize', updateOverflow);
      cancelAnimationFrame(scrollFrame);
    },
  };
}
