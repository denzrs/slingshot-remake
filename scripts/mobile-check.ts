/** Real touch/Retina interaction checks. Run against `npm run dev`: npx tsx scripts/mobile-check.ts [url]. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChrome, sleep } from './chrome';
import { press, SETTINGS } from './screens-pages';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = '/private/tmp/slingshot-mobile-check';
mkdirSync(out, { recursive: true });
const browser = await launchChrome(430, 932);
const { cdp } = browser;
const check = async (expression: string, message: string) => assert(await cdp.evaluate<boolean>(expression), message);
const click = async (text: Parameters<typeof press>[0]) => {
  assert(await cdp.evaluate<boolean>(press(text)), `No visible control: ${JSON.stringify(text)}`);
  await sleep(120);
};
const ready = async (selector: string) => {
  for (let i = 0; i < 100; i++) {
    if (await cdp.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(50);
  }
  throw new Error(`Page did not show ${selector}`);
};
const category = async (id: string) => {
  if (await cdp.evaluate<boolean>(`!!document.querySelector('.sheet-nav:not([hidden])')`)) {
    await click({ sel: `.sheet-nav:not([hidden]) [aria-controls$="-${id}"]` });
  }
};
const stored = () => cdp.evaluate<string>(`localStorage.getItem('slingshot.settings.v1')`);
const screenshot = async (name: string) => {
  const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64'));
};
const visit = async (width: number, height: number, language = 'en', dpr = 1) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const { identifier } = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.clear(); localStorage.setItem('slingshot.settings.v1', ${JSON.stringify(JSON.stringify({ ...SETTINGS, language }))});`,
  });
  try {
    await cdp.send('Page.navigate', { url });
    await ready('.launcher');
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  await sleep(150);
};

try {
  await visit(430, 932, 'en', 3);
  await check(`(() => { const c = document.querySelector('#stage'); const r = c.getBoundingClientRect(); return c.width === Math.round(r.width * devicePixelRatio) && c.height === Math.round(r.height * devicePixelRatio); })()`, 'Retina canvas is undersized');
  await click('Settings');
  await check(`document.querySelectorAll('.sheet-nav__button').length === 4`, 'Touch settings category is missing');
  await category('prefs-language');
  await click({ sel: '[data-section="prefs-language"] .item' });
  await check(`document.querySelector('.sheet-nav__button[aria-pressed="true"]').getAttribute('aria-controls').endsWith('-prefs-language')`, 'Language rebuild lost the active category');
  await check(`document.querySelector('[data-section="prefs-display"]').closest('.menu-group').hidden`, 'Inactive settings are visible');
  await browser.resize(1440, 900);
  await sleep(150);
  await check(`[...document.querySelectorAll('.sheet .menu-group')].every(el => !el.hidden)`, 'Desktop overview did not return');
  await browser.resize(320, 740, true);
  await sleep(150);
  await check(`!document.querySelector('[data-section="prefs-language"]').closest('.menu-group').hidden`, 'Phone resize lost the selected category');
  console.log('PASS Retina resolution, touch settings, language rebuild, responsive categories');

  await visit(430, 932);
  await click('Settings');
  await category('prefs-touch');
  await check(`JSON.parse(localStorage.getItem('slingshot.settings.v1')).touchControls !== 'stick'`, 'Stick unexpectedly became the default');
  await click({ sel: '[data-section="prefs-touch"] .item--segmented:first-child .segmented__option', nth: 1 });
  await check(`JSON.parse(localStorage.getItem('slingshot.settings.v1')).touchControls === 'stick'`, 'Stick choice was not saved');
  await screenshot('touch-settings');
  await click('Done');
  await click({ sel: '[data-section="modes"] .item', nth: 0 });
  await click('Start game');
  await ready('#touch-stick:not([hidden])');
  await check(`document.querySelector('.twheel').hidden && document.querySelector('.pbar').hidden`, 'Wheel controls still overlap the stick');
  await check(`(() => { const c = document.querySelector('#touch-stick canvas'); return c.width === Math.round(c.clientWidth * devicePixelRatio); })()`, 'Stick canvas is blurry');
  const stick = await cdp.evaluate<{ x: number; y: number; radius: number }>(`(() => { const r = document.querySelector('#touch-stick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, radius: r.width * .38 }; })()`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x, y: stick.y + stick.radius * .5 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stick.x + stick.radius * .65, y: stick.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await screenshot('stick-portrait');
  await browser.resize(932, 430, true);
  await sleep(250);
  await screenshot('stick-landscape');
  await click({ sel: '#pause-button' });
  await check(`(() => { const tools = [...document.querySelectorAll('.pause-tool')]; return tools.length === 2 && tools.every(el => { const icon = getComputedStyle(el, '::before'); return icon.display !== 'none' && icon.opacity !== '0' && (icon.maskImage !== 'none' || icon.content !== 'none' && icon.content !== '""'); }); })()`, 'Pause settings and main menu icons are missing');
  await click('Settings');
  await category('prefs-touch');
  await click({ sel: '[data-section="prefs-touch"] .item--segmented:first-child .segmented__option', nth: 0 });
  await click('Done');
  await click('Resume');
  await ready('.twheel:not([hidden])');
  await check(`document.querySelector('#touch-stick').hidden && !document.querySelector('.pbar').hidden`, 'Switching back to wheel controls failed');
  console.log('PASS optional stick, native-resolution drawing, touch drag, orientation changes, switch back to wheel');

  for (const width of [430, 320]) {
    for (const language of ['en', 'de']) {
      await visit(width, 844, language);
      await click({ sel: '[data-section="modes"] .item', nth: 0 });
      if (width === 430 && language === 'en') {
        await check(`!!document.querySelector('.mode-pager__viewport') && !document.querySelector('.mobile-mode-picker')`, 'Mode swiping was replaced by a dropdown');
        const header = await cdp.evaluate<{ x: number; y: number; distance: number }>(`(() => { const r = document.querySelector('.mode-pager__viewport').getBoundingClientRect(); return { x: r.left + r.width * .8, y: r.top + r.height / 2, distance: r.width * .6 }; })()`);
        for (const direction of [-1, 1]) {
          const x = direction < 0 ? header.x : header.x - header.distance;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: header.y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + direction * header.distance, y: header.y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await sleep(300);
          await check(`document.querySelector('.mode-pager__item--active').textContent.trim() === ${JSON.stringify(direction < 0 ? 'Event Horizon' : 'Classic')}`, 'Mode heading no longer changes by swiping');
        }
      }
      const initial = await cdp.evaluate<{ count: string; [key: string]: unknown }>(`(() => { const c = document.querySelector('.briefing__cards'); return { count: document.querySelector('.preset-carousel__count').textContent, scroll: c.scrollLeft, slides: [...c.querySelectorAll(':scope > .briefing__preset-shell, :scope > .briefing__own > *')].map(el => ({ title: el.textContent.trim().slice(0, 30), left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width, order: getComputedStyle(el).order })) }; })()`);
      assert.equal(initial.count, '1 / 5', `Initial carousel order: ${JSON.stringify(initial)}`);
      await check(`getComputedStyle(document.querySelector('.mode-pager__keys')).display === 'none'`, 'Keyboard hints are visible on touch');
      await click({ sel: '.preset-carousel__arrow', nth: 1 });
      await sleep(650);
      await check(`document.querySelector('.briefing__cards').scrollLeft > 100`, 'Carousel next button did not move the cards');
      await check(`JSON.parse(localStorage.getItem('slingshot.settings.v1')).simultaneousShots === true`, 'Settling on preset 2 did not activate its simultaneous-shot rules');
      await click({ sel: '.preset-carousel__arrow', nth: 1 });
      await sleep(650);
      await check(`document.querySelector('.preset-carousel__count').textContent === '3 / 5' && JSON.parse(localStorage.getItem('slingshot.settings.v1')).mayhem > 0`, 'Cannot activate preset 3');
      if (width === 430 && language === 'en') {
        await browser.resize(932, 430, true);
        await sleep(200);
        await browser.resize(width, 844, true);
        await sleep(300);
        await check(`document.querySelector('.preset-carousel__count').textContent === '3 / 5' && JSON.parse(localStorage.getItem('slingshot.settings.v1')).mayhem > 0`, 'Orientation change lost the selected preset or its scroll position');
      }
      await click({ sel: '.preset-carousel__arrow', nth: 0 });
      await sleep(650);
      await check(`document.querySelector('.preset-carousel__count').textContent === '2 / 5' && JSON.parse(localStorage.getItem('slingshot.settings.v1')).mayhem === 0`, 'Cannot go backward from preset 3 to preset 2');
      await click({ sel: '.preset-carousel__arrow', nth: 0 });
      await sleep(650);
      await check(`document.querySelector('.preset-carousel__count').textContent === '1 / 5' && JSON.parse(localStorage.getItem('slingshot.settings.v1')).simultaneousShots === false`, 'Cannot return from preset 2 to preset 1');
      const point = await cdp.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('.briefing__cards').getBoundingClientRect(); return { x: r.left + r.width * .8, y: r.top + r.height / 2 }; })()`);
      await cdp.send('Input.synthesizeScrollGesture', { ...point, xDistance: -220, yDistance: 0, gestureSourceType: 'touch', speed: 600 });
      await sleep(400);
      await check(`document.querySelector('.mode-pager__item--active').textContent.trim() === ${JSON.stringify(language === 'en' ? 'Classic' : 'Klassisch')}`, 'Swiping a preset switched the game mode');
      await check(`document.querySelector('.briefing__cards').scrollLeft > 200`, 'Native swipe did not scroll the preset cards');
      await check(`(() => { const cards = document.querySelector('.briefing__cards'); const active = cards.querySelector('[aria-pressed="true"]'); const viewport = cards.getBoundingClientRect(); const card = active.getBoundingClientRect(); return card.left >= viewport.left - 10 && card.left < viewport.left + 20; })()`, 'Native swipe left the visible preset inactive');
      await screenshot(`presets-${width}-${language}`);
    }
  }
  console.log('PASS native preset swipes, automatic selection, backward navigation, hidden shortcuts at 320/430 in EN/DE');

  await visit(430, 932);
  await click({ sel: '[data-section="modes"] .item', nth: 0 });
  const presetPoint = await cdp.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('.briefing__cards').getBoundingClientRect(); return { x: r.left + r.width * .8, y: r.top + r.height / 2 }; })()`);
  for (let i = 0; i < 4; i++) {
    await cdp.send('Input.synthesizeScrollGesture', { ...presetPoint, xDistance: -250, yDistance: 0, gestureSourceType: 'touch', speed: 600 });
    await sleep(650);
  }
  await check(`!!document.querySelector('.menu-page--rules .preset-name input')`, 'Swiping to New rule did not open the creator');
  await click('Cancel');
  await check(`!!document.querySelector('.menu-page--briefing')`, 'Cancel did not return to the briefing');
  console.log('PASS swiping to New rule opens the creator and cancel returns to the briefing');

  await visit(430, 932);
  await click({ sel: '[data-section="modes"] .item', nth: 0 });
  await click('New rule');
  await category('rules-twists');
  await click('Hidden aim');
  await cdp.evaluate(`(() => { const input = document.querySelector('.preset-name input'); input.value = 'Mobile test'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('Save rule');
  await check(`document.querySelector('.briefing__own .item[aria-pressed="true"]').textContent.includes('Mobile test')`, 'Custom rule was not selected after saving');
  await check(`(() => { const cards = document.querySelector('.briefing__cards'); const own = cards.querySelector('.briefing__own .briefing__preset-shell'); return own.getBoundingClientRect().width > cards.clientWidth * .8; })()`, 'Custom preset collapsed in the carousel');
  const kept = await stored();
  await click('New rule');
  await category('rules-twists');
  await click('Hidden aim');
  await click('Cancel');
  assert.equal(await stored(), kept, 'Cancel did not restore the rules');
  await click('Adjust rules');
  await category('rules-shots');
  await cdp.evaluate(`document.querySelector('[data-section="rules-shots"] .item:not([hidden])').focus()`);
  for (let i = 0; i < 15; i++) {
    await cdp.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
    await check(`!document.activeElement.closest('[hidden]') && document.activeElement.getClientRects().length > 0`, 'Arrow navigation entered a hidden category');
  }
  await screenshot('rules');
  await click('Done');
  await click('Edit players');
  await check(`[...document.querySelectorAll('.crew-slot:has(.slot-card--empty)')].filter(el => el.getClientRects().length).length === 1`, 'Crew repeats empty add-pilot cards');
  await click({ sel: '.pilot .pilot__type', nth: 1 });
  await click({ sel: '.pilot.is-cpu .option-selector__choice', nth: 2 });
  await click({ sel: '.pilot .pilot__type', nth: 0 });
  await click({ sel: '.pilot .pilot__type', nth: 1 });
  await check(`JSON.parse(localStorage.getItem('slingshot.settings.v1')).seats[0] === 'hard'`, 'CPU choice was lost across Human/CPU');
  await click({ sel: '.slot-card--empty .slot-card__choice', nth: 0 });
  await check(`document.querySelectorAll('.pilot').length === 3`, 'Adding a pilot failed');
  await click({ sel: '.pilot__remove', nth: 2 });
  await check(`document.querySelectorAll('.pilot').length === 2`, 'Removing a pilot failed');
  await screenshot('crew');
  console.log('PASS preset save/cancel, category keyboard navigation, crew add/remove and remembered CPU level');
  console.log(`Screenshots: ${out}`);
} finally {
  await browser.close();
}
