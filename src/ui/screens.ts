import { COLORS, SCORING } from '../config';
import type { Game } from '../game';
import type { Settings } from '../settings';
import { h, type Menu, type MenuItem, type Screen } from './menu';

export interface App {
  menu: Menu;
  settings: Settings;
  settingsChanged(): void;
  startGame(): void;
  resume(): void;
  rematch(): void;
  toTitle(): void;
  toggleFullscreen(): void;
  isFullscreen(): boolean;
}

const onOff = [
  { value: true, label: 'An' },
  { value: false, label: 'Aus' },
];

export function titleScreen(app: App): Screen {
  return {
    build: () =>
      h(
        'section.screen.screen--title',
        { 'aria-labelledby': 'wordmark' },
        h(
          'div.title-col',
          null,
          h('p.eyebrow', null, 'Gravitationsduell für zwei'),
          h('h1.wordmark', { id: 'wordmark' }, 'Slingshot'),
          h(
            'p.lede',
            null,
            'Zwei Raumschiffe, dazwischen Planeten. Jeder Schuss folgt der Schwerkraft – lies deine alten Bahnen und tast dich an den Treffer heran.',
          ),
          h('nav.items', { 'data-items': '', 'aria-label': 'Hauptmenü' }),
          h('p.keys', null, '↑ ↓ wählen · Enter bestätigen'),
        ),
      ),
    items: [
      { kind: 'action', label: 'Spiel starten', primary: true, run: () => app.startGame() },
      { kind: 'action', label: 'Einstellungen', run: () => app.menu.push(settingsScreen(app)) },
      { kind: 'action', label: 'Anleitung', run: () => app.menu.push(helpScreen(app)) },
    ],
  };
}

export function pauseScreen(app: App): Screen {
  return {
    build: () => panel('Pause', null),
    items: [
      { kind: 'action', label: 'Weiterspielen', primary: true, run: () => app.resume() },
      { kind: 'action', label: 'Neues Spiel', run: () => app.rematch() },
      { kind: 'action', label: 'Einstellungen', run: () => app.menu.push(settingsScreen(app)) },
      { kind: 'action', label: 'Anleitung', run: () => app.menu.push(helpScreen(app)) },
      { kind: 'action', label: 'Hauptmenü', run: () => app.toTitle() },
    ],
    onEscape: () => app.resume(),
  };
}

export function settingsScreen(app: App): Screen {
  const s = app.settings;
  const choice = <K extends keyof Settings>(
    label: string,
    key: K,
    options: { value: Settings[K]; label: string }[],
    disabled?: () => boolean,
  ): MenuItem => ({
    kind: 'choice',
    label,
    options,
    get: () => s[key],
    set: (v) => {
      s[key] = v as Settings[K];
      app.settingsChanged();
    },
    disabled,
  });

  return {
    build: () =>
      panel(
        'Einstellungen',
        h('p.note', null, 'Planetenzahl und unsichtbare Planeten gelten ab der nächsten Runde. Rundenzahl ab dem nächsten Spiel.'),
        'panel--wide',
      ),
    items: [
      choice('Gegner', 'opponent', [
        { value: 'human', label: 'Mensch' },
        { value: 'cpu', label: 'CPU' },
      ]),
      choice(
        'CPU-Stärke',
        'cpuLevel',
        [
          { value: 'easy', label: 'Leicht' },
          { value: 'medium', label: 'Mittel' },
          { value: 'hard', label: 'Schwer' },
        ],
        () => s.opponent !== 'cpu',
      ),
      choice('Runden pro Spiel', 'rounds', [1, 3, 5, 7, 10, 15, 20, 0].map((n) => ({ value: n, label: n ? String(n) : 'Endlos' }))),
      choice('Max. Planeten', 'maxPlanets', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) }))),
      choice('Unsichtbare Planeten', 'invisiblePlanets', onOff),
      choice('Reflektierende Ränder', 'bounce', onOff),
      choice('Feste Schusskraft', 'fixedPower', onOff),
      choice('Max. Flugzeit', 'shotTime', [10, 20, 30, 60].map((n) => ({ value: n, label: `${n} s` }))),
      choice('Gravitationslinien', 'contours', onOff),
      choice('Partikel', 'particles', onOff),
      choice('Ton', 'sound', onOff),
      {
        kind: 'choice',
        label: 'Vollbild',
        options: onOff,
        get: () => app.isFullscreen(),
        set: () => app.toggleFullscreen(),
      },
      { kind: 'action', label: 'Zurück', run: () => app.menu.back() },
    ],
  };
}

export function helpScreen(app: App): Screen {
  const key = (k: string) => h('kbd', null, k);
  const row = (keys: (Node | string)[], text: string) => h('tr', null, h('th', { scope: 'row' }, ...keys), h('td', null, text));
  return {
    build: () =>
      panel(
        'Anleitung',
        h(
          'div.help',
          null,
          h(
            'p',
            null,
            'Ihr schießt abwechselnd auf das gegnerische Schiff. Jeder Planet zieht den Schuss an – große stärker als kleine. Anzahl, Größe und Lage der Planeten wechseln jede Runde.',
          ),
          h(
            'p',
            null,
            'Eure Schüsse bleiben als Spur stehen: der letzte durchgezogen, ältere gepunktet. Vergleicht Bahn und Einstellung und korrigiert Schritt für Schritt.',
          ),
          h(
            'table.keys-table',
            null,
            h(
              'tbody',
              null,
              row([key('←'), ' ', key('→')], 'Schiff drehen'),
              row([key('↑'), ' ', key('↓')], 'Schusskraft ändern'),
              row([key('Enter')], 'Feuer (auch Leertaste)'),
              row([key('Shift')], 'große Schritte (×10)'),
              row([key('Alt')], 'kleine Schritte (×0,1)'),
              row([key('Strg'), ' oder ', key('Alt'), '+', key('Shift')], 'sehr kleine Schritte (×0,01)'),
              row(['Ziehen'], 'mit Maus oder Finger auf dem Spielfeld zielen'),
              row([key('Leertaste')], 'nächste Runde'),
              row([key('Esc')], 'Menü'),
              row([key('F')], 'Vollbild'),
            ),
          ),
          h(
            'p',
            null,
            `Ein Treffer bringt bis zu 1500 Punkte: je weniger Schüsse ihr in der Runde braucht und je weniger Kraft der Treffer hat, desto mehr. Wer das eigene Schiff trifft, schenkt dem Gegner ${SCORING.SELF_HIT} Punkte. Nach der letzten Runde gewinnt, wer mehr Punkte hat.`,
          ),
        ),
        'panel--wide',
      ),
    items: [{ kind: 'action', label: 'Zurück', primary: true, run: () => app.menu.back() }],
  };
}

export function gameOverScreen(app: App, game: Game, names: [string, string]): Screen {
  const [a, b] = game.players;
  const leader = game.leader;
  const headline = leader === null ? 'Unentschieden' : `${names[leader]} gewinnt`;
  return {
    build: () => {
      const title = h('h2.result', null, headline);
      if (leader !== null) title.style.color = COLORS.players[leader];
      const score = (n: number, id: 0 | 1) => {
        const el = h('span.scoreline__n', null, String(n));
        el.style.color = COLORS.players[id];
        return el;
      };
      return h(
        'section.screen.screen--panel',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Endstand' },
        h(
          'div.panel.panel--result',
          null,
          h('p.eyebrow', null, `Endstand nach ${game.round} ${game.round === 1 ? 'Runde' : 'Runden'}`),
          title,
          h('p.scoreline', null, score(a.score, 0), h('span.scoreline__sep', null, ':'), score(b.score, 1)),
          h('div.items.items--row', { 'data-items': '' }),
        ),
      );
    },
    items: [
      { kind: 'action', label: 'Revanche', primary: true, run: () => app.rematch() },
      { kind: 'action', label: 'Hauptmenü', run: () => app.toTitle() },
    ],
    onEscape: () => app.toTitle(),
  };
}

function panel(title: string, body: HTMLElement | null, extraClass = ''): HTMLElement {
  return h(
    'section.screen.screen--panel',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(`div.panel${extraClass ? '.' + extraClass : ''}`, null, h('h2.panel__title', null, title), ...(body ? [body] : []), h('div.items', { 'data-items': '' })),
  );
}
