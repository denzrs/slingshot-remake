import type { Lang } from '../i18n';

/** A text in every language the game speaks; leave none out. */
export type Localized = Record<Lang, string>;

/** Where the "Try it" button of an item leads. */
export type NewsTarget = 'settings';

/**
 * One announcement in the What's New dialog. The list below is the whole change log players see:
 * add an item at the top for every feature a player would want to know about (see AGENTS.md).
 */
export interface NewsItem {
  /** Unique and never reused, e.g. `refined-look`. A player has seen everything from this one on down. */
  id: string;
  /** `YYYY-MM-DD`, the day it went in. */
  date: string;
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
