import { t } from '../../platform/i18n';
import { heartIcon } from '../dom';
import { h } from '../menu/menu';
import { privacyHref } from './privacy';

/**
 * Who built the game over the version tag and the privacy link. On a phone the footer has no room for the first line.
 */
export function creditsBadge(): HTMLElement {
  const link = (user: string) => h('a', { href: `https://github.com/${user}`, target: '_blank', rel: 'noopener noreferrer' }, user);
  return h('div.version.credits', null,
    h('span.credits__slot.credits__slot--line', null,
      h('span.credits__line', null,
        `${t('credits.with')} `, heartIcon(), ` ${t('credits.by')} `, link('denzrs'), ' & ', link('matthias-Q'),
      ),
    ),
    h('span.credits__foot', null,
      h('span.credits__slot.credits__slot--tag', null,
        h('span.credits__tag', null, String(import.meta.env.VITE_APP_VERSION || 'Local-Dev')),
      ),
      h('span.credits__sep', { 'aria-hidden': 'true' }, '·'),
      h('a.launcher__privacy', { href: privacyHref() }, t('privacy.link')),
    ),
  );
}

/**
 * The "Buy me a coffee" link: a plain link, so the page loads nothing from the donation service and it learns nothing about a
 * visitor until they click. (Its own button widget would load a script from their server as soon as the menu is shown.)
 */
export function coffeeButton(): HTMLElement {
  return h('a.coffee-link', {
    href: import.meta.env.VITE_COFFEE_URL,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': t('title.coffee'),
  }, t('title.coffee'));
}
