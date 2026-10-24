import source from './releases.json';
import type { NewsBundle, NewsDocument, NewsItem } from './types';

const document = source as NewsDocument;
const images = import.meta.glob<string>('./images/*.webp', { eager: true, query: '?url', import: 'default' });

function withImage(item: NewsItem): NewsItem {
  if (!item.image) return item;
  const path = `./images/${item.image.src}`;
  const src = images[path];
  if (!src) throw new Error(`What's New image not found: ${path}`);
  return { ...item, image: { ...item.image, src } };
}

function withImages(bundle: NewsBundle): NewsBundle {
  return { ...bundle, items: bundle.items.map(withImage) };
}

const draft: NewsBundle = { tag: 'next', ...document.draft };

/** All news bundles, newest first. The Action moves the draft under its release tag before building. */
export const NEWS: readonly NewsBundle[] = [
  ...(draft.items.length ? [withImages(draft)] : []),
  ...document.releases.map(withImages),
];
