import type { Lang } from '../i18n';

/** A text in every language the game speaks; leave none out. */
export type Localized = Record<Lang, string>;

/** Where the "Try it" button of an item leads. */
export type NewsTarget = 'settings';

/** One player-facing change inside a release bundle. */
export interface NewsItem {
  /** Unique and never reused, e.g. `refined-look`. */
  id: string;
  title: Localized;
  /** One or two sentences: what it is and why it is fun. */
  text: Localized;
  /** The way there in the menus, e.g. "Settings → Display → Graphics". */
  where?: Localized;
  /** A screenshot (16:9, `.webp`, made with `npm run shot`) kept in `src/news/images/`. */
  image?: { src: string; alt: Localized };
  /** A button that opens the place the item is about. */
  open?: NewsTarget;
}

/** One What's New section. The tag is assigned by the release workflow. */
export interface NewsBundle {
  tag: string;
  summary: Localized;
  items: readonly NewsItem[];
}

/** Editorial source for published bundles and the bundle being prepared for the next release. */
export interface NewsDocument {
  draft: Omit<NewsBundle, 'tag'>;
  releases: readonly NewsBundle[];
}
