import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import './dev-shell.css';
import { DEV_PAGES, type DevPage } from '../../dev/pages';
import { isLang, setLang, t } from '../platform/i18n';

export const devPageEnabled = (page: DevPage): boolean => !('debugAim' in page) || !!import.meta.env.DEBUG_AIM;

/** Keep the chosen catalogue language when moving between tools. */
export function devHref(path: string): string {
  const lang = new URLSearchParams(location.search).get('lang');
  return isLang(lang) ? `${path}${path.includes('?') ? '&' : '?'}lang=${lang}` : path;
}

if (import.meta.env.DEV && location.pathname.startsWith('/dev/')) {
  const current = DEV_PAGES.find((page) => page.path === location.pathname) ?? DEV_PAGES[0];
  const header = document.createElement('header');
  header.className = 'dev-shell';
  header.id = 'dev-navigation';
  document.body.style.setProperty('--dev-content-top', getComputedStyle(document.body).paddingTop);
  document.body.classList.add('dev-page', `dev-page--${current.id}`);
  document.body.prepend(header);
  const render = () => {
    if (isLang(document.documentElement.lang)) setLang(document.documentElement.lang);
    header.innerHTML = `<a class="dev-shell__brand" href="${devHref('/dev/')}">SLINGSHOT <span>DEV</span></a>
      <nav class="dev-shell__links" aria-label="${t('dev.navigation')}">${DEV_PAGES.map((page) => devPageEnabled(page)
        ? `<a href="${devHref(page.path)}"${page.id === current.id ? ' aria-current="page"' : ''}>${t(page.title)}</a>`
        : `<span aria-disabled="true" title="DEBUG_AIM=1 npm run dev">${t(page.title)} · DEBUG_AIM</span>`).join('')}</nav>
      <a class="dev-shell__game" href="/">${t('dev.game')} ↗</a>`;
    header.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  render();
  const resize = () => document.documentElement.style.setProperty('--dev-header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
  new ResizeObserver(resize).observe(header);
  resize();
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}
