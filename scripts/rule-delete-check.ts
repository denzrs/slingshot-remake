/** Run against npm run dev: npx tsx scripts/rule-delete-check.ts [url]. */
import assert from 'node:assert/strict';
import { launchChrome, sleep } from './chrome';
import { press, SETTINGS } from './screens-pages';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const browser = await launchChrome(430, 932);
const { cdp } = browser;
const click = async (target: Parameters<typeof press>[0]) => {
  assert(await cdp.evaluate<boolean>(press(target)), `No visible control: ${JSON.stringify(target)}`);
  await sleep(200);
};
try {
  for (const width of [430, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 932, deviceScaleFactor: 1, mobile: width === 430 });
    const { identifier } = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear(); localStorage.setItem('slingshot.settings.v1', ${JSON.stringify(JSON.stringify({ ...SETTINGS, language: 'en' }))});` });
    await cdp.send('Page.navigate', { url });
    await sleep(1000);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await click({ sel: '[data-section="modes"] .item', nth: 0 });
    await click('New rule');
    await click('Save rule');
    await click({ sel: '.item__status-reset, .preset-carousel__action--restore' });
    await click('Delete rule');
    await click('Really delete?');
    assert(await cdp.evaluate<boolean>(`!!document.querySelector('.menu-page--briefing')`), 'Deleting did not return to briefing');
    await sleep(1000);
    assert(await cdp.evaluate<boolean>(`!!document.querySelector('.menu-page--briefing')`), 'Creator reopened after deleting');
    await click('New rule');
    await click('Cancel');
    assert(await cdp.evaluate<boolean>(`!!document.querySelector('.menu-page--briefing')`), 'Cancel after deletion did not return to briefing');
    await sleep(1000);
    assert(await cdp.evaluate<boolean>(`!!document.querySelector('.menu-page--briefing')`), 'Creator reopened after cancel');
    console.log(`PASS deletion and cancel return to briefing at ${width}px`);
  }
} finally { await browser.close(); }
