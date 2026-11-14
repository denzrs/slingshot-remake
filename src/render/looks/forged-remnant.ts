import type { Planet } from '../../sim/physics';
import { rgba } from '../color';
import { drawNeutronStar, drawPulsarBeams, NEBULA_REACH } from '../sun';
import { GLSL_HEAD, onScreen, pixelsOf, place, seedOffset, shadeKept } from './forged-gl';

/**
 * Forged's supernova remnant, after the Crab: a torn cage of glowing filaments, red where the gas is cool and orange-white
 * where it is hot, round a faint teal fill; in the middle the pulsar's own nebula, a blue-white haze with a ring round
 * the star, jets along its axis and wisps rippling out, and the pulsar's two beams sweeping round over it. Young, the
 * whole remnant burns hotter and whiter.
 */
const REMNANT_SHADER = `${GLSL_HEAD}
uniform float uTime;
uniform float uSeed;
uniform float uTurn;
uniform float uYoung;
const float PI = 3.14159265;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  // The shell is seen at a slant and turns slowly.
  float c = cos(uTurn), s = sin(uTurn);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  q.y /= 0.84;
  float r = length(q);
  if (r >= 1.0) {
    outColor = vec4(0.0);
    return;
  }
  vec3 o = vec3(uSeed);
  float t = uTime * 0.02;
  vec3 w = vec3(q * 2.2, t) + o;
  vec2 warp = vec2(fbm(w, 3), fbm(w + 5.2, 3)) - 0.5;
  // Its edge is torn, so it is never a clean ring.
  float edge = 0.78 + 0.32 * (fbm(vec3(q * 1.7, 3.0) + o, 3) - 0.5);
  float rr = r / edge;

  // The cage: ridges of a warped noise, a coarse net and a fine one.
  float ridge1 = 1.0 - abs(2.0 * fbm(vec3(q * 4.0 + warp * 1.6, 1.0 + t) + o, 4) - 1.0);
  float ridge2 = 1.0 - abs(2.0 * fbm(vec3(q * 9.0 + warp * 2.4, 7.0 + t * 1.3) + o, 3) - 1.0);
  float gas = fbm(vec3(q * 3.0 + warp, 11.0) + o, 4);
  float shell = smoothstep(0.4, 0.82, rr) * (1.0 - smoothstep(0.82, 1.0, rr));
  shell *= 0.45 + 0.75 * smoothstep(0.6, 0.9, rr);
  // Torn: whole stretches of the shell have thinned to nothing.
  float torn = smoothstep(0.28, 0.62, gas);
  float filament = (pow(ridge1, 7.5) + 0.5 * pow(ridge2, 10.0)) * shell * torn;
  vec3 cool = vec3(0.95, 0.17, 0.11);
  vec3 hot = vec3(1.0, 0.68, 0.34);
  vec3 tone = mix(hot, cool, smoothstep(0.5, 0.95, rr));
  tone = mix(tone, vec3(1.0, 0.9, 0.75), uYoung * 0.4);
  float fill = (1.0 - smoothstep(0.3, 0.95, rr)) * smoothstep(0.35, 0.75, gas) * 0.28;

  // The pulsar's nebula: haze, a ring round the star, jets along its axis, wisps running outwards.
  float haze = exp(-r * r / 0.03) * (0.5 + 0.7 * fbm(vec3(q * 7.0, uTime * 0.08) + o, 3));
  float ring = exp(-pow((length(vec2(q.x, q.y * 1.9)) - 0.12) / 0.025, 2.0)) * (0.4 + 0.8 * fbm(vec3(q * 12.0, uTime * 0.1) + o, 2));
  float jet = exp(-pow(q.x / 0.018, 2.0)) * exp(-abs(q.y) / 0.22) * smoothstep(0.02, 0.06, abs(q.y));
  float wisps = pow(0.5 + 0.5 * sin((r - uTime * 0.035) * 75.0 + 6.0 * fbm(vec3(q * 4.0, 2.0) + o, 2)), 3.0) * exp(-r / 0.13) * smoothstep(0.03, 0.1, r) * (0.3 + 0.7 * fbm(vec3(q * 6.0, uTime * 0.05) + o, 2)) * 0.35;
  vec3 sync = vec3(0.5, 0.7, 1.0);

  // The blast front, far out: a thin, faint blue line.
  float front = exp(-pow((rr - 0.98) / 0.035, 2.0)) * smoothstep(0.4, 0.75, fbm(vec3(q * 5.0, t) + o, 3));

  float bright = 1.0 + 0.6 * uYoung;
  vec3 col = tone * filament * 1.25 * bright
    + vec3(0.14, 0.58, 0.55) * fill
    + sync * (haze * 0.8 + ring * 0.35 + jet * 0.55 + wisps) * bright
    + vec3(0.45, 0.6, 1.0) * front * 0.3;
  col *= 1.0 - smoothstep(0.7, 1.0, r);
  col = min(col, vec3(1.0));
  outColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;

/** The largest the remnant is worked out at, in pixels, and how often: it drifts slowly, and what is between is the picture kept. */
const REMNANT_LIMIT = 512;
const REMNANT_HZ = 20;

const slot = (seed: number, k: number): number => {
  const h = Math.sin((seed + k * .618) * 127.1) * 43758.5453;
  return h - Math.floor(h);
};

/** The supernova's remnant, `age` seconds after it: it blows out fast and slows, as the shared one, so it reaches as far. */
export function drawForgedNeutronStar(ctx: CanvasRenderingContext2D, star: Planet, time: number, age: number, alpha = 1): void {
  const seed = star.seed;
  const grown = 1 - Math.pow(1 - Math.min(1, age / 3.5), 3);
  const reach = NEBULA_REACH * (.15 + .85 * grown) * (1 + .025 * Math.sin(time * .6));
  ctx.save();
  ctx.translate(star.x, star.y);
  if (onScreen(ctx, 0, 0, reach)) {
    const pixels = pixelsOf(ctx, reach * 2);
    const shaded = shadeKept(`remnant:${seed}`, time, REMNANT_HZ, REMNANT_SHADER, pixels, pixels, REMNANT_LIMIT, (u) => {
      u.f('uTime', time);
      u.f('uSeed', seedOffset(seed));
      u.f('uTurn', slot(seed, 7) * Math.PI + time * .015);
      u.f('uYoung', 1 - Math.min(1, age / 6));
    });
    if (!shaded) {
      ctx.restore();
      drawNeutronStar(ctx, star, time, age, alpha);
      return;
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * Math.min(1, age / .8);
    place(ctx, shaded, -reach, -reach, reach * 2, reach * 2);
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha * Math.min(1, age / 1.2);

  // The pulsar's beams sweeping round, as in every look: the remnant's turning light.
  drawPulsarBeams(ctx, seed, time);

  // The star: a white-hot point in a throbbing blue halo, with a faint cross of light on it as a lens sees one.
  const R = star.radius;
  const throb = .75 + .25 * Math.sin(time * 5.2);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 7);
  halo.addColorStop(0, rgba('#ffffff', .95));
  halo.addColorStop(.15, rgba('#d6eaff', .75 * throb));
  halo.addColorStop(.45, rgba('#6aa8ff', .22 * throb));
  halo.addColorStop(1, rgba('#3a5cff', 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 7, 0, Math.PI * 2);
  ctx.fill();
  const spike = R * 11 * (.85 + .15 * throb);
  for (const angle of [0, Math.PI / 2]) {
    ctx.save();
    ctx.rotate(angle);
    const line = ctx.createLinearGradient(-spike, 0, spike, 0);
    line.addColorStop(0, rgba('#9cc8ff', 0));
    line.addColorStop(.5, rgba('#ffffff', .5));
    line.addColorStop(1, rgba('#9cc8ff', 0));
    ctx.fillStyle = line;
    ctx.fillRect(-spike, -R * .12, spike * 2, R * .24);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, R * .5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
