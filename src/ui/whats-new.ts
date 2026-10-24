import { getLang, t } from '../i18n';
import type { NewsBundle, NewsItem, NewsTarget } from '../news/types';
import { h, type MenuItem, type Screen } from './menu';
import { menuPage } from './menu-page';
import { modeArt } from './mode-icons';
import type { App } from './screens';
import './whats-new.css';

function media(item: NewsItem): HTMLElement {
  const lang = getLang();
  return h('div.news__media', null,
    item.image
      ? h('img.news__image', { src: item.image.src, alt: item.image.alt[lang], width: '1280', height: '720', loading: 'lazy' })
      : h('div.news__art', { role: 'img', 'aria-label': t('news.artAlt') }, modeArt('news')),
  );
}

function card(item: NewsItem): HTMLElement {
  const lang = getLang();
  return h('article.news__item', null,
    media(item),
    h('div.news__text', null,
      h('h4.news__title', null, item.title[lang]),
      h('p.news__body', null, item.text[lang]),
      ...(item.where ? [h('p.news__where', null, h('span.news__where-label', null, t('news.where')), h('span.news__where-value', null, item.where[lang]))] : []),
      ...(item.open ? [h('div.items.items--row.news__try', { 'data-section': `try-${item.id}` })] : []),
    ),
  );
}

function release(bundle: NewsBundle): HTMLElement {
  const lang = getLang();
  const tag = bundle.tag === 'next' ? t('news.nextTag') : bundle.tag;
  return h('section.news__release', null,
    h('header.news__release-head', null,
      h('h3.news__tag', null, tag),
      h('p.news__summary', null, bundle.summary[lang]),
    ),
    h('div.news__items', null, ...bundle.items.map(card)),
  );
}

/** The What's New dialog: release tags and summaries group the smaller feature cards below. */
export function newsScreen(app: App, bundles: readonly NewsBundle[], open: Record<NewsTarget, () => void>): Screen {
  const tryIt = bundles.flatMap((bundle) => bundle.items.flatMap((item): MenuItem[] => (item.open ? [{ kind: 'action', section: `try-${item.id}`, label: t('news.try'), run: open[item.open] }] : [])));
  const rows: MenuItem[] = [
    ...tryIt,
    { kind: 'action', section: 'actions', label: t('news.done'), primary: true, run: () => app.menu.back() },
  ];
  return {
    build: () => menuPage({
      title: t('news.title'),
      className: 'menu-page--news',
      body: [h('div.news', null, ...bundles.map(release))],
      footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
    }),
    items: rows,
    focus: rows.length - 1,
  };
}
