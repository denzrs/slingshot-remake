import { getLang, t } from '../../platform/i18n';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import { hintText } from '../../platform/input-device';
import type { App } from './app';
import { sectionNodes, siteRoot } from './privacy';
import { TERMS_TEXT } from './terms-text';

/** The terms page is at `/terms/`, beside `/privacy/` and `/stats/` (the build carries it as `terms/index.html`). */
const PAGE_PATH = /\/terms\/?$/;

export function isTermsPath(pathname: string): boolean {
  return PAGE_PATH.test(pathname);
}

/** Where the menu's footer link goes. */
export function termsHref(): string {
  return `${siteRoot()}terms/`;
}

/**
 * The terms page, opened by its own address, like the privacy page: the footer link is a plain link to `/terms/`, and *Zurück*
 * is a plain navigation back to the game's root.
 */
export function termsScreen(_app: App): Screen {
  const back = (): void => location.assign(siteRoot());
  const text = TERMS_TEXT[getLang()];
  return {
    build: () => menuPage({
      title: t('terms.title'),
      className: 'menu-page--privacy',
      body: [
        h('article.privacy', null,
          h('p.privacy__updated', null, text.updated),
          ...text.sections.map(sectionNodes),
        ),
      ],
      keys: hintText('shell.keys'),
      footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
    }),
    items: [
      { kind: 'action', section: 'actions', label: t('common.back'), primary: true, run: back },
    ] satisfies MenuItem[],
    onEscape: () => {
      back();
      return true;
    },
  };
}
