/**
 * The menu pages the screens script visits: how to get to each one, what it is judged by, and what is taken out of the
 * markup so two runs can be compared.
 */

import type { Cdp } from './chrome';

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
  /** Phones show one rules/settings category; desktop keeps the overview. */
  | { category: string }
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
const badge: Target = { sel: '.item__status-reset, .preset-carousel__action--restore' };
const keep: Target = { sel: '.item__status-save, .preset-carousel__action--save' };
/** A rule changed on the rules page, which is then left. */
const tweak: Step[] = [click('Adjust rules'), { category: 'rules-twists' }, click('Hidden aim'), click('Done')];
const NAME: Step = { type: { sel: 'input[type=text], input:not([type])', text: 'My test rule' } };
/** What the player does with the cards: change a preset, go back, keep the change, restore the original; then make one of their own, change it and delete it. */
const handling = (open: Step[], card: Target): Step[][] => [
  [...open, click(card), ...tweak, { snap: 'edited' }, click(badge), { snap: 'reset' }, ...tweak, click(keep), { snap: 'kept' }, click(badge), { snap: 'original' }],
  [
    ...open, click('New rule'), NAME, click('Save rule'), { snap: 'made' }, ...tweak, { snap: 'edited' }, click(keep), { snap: 'kept' },
    click(badge), { snap: 'changing' }, click('Delete rule'), { snap: 'asking' }, click('Really delete?'), { snap: 'deleted' },
  ],
  [...open, click('New rule'), { category: 'rules-twists' }, click('Hidden aim'), { snap: 'edited' }, click('Cancel'), { snap: 'cancelled' }],
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
  { name: 'settings', steps: [click('Settings'), { snap: 'display' }, { category: 'prefs-device' }, { snap: 'device' }, { category: 'prefs-language' }, { snap: 'language' }] },
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

/** Resolves once nothing on the page moves any more: its animations are over and its markup and size have held still for a few frames. */
export const SETTLE = `new Promise((done) => {
  const root = document.getElementById('overlay');
  const t0 = performance.now();
  let last = '', still = 0;
  const tick = () => {
    const busy = document.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity);
    const sig = root.innerHTML.length + ':' + root.scrollHeight + ':' + Math.round(root.getBoundingClientRect().height);
    if (!busy && sig === last) still++; else { still = 0; last = sig; }
    if (still >= 6 || performance.now() - t0 > 3000) return done(still >= 6);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`;

/** Resolves true once the expression holds, false if it does not within the time. */
export const until = (expression: string, ms = 8000): string => `new Promise((done) => {
  const t0 = performance.now();
  const tick = () => {
    if (${expression}) return done(true);
    if (performance.now() - t0 > ${ms}) return done(false);
    setTimeout(tick, 20);
  };
  tick();
})`;

/** Does one step on the page: null when it went well, what went wrong otherwise. (A `snap` is the caller's to take.) */
export async function perform(cdp: Cdp, step: Exclude<Step, { snap: string }>): Promise<string | null> {
  if ('click' in step) {
    if (!(await cdp.evaluate<boolean>(press(step.click)))) return `nothing to press for ${JSON.stringify(step.click)}`;
    await cdp.evaluate(SETTLE);
  } else if ('category' in step) {
    const opened = await cdp.evaluate<boolean>(`(() => {
      const navigation = [...document.querySelectorAll('.sheet-nav')].find((el) => !el.hidden);
      if (!navigation) return true;
      const button = navigation.querySelector('[aria-controls$="-${step.category}"]');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!opened) return `no category ${step.category}`;
    await cdp.evaluate(SETTLE);
  } else if ('type' in step) {
    const typed = await cdp.evaluate<boolean>(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(step.type.sel)})].find((e) => e.getClientRects().length > 0);
      if (!el) return false;
      el.focus();
      el.value = ${JSON.stringify(step.type.text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!typed) return `no field for ${step.type.sel}`;
  } else if ('key' in step) {
    await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(step.key)}, bubbles: true }))`);
    await cdp.evaluate(SETTLE);
  } else if ('until' in step) {
    if (!(await cdp.evaluate<boolean>(until(step.until)))) return `never became true: ${step.until}`;
    await cdp.evaluate(SETTLE);
  } else {
    await new Promise((r) => setTimeout(r, step.wait));
  }
  return null;
}

/**
 * What the mobile audit looks for on a phone, as a function (given the safe area the phone has) to run in the page: the
 * whole page, not only the menu, since a match has its controls outside it. Lists, as short descriptions, what is cut off
 * by the window's edge, what is under the notch or the home bar, what text is shortened or runs out of its box, and which
 * tap targets are small.
 */
export const MEASURE_PHONE = `(insets) => {
  const vw = innerWidth, vh = innerHeight;
  const shown = (el) => {
    if (el.getClientRects().length === 0 || el.closest('[hidden]')) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  };
  const name = (el) => {
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 2).map((c) => '.' + c).join('') + (text ? ' "' + text + '"' : '');
  };
  /** Whether an ancestor holds the element back on this axis: it scrolls or clips there, so what lies beyond is not lost. */
  const held = (el, axis) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (getComputedStyle(a)[axis] !== 'visible') return true;
    return false;
  };
  const all = [...document.body.querySelectorAll('*')].filter((el) => !(el instanceof SVGElement && !(el instanceof SVGSVGElement)) && el.id !== 'stage' && !el.closest('#stage, #debug-seed, #chat[hidden]') && shown(el));
  const sized = all.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const rect = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom); };
  const hasText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  const cutOff = sized.filter((el) => {
    const r = el.getBoundingClientRect();
    return ((r.right > vw + 1 || r.left < -1) && !held(el, 'overflowX')) || ((r.bottom > vh + 1 || r.top < -1) && !held(el, 'overflowY'));
  }).map((el) => name(el) + ' [' + rect(el) + '] in ' + vw + 'x' + vh);

  /** Whether the element is inside something that really scrolls sideways (a carousel): what scrolls may pass under the notch. */
  const sideways = (el) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (/auto|scroll/.test(getComputedStyle(a).overflowX) && a.scrollWidth > a.clientWidth + 1) return true;
    return false;
  };
  const interactive = (el) => el.matches('button, a[href], input, select, textarea, [role=button], [role=tab], [role=switch], summary, .item');
  const fixedEdge = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return true; return false; };
  // Inside a side safe area (landscape): a failure around the middle of the screen, where the Dynamic Island is; in a corner only a warning, the rounded corner being the least of it. A peek past the screen's edge (a neighbouring tab) is on purpose.
  const island = (r) => r.bottom > vh / 2 - 70 && r.top < vh / 2 + 70;
  const inSide = (el) => {
    if (!hasText(el) && !interactive(el)) return null;
    const r = el.getBoundingClientRect();
    if (sideways(el) || r.left < -1 || r.right > vw + 1) return null;
    return (insets.left > 0 && r.left < insets.left - 1) || (insets.right > 0 && r.right > vw - insets.right + 1) ? r : null;
  };
  const edgeHit = (el) => {
    const r = el.getBoundingClientRect();
    return fixedEdge(el) && !held(el, 'overflowY') && interactive(el) && (r.top < insets.top - 1 || r.bottom > vh - insets.bottom + 1);
  };
  const detail = (el) => name(el) + ' [' + rect(el) + '] safe: top ' + insets.top + ', bottom ' + insets.bottom + ', sides ' + insets.left + '/' + insets.right;
  const unsafe = sized.filter((el) => { const r = inSide(el); return edgeHit(el) || (r && island(r)); }).map(detail);
  const cornerUnsafe = sized.filter((el) => { const r = inSide(el); return r && !island(r) && !edgeHit(el); }).map(detail);

  const shortened = sized.filter((el) => {
    const s = getComputedStyle(el);
    if (!hasText(el)) return false;
    if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) return true;
    const clamp = s.webkitLineClamp;
    return !!clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
  }).map((el) => name(el) + ' (' + el.scrollWidth + '/' + el.clientWidth + ' wide, ' + el.scrollHeight + '/' + el.clientHeight + ' high)');

  const overflowing = sized.filter((el) => {
    if (!hasText(el)) return false;
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis' || s.overflowX === 'auto' || s.overflowX === 'scroll') return false;
    return el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 4 && (s.overflowX === 'hidden' || s.overflowX === 'clip' || s.whiteSpace === 'nowrap');
  }).map((el) => name(el) + ' (' + el.scrollWidth + ' of ' + el.clientWidth + ')');

  const smallTargets = sized.filter((el) => {
    if (!interactive(el) || el.matches('input[type=hidden], .sheet-nav *')) return false;
    const r = el.getBoundingClientRect();
    return Math.min(r.width, r.height) < 44 && !el.closest('[inert]');
  }).slice(0, 12).map((el) => { const r = el.getBoundingClientRect(); return name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); });

  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.append(probe);
  const ps = getComputedStyle(probe);
  const envInsets = { top: parseFloat(ps.paddingTop) || 0, right: parseFloat(ps.paddingRight) || 0, bottom: parseFloat(ps.paddingBottom) || 0, left: parseFloat(ps.paddingLeft) || 0 };
  probe.remove();
  return { viewport: [vw, vh], envInsets, cutOff: cutOff.slice(0, 10), unsafe: unsafe.slice(0, 10), cornerUnsafe: cornerUnsafe.slice(0, 6), shortened: shortened.slice(0, 12), overflowing: overflowing.slice(0, 10), smallTargets };
}`;
