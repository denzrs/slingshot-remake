import '@fontsource/big-shoulders-stencil-display/800';
import './dev-home.css';
import { DEV_PAGES } from '../../dev/pages';
import { devHref, devPageEnabled } from './dev-shell';
import { isLang, setLang, t } from '../platform/i18n';

if (import.meta.env.DEV) {
  const lang = new URLSearchParams(location.search).get('lang');
  setLang(isLang(lang) ? lang : 'de');
  document.documentElement.lang = isLang(lang) ? lang : 'de';
  document.body.classList.add('dev-home-page');
  const main = document.createElement('main');
  main.className = 'dev-home';
  main.innerHTML = `<p class="dev-home__eyebrow">SLINGSHOT / DEV</p>
    <h1>${t('dev.title')}</h1><p class="dev-home__intro">${t('dev.intro')}</p>
    <div class="dev-home__pages">${DEV_PAGES.filter((page) => page.id !== 'home').map((page, index) => {
      const enabled = devPageEnabled(page);
      const content = `<span class="dev-home__number">0${index + 1}</span><h2>${t(page.title)}${enabled ? ' ↗' : ''}</h2><p>${t(page.description)}</p><code>${page.path}</code>`;
      return enabled
        ? `<a class="dev-home__page" href="${devHref(page.path)}">${content}</a>`
        : `<article class="dev-home__page is-disabled" aria-disabled="true">${content}<p class="dev-home__gate">${t('dev.aim.disabled')}<br><code>DEBUG_AIM=1 npm run dev</code></p></article>`;
    }).join('')}</div><p class="dev-home__foot">${t('dev.only')}</p>`;
  document.body.append(main);
}
