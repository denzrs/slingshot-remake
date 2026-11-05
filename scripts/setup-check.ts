/** Mobile setup must fit its key controls and stay still when preset actions appear. Run against `npm run dev`. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChrome, sleep } from './chrome';
import { press, SETTINGS } from './screens-pages';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = '/private/tmp/slingshot-setup-check';
mkdirSync(out, { recursive: true });
const browser = await launchChrome(440, 956);
try {
  const { cdp } = browser;
  const click = async (target: Parameters<typeof press>[0]) => {
    assert(await cdp.evaluate<boolean>(press(target)), `Missing control ${JSON.stringify(target)}`);
    await sleep(160);
  };
  for (const [width, height] of [[440, 956], [390, 844], [320, 740]]) {
    await browser.resize(width, height, true);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const { identifier } = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.clear(); localStorage.setItem('slingshot.settings.v1', ${JSON.stringify(JSON.stringify({ ...SETTINGS, language: 'de' }))});`,
    });
    await cdp.send('Page.navigate', { url });
    for (let i = 0; i < 100 && !(await cdp.evaluate<boolean>(`!!document.querySelector('.launcher')`)); i++) await sleep(50);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await click({ sel: '[data-section="modes"] .item', nth: 0 });
    // Keep the longer German label in the fit check, even if the UI copy is shortened later.
    await cdp.evaluate(`document.querySelector('[data-section="quick"] .item__label').firstChild.textContent = 'Runden pro Spiel'`);
    const measure = () => cdp.evaluate<{ anchors: number[]; overflow: number; controls: { label: string; visible: boolean }[] }>(`(() => {
      const body = document.querySelector('.menu-page__body');
      const box = body.getBoundingClientRect();
      const selectors = ['.briefing__cards', '.preset-carousel__nav', '[data-section="quick"] .item', '.briefing__players .item', '.briefing__edit .item'];
      const anchors = selectors.map(selector => document.querySelector(selector).getBoundingClientRect().top);
      const controls = ['.briefing__players .item', '.briefing__edit .item', '.menu-page__actions .item--primary'].map(selector => {
        const el = document.querySelector(selector), r = el.getBoundingClientRect();
        return { label: el.textContent.trim(), visible: r.top >= 0 && r.bottom <= innerHeight && (!body.contains(el) || r.bottom <= box.bottom + 1) };
      });
      return { anchors, overflow: body.scrollHeight - body.clientHeight, controls };
    })()`);
    const before = await measure();
    await click({ sel: '.briefing__powerup', nth: 0 });
    const after = await measure();
    const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${out}/${width}-edited.png`, Buffer.from(data, 'base64'));
    console.log(JSON.stringify({ viewport: [width, height], before, after }));
    assert(after.anchors.every((y, i) => Math.abs(y - before.anchors[i]) <= 1), 'Editing a preset moved the carousel, options, or crew actions');
    assert(after.controls.every(({ visible }) => visible), 'Crew, rules, or Start is outside the viewport');
    assert(after.overflow <= 1, 'The core setup requires vertical scrolling');
    const stable = async () => {
      const current = await measure();
      assert(current.anchors.every((y, i) => Math.abs(y - before.anchors[i]) <= 1), 'Saving or restoring moved the setup');
    };
    assert(await cdp.evaluate<boolean>(`!document.querySelector('.preset-carousel__action--restore').disabled && !document.querySelector('.preset-carousel__action--save').disabled`), 'Edit actions are unavailable');
    await click({ sel: '.preset-carousel__action--restore' });
    assert(await cdp.evaluate<boolean>(`!JSON.parse(localStorage.getItem('slingshot.settings.v1')).powerUps`), 'Restore did not undo the power-up change');
    await stable();
    await click({ sel: '.briefing__powerup', nth: 0 });
    await click({ sel: '.preset-carousel__action--save' });
    assert(await cdp.evaluate<boolean>(`document.querySelector('.preset-carousel__action--save').disabled && !document.querySelector('.preset-carousel__action--restore').disabled`), 'Save did not keep the preset changes');
    await stable();
    await click({ sel: '.preset-carousel__action--restore' });
    assert(await cdp.evaluate<boolean>(`!JSON.parse(localStorage.getItem('slingshot.settings.v1')).powerUps`), 'Restore did not return to the original preset');
    await stable();
    if (width === 440) {
      for (const mode of ['classic', 'horizon', 'solar']) {
        if (mode !== 'classic') await click({ sel: `.mode-pager__item--${mode}` });
        await click('Mayhem');
        await sleep(350);
        const mayhem = await measure();
        assert(mayhem.overflow <= 1 && mayhem.controls.every(({ visible }) => visible), `${mode}: Mayhem hides setup controls at the supplied viewport`);
        const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${out}/${width}-${mode}-mayhem.png`, Buffer.from(data, 'base64'));
      }
    }
  }
  console.log('PASS stable preset actions and visible setup controls at 440, 390 and 320 px');
} finally { await browser.close(); }
