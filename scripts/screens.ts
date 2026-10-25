/**
 * Walks the menu pages at several window sizes and checks that they fit: nothing cut off at the bottom or sides of the
 * window (the page itself never scrolls), only the places that scroll on purpose.
 *
 *   npm run dev                       # the game, in another terminal
 *   npm run dev:server                # the relay, for the online pages (they are skipped with --local)
 *   npm run screens                   # check every page at every size, exit 1 if one doesn't fit
 *   npm run screens -- --out dump     # also write each page's markup and measurements to dump/<size>/ (diff two dumps to see what a change did)
 *
 *   --url <url>         the game, default http://localhost:5173/
 *   --relay <url>       the relay the online pages connect to, default ws://localhost:8080
 *   --out <dir>         write <dir>/<size>/<page>.html and .json; with --png also a screenshot
 *   --sizes <WxH,..>    window sizes to try
 *   --only <text>       only the pages whose name contains this
 *   --local             leave out the pages that need the relay
 *   --png               write screenshots next to the dumps
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, sleep, type Browser } from './chrome';

const SIZES = ['1920x1080', '1440x900', '1280x800', '1024x720', '768x1024', '390x844', '360x640'];

/** The day the pages are shown for, so "today's pick" and the daily challenge are the same on every run. */
const DAY = '2026-10-25';

/** What the pages are set up with: English, and nothing that moves or changes by itself. */
const SETTINGS = { language: 'en', menuBackground: false, statsTicker: false, lessMenuMotion: true, menuSounds: false, gameSounds: false };

type Target = string | { sel: string; text?: string; nth?: number };
type Step =
  | { click: Target }
  /** Types into the first visible field that matches. */
  | { type: { sel: string; text: string } }
  | { key: string }
  | { wait: number }
  /** Records the page as it is now, under this name (the last step of a page does so, too). */
  | { snap: string };

interface Page {
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
const connect: Step[] = [click('Connect'), { wait: 900 }];
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

const PAGES: Page[] = [
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
      ...online('Create a room'), ...connect, click('Create room'), { wait: 900 }, { snap: 'room' },
      ...PRESETS.flatMap((i): Step[] => [click(preset(i)), { snap: `preset-${i}` }]),
      click('Adjust rules'), { snap: 'rules' },
    ],
  })),
  ...(['classic', 'horizon', 'solar'] as const).flatMap((mode): Page[] =>
    handling([...online('Create a room'), ...connect, click('Create room'), { wait: 900 }], preset(1)).map((steps, i) => ({
      name: `online-cards-${mode}-${['edit', 'mine', 'cancel'][i]}`, online: true, lobby: { gameMode: mode }, steps,
    }))),
  ...(['classic', 'horizon', 'solar'] as const).map((mode): Page => ({
    name: `online-creator-${mode}`,
    online: true,
    lobby: { gameMode: mode },
    steps: [
      ...online('Create a room'), ...connect, click('Create room'), { wait: 900 },
      click('New rule'), { snap: 'open' },
      { type: { sel: 'input[type=text], input:not([type])', text: 'My test rule' } }, { snap: 'named' },
      click('Save'), { snap: 'saved' },
    ],
  })),
];

/** The measurement a page is judged by, run in the page itself. */
const MEASURE = `(() => {
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
  return { viewport: [vw, vh], scrollers, cutBottom: cutBottom.slice(0, 8), cutSide: cutSide.slice(0, 8) };
})()`;

/** Finds the thing to press and presses it: a row or a button, by its text or by a selector. */
const press = (target: Target): string => {
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

/** Markup with the bits that differ from run to run taken out, so two dumps can be diffed. */
function steady(html: string): string {
  const numbered = (value: string): string => value.replace(/\d+/g, '#');
  return html
    .replace(/\b(id|for|aria-labelledby|aria-describedby|aria-controls|href)="([^"]*)"/g, (_, attr: string, value: string) => `${attr}="${numbered(value)}"`)
    .replace(/url\(#([^)]*)\)/g, (_, id: string) => `url(#${numbered(id)})`)
    // The clock of the next daily challenge, and the room's code.
    .replace(/(New challenge in )\d+:\d+/g, '$1##:##')
    .replace(/(Room )\d+( · )/g, '$1#$2')
    .replace(/(lobby__code-value">)[^<]*</g, '$1…<')
    .replace(/></g, '>\n<');
}

/** What the page keeps in the browser, as written out in a fixed order and without the random bits (this browser's id, the ids of the player's own presets). */
function steadyStorage(storage: Record<string, string>): Record<string, unknown> {
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

interface Options {
  url: string;
  relay: string;
  out: string | null;
  sizes: string[];
  only: string | null;
  localOnly: boolean;
  png: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { url: 'http://localhost:5173/', relay: 'ws://localhost:8080', out: null, sizes: SIZES, only: null, localOnly: false, png: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--url') o.url = value();
    else if (flag === '--relay') o.relay = value();
    else if (flag === '--out') o.out = value();
    else if (flag === '--sizes') o.sizes = value().split(',');
    else if (flag === '--only') o.only = value();
    else if (flag === '--local') o.localOnly = true;
    else if (flag === '--png') o.png = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  return o;
}

interface Result {
  size: string;
  page: string;
  problems: string[];
}

async function visit(browser: Browser, opts: Options, size: string, page: Page, results: Result[]): Promise<void> {
  const { cdp } = browser;
  const [width, height] = size.split('x').map(Number);
  await browser.resize(width, height, width < 768);
  // The settings go in on the game's own origin, then the game is loaded for real.
  const origin = new URL(opts.url).origin;
  await cdp.send('Page.navigate', { url: `${origin}/favicon.svg` });
  await sleep(150);
  await cdp.evaluate(`localStorage.clear(); localStorage.setItem('slingshot.settings.v1', ${JSON.stringify(JSON.stringify(SETTINGS))}); localStorage.setItem('slingshot.lobby.v1', ${JSON.stringify(JSON.stringify({ server: opts.relay, ...page.lobby }))}); true`);
  await cdp.send('Page.navigate', { url: `${new URL(opts.url).href}?daily=${DAY}` });
  for (let i = 0; i < 50 && !(await cdp.evaluate<boolean>(`!!document.querySelector('#overlay .item')`)); i++) await sleep(100);
  await sleep(300);

  const snap = async (label: string): Promise<void> => {
    await sleep(250);
    const measured = await cdp.evaluate<{ viewport: number[]; scrollers: string[]; cutBottom: string[]; cutSide: string[] }>(MEASURE);
    const name = label ? `${page.name}__${label}` : page.name;
    const problems = [...measured.cutBottom.map((p) => `cut off below: ${p}`), ...measured.cutSide.map((p) => `cut off at the side: ${p}`)];
    results.push({ size, page: name, problems });
    if (!opts.out) return;
    const dir = join(opts.out, size);
    mkdirSync(dir, { recursive: true });
    const markup = await cdp.evaluate<string>(`document.getElementById('overlay').innerHTML`);
    const storage = await cdp.evaluate<string>(`JSON.stringify(Object.fromEntries(Object.entries(localStorage).sort()))`);
    writeFileSync(join(dir, `${name}.html`), steady(markup));
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ ...measured, storage: steadyStorage(JSON.parse(storage) as Record<string, string>) }, null, 2));
    if (opts.png) {
      const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'));
    }
  };

  let snapped = false;
  for (const step of page.steps) {
    if ('click' in step) {
      if (!(await cdp.evaluate<boolean>(press(step.click)))) {
        results.push({ size, page: page.name, problems: [`nothing to press for ${JSON.stringify(step.click)}`] });
        return;
      }
      await sleep(350);
    } else if ('type' in step) {
      const typed = await cdp.evaluate<boolean>(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(step.type.sel)})].find((e) => e.getClientRects().length > 0);
        if (!el) return false;
        el.focus();
        el.value = ${JSON.stringify(step.type.text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      if (!typed) {
        results.push({ size, page: page.name, problems: [`no field for ${step.type.sel}`] });
        return;
      }
    } else if ('key' in step) {
      await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(step.key)}, bubbles: true }))`);
      await sleep(300);
    } else if ('wait' in step) {
      await sleep(step.wait);
    } else {
      await snap(step.snap);
      snapped = true;
    }
  }
  if (!snapped || !('snap' in page.steps[page.steps.length - 1])) await snap('');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const pages = PAGES.filter((p) => (!opts.localOnly || !p.online) && (!opts.only || p.name.includes(opts.only)));
  const browser = await launchChrome(1280, 800);
  const results: Result[] = [];
  try {
    for (const size of opts.sizes) {
      for (const page of pages) await visit(browser, opts, size, page, results);
      console.log(`${size}: ${results.filter((r) => r.size === size && r.problems.length === 0).length}/${results.filter((r) => r.size === size).length} pages fit`);
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => r.problems.length > 0);
  for (const r of failed) console.log(`✗ ${r.size} ${r.page}\n    ${r.problems.join('\n    ')}`);
  console.log(failed.length ? `${failed.length} of ${results.length} pages have a problem` : `all ${results.length} pages fit`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
