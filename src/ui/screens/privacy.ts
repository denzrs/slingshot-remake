import { getLang, t } from '../../platform/i18n';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import { hintText } from '../../platform/input-device';
import type { App } from './app';
import { PRIVACY_TEXT, type PrivacySection } from './privacy-text';

/** The privacy page is at `/privacy/`, beside `/stats/` (the build carries it as `privacy/index.html`). */
const PAGE_PATH = /\/privacy\/?$/;

export function isPrivacyPath(pathname: string): boolean {
  return PAGE_PATH.test(pathname);
}

/** The game's own root, whatever sub-path it is hosted under and whichever of its pages is open. */
export function siteRoot(pathname: string = location.pathname): string {
  return pathname.replace(/(?:stats|privacy|terms)\/?$/, '').replace(/\/?$/, '/');
}

/** Where the menu's footer link goes. */
export function privacyHref(): string {
  return `${siteRoot()}privacy/`;
}

/** A line of text with its `[text](url)` links made into links; other square brackets are plain text. */
function inline(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  let rest = text;
  for (let m = /\[([^\]]+)\]\(((?:https:|mailto:)[^)\s]+)\)/.exec(rest); m; m = /\[([^\]]+)\]\(((?:https:|mailto:)[^)\s]+)\)/.exec(rest)) {
    if (m.index) out.push(rest.slice(0, m.index));
    out.push(h('a', m[2].startsWith('https:') ? { href: m[2], target: '_blank', rel: 'noopener noreferrer' } : { href: m[2] }, m[1]));
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) out.push(rest);
  return out;
}

/** Lines starting with "- " in a section's body become one list; everything else is a paragraph. Shared with the terms page. */
export function sectionNodes({ title, body }: PrivacySection): HTMLElement {
  const section = h('section.privacy__section', null, h('h3.privacy__heading', null, title));
  let list: HTMLElement | null = null;
  for (const line of body) {
    if (line.startsWith('- ')) {
      if (!list) {
        list = h('ul.privacy__list', null);
        section.append(list);
      }
      list.append(h('li', null, ...inline(line.slice(2))));
    } else {
      list = null;
      section.append(h('p', null, ...inline(line)));
    }
  }
  return section;
}

/**
 * The privacy page, opened by its own address: the menu's footer link is a plain link to `/privacy/`, and *Zurück* is a plain
 * navigation back to the game's root, so the address and the page always agree.
 */
export function privacyScreen(_app: App): Screen {
  const back = (): void => location.assign(siteRoot());
  const text = PRIVACY_TEXT[getLang()];
  return {
    build: () => menuPage({
      title: t('privacy.title'),
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
