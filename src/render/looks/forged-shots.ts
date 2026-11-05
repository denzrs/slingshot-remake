import { COLORS } from '../../sim/config';
import { isWormholeJump, type Planet, type Wormhole } from '../../sim/physics';
import { rgba } from '../color';
import { strokePolyline } from '../polyline';
import { drawSun, type SunStyle } from '../sun';
import { canShade, GLSL_HEAD, onScreen, pixelsOf, place, seedOffset, shadeKept } from './forged-gl';
import { lightParts } from './forged-parts';

/**
 * What flies in the forged look, and the sun it flies past. A shot is a white-hot core in a halo, with a glint across it
 * and a tapering tail of heat that sheds embers; its track cools towards where it began and is run along by pulses of
 * light; a plasma shot crackles. The sun's surface and corona are shaders, at the size they are drawn and moving every frame;
 * without shaders it has its sprites and rays of light over them.
 */

/** A seeded [0, 1) for one slot, the same every frame. */
const slot = (n: number): number => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/** The tail is this many points long at most. */
const TAIL = 26;

/** A shot in flight: a hot core, a glint, and a tail that tapers, cools towards its end and sheds embers. */
export function drawForgedShot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, trail: readonly number[], time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const tail = Math.min(TAIL, trail.length / 2 - 1);
  // Three passes over the tail, wide and faint to thin and white-hot, each a little shorter than the one under it.
  for (const [width, alpha, white, reach] of [[4.6, 0.08, 0, 1], [2.2, 0.3, 0, 0.85], [0.9, 0.65, 1, 0.6]] as const) {
    const from = Math.floor(tail * reach);
    for (let k = 0; k < from; k++) {
      const i = trail.length - 2 - k * 2;
      const f = 1 - k / from;
      ctx.strokeStyle = white ? rgba(COLORS.bone, alpha * f * f * f) : rgba(color, alpha * f * f);
      ctx.lineWidth = width * f;
      ctx.beginPath();
      ctx.moveTo(trail[i - 2], trail[i - 1]);
      ctx.lineTo(trail[i], trail[i + 1]);
      ctx.stroke();
    }
  }
  // Embers: specks that come off the tail, drift away from the line as they age and go out.
  for (let j = 0; j < 7; j++) {
    const age = (time * 1.3 + j / 7) % 1;
    const k = Math.min(tail - 1, Math.floor(age * tail));
    const i = trail.length - 2 - k * 2;
    if (i < 2) continue;
    const side = (slot(j + 1) - 0.5) * 2;
    ctx.fillStyle = rgba(j % 3 === 0 ? COLORS.bone : color, 0.8 * (1 - age));
    ctx.beginPath();
    ctx.arc(trail[i] + side * age * 6, trail[i + 1] + (slot(j + 9) - 0.5) * age * 8, 0.9 * (1 - age * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  // The head: a halo that breathes, a core, and a glint of light across it.
  const pulse = 0.9 + 0.1 * Math.sin(time * 18 + x * 0.1);
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 12 * pulse);
  halo.addColorStop(0, rgba(COLORS.bone, 0.95));
  halo.addColorStop(0.2, rgba(color, 0.7));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - 13, y - 13, 26, 26);
  const turn = time * 0.7;
  for (let a = 0; a < 2; a++) {
    const dx = Math.cos(turn + (a * Math.PI) / 2) * 10 * pulse;
    const dy = Math.sin(turn + (a * Math.PI) / 2) * 10 * pulse;
    const glint = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
    glint.addColorStop(0, rgba(COLORS.bone, 0));
    glint.addColorStop(0.5, rgba(COLORS.bone, 0.5));
    glint.addColorStop(1, rgba(COLORS.bone, 0));
    ctx.strokeStyle = glint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The recent stretch of a track is drawn segment by segment, so it can brighten towards the shot. */
const RECENT = 70;

/**
 * The track of a shot in flight: the old part a single faint line, the last stretch brightening towards the shot and
 * thickening, and pulses of light running along it towards the shot. A plasma shot keeps the ribbon it already has.
 */
export function drawForgedLiveTrail(ctx: CanvasRenderingContext2D, pts: number[], wormholes: readonly Wormhole[], color: string, plasma: boolean, time: number): void {
  if (plasma) {
    lightParts.liveTrail!(ctx, pts, wormholes, color, plasma, time);
    return;
  }
  const n = pts.length / 2;
  if (n < 2) return;
  const split = Math.max(1, n - RECENT);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The old track: a wide soft glow under a thin line, both faint.
  const old = pts.slice(0, split * 2 + 2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(color, 0.05);
  ctx.lineWidth = 3.5;
  strokePolyline(ctx, old, wormholes);
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = rgba(color, 0.4);
  ctx.lineWidth = 1;
  strokePolyline(ctx, old, wormholes);
  // The recent track: hotter and thicker the nearer the shot.
  ctx.globalCompositeOperation = 'lighter';
  for (let k = split; k < n; k++) {
    if (wormholes.length && isWormholeJump(pts, k * 2, wormholes)) continue;
    const f = (k - split + 1) / (n - split);
    ctx.strokeStyle = rgba(color, 0.08 + 0.2 * f);
    ctx.lineWidth = 2 + 2.2 * f;
    ctx.beginPath();
    ctx.moveTo(pts[k * 2 - 2], pts[k * 2 - 1]);
    ctx.lineTo(pts[k * 2], pts[k * 2 + 1]);
    ctx.stroke();
    ctx.strokeStyle = rgba(f > 0.6 ? COLORS.bone : color, 0.3 + 0.6 * f);
    ctx.lineWidth = 0.9 + 0.7 * f;
    ctx.stroke();
  }
  // Pulses: three bright beads that run from the muzzle's end of the glowing stretch to the shot, and start again.
  const span = Math.min(n - 1, RECENT * 2);
  for (let p = 0; p < 3; p++) {
    const at = n - 1 - span + ((time * 38 + (p * span) / 3) % span);
    const k = Math.min(n - 1, Math.max(1, Math.floor(at)));
    if (wormholes.length && isWormholeJump(pts, k * 2, wormholes)) continue;
    const f = (k - (n - 1 - span)) / span;
    const bead = ctx.createRadialGradient(pts[k * 2], pts[k * 2 + 1], 0, pts[k * 2], pts[k * 2 + 1], 3);
    bead.addColorStop(0, rgba(COLORS.bone, 0.75 * f));
    bead.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = bead;
    ctx.fillRect(pts[k * 2] - 3, pts[k * 2 + 1] - 3, 6, 6);
  }
  ctx.restore();
}

/** A plasma shot: a halo, a lumpy body that wobbles, a white core and arcs of lightning that jump about it. */
export function drawForgedPlasmaShot(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  lightParts.plasmaShot!(ctx, x, y, time);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const heat = ctx.createRadialGradient(x, y, 4, x, y, 26);
  heat.addColorStop(0, 'rgba(34,228,255,0.3)');
  heat.addColorStop(1, 'rgba(34,228,255,0)');
  ctx.fillStyle = heat;
  ctx.fillRect(x - 26, y - 26, 52, 52);
  // The arcs change about twenty times a second: lightning does not glide.
  const beat = Math.floor(time * 20);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let arc = 0; arc < 3; arc++) {
    let a = slot(beat * 7 + arc * 3.1) * Math.PI * 2;
    let r = 4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    for (let s = 1; s <= 5; s++) {
      a += (slot(beat * 11 + arc * 5 + s) - 0.5) * 1.3;
      r += 2.2 + slot(beat + arc + s * 1.7) * 2.2;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.strokeStyle = 'rgba(34,228,255,0.35)';
    ctx.lineWidth = 3.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(224,255,255,0.9)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  ctx.restore();
}

/** The ball: the same folding gas as the sprite in `sun.ts`, with fine cells of rising gas and slow dark spots on it, read on a sphere and dimmed to the edge. */
const SURFACE_SHADER = `${GLSL_HEAD}
uniform float uTime;
uniform float uSeed;
uniform float uGiant;
vec3 ramp(float h) {
  vec3 c = mix(vec3(120, 26, 8), vec3(226, 76, 14), smoothstep(0.0, 0.3, h));
  c = mix(c, vec3(255, 150, 30), smoothstep(0.3, 0.58, h));
  c = mix(c, vec3(255, 214, 90), smoothstep(0.58, 0.82, h));
  return mix(c, vec3(255, 248, 200), smoothstep(0.82, 1.0, h)) / 255.0;
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float rr = dot(p, p);
  float r = sqrt(rr);
  if (r >= 1.0) {
    outColor = vec4(0.0);
    return;
  }
  float z = sqrt(1.0 - rr);
  vec3 n = vec3(p, z);
  float t = uTime * 0.16;
  vec3 o = vec3(uSeed);
  vec2 q = vec2(fbm(n * 1.9 + o + vec3(t, 0.0, 0.0), 4), fbm(n * 1.9 - o + vec3(0.0, t * 0.8, 4.0), 4));
  float f = fbm(n * 2.8 + vec3(q * 2.6, t * 0.6) + o, 5);
  // The cells are ridges of a fine noise, carried along by the same flow.
  float cells = 1.0 - abs(2.0 * fbm(n * 16.0 + vec3(q * 5.0, t * 3.0) + o, 3) - 1.0);
  float spots = smoothstep(0.66, 0.74, fbm(n * 3.4 + vec3(-t * 0.25, 0.0, 7.0) + o, 3));
  float temp = (0.12 + 1.05 * pow(f, 1.4) + 0.16 * (cells - 0.7)) * (0.5 + 0.5 * sqrt(z)) * (1.0 - 0.62 * uGiant) * (1.0 - 0.45 * spots);
  float a = 1.0 - smoothstep(0.97, 1.0, r);
  outColor = vec4(ramp(temp) * a, a);
}`;

/** The corona: streamers that bend with the distance and run outwards, over a glow that thins out. White-gold at the surface, orange, then deep red. */
const CORONA_SHADER = `${GLSL_HEAD}
uniform float uTime;
uniform float uSeed;
uniform float uReach;
uniform float uFlare;
uniform float uGiant;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uReach;
  float rho = length(p);
  float outward = rho - uTime * 0.09;
  float a0 = atan(p.y, p.x);
  float a1 = a0 + rho * 0.22 + uTime * 0.02;
  float a2 = a0 - rho * 0.16 - uTime * 0.034;
  // On a circle, so the angle has no seam.
  float broad = fbm(vec3(cos(a1) * 1.7 + uSeed, sin(a1) * 1.7, outward * 0.22), 4);
  float fine = fbm(vec3(cos(a2) * 5.2, sin(a2) * 5.2 + uSeed, outward * 0.5), 4);
  float ray = pow(smoothstep(0.3, 0.76, broad * 0.62 + fine * 0.38), 1.5);
  float falloff = exp(-(rho - 1.0) * 1.1);
  float glow = 0.16 * exp(-(rho - 1.0) * 1.9);
  float fade = (1.0 - smoothstep(uReach * 0.7, uReach, rho)) * smoothstep(0.85, 1.05, rho);
  float k = min(1.0, (ray * falloff * 1.15 + glow) * (1.0 + uFlare * 0.7) * fade);
  float h = min(1.0, (rho - 1.0) / 1.9);
  vec3 near = mix(vec3(255, 222, 150), vec3(255, 150, 110), uGiant);
  vec3 far = mix(vec3(214, 74, 26), vec3(170, 30, 16), uGiant);
  vec3 c = mix(near, far, h) / 255.0;
  outColor = vec4(c * k, k);
}`;

/** The largest the ball and the corona are worked out at, in pixels. */
const SURFACE_LIMIT = 512;
const CORONA_LIMIT = 512;
/** How often they are worked out again: both churn slowly, and what is between is the picture kept. */
const SUN_HZ = 20;
/** The corona's reach in radii when calm, as in `sun.ts`: the shader's own coordinates. */
const CORONA_REACH = 3.6;

const sunStyle: SunStyle = {
  corona(ctx, seed, reach, time, flare, giant) {
    if (!onScreen(ctx, 0, 0, reach)) return true;
    const pixels = pixelsOf(ctx, reach * 2);
    const shaded = shadeKept(`corona:${seed}`, time, SUN_HZ, CORONA_SHADER, pixels, pixels, CORONA_LIMIT, (u) => {
      u.f('uTime', time);
      u.f('uSeed', seedOffset(seed));
      u.f('uReach', CORONA_REACH);
      u.f('uFlare', flare);
      u.f('uGiant', giant);
    });
    if (!shaded) return false;
    place(ctx, shaded, -reach, -reach, reach * 2, reach * 2);
    return true;
  },
  surface(ctx, seed, R, time, giant) {
    if (!onScreen(ctx, 0, 0, R)) return true;
    const pixels = pixelsOf(ctx, R * 2);
    const shaded = shadeKept(`surface:${seed}`, time, SUN_HZ, SURFACE_SHADER, pixels, pixels, SURFACE_LIMIT, (u) => {
      u.f('uTime', time);
      u.f('uSeed', seedOffset(seed));
      u.f('uGiant', giant);
    });
    if (!shaded) return false;
    place(ctx, shaded, -R, -R, R * 2, R * 2);
    return true;
  },
};

/**
 * The sun with light thrown off it: a wide warm wash over the field round it and, without shaders, rays that turn slowly against each other. `flare` (the storm) makes it all stronger.
 */
export function drawForgedSun(ctx: CanvasRenderingContext2D, sun: Planet, time: number, alpha: number, flare: number): void {
  drawSun(ctx, sun, time, alpha, flare, sunStyle);
  const R = sun.radius;
  const giant = sun.giant ?? 0;
  const warm = giant > 0.3 ? '255,90,60' : '255,196,110';
  ctx.save();
  ctx.translate(sun.x, sun.y);
  ctx.globalCompositeOperation = 'lighter';
  const strength = alpha * (1 + flare * 0.9);
  // The wash: light the sun throws over the whole neighbourhood.
  const wash = ctx.createRadialGradient(0, 0, R, 0, 0, R * 15);
  wash.addColorStop(0, `rgba(${warm},${0.045 * strength})`);
  wash.addColorStop(1, `rgba(${warm},0)`);
  ctx.fillStyle = wash;
  ctx.fillRect(-R * 15, -R * 15, R * 30, R * 30);
  // The rays: tapering wedges of light out of the middle, in two layers that turn against each other. The shaded corona has streamers of its own.
  for (const [count, spin, reach, base] of canShade() ? [] : ([[11, 0.018, 9, 0.028], [7, -0.027, 6.5, 0.02]] as const)) {
    ctx.save();
    ctx.rotate(time * spin + count);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + (slot(k + count) - 0.5) * 0.35;
      const width = 0.05 + slot(k * 3 + count) * 0.07;
      const length = R * reach * (0.65 + 0.35 * slot(k * 5 + count + 3)) * (1 + flare * 0.5);
      const breathe = 0.7 + 0.3 * Math.sin(time * (0.6 + slot(k + 20)) + k);
      const ray = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, length);
      ray.addColorStop(0, `rgba(${warm},${base * breathe * strength})`);
      ray.addColorStop(1, `rgba(${warm},0)`);
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, length, a - width, a + width);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}
