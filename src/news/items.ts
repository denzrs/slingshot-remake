import refinedLook from './images/refined-look.webp';
import type { NewsItem } from './types';

/**
 * What's New, newest first. Adding an item at the top is all it takes to announce something:
 * every player who has not seen it gets the dialog once, at their next visit. How to write one: AGENTS.md.
 */
export const NEWS: readonly NewsItem[] = [
  {
    id: 'refined-look',
    date: '2026-10-24',
    title: { de: 'Refined Look', en: 'Refined Look' },
    text: {
      de: 'Glühende Raumschiffe und Planeten, die sich bewegen: Slingshot in einer neuen Grafik. Der klassische Look bleibt, du schaltest jederzeit um.',
      en: 'Glowing ships and planets that move: Slingshot with new graphics. The classic look is still there, switch any time.',
    },
    where: { de: 'Einstellungen → Darstellung → Grafik', en: 'Settings → Display → Graphics' },
    image: {
      src: refinedLook,
      alt: {
        de: 'Die Einstellungen mit der hervorgehobenen Auswahl „Refined Look“ unter Grafik',
        en: 'The settings with the Graphics choice "Refined Look" highlighted',
      },
    },
    open: 'settings',
  },
];
