import { GLSL_HEAD, postStageOf, type Stage } from './forged-gl';
import type { FrameInfo } from './painter';

/**
 * The forged post pass as shaders: the bright parts of the frame kept with a soft threshold and blurred on a chain of
 * halving levels and back up (each step a small tent of samples, so the blur is round and a small bright shot does not
 * shimmer), put over the frame with a screen, which rolls off where the sum would clip. Then the vignette, the grade and
 * the grain, as `forged-sky.ts` draws them, with a touch of dither so the deep blues do not band.
 *
 * The frame has to cross to the GPU as a texture, once, or twice while something must go over the bloom but under the grade.
 */

/** Keeps what is nearly white. Luma, not the brightest channel: a ship's strong colour must not bloom, only what is nearly white. */
const THRESHOLD = `${GLSL_HEAD}
uniform sampler2D uFrom;
void main() {
  vec3 c = texture(uFrom, vUv).rgb;
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  outColor = vec4(pow(c, vec3(6.0)) * smoothstep(0.6, 0.95, l), 1.0);
}`;

const DOWN = `${GLSL_HEAD}
uniform sampler2D uFrom;
uniform vec2 uTexel;
void main() {
  vec2 d = uTexel;
  vec3 c = texture(uFrom, vUv).rgb * 4.0;
  c += texture(uFrom, vUv + vec2(-d.x, -d.y)).rgb;
  c += texture(uFrom, vUv + vec2(d.x, -d.y)).rgb;
  c += texture(uFrom, vUv + vec2(-d.x, d.y)).rgb;
  c += texture(uFrom, vUv + vec2(d.x, d.y)).rgb;
  outColor = vec4(c / 8.0, 1.0);
}`;

/** The level below, blurred on the way up; blending adds it to what the level already holds. */
const UP = `${GLSL_HEAD}
uniform sampler2D uFrom;
uniform vec2 uTexel;
void main() {
  vec2 d = uTexel;
  vec3 c = texture(uFrom, vUv + vec2(-d.x * 2.0, 0.0)).rgb;
  c += texture(uFrom, vUv + vec2(d.x * 2.0, 0.0)).rgb;
  c += texture(uFrom, vUv + vec2(0.0, -d.y * 2.0)).rgb;
  c += texture(uFrom, vUv + vec2(0.0, d.y * 2.0)).rgb;
  c += texture(uFrom, vUv + vec2(-d.x, -d.y)).rgb * 2.0;
  c += texture(uFrom, vUv + vec2(d.x, -d.y)).rgb * 2.0;
  c += texture(uFrom, vUv + vec2(-d.x, d.y)).rgb * 2.0;
  c += texture(uFrom, vUv + vec2(d.x, d.y)).rgb * 2.0;
  outColor = vec4(c / 12.0, 1.0);
}`;

/** The blur's result as a picture, how strong it is put over the frame. */
const SHOW_BLOOM = `${GLSL_HEAD}
uniform sampler2D uFrom;
uniform float uStrength;
void main() {
  outColor = vec4(min(vec3(1.0), texture(uFrom, vUv).rgb * uStrength), 1.0);
}`;

const COMPOSITE = `${GLSL_HEAD}
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uStrength;
uniform float uTime;
uniform vec2 uSize;
uniform vec4 uPlate;
vec3 softLight(vec3 a, vec3 b) {
  return mix(2.0 * a * b + a * a * (1.0 - 2.0 * b), sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b), step(0.5, b));
}
vec3 overlay(vec3 a, vec3 b) {
  return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a));
}
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  vec3 b = min(vec3(1.0), texture(uBloom, vUv).rgb * uStrength);
  c = 1.0 - (1.0 - c) * (1.0 - b);

  vec2 at = vUv * uSize;
  vec2 middle = uPlate.xy + uPlate.zw * 0.5;
  float reach = length(uPlate.zw) * 0.62;
  float dim = 0.55 * clamp((distance(at, middle) - reach * 0.5) / (reach * 0.5), 0.0, 1.0);
  c = mix(c, vec3(2.0, 5.0, 12.0) / 255.0, dim);

  vec2 inPlate = (at - uPlate.xy) / uPlate.zw;
  if (all(greaterThanEqual(inPlate, vec2(0.0))) && all(lessThanEqual(inPlate, vec2(1.0)))) {
    // Cool in the high lights of the top, warm in the low ones.
    vec3 tone = mix(vec3(70.0, 130.0, 255.0), vec3(255.0, 150.0, 70.0), inPlate.y) / 255.0;
    c = mix(c, softLight(c, tone), mix(0.14, 0.1, inPlate.y));
    // Grain, about fifteen new patterns a second.
    float n = hash(vec3(floor(at), floor(uTime * 15.0)));
    c = mix(c, overlay(c, vec3(n)), 0.05);
  }
  // A step of dither hides the bands 8 bits leave in a slow dark gradient.
  c += (hash(vec3(at, 3.0)) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}`;

interface Level {
  texture: WebGLTexture;
  buffer: WebGLFramebuffer;
  w: number;
  h: number;
}
interface Chain {
  levels: Level[];
  scene: WebGLTexture;
}

/** Each frame size's blur levels, at ½ to 1/32; made again when the context comes back. */
const LEVELS = 5;
const chains = new Map<string, Chain>();
let generation = -1;

function linear(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function chainFor(stage: Stage, gl: WebGL2RenderingContext, w: number, h: number): Chain | null {
  if (generation !== stage.generation) {
    chains.clear();
    generation = stage.generation;
  }
  const key = `${w}×${h}`;
  const known = chains.get(key);
  if (known) return known;
  if (chains.size >= 4) {
    for (const chain of chains.values()) {
      gl.deleteTexture(chain.scene);
      for (const level of chain.levels) {
        gl.deleteTexture(level.texture);
        gl.deleteFramebuffer(level.buffer);
      }
    }
    chains.clear();
  }
  // Light in floating point where it can be rendered to: a soft bloom in 8 bits bands.
  const float = !!gl.getExtension('EXT_color_buffer_float');
  const levels: Level[] = [];
  for (let i = 1; i <= LEVELS; i++) {
    const lw = Math.max(1, Math.ceil(w / 2 ** i));
    const lh = Math.max(1, Math.ceil(h / 2 ** i));
    const texture = gl.createTexture();
    const buffer = gl.createFramebuffer();
    if (!texture || !buffer) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, lw, lh, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    linear(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    levels.push({ texture, buffer, w: lw, h: lh });
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const scene = gl.createTexture();
  if (!scene) return null;
  gl.bindTexture(gl.TEXTURE_2D, scene);
  linear(gl);
  const made = { levels, scene };
  chains.set(key, made);
  return made;
}

function upload(gl: WebGL2RenderingContext, scene: WebGLTexture, frame: HTMLCanvasElement): void {
  gl.bindTexture(gl.TEXTURE_2D, scene);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame);
}

/** Runs the threshold and the blur over the texture of the frame: the result is in the first level. */
function blur(stage: Stage, gl: WebGL2RenderingContext, chain: Chain): boolean {
  const { levels, scene } = chain;
  const pass = (fragment: string, to: Level, set: Parameters<Stage['run']>[1]): boolean => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.buffer);
    gl.viewport(0, 0, to.w, to.h);
    return stage.run(fragment, set, true);
  };
  if (!pass(THRESHOLD, levels[0], (u) => u.tex('uFrom', 0, scene))) return false;
  for (let i = 1; i < LEVELS; i++) {
    const from = levels[i - 1];
    if (!pass(DOWN, levels[i], (u) => {
      u.tex('uFrom', 0, from.texture);
      u.v2('uTexel', 0.5 / from.w, 0.5 / from.h);
    })) return false;
  }
  // Up: each level adds the one below it.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  let ok = true;
  for (let i = LEVELS - 1; i > 0 && ok; i--) {
    const from = levels[i];
    ok = pass(UP, levels[i - 1], (u) => {
      u.tex('uFrom', 0, from.texture);
      u.v2('uTexel', 0.5 / from.w, 0.5 / from.h);
    });
  }
  gl.disable(gl.BLEND);
  return ok;
}

/**
 * Draws the post pass over `ctx`'s frame: the bloom, what must go over the bloom (`redraws`), and with `whole` the vignette,
 * grade and grain. False when there are no shaders for it; then the frame has not been touched.
 */
export function shadePost(ctx: CanvasRenderingContext2D, f: FrameInfo, redraws: readonly ((ctx: CanvasRenderingContext2D) => void)[], whole: boolean): boolean {
  const stage = postStageOf();
  const gl = stage?.context();
  if (!stage || !gl) return false;
  const main = ctx.canvas;
  if (stage.canvas.width !== main.width || stage.canvas.height !== main.height) {
    stage.canvas.width = main.width;
    stage.canvas.height = main.height;
  }
  const chain = chainFor(stage, gl, main.width, main.height);
  if (!chain) return false;
  upload(gl, chain.scene, main);
  if (!blur(stage, gl, chain)) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return false;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const strength = Math.min(1, 0.35 + 0.4 * f.flash + 0.3 * f.whiteout);
  const bloom = chain.levels[0];

  // The frame comes back whole when nothing has to go between the bloom and the grade.
  const direct = whole && redraws.length === 0;
  if (!direct) {
    gl.viewport(0, main.height - bloom.h, bloom.w, bloom.h);
    if (!stage.run(SHOW_BLOOM, (u) => {
      u.tex('uFrom', 0, bloom.texture);
      u.f('uStrength', strength);
    })) return false;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(stage.canvas, 0, 0, bloom.w, bloom.h, 0, 0, main.width, main.height);
    ctx.restore();
    for (const redraw of redraws) redraw(ctx);
    if (!whole) return true;
    upload(gl, chain.scene, main);
  }
  gl.viewport(0, 0, main.width, main.height);
  const ran = stage.run(COMPOSITE, (u) => {
    u.tex('uScene', 0, chain.scene);
    u.tex('uBloom', 1, bloom.texture);
    u.f('uStrength', direct ? strength : 0);
    u.f('uTime', f.time);
    u.v2('uSize', main.width, main.height);
    u.v4('uPlate', f.plate.x, f.plate.y, f.plate.w, f.plate.h);
  });
  // Without a direct pass the bloom is already in the frame, and must not be drawn a second time.
  if (!ran) return !direct;
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(stage.canvas, 0, 0, main.width, main.height);
  ctx.restore();
  return true;
}
