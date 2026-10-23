import { t } from '../i18n';
import { h } from './dom';

interface MenuPage {
  title: string;
  eyebrow?: string;
  intro?: string;
  headerAside?: Node;
  className?: string;
  body: Node[];
  aside?: Node[];
  /** A custom action container; every menu page keeps the same footer shell. */
  footer?: HTMLElement;
  keys?: string;
}

/** The shared page frame for menus: one heading, a reading area and actions that stay in reach. */
export function menuPage({ title, eyebrow = 'Slingshot', intro, headerAside, className = '', body, aside, footer, keys = t('shell.keys') }: MenuPage): HTMLElement {
  return h('section.screen.screen--panel.screen--menu-page', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(`div.menu-page${className ? `.${className}` : ''}`, null,
      h('header.menu-page__head', null,
        h('p.eyebrow', null, eyebrow),
        h('h2.menu-page__title', null, title),
        ...(intro ? [h('p.menu-page__intro', null, intro)] : []),
        ...(headerAside ? [headerAside] : []),
      ),
      h(`div.menu-page__body${aside ? '.menu-page__body--split' : ''}`, null,
        h('div.menu-page__main', null, ...body),
        ...(aside ? [h('aside.menu-page__aside', null, ...aside)] : []),
      ),
      h('footer.menu-page__foot', null,
        h('p.keys', null, keys),
        footer ?? h('div.items.items--row.menu-page__actions', { 'data-items': '' }),
      ),
    ),
  );
}

/** A labelled group of live menu controls. */
export function menuGroup(title: string, section: string): HTMLElement {
  return h('section.menu-group', null,
    h('h3.setup__title', null, title),
    h('div.setup__rows', { 'data-section': section }),
  );
}
