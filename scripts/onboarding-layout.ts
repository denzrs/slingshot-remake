/** Regression check: the first-run picker fits its viewport, with no page scroll or clipped controls.
 * node --import tsx scripts/onboarding-layout.ts [--url http://localhost:5173/]
 * Without --url, builds and checks the production first-run flow.
 */
import { launchChrome, sleep } from './chrome';
import { buildWorkingTree, serve, type Served } from './serve';

const SIZES = [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 600], [768, 1024], [390, 844], [375, 667], [360, 640], [320, 568], [844, 390], [667, 375]];

async function main(): Promise<void> {
  const urlIndex = process.argv.indexOf('--url');
  let served: Served | undefined;
  const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : (served = await serve(buildWorkingTree())).url;
  if (!url) throw new Error('--url needs an address');
  const browser = await launchChrome(1280, 720);
  const { cdp } = browser;
  let failed = false;
  try {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.clear();localStorage.setItem('slingshot.settings.v1',JSON.stringify({language:'de',menuSounds:false,gameSounds:false,lessMenuMotion:true}));`,
    });
    await cdp.send('Page.navigate', { url });
    await sleep(250);
    await cdp.evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(document.querySelector('dialog.onboarding[open]'))resolve(true);else if(n++>100)reject(new Error('Onboarding did not open'));else setTimeout(poll,50)};poll()})`);
    for (const [width, height] of SIZES) {
      await browser.resize(width, height, width <= 760);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: width <= 760 });
      await sleep(100);
      const problems = await cdp.evaluate<string[]>(`(() => {
        const dialog = document.querySelector('dialog.onboarding');
        const issues = [];
        if (dialog.scrollHeight > dialog.clientHeight + 1) issues.push('page content exceeds viewport: ' + dialog.scrollHeight + '/' + dialog.clientHeight);
        if (dialog.scrollWidth > dialog.clientWidth + 1) issues.push('page overflows horizontally');
        const selectors = ['.onboarding__header', '.onboarding__step', '.onboarding__details', '.onboarding__footer', '.onboarding__choices', '.onboarding__scene-tabs'];
        for (const selector of selectors) for (const el of dialog.querySelectorAll(selector)) {
          const r = el.getBoundingClientRect();
          if (r.right < 0 || r.left > innerWidth) continue;
          if (r.top < -1 || r.bottom > innerHeight + 1) issues.push(selector + ' is cut off: ' + Math.round(r.top) + '..' + Math.round(r.bottom));
        }
        for (const el of dialog.querySelectorAll('.onboarding__skip, .onboarding__continue, .onboarding__choice')) {
          const r = el.getBoundingClientRect();
          if (r.left < -1 || r.right > innerWidth + 1 || r.height < 43) issues.push('action is clipped or too small');
        }
        for (const el of dialog.querySelectorAll('.onboarding__field')) if (el.getBoundingClientRect().height < 64) issues.push('preview has been squeezed away');
        dialog.scrollTop = 100;
        if (dialog.scrollTop !== 0 || scrollY !== 0) issues.push('page can scroll vertically');
        return issues;
      })()`);
      failed ||= problems.length > 0;
      console.log(`${problems.length ? 'FAIL' : 'PASS'} ${width}×${height}${problems.length ? ': ' + problems.join('; ') : ''}`);
    }
  } finally {
    await browser.close();
    await served?.close();
  }
  if (failed) process.exitCode = 1;
}
void main();
