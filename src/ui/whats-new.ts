import { getLang, t } from '../i18n';
import type { NewsItem, NewsTarget } from '../news/types';
import { h, type MenuItem, type Screen } from './menu';
import { menuPage } from './menu-page';
import type { App } from './screens';
import './whats-new.css';

const dateFormat = (date: string): string => new Date(`${date}T12:00:00`).toLocaleDateString(getLang(), { day: 'numeric', month: 'long', year: 'numeric' });

function card(item: NewsItem): HTMLElement {
  const lang = getLang();
  return h('article.news__item', null,
    ...(item.image ? [h('img.news__image', { src: item.image.src, alt: item.image.alt[lang], width: '1280', height: '720', loading: 'lazy' })] : []),
    h('div.news__text', null,
      h('p.news__date', null, dateFormat(item.date)),
      h('h3.news__title', null, item.title[lang]),
      h('p.news__body', null, item.text[lang]),
      ...(item.where ? [h('p.news__where', null, h('span.news__where-label', null, t('news.where')), item.where[lang])] : []),
      ...(item.open ? [h('div.items.items--row.news__try', { 'data-section': `try-${item.id}` })] : []),
    ),
  );
}

/** The What's New dialog: the given announcements, newest first, each with its picture and where to find it. */
export function newsScreen(app: App, items: readonly NewsItem[], open: Record<NewsTarget, () => void>): Screen {
  const tryIt = items.flatMap((item): MenuItem[] => (item.open ? [{ kind: 'action', section: `try-${item.id}`, label: t('news.try'), run: open[item.open] }] : []));
  const rows: MenuItem[] = [
    ...tryIt,
    { kind: 'action', section: 'actions', label: t('news.done'), primary: true, run: () => app.menu.back() },
  ];
  return {
    build: () => menuPage({
      title: t('news.title'),
      className: 'menu-page--news',
      body: [h('div.news', null, ...items.map(card))],
      footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
    }),
    items: rows,
    focus: rows.length - 1,
  };
}
