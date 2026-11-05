/**
 * The forged look's shaders: an offscreen WebGL2 canvas that paints a picture, which the caller then draws into the 2D frame
 * with `drawImage`, so the shaders sit in the same order and transforms as everything else. There is one, small and shared
 * by every element and every canvas, as a browser allows only a few contexts. Every caller keeps its Canvas 2D drawing for
 * when the stage is not to be had: no WebGL2, a context lost, a shader that fails to compile, or a GPU the browser says is
 * slow (a software renderer would pay more for these than for what they replace).
 *
 * `?forgedgl=off` draws without shaders, for comparing; `?forgedgl=soft` allows a software renderer, for headless shots.
 */

const VERTEX = `#version 300 es
in vec2 aAt;
out vec2 vUv;
void main() {
  // vUv runs from the top left, as a canvas does.
  vUv = vec2(aAt.x * 0.5 + 0.5, 0.5 - aAt.y * 0.5);
  gl_Position = vec4(aAt, 0.0, 1.0);
}`;

/** What every fragment shader starts with: value noise and fractal noise, in the same shape as `render/noise.ts`. */
export const GLSL_HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < octaves; i++) {
    sum += amp * noise(p);
    norm += amp;
    amp *= 0.5;
    p = p * 2.03 + vec3(17.1, 9.2, 4.7);
  }
  return sum / norm;
}
`;

/** A seed as an offset into the noise, small enough for the shader's floats to stay exact. */
export const seedOffset = (seed: number): number => {
  const h = Math.sin(seed * 12.9898) * 43758.5453;
  return (h - Math.floor(h)) * 200;
};

/** A hex colour as the three 0 → 1 values a shader wants. */
export const unit = (rgb: readonly number[]): [number, number, number] => [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];

/** The uniforms of the program in use, by name; one that the compiler dropped is simply not set. */
export class Uniforms {
  private readonly at = new Map<string, WebGLUniformLocation | null>();
  constructor(private readonly gl: WebGL2RenderingContext, private readonly program: WebGLProgram) {}
  private spot(name: string): WebGLUniformLocation | null {
    let spot = this.at.get(name);
    if (spot === undefined) {
      spot = this.gl.getUniformLocation(this.program, name);
      this.at.set(name, spot);
    }
    return spot;
  }
  f(name: string, x: number): void {
    this.gl.uniform1f(this.spot(name), x);
  }
  v2(name: string, x: number, y: number): void {
    this.gl.uniform2f(this.spot(name), x, y);
  }
  v3(name: string, v: readonly number[]): void {
    this.gl.uniform3f(this.spot(name), v[0], v[1], v[2]);
  }
  /** Binds a texture to texture unit `slot` for the sampler `name`. */
  tex(name: string, slot: number, texture: WebGLTexture): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + slot);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(this.spot(name), slot);
  }
}

interface Program {
  program: WebGLProgram;
  uniforms: Uniforms;
}

/** An upload a stage keeps: pixels or an image, and how it is sampled. */
export interface TextureSource {
  upload(gl: WebGL2RenderingContext): void;
}

/** One WebGL2 canvas with its programs and textures. */
export class Stage {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext | null = null;
  private lost = false;
  private dead = false;
  /** Goes up when the context comes back: anything made on the old one is gone. */
  generation = 0;
  private programs = new Map<string, Program | null>();
  private textures = new Map<string, WebGLTexture>();
  private timer: { ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }; query: WebGLQuery | null; open: boolean; seconds: number } | null = null;

  constructor() {
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.generation++;
      this.programs.clear();
      this.textures.clear();
      this.prepare();
    });
  }

  /** The context, or null when there is none to be had right now. */
  context(): WebGL2RenderingContext | null {
    if (this.dead || this.lost) return null;
    if (!this.gl) {
      const gl = this.canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        failIfMajorPerformanceCaveat: switchValue() !== 'soft',
      });
      if (!gl) {
        this.dead = true;
        return null;
      }
      this.gl = gl;
      this.prepare();
    }
    return this.gl;
  }

  private prepare(): void {
    const gl = this.gl!;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // One triangle over the whole viewport.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    this.timer = ext ? { ext, query: null, open: false, seconds: 0 } : null;
  }

  private compile(fragment: string): Program | null {
    const gl = this.gl!;
    const shader = (type: number, source: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) console.error('forged shader:', gl.getShaderInfoLog(s));
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VERTEX);
    const fs = shader(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'aAt');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) console.error('forged shader:', gl.getProgramInfoLog(program));
      return null;
    }
    return { program, uniforms: new Uniforms(gl, program) };
  }

  /** Runs a fragment shader over the viewport already set. False when it does not compile. */
  run(fragment: string, set: (u: Uniforms) => void): boolean {
    const gl = this.gl!;
    let program = this.programs.get(fragment);
    if (program === undefined) {
      program = this.compile(fragment);
      this.programs.set(fragment, program);
    }
    if (!program) return false;
    this.startTimer();
    gl.useProgram(program.program);
    set(program.uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** A texture made once and kept, by key. */
  texture(key: string, source: TextureSource): WebGLTexture | null {
    const known = this.textures.get(key);
    if (known) return known;
    const gl = this.gl!;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    source.upload(gl);
    this.textures.set(key, texture);
    return texture;
  }

  private startTimer(): void {
    const timer = this.timer;
    if (!timer || timer.open || timer.query) return;
    const gl = this.gl!;
    timer.query = gl.createQuery();
    if (!timer.query) return;
    gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, timer.query);
    timer.open = true;
  }

  /** Closes this frame's measure of the GPU and returns the latest one that has come back (s); a browser without the timer says 0. */
  closeFrame(): number {
    const timer = this.timer;
    const gl = this.gl;
    if (!timer || !gl) return 0;
    if (timer.open) {
      gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
      timer.open = false;
    } else if (timer.query && gl.getQueryParameter(timer.query, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(timer.ext.GPU_DISJOINT_EXT)) timer.seconds = gl.getQueryParameter(timer.query, gl.QUERY_RESULT) / 1e9;
      gl.deleteQuery(timer.query);
      timer.query = null;
    } else if (!timer.query) {
      // Nothing was drawn with this stage for a whole frame.
      timer.seconds = 0;
    }
    return timer.seconds;
  }
}

/** The URL's switch for the shaders (see the top of the file); read once per search string, as it is asked for several times a frame. */
let switchFor: string | null = null;
let switchKnown: string | null = null;
function switchValue(): string | null {
  if (typeof location === 'undefined') return null;
  if (switchFor !== location.search) {
    switchFor = location.search;
    switchKnown = new URLSearchParams(location.search).get('forgedgl');
  }
  return switchKnown;
}

let spriteStage: Stage | null = null;
const usable = (): boolean => typeof document !== 'undefined' && switchValue() !== 'off';

function sprites(): Stage | null {
  if (!usable()) return null;
  spriteStage ??= new Stage();
  return spriteStage.context() ? spriteStage : null;
}

/** How much of its full size a shaded sprite is drawn at: lowered when the frame cannot keep up (`forged-sky.ts`). */
let detail = 1;
export function setShaderDetail(value: number): void {
  detail = value;
}

/** The picture a shader has just painted: the top left `w` × `h` of `canvas`. Only good until the next one. */
export interface Shaded {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

/** The device pixels a length in the current frame of `ctx` covers. */
export function pixelsOf(ctx: CanvasRenderingContext2D, length: number): number {
  const m = ctx.getTransform();
  return length * Math.hypot(m.a, m.b);
}

/** Whether the square of side `reach * 2` round (x, y) in the current frame of `ctx` is at least in part on its canvas; what is off it need not be shaded. */
export function onScreen(ctx: CanvasRenderingContext2D, x: number, y: number, reach: number): boolean {
  const m = ctx.getTransform();
  const cx = m.a * x + m.c * y + m.e;
  const cy = m.b * x + m.d * y + m.f;
  const r = reach * Math.hypot(m.a, m.b) * Math.SQRT2;
  return cx + r >= 0 && cy + r >= 0 && cx - r <= ctx.canvas.width && cy - r <= ctx.canvas.height;
}

/** The biggest sprite asked for since the sprite canvas was last sized: it shrinks back after a stretch with only small ones. */
let peakW = 0;
let peakH = 0;
let frames = 0;
const SHRINK_EVERY = 300;
const pow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(64, n)));

/**
 * Paints `fragment` as a sprite `width` × `height` pixels (at most `limit` on its long side, and less while the frame is short
 * of time). Null when it cannot, and the caller draws its own way. The shader's output is premultiplied.
 */
export function shade(fragment: string, width: number, height: number, limit: number, set: (u: Uniforms, stage: Stage) => void): Shaded | null {
  const stage = sprites();
  if (!stage) return null;
  const gl = stage.context()!;
  const k = Math.min(1, limit / Math.max(width, height, 1)) * detail;
  const w = Math.max(2, Math.ceil(width * k));
  const h = Math.max(2, Math.ceil(height * k));
  const canvas = stage.canvas;
  peakW = Math.max(peakW, w);
  peakH = Math.max(peakH, h);
  // It grows by powers of two: resizing throws its buffer away.
  if (canvas.width < w || canvas.height < h) {
    canvas.width = Math.max(canvas.width, pow2(w));
    canvas.height = Math.max(canvas.height, pow2(h));
  }
  gl.viewport(0, canvas.height - h, w, h);
  return stage.run(fragment, (u) => set(u, stage)) ? { canvas, w, h } : null;
}

/** A shaded picture kept in a canvas of its own between beats. */
interface Kept {
  canvas: HTMLCanvasElement | null;
  /** When it was last worked out (s). */
  at: number;
}
const kept = new Map<string, Kept>();
const KEPT_MAX = 48;

/** A stable [0, 1) for a key, to stagger the beats of things that appear together. */
function spread(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % 997) / 997;
}

/**
 * Like `shade`, for something that moves slowly: the picture is worked out again `hz` times a second and kept in between (a
 * 2D canvas of its own, which costs the GPU a copy, not a shader), each key on a beat of its own so they do not all fall in one frame.
 */
export function shadeKept(key: string, time: number, hz: number, fragment: string, width: number, height: number, limit: number, set: (u: Uniforms, stage: Stage) => void): Shaded | null {
  let keep = kept.get(key);
  if (!keep) {
    if (kept.size >= KEPT_MAX) kept.clear();
    keep = { canvas: null, at: -1 };
    kept.set(key, keep);
  }
  const every = 1 / hz;
  if (!keep.canvas || time < keep.at || time - keep.at >= every) {
    const shaded = shade(fragment, width, height, limit, set);
    if (!shaded) return null;
    keep.canvas ??= document.createElement('canvas');
    if (keep.canvas.width !== shaded.w || keep.canvas.height !== shaded.h) {
      keep.canvas.width = shaded.w;
      keep.canvas.height = shaded.h;
    }
    const c = keep.canvas.getContext('2d')!;
    c.globalCompositeOperation = 'copy';
    c.drawImage(shaded.canvas, 0, 0, shaded.w, shaded.h, 0, 0, shaded.w, shaded.h);
    keep.at = keep.at < 0 ? time - spread(key) * every : time;
  }
  return { canvas: keep.canvas, w: keep.canvas.width, h: keep.canvas.height };
}

/** Draws a shaded picture over the given rectangle of `ctx`. */
export function place(ctx: CanvasRenderingContext2D, picture: Shaded, x: number, y: number, w: number, h: number): void {
  ctx.drawImage(picture.canvas, 0, 0, picture.w, picture.h, x, y, w, h);
}

/** Closes the frame on the stage. */
export function closeShaderFrame(): void {
  if (spriteStage && ++frames >= SHRINK_EVERY) {
    // Between frames, so nothing is lost: a planet's 1536² once made the canvas that big for good.
    const canvas = spriteStage.canvas;
    const w = pow2(peakW);
    const h = pow2(peakH);
    if (canvas.width > w * 2 || canvas.height > h * 2) {
      canvas.width = Math.min(canvas.width, w);
      canvas.height = Math.min(canvas.height, h);
    }
    peakW = peakH = frames = 0;
  }
  lastGpu = spriteStage?.closeFrame() ?? 0;
}

let lastGpu = 0;
/** The GPU time of the latest frame the timer has answered for (s), 0 where the browser has no timer; for the gallery's readout. */
export const shaderGpuSeconds = (): number => lastGpu;
