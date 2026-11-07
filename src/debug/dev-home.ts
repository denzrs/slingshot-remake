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
  const listed = DEV_PAGES.filter((page) => page.id !== 'home');
  const pages = listed.filter(devPageEnabled);
  const hidden = listed.filter((page) => !devPageEnabled(page));
  main.innerHTML = `<p class="dev-home__eyebrow">SLINGSHOT / DEV</p>
    <h1>${t('dev.title')}</h1><p class="dev-home__intro">${t('dev.intro')}</p>
    <div class="dev-home__pages">${pages.map((page, index) => `<a class="dev-home__page" href="${devHref(page.path)}"><span class="dev-home__number">0${index + 1}</span><h2>${t(page.title)}</h2><p>${t(page.description)}</p><code>${page.path}</code></a>`).join('')}</div>
    <p class="dev-home__foot">${t('dev.only')}</p>${hidden.length ? `<p class="dev-home__foot">${t('dev.aim.disabled')} <code>DEBUG_AIM=1 npm run dev</code></p>` : ''}`;
  document.body.append(main);
}
