import { getLang, t } from '../i18n';
import type { NewsBundle, NewsItem, NewsTarget } from '../news/types';
import { h, type MenuItem, type Screen } from './menu';
import { menuPage } from './menu-page';
import { modeArt } from './mode-icons';
import type { App } from './screens';
import './whats-new.css';

function artwork(item: NewsItem, enlarged = false): HTMLElement {
  const lang = getLang();
  if (item.image) {
    return h(`img.${enlarged ? 'news__lightbox-image' : 'news__image'}`, {
      src: item.image.src,
      alt: item.image.alt[lang],
      width: '1280',
      height: '720',
      ...(enlarged ? {} : { loading: 'lazy' }),
    });
  }
  return h(`div.news__art${enlarged ? '.news__art--large' : ''}`, { role: 'img', 'aria-label': t('news.artAlt') }, modeArt('news'));
}

function media(item: NewsItem): HTMLElement {
  if (!item.image) return h('div.news__media', null, artwork(item));

  const lang = getLang();
  const titleId = `news-lightbox-title-${item.id}`;
  const close = h('button.news__lightbox-close', {
    type: 'button',
    'aria-label': t('news.close'),
  }, h('span', { 'aria-hidden': 'true' }, '×'), t('news.close'));
  const dialog = h('dialog.news__lightbox', { 'aria-labelledby': titleId },
    h('div.news__lightbox-panel', null,
      h('header.news__lightbox-head', null,
        h('div.news__lightbox-heading', null,
          h('p.news__lightbox-kicker', null, t('news.expand')),
          h('h3.news__lightbox-title', { id: titleId }, item.title[lang]),
        ),
        close,
      ),
      h('div.news__lightbox-stage', null, artwork(item, true)),
    ),
  ) as HTMLDialogElement;
  const expand = h('button.news__expand', {
    type: 'button',
    'aria-label': `${t('news.expand')}: ${item.title[lang]}`,
  }, h('span.news__expand-icon', { 'aria-hidden': 'true' }, '⤢'), t('news.expand'));
  const container = h('div.news__media', null, artwork(item), expand, dialog);

  expand.addEventListener('click', () => dialog.showModal());
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dialog.close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  return container;
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
  const tag = bundle.tag === 'next' ? t('news.nextTag') : bundle.tag;
  return h('section.news__release', null,
    h('header.news__release-head', null,
      h('h3.news__tag', null, tag),
    ),
    h('div.news__items', null, ...bundle.items.map(card)),
  );
}

/** The What's New dialog: release tags group the feature cards below. */
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
