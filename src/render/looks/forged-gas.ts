import { COLORS } from '../../sim/config';
import { hexToRgb, rgba } from '../color';
import { blend, drawNebula, NEBULA_SPRITE_REACH, phases } from '../nebula';
import { LIGHT } from '../planet-common';
import { drawStormCloud, slot, smooth, STORM_SPRITE_REACH, stormFlight } from '../storm';
import { paintPortal } from '../wormhole';
import { GLSL_HEAD, onScreen, pixelsOf, place, seedOffset, shadeKept, unit } from './forged-gl';
import { drawLightNebulaGlow, drawLightPortalGlow } from './forged-light';
import { lightParts } from './forged-parts';
import { forgedFrame } from './forged-sky';

/**
 * The forged look's gas and gateways: the nebula and the sun's storm clouds are gas that moves, lit from the side the sun is
 * on, with light moving inside them (shaders, `forged-gl.ts`, or without them their sprites), and a portal pours light into
 * its middle. Each builds on what the light draws (`forged-parts.ts`) and adds over it.
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
vec3 warped(vec2 p, vec2 warp, float t) {
  return vec3(p * 2.1 + warp * 1.8 + uSeed, t * 0.7);
}
float shape(vec2 p, float f) {
  return envelope(p) * (0.22 + 0.78 * smoothstep(0.24, 0.78, f));
}
// x: the gas; y: the gas of its first three octaves alone, which the light reads, for it only needs where the gas thickens.
vec2 gas(vec2 p, vec2 warp, float t) {
  vec3 q = warped(p, warp, t);
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  float coarse = 0.0;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(q);
    norm += amp;
    amp *= 0.5;
    q = q * 2.03 + vec3(17.1, 9.2, 4.7);
    if (i == 2) coarse = sum / norm;
  }
  float env = envelope(p);
  return env * (0.22 + 0.78 * smoothstep(0.24, 0.78, vec2(sum / norm, coarse)));
}
float light(vec2 p, vec2 warp, float t, float here) {
  vec2 q = p + uToLight * 0.14;
  float there = shape(q, fbm(warped(q, warp, t), 3));
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
  vec2 g = gas(p, warp, t);
  float f = g.x;
  float lit = light(p, warp, t, g.y);
  vec3 c = mix(uEdge, uCore, smoothstep(0.35, 1.0, f) * 0.8) * (0.72 + 0.56 * lit);
  float a = 0.55 * smoothstep(0.0, 0.9, f);
  outColor = vec4(c * a, a);
}`;

/**
 * The storm's plasma: wound up in its own field, so it curls round its middle, tighter further in. A veil of deep red
 * haze, thinning out to the cloud's edge so its reach shows, holds ropes and fine threads of hot gas that run with the
 * flow, red-orange where they are hottest and only faintly glowing; the side towards the sun is heated a little more. The
 * haze is a veil like a nebula's, so ships and shots read through it; the ropes are light added over it.
 */
const STORM_SHADER = `${GLSL_HEAD}${GAS}
vec3 heat(float h) {
  vec3 c = mix(vec3(0.36, 0.04, 0.03), vec3(0.84, 0.18, 0.06), smoothstep(0.0, 0.35, h));
  c = mix(c, vec3(1.0, 0.5, 0.13), smoothstep(0.35, 0.65, h));
  c = mix(c, vec3(1.0, 0.8, 0.44), smoothstep(0.65, 0.88, h));
  return mix(c, vec3(1.0, 0.96, 0.86), smoothstep(0.88, 1.0, h));
}
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uReach;
  float r = length(p);
  float curl = 1.5 * exp(-r * 1.2) + 0.3 * sin(uTime * 0.25 + uSeed);
  float cs = cos(curl), sn = sin(curl);
  vec2 s = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
  float t = uTime * 0.18;
  vec2 warp = flow(s, t);
  vec2 g = gas(s, warp, t);
  float f = g.x;
  float rope = 1.0 - abs(2.0 * fbm(vec3(s * 3.2 + warp * 2.6, t * 1.4 + uSeed), 3) - 1.0);
  float thread = 1.0 - abs(2.0 * fbm(vec3(s * 7.5 + warp * 3.4, t * 2.0 - uSeed), 3) - 1.0);
  float strands = (0.9 * pow(rope, 6.0) + 0.6 * pow(thread, 10.0)) * smoothstep(0.15, 0.6, f);
  float lit = light(s, warp, t, g.y);
  float core = exp(-r * r * 3.0);
  float h = clamp(f * 0.34 + strands * 0.16 + core * 0.06 + (lit - 0.5) * 0.16, 0.0, 1.0);
  // A thin veil of cooler gas out to the cloud's edge, so its reach can be seen.
  float veil = 0.16 * (1.0 - smoothstep(0.55, 1.05, r)) * (0.55 + 0.45 * fbm(vec3(s * 2.0, t) + uSeed, 2));
  float haze = max(0.34 * smoothstep(0.05, 0.8, f), veil);
  // The ropes glow a little, red-orange at their hottest: plasma held in a field, not flames.
  vec3 glow = heat(min(0.6, 0.35 + strands * 0.3)) * strands * 0.26;
  float a = clamp(haze + 0.5 * max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);
  outColor = vec4(min(heat(h) * haze + glow, vec3(a)), a);
}`;

/** The largest a cloud is worked out at, in pixels: it is all soft flow, so it can be drawn up. */
const GAS_LIMIT = 192;
/** How often a cloud is worked out again: it drifts slowly, and what is between is the picture kept. */
const GAS_HZ = 15;
/** The storm's plasma has fine threads in it, so it is worked out larger. */
const STORM_LIMIT = 320;

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
  const seen = onScreen(ctx, n.x, n.y, half);
  const pixels = seen ? pixelsOf(ctx, half * 2) : 0;
  const haze = !seen ? null : shadeKept(`nebula:${n.seed}`, time, GAS_HZ, NEBULA_SHADER, pixels, pixels, GAS_LIMIT, (u) => {
    const edge = blend(color, COLORS.line, 0.3);
    u.f('uReach', NEBULA_SPRITE_REACH);
    u.f('uTime', time);
    u.f('uSeed', seedOffset(n.seed));
    u.v3('uEdges', [p0, p1, p2]);
    u.v2('uToLight', ...toLight(n.x, n.y));
    u.v3('uEdge', unit(hexToRgb(edge)));
    u.v3('uCore', unit(hexToRgb(blend(edge, COLORS.boneDim, 0.45))));
  });
  if (!seen) {
    // Off the screen: nothing of the haze would show.
  } else if (haze) {
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

/** One cloud of the sun's storm: the plasma already drawn, with a faint warm heart. */
export function drawForgedStormCloud(ctx: CanvasRenderingContext2D, cloud: { x: number; y: number; radius: number; seed: number }, sun: { x: number; y: number }, age: number, time: number, dissolve: number): void {
  drawStormCloud(ctx, cloud, sun, age, time, dissolve, (c, x, y, half, fade) => {
    if (!onScreen(c, x, y, half)) return true;
    const pixels = pixelsOf(c, half * 2);
    const gas = shadeKept(`storm:${cloud.seed}`, time, GAS_HZ, STORM_SHADER, pixels, pixels, STORM_LIMIT, (u) => {
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
  heart.addColorStop(0, `rgba(255,120,50,${0.1 * fade * (0.8 + 0.2 * Math.sin(time * 3 + cloud.seed))})`);
  heart.addColorStop(1, 'rgba(200,50,20,0)');
  ctx.fillStyle = heart;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** A portal's mouth, in its own frame (`rx`, `ry` its half-axes): the doorway with three arms of light spiralling into the middle. */
export function paintForgedPortal(ctx: CanvasRenderingContext2D, rx: number, ry: number, radius: number, color: string, time: number, alpha: number, phase: number): void {
  paintPortal(ctx, rx, ry, radius, color, time, alpha, phase);
  ctx.globalAlpha = alpha;
  drawLightPortalGlow(ctx, rx, ry, color, time + phase);
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
