/**
 * The menu pages the screens script visits: how to get to each one, what it is judged by, and what is taken out of the
 * markup so two runs can be compared.
 */

/** The sizes people use, and the ones just either side of a breakpoint, where a layout changes. */
export const SIZES = [
  '1920x1080', '1440x900', '1280x800', '1024x720', '768x1024', '390x844', '360x640',
  '1000x720', '1001x720', '1100x800', '1101x800', '1440x999', '1440x1000',
];
/** Enough to see most changes in under a minute. */
export const QUICK_SIZES = ['1440x900', '1024x720', '390x844'];

/** The day the pages are shown for, so "today's pick" and the daily challenge are the same on every run. */
export const DAY = '2026-10-25';

/** What the pages are set up with: English, and nothing that moves or changes by itself. */
export const SETTINGS = { language: 'en', menuBackground: false, statsTicker: false, lessMenuMotion: true, menuSounds: false, gameSounds: false };

export type Target = string | { sel: string; text?: string; nth?: number };
export type Step =
  | { click: Target }
  /** Types into the first visible field that matches. */
  | { type: { sel: string; text: string } }
  | { key: string }
  /** A pause, for what no page state tells (the game's first frames). */
  | { wait: number }
  /** Waits until this expression is true in the page. */
  | { until: string }
  /** Records the page as it is now, under this name (the last step of a page does so, too). */
  | { snap: string };

export interface Page {
  name: string;
  /** Needs the relay. */
  online?: boolean;
  /** What the lobby remembers from an earlier visit, on top of the relay's address. */
  lobby?: Record<string, unknown>;
  steps: Step[];
}

const click = (target: Target): Step => ({ click: target });
const card = (section: string, nth: number): Target => ({ sel: `[data-section="${section}"] .item`, nth });
/** A preset's card, local or online: the player's own "new rule" card is not one of them. */
const preset = (nth: number): Target => ({ sel: '.briefing__preset-shell .item--card', nth });
const local = (nth: number): Step[] => [click(card('modes', nth))];
const online = (text: string): Step[] => [click('Play online'), click(text)];
/** What the page shows once the relay has taken the connection, and once a room stands. */
const CONNECTED = "!!document.querySelector('.online-connection.is-connected')";
const IN_ROOM = "!!document.querySelector('.menu-page--room')";
const connect: Step[] = [click('Connect'), { until: CONNECTED }];
const PRESETS = [0, 1, 2, 3];
/** The badge on the chosen card that goes back to what it gave, and the one that keeps the changes. */
const badge: Target = { sel: '.item__status-reset' };
const keep: Target = { sel: '.item__status-save' };
/** A rule changed on the rules page, which is then left. */
const tweak: Step[] = [click('Adjust rules'), click('Hidden aim'), click('Done')];
const NAME: Step = { type: { sel: 'input[type=text], input:not([type])', text: 'My test rule' } };
/** What the player does with the cards: change a preset, go back, keep the change, restore the original; then make one of their own, change it and delete it. */
const handling = (open: Step[], card: Target): Step[][] => [
  [...open, click(card), ...tweak, { snap: 'edited' }, click(badge), { snap: 'reset' }, ...tweak, click(keep), { snap: 'kept' }, click(badge), { snap: 'original' }],
  [
    ...open, click('New rule'), NAME, click('Save rule'), { snap: 'made' }, ...tweak, { snap: 'edited' }, click(keep), { snap: 'kept' },
    click(badge), { snap: 'changing' }, click('Delete rule'), { snap: 'asking' }, click('Really delete?'), { snap: 'deleted' },
  ],
  [...open, click('New rule'), click('Hidden aim'), { snap: 'edited' }, click('Cancel'), { snap: 'cancelled' }],
];

export const PAGES: Page[] = [
  { name: 'title', steps: [] },
  { name: 'title-online', steps: [click('Play online')] },
  ...(['classic', 'horizon', 'solar'] as const).flatMap((mode, nth): Page[] => [
    { name: `setup-${mode}`, steps: local(nth) },
    {
      name: `setup-${mode}-presets`,
      steps: [...local(nth), ...PRESETS.flatMap((i): Step[] => [click(preset(i)), { snap: `preset-${i}` }])],
    },
    { name: `rules-${mode}`, steps: [...local(nth), click('Adjust rules')] },
    { name: `crew-${mode}`, steps: [...local(nth), click('Edit players')] },
    {
      name: `creator-${mode}`,
      steps: [
        ...local(nth), click('New rule'), { snap: 'open' },
        { type: { sel: 'input[type=text], input:not([type])', text: 'My test rule' } }, { snap: 'named' },
        click('Save'), { snap: 'saved' },
      ],
    },
  ]),
  ...(['classic', 'horizon', 'solar'] as const).flatMap((mode, nth): Page[] =>
    handling(local(nth), preset(1)).map((steps, i) => ({ name: `cards-${mode}-${['edit', 'mine', 'cancel'][i]}`, steps }))),
  { name: 'settings', steps: [click('Settings')] },
  { name: 'training', steps: [click('Flight training')] },
  { name: 'daily', steps: [{ click: { sel: '[data-section="daily"] .item' } }] },
  { name: 'game-pause', steps: [...local(0), click('Start game'), { wait: 600 }, { key: 'Escape' }, { wait: 400 }] },
  { name: 'online-find', online: true, steps: [...online('Find a room'), ...connect] },
  { name: 'online-code', online: true, steps: [...online('Enter a code'), ...connect] },
  { name: 'online-create', online: true, steps: [...online('Create a room'), ...connect] },
  // The presets live in the room itself: a room is opened first, and its game and rules are picked inside it.
  ...(['classic', 'horizon', 'solar'] as const).map((mode): Page => ({
    name: `online-room-${mode}`,
    online: true,
    lobby: { gameMode: mode },
    steps: [
      ...online('Create a room'), ...connect, click('Create room'), { until: IN_ROOM }, { snap: 'room' },
      ...PRESETS.flatMap((i): Step[] => [click(preset(i)), { snap: `preset-${i}` }]),
      click('Adjust rules'), { snap: 'rules' },
    ],
  })),
  ...(['classic', 'horizon', 'solar'] as const).flatMap((mode): Page[] =>
    handling([...online('Create a room'), ...connect, click('Create room'), { until: IN_ROOM }], preset(1)).map((steps, i) => ({
      name: `online-cards-${mode}-${['edit', 'mine', 'cancel'][i]}`, online: true, lobby: { gameMode: mode }, steps,
    }))),
  ...(['classic', 'horizon', 'solar'] as const).map((mode): Page => ({
    name: `online-creator-${mode}`,
    online: true,
    lobby: { gameMode: mode },
    steps: [
      ...online('Create a room'), ...connect, click('Create room'), { until: IN_ROOM },
      click('New rule'), { snap: 'open' },
      { type: { sel: 'input[type=text], input:not([type])', text: 'My test rule' } }, { snap: 'named' },
      click('Save'), { snap: 'saved' },
    ],
  })),
];

/** The measurement a page is judged by, run in the page itself. */
export const MEASURE = `(() => {
  const root = document.getElementById('overlay');
  const vw = innerWidth, vh = innerHeight;
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
  /** Whether an ancestor holds the element back on this axis: it scrolls or clips there, so what lies beyond is not lost. */
  const held = (el, axis) => {
    for (let a = el.parentElement; a && a !== root; a = a.parentElement) if (getComputedStyle(a)[axis] !== 'visible') return true;
    return false;
  };
  const all = [...root.querySelectorAll('*')].filter(shown);
  const scrollers = all.filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1).map((el) => name(el) + ' ' + el.scrollHeight + '/' + el.clientHeight);
  const sized = all.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !(el instanceof SVGElement && el.closest('svg') !== el && !(el instanceof SVGSVGElement)); });
  const cutBottom = sized.filter((el) => el.getBoundingClientRect().bottom > vh + 1 && !held(el, 'overflowY')).map((el) => name(el) + ' +' + Math.round(el.getBoundingClientRect().bottom - vh));
  const cutSide = sized.filter((el) => { const r = el.getBoundingClientRect(); return (r.right > vw + 1 || r.left < -1) && !held(el, 'overflowX'); }).map((el) => name(el) + ' ' + Math.round(el.getBoundingClientRect().left) + '..' + Math.round(el.getBoundingClientRect().right));
  // Where every element is and how it is dressed, to tell a change that moves or recolours anything from one that does not. The
  // list of open rooms is other people's business, and is left out.
  const look = (el) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor, s.borderTopColor, s.fontSize, s.fontWeight, s.opacity, s.display, s.boxShadow === 'none' ? '' : 'shadow', s.letterSpacing, s.lineHeight].join('|'); };
  const layout = all.filter((el) => !el.closest('.lobby__rooms')).map((el) => {
    const r = el.getBoundingClientRect();
    return name(el) + ' ' + [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(',') + ' ' + look(el);
  });
  return { viewport: [vw, vh], scrollers, cutBottom: cutBottom.slice(0, 8), cutSide: cutSide.slice(0, 8), layout };
})()`;

/** Finds the thing to press and presses it: a row or a button, by its text or by a selector. */
export const press = (target: Target): string => {
  const { sel, text, nth } = typeof target === 'string' ? { sel: undefined, text: target, nth: undefined } : target;
  return `(() => {
    const norm = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase();
    const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
    const pool = [...document.querySelectorAll(${JSON.stringify(sel ?? 'button, a, [role=button], .item')})].filter(shown);
    const want = ${JSON.stringify(text ? text.toLowerCase() : null)};
    const hits = want === null ? pool : (() => {
      const starts = pool.filter((el) => norm(el.textContent).startsWith(want));
      return starts.length ? starts : pool.filter((el) => norm(el.textContent).includes(want));
    })();
    const el = hits[${nth ?? 0}];
    if (!el) return false;
    el.click();
    return true;
  })()`;
};

/** The classes the page wears for a moment after something happens (its entrance, a connection coming up, a result found), whose timers run on the page's own clock. */
const MOMENTARY = /\s*\b(menu-page--entered|menu-page--mode-enter-(?:next|previous)|is-linked|is-dropped|is-found|is-not-found|is-error|lobby--linked)\b/g;

/** Markup with the bits that differ from run to run taken out, so two dumps can be diffed. */
export function steady(html: string): string {
  const numbered = (value: string): string => value.replace(/\d+/g, '#');
  return html
    .replace(/\b(id|for|aria-labelledby|aria-describedby|aria-controls|href)="([^"]*)"/g, (_, attr: string, value: string) => `${attr}="${numbered(value)}"`)
    .replace(/url\(#([^)]*)\)/g, (_, id: string) => `url(#${numbered(id)})`)
    // The clock of the next daily challenge, and the room's code.
    .replace(/(New challenge in )\d+:\d+/g, '$1##:##')
    .replace(/(Room )\d+( · )/g, '$1#$2')
    .replace(/(lobby__code-value">)[^<]*</g, '$1…<')
    // Whoever else is on the relay: the list of open rooms and how many there are.
    .replace(/<ul class="lobby__rooms[^"]*">.*?<\/ul>/gs, '<ul class="lobby__rooms"></ul>')
    .replace(/(online-rooms__count">)\d+/g, '$1N')
    .replace(/class="([^"]*)"/g, (_, classes: string) => `class="${classes.replace(MOMENTARY, '').trim()}"`)
    .replace(/></g, '>\n<');
}

/** What the page keeps in the browser, as written out in a fixed order and without the random bits (this browser's id, the ids of the player's own presets). */
export function steadyStorage(storage: Record<string, string>): Record<string, unknown> {
  const sorted = (value: unknown): unknown => Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]))
      : value;
  return Object.fromEntries(Object.entries(storage).map(([key, raw]) => {
    if (key === 'slingshot.browser.v1') return [key, '…'];
    try {
      return [key, sorted(JSON.parse(raw.replace(/"id":"[a-z0-9]{8}"/g, '"id":"…"')))];
    } catch {
      return [key, raw];
    }
  }));
}
