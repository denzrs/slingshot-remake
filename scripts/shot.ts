/**
 * Screenshots of the running game.
 *
 *   npm run dev                      # in another terminal
 *   npm run shot -- --out luminous-look.webp --settings '{"look":"luminous"}' \
 *     --click "Einstellungen" --mark "Verfeinerter Look"
 *
 * Drives a headless Chrome over the DevTools protocol, so it needs Chrome installed
 * (set CHROME_PATH if it isn't where `chrome.ts` looks).
 *
 *   --out <file>        where to write it; the format follows the extension (.webp, .png, .jpg)
 *   --url <url>         default http://localhost:5173/
 *   --size <WxH>        viewport, default 1280x720
 *   --settings <json>   merged into the saved settings before the page loads; a German UI unless it says otherwise
 *   --click <text>      press the button with this text, once per flag, in order
 *   --mark <text>       draw a ring around the smallest element showing this text, once per flag
 *   --wait <ms>         how long to let the page settle before the shot, default 1500
 */
import { writeFileSync } from 'node:fs';
import { launchChrome, sleep } from './chrome';

interface Options {
  out: string;
  url: string;
  width: number;
  height: number;
  settings: Record<string, unknown>;
  clicks: string[];
  marks: string[];
  wait: number;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { out: '', url: 'http://localhost:5173/', width: 1280, height: 720, settings: {}, clicks: [], marks: [], wait: 1500 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--out') o.out = value();
    else if (flag === '--url') o.url = value();
    else if (flag === '--size') {
      const [w, h] = value().split('x').map(Number);
      if (!w || !h) throw new Error('--size wants WIDTHxHEIGHT, e.g. 1280x720');
      o.width = w;
      o.height = h;
    } else if (flag === '--settings') o.settings = JSON.parse(value()) as Record<string, unknown>;
    else if (flag === '--click') o.clicks.push(value());
    else if (flag === '--mark') o.marks.push(value());
    else if (flag === '--wait') o.wait = Number(value());
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!o.out) throw new Error('--out <file> is required');
  return o;
}

const MARK_STYLE = 'outline: 3px solid #ffd27a; outline-offset: 4px; border-radius: 4px; box-shadow: 0 0 24px rgb(255 210 122 / 0.55);';

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const browser = await launchChrome(opts.width, opts.height);
  try {
    const { cdp } = browser;
    // Seed the storage on the game's own origin, then load it for real.
    const origin = new URL(opts.url).origin;
    await cdp.send('Page.navigate', { url: `${origin}/favicon.svg` });
    await sleep(500);
    const settings = JSON.stringify({ language: 'de', ...opts.settings });
    await cdp.evaluate(`localStorage.setItem('slingshot.settings.v1', ${JSON.stringify(settings)}); true`);
    const target = new URL(opts.url);
    await cdp.send('Page.navigate', { url: target.href });
    await sleep(opts.wait);
    for (const text of opts.clicks) {
      const clicked = await cdp.evaluate<boolean>(`(() => {
        const norm = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase();
        const want = norm(${JSON.stringify(text)});
        const button = [...document.querySelectorAll('button, a, [role=button]')].find((el) => el.offsetParent !== null && norm(el.textContent).includes(want));
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`No button showing "${text}"`);
      await sleep(700);
    }
    for (const text of opts.marks) {
      const marked = await cdp.evaluate<boolean>(`(() => {
        const norm = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase();
        const want = norm(${JSON.stringify(text)});
        const hits = [...document.querySelectorAll('body *')].filter((el) => el.offsetParent !== null && norm(el.textContent).includes(want));
        // The smallest one that still holds the text is the thing itself, not a container around it.
        const target = hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)))[0];
        if (!target) return false;
        const row = target.closest('.item, .setup__row, button, label') ?? target;
        row.style.cssText += ${JSON.stringify(MARK_STYLE)};
        return true;
      })()`);
      if (!marked) throw new Error(`Nothing on screen shows "${text}"`);
    }
    await sleep(500);
    const format = opts.out.endsWith('.png') ? 'png' : opts.out.endsWith('.webp') ? 'webp' : 'jpeg';
    const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format, quality: 86 });
    writeFileSync(opts.out, Buffer.from(data, 'base64'));
    console.log(`Wrote ${opts.out} (${Math.round(Buffer.from(data, 'base64').length / 1024)} KB)`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
