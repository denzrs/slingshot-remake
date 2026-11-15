import { DARK_MARGIN } from '../../game/dark-matter';
import { COLORS, FIELD } from '../../sim/config';
import { hexToRgb, rgba } from '../color';
import { fbm } from '../noise';
import { smoothstep } from '../planet-common';
import { createDarkDissolve, fog, stepDarkDissolve, tile, type DarkDissolve } from './dark-fog';
import { GLSL_HEAD, shade, shaderDetail, unit } from './forged-gl';
import type { DarkMasks } from './painter';

const FULL_W = FIELD.width + 2 * DARK_MARGIN;
const FULL_H = FIELD.height + 2 * DARK_MARGIN;
/** Shader canvas long side (keeps Forged's stage canvas within 1024² while giving >2× the old 2D pixel density). */
const DARK_LIMIT = 1024;
/** Idle drift rate (Hz); active smoke tearing/dissolving runs on every rendered frame for smooth motion. */
const SHADED_FPS = 12;

/**
 * Forged Dark Matter shader: reads the two-channel (`RG8`) cover + dissolve-wake texture with hardware `LINEAR`
 * filtering plus a 4-tap prefilter, blends the aiming ship's clearing into that scalar field, and warps the edge with
 * multi-scale 3D FBM in world coordinates so flying shots smoothly part and dissolve the smoke into glowing wisps.
 */
const DARK_SHADER = `${GLSL_HEAD}
uniform sampler2D uCover;
uniform vec2 uSize;
uniform vec2 uTexel;
uniform vec3 uClearing;
uniform vec3 uColor;
uniform float uTime;

vec2 softField(vec2 uv) {
  vec2 h = uTexel * 0.5;
  return 0.25 * (
    texture(uCover, uv + vec2(-h.x, -h.y)).rg +
    texture(uCover, uv + vec2( h.x, -h.y)).rg +
    texture(uCover, uv + vec2(-h.x,  h.y)).rg +
    texture(uCover, uv + vec2( h.x,  h.y)).rg
  );
}

float clearMask(vec2 p) {
  if (uClearing.z <= 0.0) return 1.0;
  float d = length(p - uClearing.xy) / uClearing.z;
  return smoothstep(0.42, 1.12, d);
}

vec3 deepSmoke(vec2 pos) {
  vec2 bp = pos * 0.008;
  float bt = uTime * 0.04;
  float b1 = fbm(vec3(bp, bt), 2);
  float b2 = fbm(vec3(bp * 2.1 + vec2(7.3, -4.1), bt * 1.3 + 5.0), 2);
  vec3 base = vec3(0.007, 0.004, 0.020);
  vec3 deep = vec3(0.052, 0.040, 0.115) * smoothstep(0.42, 0.85, b1) * 0.45;
  vec3 vein = vec3(0.088, 0.068, 0.195) * smoothstep(0.48, 0.88, b2) * 0.25;
  return base + deep + vein;
}

void main() {
  vec2 pos = vUv * uSize;
  vec2 s = uTexel * 3.8;
  vec2 f0 = texture(uCover, vUv).rg;
  vec2 f1 = texture(uCover, vUv + vec2(-s.x, 0.0)).rg;
  vec2 f2 = texture(uCover, vUv + vec2( s.x, 0.0)).rg;
  vec2 f3 = texture(uCover, vUv + vec2(0.0, -s.y)).rg;
  vec2 f4 = texture(uCover, vUv + vec2(0.0,  s.y)).rg;
  float cMin = min(f0.r, min(min(f1.r, f2.r), min(f3.r, f4.r)));
  float cMax = max(f0.r, max(max(f1.r, f2.r), max(f3.r, f4.r)));
  float wMax = max(f0.g, max(max(f1.g, f2.g), max(f3.g, f4.g)));
  float clearMin = 1.0;
  float clearMax = 1.0;
  if (uClearing.z > 0.0) {
    float dist = length(pos - uClearing.xy);
    clearMin = smoothstep(0.42, 1.12, max(0.0, dist - 38.0) / uClearing.z);
    clearMax = smoothstep(0.42, 1.12, (dist + 38.0) / uClearing.z);
  }
  if (cMax * clearMax <= 0.002 && wMax <= 0.002) {
    outColor = vec4(0.0);
    return;
  }
  if (cMin * clearMin >= 0.998 && wMax <= 0.002) {
    outColor = vec4(deepSmoke(pos), 1.0);
    return;
  }

  vec2 p = pos * 0.022;
  float t = uTime * 0.14;
  vec2 flow = vec2(
    fbm(vec3(p * 1.05 + vec2(3.1, 7.4), t), 3),
    fbm(vec3(p * 1.05 + vec2(14.7, 2.8), t + 6.3), 3)
  ) - 0.5;
  // Freshly parted smoke swirls slightly wider as it dissolves away.
  vec2 wPos = pos + flow * (28.0 + f0.g * 18.0);
  vec2 wUv = clamp(wPos / uSize, vec2(0.0), vec2(1.0));
  vec2 cw = softField(wUv);
  float cm = clearMask(wPos);
  float c = cw.r * cm;
  float wake = cw.g * cm;

  vec2 wp = p + flow * (1.45 + wake * 0.55);
  float coarse = fbm(vec3(wp * 0.9, t * 0.8 + 11.0), 3);
  float fine = fbm(vec3(wp * 2.7 + flow * 1.6, t * 1.35 + 29.0), 4);
  float tear = (coarse - 0.48) * 0.62 + (fine - 0.5) * 0.42;
  float wisp = smoothstep(0.28, 0.82, fine * 0.65 + coarse * 0.35);
  // Thin gaps between smoke filaments open slightly earlier while tendrils linger.
  float dens = clamp(c + tear * smoothstep(0.02, 0.42, c) * (1.0 - 0.28 * c) - wake * (1.0 - wisp) * 0.12, 0.0, 1.0);

  float smokeA = smoothstep(0.14, 0.92, dens);
  float puff = pow(wisp, 1.35) * wake * (1.0 - smokeA * 0.65);
  float bodyA = clamp(smokeA + puff * 0.22, 0.0, 1.0);
  float torn = 4.0 * smokeA * (1.0 - smokeA);
  float pulse = 0.88 + 0.12 * sin(uTime * 1.2 + coarse * 5.0);
  // Glow caught in the tattered smoke crests, plus soft scatter inside nearby billows and dissolving wisps.
  float crest = pow(torn, 1.35) * (0.10 + 0.90 * wisp) * pulse * (0.56 + 0.18 * wake);
  float scatter = smoothstep(0.16, 0.62, smokeA) * (1.0 - smokeA) * wisp * 0.24 + puff * 0.26;
  vec3 rimCol = mix(uColor * 0.70, mix(uColor, vec3(1.0, 0.97, 0.92), 0.30), pow(wisp, 1.8)) * crest + uColor * scatter;
  vec3 bodyCol = deepSmoke(pos);
  float a = clamp(bodyA + max(rimCol.r, max(rimCol.g, rimCol.b)) * 0.70, 0.0, 1.0);
  outColor = vec4(min(bodyCol * bodyA + rimCol, vec3(a)), a);
}`;

interface DarkKept {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  held: boolean;
  stamp: string | null;
  staticStamp: string | null;
  dissolve: DarkDissolve;
  bucket: number;
}

const keptByCtx = new WeakMap<CanvasRenderingContext2D, DarkKept>();

function drawForgedDarkShader(ctx: CanvasRenderingContext2D, masks: DarkMasks, time: number): boolean {
  const { id, cover, cols, rows, version } = masks.field;
  const clearingKey = masks.clearing ? `${Math.round(masks.clearing.x)},${Math.round(masks.clearing.y)},${masks.clearing.r}` : '-';
  const staticStamp = `${id}:${masks.color}:${clearingKey}:${shaderDetail()}`;
  const cacheStamp = `${staticStamp}:${version}`;
  let kept = keptByCtx.get(ctx);
  if (!kept) {
    kept = {
      canvas: document.createElement('canvas'),
      w: 0,
      h: 0,
      held: false,
      stamp: null,
      staticStamp: null,
      dissolve: createDarkDissolve(),
      bucket: -1,
    };
    keptByCtx.set(ctx, kept);
  }
  const active = stepDarkDissolve(kept.dissolve, id, cover, cols, rows, version, time);
  const bucket = Math.floor(time * SHADED_FPS);
  const changed = kept.stamp !== cacheStamp;
  const urgent = kept.staticStamp !== staticStamp;
  if (!kept.held || kept.stamp === null || bucket !== kept.bucket || urgent || changed || active) {
    const color = unit(hexToRgb(masks.color));
    const texStamp = `${id}:${kept.dissolve.tick}`;
    const shaded = shade(DARK_SHADER, FULL_W, FULL_H, DARK_LIMIT, (u, stage) => {
      const tex = stage.fieldTexture('forged-dark-cover', cols, rows, texStamp, (dst) => {
        const { vis, wake } = kept!.dissolve;
        for (let i = 0; i < vis.length; i++) {
          dst[i * 2] = (vis[i] * 255 + 0.5) | 0;
          dst[i * 2 + 1] = (wake[i] * 255 + 0.5) | 0;
        }
      }, 2);
      if (tex) u.tex('uCover', 0, tex);
      u.v2('uSize', FULL_W, FULL_H);
      u.v2('uTexel', 1 / cols, 1 / rows);
      if (masks.clearing) u.v3('uClearing', [masks.clearing.x + DARK_MARGIN, masks.clearing.y + DARK_MARGIN, masks.clearing.r]);
      else u.v3('uClearing', [0, 0, -1]);
      u.v3('uColor', color);
      u.f('uTime', time);
    });
    if (!shaded) return false;
    kept.w = shaded.w;
    kept.h = shaded.h;
    kept.stamp = cacheStamp;
    kept.staticStamp = staticStamp;
    kept.bucket = bucket;
    // Draw straight from the WebGL canvas while animating every frame; snapshot to `kept.canvas` once settled for idle frames.
    if (!active) {
      if (kept.canvas.width !== shaded.w || kept.canvas.height !== shaded.h) {
        kept.canvas.width = shaded.w;
        kept.canvas.height = shaded.h;
      }
      const c = kept.canvas.getContext('2d')!;
      c.globalCompositeOperation = 'copy';
      c.drawImage(shaded.canvas, 0, 0, shaded.w, shaded.h, 0, 0, shaded.w, shaded.h);
      kept.held = true;
    } else {
      kept.held = false;
    }
    ctx.save();
    ctx.globalAlpha = masks.fade;
    ctx.drawImage(shaded.canvas, 0, 0, shaded.w, shaded.h, -DARK_MARGIN, -DARK_MARGIN, FULL_W, FULL_H);
    ctx.restore();
    return true;
  }
  ctx.save();
  ctx.globalAlpha = masks.fade;
  ctx.drawImage(kept.canvas, 0, 0, kept.w, kept.h, -DARK_MARGIN, -DARK_MARGIN, FULL_W, FULL_H);
  ctx.restore();
  return true;
}

const NW = 200;
const NH = 125;

/** A cloud map: `tint` where the noise is thick (2D fallback when WebGL2 is unavailable). */
function cloudMap(key: string, seed: number, tint: [number, number, number], scale: number): HTMLCanvasElement {
  return tile(key, NW, NH, (c) => {
    const img = c.createImageData(NW, NH);
    for (let y = 0; y < NH; y++) {
      for (let x = 0; x < NW; x++) {
        const v = fbm(x / scale, y / scale, 0, seed, 5);
        const a = Math.min(1, Math.max(0, (v - 0.4) / 0.35));
        const i = (y * NW + x) * 4;
        img.data[i] = tint[0];
        img.data[i + 1] = tint[1];
        img.data[i + 2] = tint[2];
        img.data[i + 3] = a * a * 255;
      }
    }
    c.putImageData(img, 0, 0);
  });
}

/** A map of wisps, white, for light that flows along the edge (2D fallback). */
function wispMap(): HTMLCanvasElement {
  return tile('forged-dark-wisps', 256, 160, (c, w, h) => {
    const img = c.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // stretched along x, so the light reads as strands; sampled round a cylinder, so the map wraps along x without a seam
        const a0 = (x / w) * Math.PI * 2;
        const R = w / (Math.PI * 2) / 26;
        const v = fbm(Math.cos(a0) * R, y / 9, Math.sin(a0) * R, 53, 4);
        const a = Math.min(1, Math.max(0, (v - 0.45) / 0.3));
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = a * a * 255;
      }
    }
    c.putImageData(img, 0, 0);
  });
}

/**
 * Forged: the matter is a smoke that drinks the light, slow cold veins turning in it. Where a shot has torn it open,
 * the shader warps the coarse grid mask with multi-scale noise so the edge tears unevenly and glows softly in the
 * player's colour; the 2D fog path stands in when WebGL2 is unavailable.
 */
export function drawForgedDark(ctx: CanvasRenderingContext2D, masks: DarkMasks, time: number): void {
  if (drawForgedDarkShader(ctx, masks, time)) return;
  const veins = cloudMap('forged-dark-veins', 7, [58, 52, 96], 22);
  const deep = cloudMap('forged-dark-deep', 31, [20, 14, 34], 40);
  const wisps = wispMap();
  fog(ctx, masks, { scale: 0.34, fps: 4, rimFps: 15, blur: 0.9 }, time, (c, w, h) => {
    c.fillStyle = '#020106';
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 0.6;
    c.drawImage(deep, -40 + Math.cos(time * 0.05) * 30, -30 + Math.sin(time * 0.04) * 20, w + 80, h + 60);
    c.globalAlpha = 0.28;
    c.drawImage(veins, -60 + Math.sin(time * 0.11) * 40, -38 + Math.cos(time * 0.09) * 25, w + 120, h + 76);
    c.globalAlpha = 1;
  }, (c, w, h) => {
    c.fillStyle = masks.color;
    c.globalAlpha = 0.24 + 0.04 * Math.sin(time * 1.3);
    c.fillRect(0, 0, w, h);
    const tinted = tintedWisps(wisps, masks.color);
    c.globalCompositeOperation = 'lighter';
    const span = w * 0.6;
    for (const [map, speed, alpha, flip] of [[tinted, 18, 0.72, 1], [tinted, -11, 0.48, -1], [wisps, 26, 0.14, 1]] as const) {
      const off = ((time * speed) % span + span) % span;
      c.globalAlpha = alpha;
      c.save();
      c.scale(1, flip);
      for (let x = -span + off; x < w; x += span) c.drawImage(map, x, flip > 0 ? 0 : -h, span, h);
      c.restore();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  });
}

/** The wisps in a player's colour, kept per colour (2D fallback). */
function tintedWisps(wisps: HTMLCanvasElement, color: string): HTMLCanvasElement {
  return tile(`forged-dark-wisps-${color}`, wisps.width, wisps.height, (c, w, h) => {
    c.drawImage(wisps, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
  });
}

/** Forged: found. Red rings closing smoothly on the ship, their light trailing outside them into a pulsing lock glow. */
export function drawForgedDarkAlert(ctx: CanvasRenderingContext2D, x: number, y: number, age: number): void {
  const envelope = smoothstep(0, 0.16, age) * smoothstep(3, 2.4, age);
  if (envelope <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';

  let arrival = 0;
  for (let w = 0; w < 6; w++) {
    const t = age * 0.9 - w / 3;
    if (t <= 0 || t >= 1) continue;
    // Fade in from zero at the outer perimeter and dissolve seamlessly as the wave merges into the lock ring.
    const alpha = smoothstep(0, 0.24, t) * (1 - smoothstep(0.68, 1, t)) * envelope;
    if (alpha <= 0) continue;
    arrival = Math.max(arrival, smoothstep(0.62, 0.9, t) * (1 - smoothstep(0.9, 1, t)));
    const ease = 1 - (1 - t) ** 1.15;
    const r = 16 + (1 - ease) * 42;
    const band = ctx.createRadialGradient(0, 0, r, 0, 0, r + 16);
    band.addColorStop(0, rgba(COLORS.danger, 0.34 * alpha));
    band.addColorStop(0.45, rgba(COLORS.danger, 0.1 * alpha));
    band.addColorStop(1, rgba(COLORS.danger, 0));
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(0, 0, r + 16, 0, Math.PI * 2);
    ctx.arc(0, 0, r, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.strokeStyle = rgba(COLORS.danger, 0.85 * alpha);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(COLORS.bone, 0.32 * alpha);
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // Soft lock beacon round the hull: blooms in at start and flares gently as each closing wave arrives.
  const corePulse = 0.45 + 0.55 * arrival;
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  glow.addColorStop(0, rgba(COLORS.danger, 0.22 * corePulse * envelope));
  glow.addColorStop(0.6, rgba(COLORS.danger, 0.08 * corePulse * envelope));
  glow.addColorStop(1, rgba(COLORS.danger, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(COLORS.danger, (0.24 + 0.36 * arrival) * envelope);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
