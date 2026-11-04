import { COLORS } from '../../sim/config';
import { hexToRgb, rgba } from '../color';
import { blend, drawNebula, NEBULA_SPRITE_REACH, phases } from '../nebula';
import { LIGHT } from '../planet-common';
import { drawStormCloud, slot, smooth, STORM_SPRITE_REACH, stormFlight } from '../storm';
import { paintPortal } from '../wormhole';
import { GLSL_HEAD, pixelsOf, place, seedOffset, shade, unit } from './forged-gl';
import { drawLightNebulaGlow, drawLightPortalGlow } from './forged-light';
import { lightParts } from './forged-parts';
import { forgedFrame } from './forged-sky';

/**
 * The forged look's gas and gateways: the nebula and the sun's storm clouds are gas that moves, lit from the side the sun is
 * on, with light moving inside them, and a portal pours light into its middle. Each builds on what the light draws
 * (`forged-parts.ts`) and adds over it, and each falls back to its sprites and strokes without shaders (`forged-gl.ts`).
 */

/** A seeded [0, 1) for one slot of a cloud, the same on every screen. */
const at = (seed: number, k: number): number => slot(seed, k);

/**
 * Gas that moves, shared by the nebula and the storm: a noise field warped by two others that drift, inside an uneven
 * edge. `light` says how lit a point is: the gas a step towards the light against the gas here, so billows have a lit side.
 */
const GAS = `
uniform float uReach;
uniform float uTime;
uniform float uSeed;
uniform vec3 uEdges;
uniform vec2 uToLight;
float envelope(vec2 p) {
  float a = atan(p.y, p.x);
  float edge = 1.0 + 0.18 * sin(3.0 * a + uEdges.x) + 0.11 * sin(5.0 * a + uEdges.y) + 0.06 * sin(7.0 * a + uEdges.z);
  return 1.0 - smoothstep(0.1, 1.02, length(p) / edge);
}
vec2 flow(vec2 p, float t) {
  return vec2(fbm(vec3(p * 1.4 + uSeed, t), 3), fbm(vec3(p * 1.4 - uSeed, t + 9.0), 3)) - 0.5;
}
float gas(vec2 p, vec2 warp, float t) {
  return envelope(p) * (0.22 + 0.78 * smoothstep(0.24, 0.78, fbm(vec3(p * 2.1 + warp * 1.8 + uSeed, t * 0.7), 5)));
}
float light(vec2 p, vec2 warp, float t, float here) {
  float there = gas(p + uToLight * 0.14, warp, t);
  return clamp(0.5 + (here - there) * 2.4, 0.0, 1.0);
}
`;

/** The nebula: a haze as thin as the sprites' two layers, so ships and shots read over it; the thick middle a lighter tint of its colour. */
const NEBULA_SHADER = `${GLSL_HEAD}${GAS}
uniform vec3 uEdge;
uniform vec3 uCore;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uReach;
  float t = uTime * 0.05;
  vec2 warp = flow(p, t);
  float f = gas(p, warp, t);
  float lit = light(p, warp, t, f);
  vec3 c = mix(uEdge, uCore, smoothstep(0.35, 1.0, f) * 0.8) * (0.72 + 0.56 * lit);
  float a = 0.55 * smoothstep(0.0, 0.9, f);
  outColor = vec4(c * a, a);
}`;

/** The storm's plasma: deep red at the thin edge through orange to gold, with veins of heat along the ridges of another warped field. */
const STORM_SHADER = `${GLSL_HEAD}${GAS}
vec3 ramp(float h) {
  vec3 c = mix(vec3(150, 40, 18), vec3(214, 92, 34), smoothstep(0.0, 0.4, h));
  c = mix(c, vec3(244, 134, 58), smoothstep(0.4, 0.75, h));
  return mix(c, vec3(255, 188, 120), smoothstep(0.75, 1.0, h)) / 255.0;
}
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uReach;
  float t = uTime * 0.14;
  vec2 warp = flow(p, t);
  float f = gas(p, warp, t);
  float ridge = 1.0 - abs(2.0 * fbm(vec3(p * 4.0 + warp * 2.4, t * 1.6 + uSeed), 3) - 1.0);
  float vein = smoothstep(0.8, 0.96, ridge);
  float lit = light(p, warp, t, f);
  vec3 c = ramp(f * 0.74 + vein * f * 0.3) * (0.78 + 0.44 * lit);
  float a = 0.62 * smoothstep(0.0, 0.9, f);
  outColor = vec4(c * a, a);
}`;

/** The largest a cloud is worked out at, in pixels: it is all soft flow, so it can be drawn up. */
const GAS_LIMIT = 448;

/** The way to the field's light from (x, y) in the field: the first sun, otherwise upper left as the planets are lit. */
function toLight(x: number, y: number): [number, number] {
  const sun = forgedFrame()?.suns[0];
  const dx = sun ? sun.x - x : LIGHT[0];
  const dy = sun ? sun.y - y : LIGHT[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/** A nebula: the haze worked out as it moves, or without shaders lit again from inside by a second pass of the same gas; and soft flashes of its own colour. */
export function drawForgedNebula(ctx: CanvasRenderingContext2D, n: { x: number; y: number; radius: number; seed: number }, color: string, time: number): void {
  const base = ctx.globalAlpha;
  const [p0, p1, p2] = phases(n.seed);
  const half = n.radius * (1 + 0.02 * Math.sin(time * 0.7 + p1)) * NEBULA_SPRITE_REACH;
  const pixels = pixelsOf(ctx, half * 2);
  const haze = shade(NEBULA_SHADER, pixels, pixels, GAS_LIMIT, (u) => {
    const edge = blend(color, COLORS.line, 0.3);
    u.f('uReach', NEBULA_SPRITE_REACH);
    u.f('uTime', time);
    u.f('uSeed', seedOffset(n.seed));
    u.v3('uEdges', [p0, p1, p2]);
    u.v2('uToLight', ...toLight(n.x, n.y));
    u.v3('uEdge', unit(hexToRgb(edge)));
    u.v3('uCore', unit(hexToRgb(blend(edge, COLORS.boneDim, 0.45))));
  });
  if (haze) {
    place(ctx, haze, n.x - half, n.y - half, half * 2, half * 2);
    drawLightNebulaGlow(ctx, n, color, time);
  } else {
    lightParts.nebula!(ctx, n, color, time);
    // The same haze once more, added up as light, turned the other way.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = base * 0.3;
    drawNebula(ctx, { ...n, radius: n.radius * 0.92 }, color, -time * 1.3 + 17);
    ctx.restore();
  }
  // Flashes: every few seconds a patch deep in the gas lights up and dies away.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 2; k++) {
    const cycle = time / (3.1 + k * 1.7) + at(n.seed, 30 + k);
    const beat = Math.floor(cycle);
    const phase = cycle - beat;
    if (phase > 0.25) continue;
    const flash = Math.sin((phase / 0.25) * Math.PI);
    const angle = at(n.seed, beat * 3 + k) * Math.PI * 2;
    const dist = n.radius * 0.55 * Math.sqrt(at(n.seed, beat * 5 + k + 7));
    const x = n.x + Math.cos(angle) * dist;
    const y = n.y + Math.sin(angle) * dist;
    const r = n.radius * (0.3 + 0.2 * at(n.seed, beat + 11));
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, rgba(color, 0.32 * flash * base));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** One cloud of the sun's storm: the plasma already drawn, with a burning heart. */
export function drawForgedStormCloud(ctx: CanvasRenderingContext2D, cloud: { x: number; y: number; radius: number; seed: number }, sun: { x: number; y: number }, age: number, time: number, dissolve: number): void {
  drawStormCloud(ctx, cloud, sun, age, time, dissolve, (c, x, y, half, fade) => {
    const pixels = pixelsOf(c, half * 2);
    const gas = shade(STORM_SHADER, pixels, pixels, GAS_LIMIT, (u) => {
      const dx = sun.x - x;
      const dy = sun.y - y;
      const l = Math.hypot(dx, dy) || 1;
      u.f('uReach', STORM_SPRITE_REACH);
      u.f('uTime', time);
      u.f('uSeed', seedOffset(cloud.seed));
      u.v3('uEdges', phases(cloud.seed));
      u.v2('uToLight', dx / l, dy / l);
    });
    if (!gas) return false;
    c.save();
    c.globalAlpha = fade;
    place(c, gas, x - half, y - half, half * 2, half * 2);
    c.restore();
    return true;
  });
  const flight = stormFlight(cloud, sun, age);
  if (!flight) return;
  const { x, y, r, p } = flight;
  const fade = ctx.globalAlpha * smooth(0, 0.3, p) * (1 - dissolve);
  if (fade <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const heart = ctx.createRadialGradient(x, y, 0, x, y, r * 0.8);
  heart.addColorStop(0, `rgba(255,170,70,${0.3 * fade * (0.8 + 0.2 * Math.sin(time * 3 + cloud.seed))})`);
  heart.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = heart;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** A portal's vortex: noise in log-polar terms, so it pours towards the middle and turns as it goes, with three arms riding on it. */
const PORTAL_SHADER = `${GLSL_HEAD}
uniform float uTime;
uniform vec3 uColor;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float depth = log(r + 0.04);
  float a = atan(p.y, p.x) + depth * 1.6 + uTime * 1.2;
  // On a circle, so the angle has no seam.
  vec3 at = vec3(cos(a) * 1.6, sin(a) * 1.6, depth * 1.4 + uTime * 0.9);
  float gas = fbm(at, 4);
  float arms = pow(0.5 + 0.5 * cos(3.0 * a + gas * 2.6), 3.0);
  float deep = 1.0 - smoothstep(0.0, 1.0, r);
  float rim = 1.0 - smoothstep(0.82, 1.0, r);
  float glow = (0.1 + 0.55 * gas * gas + 0.6 * arms * (0.25 + 0.75 * gas)) * (0.35 + 1.1 * deep) * rim;
  float heart = pow(max(0.0, 1.0 - r * 2.1), 2.0);
  vec3 c = uColor * glow + mix(uColor, vec3(1.0), 0.6) * smoothstep(0.5, 1.2, glow) * 0.5 + vec3(0.75) * heart;
  outColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;
const PORTAL_LIMIT = 256;

/** A portal's mouth, in its own frame (`rx`, `ry` its half-axes): the doorway with light pouring into the middle, a vortex or without shaders three spiralling arms. */
export function paintForgedPortal(ctx: CanvasRenderingContext2D, rx: number, ry: number, radius: number, color: string, time: number, alpha: number, phase: number): void {
  paintPortal(ctx, rx, ry, radius, color, time, alpha, phase);
  ctx.globalAlpha = alpha;
  drawLightPortalGlow(ctx, rx, ry, color, time + phase);
  const vortex = shade(PORTAL_SHADER, pixelsOf(ctx, rx * 2), pixelsOf(ctx, ry * 2), PORTAL_LIMIT, (u) => {
    u.f('uTime', time + phase * 7);
    u.v3('uColor', unit(hexToRgb(color)));
  });
  if (vortex) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';
    place(ctx, vortex, -rx, -ry, rx * 2, ry * 2);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const SEGMENTS = 22;
  for (let arm = 0; arm < 3; arm++) {
    const turn = (arm / 3) * Math.PI * 2 + (time + phase) * 1.7;
    for (let k = 0; k < SEGMENTS; k++) {
      const s0 = k / SEGMENTS;
      const s1 = (k + 1) / SEGMENTS;
      const point = (s: number): [number, number] => {
        const a = turn + s * 4.4;
        const f = 0.95 - s * 0.86;
        return [Math.cos(a) * rx * f, Math.sin(a) * ry * f];
      };
      const [x0, y0] = point(s0);
      const [x1, y1] = point(s1);
      // Brighter and thicker towards the middle.
      ctx.strokeStyle = rgba(color, 0.12 + 0.55 * s1 * s1);
      ctx.lineWidth = 0.8 + 1.8 * s1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  const heart = ctx.createRadialGradient(0, 0, 0, 0, 0, ry * 0.5);
  heart.addColorStop(0, 'rgba(255,255,255,0.5)');
  heart.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = heart;
  ctx.scale(rx / ry, 1);
  ctx.beginPath();
  ctx.arc(0, 0, ry * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
