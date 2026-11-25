import { FIELD } from '../sim/config';
import { LOOKS, setLook, type Look } from '../data/look';
import { Effects } from '../render/effects';
import { Renderer } from '../render/renderer';
import { aiming } from './gallery-match';
import { sendPerf, type FrameTime } from './perf-report';

/**
 * Dev-only page (`/dev/perf.html`): a planet breaks in the real renderer, the same in every run, and the frame times go to
 * the dev server (`perf-report.ts`). Made to be opened on a phone; it starts by itself and runs again after a change.
 */

const WARM = 2500;
const RUN = 4000;

const note = document.createElement('div');
note.style.cssText = 'position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:2;color:#fff;font:12px/1.5 monospace;white-space:pre-wrap;pointer-events:none;text-shadow:0 0 4px #000';
document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
document.body.append(note);

async function run(look: Look): Promise<FrameTime[]> {
  setLook(look);
  const canvas = document.createElement('canvas');
  document.body.prepend(canvas);
  const match = aiming('classic', 4, { maxPlanets: 7, contours: true });
  const renderer = new Renderer(canvas);
  const effects = new Effects(true, false, 'medium');
  const frames: FrameTime[] = [];
  let broke = false;
  let last = await new Promise<number>(requestAnimationFrame);
  const start = last + WARM;
  await new Promise<void>((done) => {
    const frame = (now: number): void => {
      const gap = now - last;
      last = now;
      const a = performance.now();
      if (!broke && now >= start) {
        broke = true;
        // The planet nearest the middle, so the debris flies across the whole field.
        const planets = match.world.planets;
        const far = (p: { x: number; y: number }): number => Math.hypot(p.x - FIELD.width / 2, p.y - FIELD.height / 2);
        const [planet] = planets.splice(planets.indexOf([...planets].sort((p, q) => far(p) - far(q))[0]), 1);
        match.world.version++;
        effects.shatter(planet.x, planet.y, planet.tint, planet.radius);
      }
      effects.update(Math.min(0.05, gap / 1000), match.world);
      const b = performance.now();
      renderer.draw(match, effects, { hud: true, fullScreen: false, touch: true, recording: false, keyHints: false, aimCardDodge: false, seatNumbers: false }, Math.min(0.05, gap / 1000));
      frames.push([now - start, gap, b - a, performance.now() - b]);
      if (now - start < RUN) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });
  canvas.remove();
  return frames;
}

const asked = new URLSearchParams(location.search).get('run')?.split(',');
for (const look of LOOKS) {
  if (asked && !asked.includes(look)) continue;
  const line = document.createElement('div');
  line.textContent = `${look} …`;
  note.append(line);
  // The GPU works off what is queued before the next run.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const sent = await sendPerf(`page ${look}`, await run(look));
  line.textContent = `${look} ${sent ? '✓' : '✗'}`;
}
note.append('fertig');
