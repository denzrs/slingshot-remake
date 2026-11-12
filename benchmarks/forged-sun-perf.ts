/**
 * Compare the changed solar effects against the shared drawing, in a real Chrome canvas.
 * Run npm run dev first, then: npx tsx benchmarks/forged-sun-perf.ts [http://localhost:5173]
 *
 * The surface/corona are omitted from both so their noise/shader cache cannot hide a regression in the arches.
 * Each frame is read back to finish its canvas work. Absolute times include that readback; compare the pairs.
 */
import { launchChrome, sleep } from '../scripts/chrome';

const origin = process.argv[2] ?? 'http://localhost:5173';
const browser = await launchChrome(1000, 700);
try {
  await browser.cdp.send('Page.navigate', { url: `${origin}/dev/suns.html?look=forged` });
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    await sleep(100);
    ready = await browser.cdp.evaluate<boolean>(`!!document.querySelector('#pause')`).catch(() => false);
  }
  if (!ready) throw new Error('Sun gallery did not load');
  const results = await browser.cdp.evaluate(`(async () => {
    const pause = document.querySelector('#pause');
    if (pause.textContent.includes('pausieren')) pause.click();
    const { drawSun } = await import('/src/render/sun.ts');
    const { drawStormBurst } = await import('/src/render/storm.ts');
    const { drawForgedProminences, drawForgedProminencesFront, drawForgedStormBurst, warmSunEruptions } = await import('/src/render/looks/forged-sun.ts');
    const { image } = await import('/src/render/looks/forged-assets.ts');
    warmSunEruptions();
    for (let i = 0; i < 100 && !image('sunFront'); i++) await new Promise(r => setTimeout(r, 50));
    if (!image('sunFront')) throw new Error('Storm texture did not load');
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 480;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const shared = { surface: () => true, corona: () => true };
    const forged = { ...shared, prominences: drawForgedProminences, prominencesFront: drawForgedProminencesFront };
    const results = [];
    for (const radius of [22, 60, 100]) {
      for (const flare of [0, 1]) {
        const sun = { x: 240, y: 240, radius, seed: 1, mass: 1, style: 'star', sun: true, tint: '#fff' };
        const samples = [[], []];
        const frame = (version, n) => {
          ctx.clearRect(0, 0, 480, 480);
          drawSun(ctx, sun, 10 + n / 60, 1, flare, version ? forged : shared);
          ctx.getImageData(0, 0, 1, 1);
        };
        for (let n = 0; n < 80; n++) { frame(0, n); frame(1, n); }
        // Alternate the order so warming, thermal changes and background work affect both versions.
        for (let batch = 0; batch < 16; batch++) for (const version of batch % 2 ? [1, 0] : [0, 1]) {
          const start = performance.now();
          for (let n = 0; n < 40; n++) frame(version, batch * 40 + n);
          samples[version].push((performance.now() - start) / 40);
        }
        const med = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
        const before = med(samples[0]), after = med(samples[1]);
        results.push({ radius, flare, beforeMs: +before.toFixed(3), afterMs: +after.toFixed(3), changePct: +((after / before - 1) * 100).toFixed(1) });
      }
    }
    const sun = { x: 240, y: 240, radius: 36 };
    const burst = [];
    for (const paint of [drawStormBurst, drawForgedStormBurst]) {
      const start = performance.now();
      for (let n = 0; n < 480; n++) {
        ctx.clearRect(0, 0, 480, 480);
        paint(ctx, sun, (n % 96 + 1) / 60);
        ctx.getImageData(0, 0, 1, 1);
      }
      burst.push((performance.now() - start) / 480);
    }
    return { arches: results, storm: { beforeMs: +burst[0].toFixed(3), afterMs: +burst[1].toFixed(3) } };
  })()`);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
