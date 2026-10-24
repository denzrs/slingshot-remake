import refinedLook from './images/refined-look.webp';
import solarSystem from './images/v2-solar-system.webp';
import type { NewsItem } from './types';

/**
 * What's New, newest first. Adding an item at the top is all it takes to announce something:
 * every player who has not seen it gets the dialog once, at their next visit. How to write one: AGENTS.md.
 */
export const NEWS: readonly NewsItem[] = [
  {
    id: 'stats-news-ticker',
    date: '2026-10-24',
    title: { de: 'Zahlen im Vorbeiflug', en: 'Stats on the fly' },
    text: {
      de: 'Kleine Fundstücke aus den Spielstatistiken rauschen jetzt als Laufband durchs Titelmenü und die Online-Lobby. Wenn du lieber Ruhe hast, schalte es unter Einstellungen → Darstellung aus.',
      en: 'Small discoveries from the game stats now stream through the title screen and online lobby. Turn the ticker off under Settings → Display if you would rather have a quieter menu.',
    },
    where: { de: 'Titelmenü · Online spielen · Einstellungen → Darstellung → Statistik-Laufband', en: 'Title screen · Play online · Settings → Display → Stats ticker' },
  },
  {
    id: 'solar-system-v2',
    date: '2026-10-24',
    title: { de: 'Sonnensystem in v2', en: 'Solar System in v2' },
    text: {
      de: 'Planeten und Schiffe kreisen um die Sonne, während sich das ganze Spielfeld im Lauf der Partie weiterdreht. Sonnenstürme verpassen Schüssen einen elektrischen Ruck; im Spielbericht erscheinen deine stärksten Flugbahnen als animierte Highlights.',
      en: 'Planets and ships orbit the sun as the whole field turns during play. Solar storms give shots an electric kick, and your standout paths appear as animated highlights in the match report.',
    },
    where: { de: 'Sonnensystem', en: 'Solar System' },
    image: {
      src: solarSystem,
      alt: {
        de: 'Partie im Sonnensystem mit Sonne, Planeten und umlaufenden Bahnen',
        en: 'A Solar System match with the sun, planets and their orbits',
      },
    },
  },
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
