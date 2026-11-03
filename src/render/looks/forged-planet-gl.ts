/**
 * The forged planets' sphere and cloud, shaded on the GPU: one WebGL2 canvas, shared by every planet, shades a planet's
 * disc in one pass (the map turned round, lit, its cloud's shadow, dusk, the lights of settlements, the cloud layer over
 * it) and the sprite copies it straight onto the field. The same picture as `paintSurface` and `paintClouds` in
 * `forged-planet.ts`, worked out per pixel each frame instead of baked into arrays and painted ten times a second.
 *
 * Where there is no WebGL2 (a canvas drawn without a GPU, as often as not), or the context is lost, or the page is opened
 * with `?planets=cpu`, `forgedPlanetGl()` is null and the planets are painted on the CPU as before.
 */

/** What the shader needs to know of a planet: everything `bake` works out once, and the maps it wears. */
export interface GlPlanet {
  size: number;
  /** The disc's radius (sprite pixels). */
  radius: number;
  spin: number;
  tilt: number;
  specular: number;
  rim: readonly number[];
  dusk: readonly number[];
  gain: readonly number[];
  settled: boolean;
  /** The Blender map, and the procedural cloud map (by name, as `proceduralMap` makes them). */
  map: HTMLImageElement;
  mapName: string;
  cloud: { kind: string; data: Uint8Array; enabled: boolean; colour: readonly number[]; banded: boolean; direction: number; phase: number };
  city: Uint8Array | null;
}

export interface GlConstants {
  light: readonly number[];
  night: readonly number[];
  cityLight: readonly number[];
  surfaceRate: number;
  cloudRate: number;
  shadow: number;
  shadowDepth: number;
  mapW: number;
  mapH: number;
}

export interface ForgedPlanetGl {
  /** Shades `p` at `time`, its moon's shadow on it, and returns the canvas it is on, and where on it (the source rectangle to copy, `size` square). */
  shade(p: GlPlanet, time: number, moon: { x: number; y: number; z: number; radius: number } | null): { canvas: HTMLCanvasElement; x: number; y: number };
}

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D map, cloudMap, cityMap;
uniform float size, radius, specular, settled, cloudOn, banded, phase, surfaceTurn, cloudTurn, shadowAt, shadowDepth, mapH;
uniform vec2 spin, tilt; // cos, sin
uniform vec3 light, rim, dusk, gain, night, cityLight, cloudColour;
// The moon's middle and radius in the planet's radii (radius 0: no moon).
uniform vec4 moon;
out vec4 colour;

const float PI = 3.14159265358979;
const float MOON_SHADOW = 0.85;

float smooth01(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
// A band of a gas giant turns at a speed of its own, by the map's row.
float shiftOf(float row, float turn, float spread) {
  return banded > 0.5 ? turn * (1.0 + spread * sin(row / mapH * PI * 3.0 + phase)) : turn;
}

void main() {
  // The pixel, from the sprite's top left, as the 2D canvas counts it.
  float half_ = size * 0.5;
  vec2 d = vec2(gl_FragCoord.x - half_, (size - gl_FragCoord.y) - half_) / radius;
  float rr = dot(d, d);
  float dist = sqrt(rr);
  float cover = smooth01(1.0 + 1.0 / radius, 1.0 - 1.0 / radius, dist);
  if (cover <= 0.0) { colour = vec4(0.0); return; }
  float nz = sqrt(max(0.0, 1.0 - rr));
  // The point on the sphere, turned about the vertical by the seed and tipped by the tilt, as longitude and latitude.
  float ty = d.y * tilt.x + nz * tilt.y;
  float tz = -d.y * tilt.y + nz * tilt.x;
  float tx = d.x * spin.x + tz * spin.y;
  float tzz = -d.x * spin.y + tz * spin.x;
  float u = atan(tx, tzz) / (2.0 * PI) + 0.5;
  float v = 0.5 + asin(clamp(ty, -1.0, 1.0)) / PI;
  float row = min(mapH - 1.0, floor(v * mapH));

  float lam = d.x * light.x + d.y * light.y + nz * light.z;
  float lit = clamp(0.06 + 0.98 * pow(max(0.0, lam), 0.85), 0.0, 1.0);
  if (moon.w > 0.0) {
    // The moon's shadow: dark where the way to the light runs through it, soft at the edge.
    vec3 toMoon = moon.xyz - vec3(d, nz);
    float along = dot(toMoon, light);
    if (along > 0.0) {
      float miss = sqrt(max(0.0, dot(toMoon, toMoon) - along * along));
      lit *= 1.0 - MOON_SHADOW * (1.0 - smooth01(moon.w * 0.75, moon.w * 1.3, miss));
    }
  }
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float spec = specular * pow(max(0.0, dot(vec3(d, nz), halfway)), 36.0);
  float fresnel = pow(1.0 - nz, 2.6) * (0.3 + 0.7 * smooth01(-0.25, 0.6, lam));
  float twilight = smooth01(-0.14, 0.0, lam) * (1.0 - smooth01(0.0, 0.32, lam)) * 0.22;
  vec3 add = vec3(spec) + rim * fresnel * 0.55 + dusk * twilight;

  float us = u + shiftOf(row, surfaceTurn, 0.5);
  float uc = u + shiftOf(row, cloudTurn, 0.8);
  vec3 albedo = min(vec3(1.0), texture(map, vec2(us, v)).rgb * gain);
  if (cloudOn > 0.5) {
    // The cloud's shadow: the same map as the cloud layer, read a little to the side, darkens the ground under it.
    albedo *= 1.0 - shadowDepth * texture(cloudMap, vec2(uc - shadowAt, v)).r * (0.4 + 0.6 * lit);
  }
  float lights = settled * smooth01(0.05, -0.3, lam) * 0.95;
  float glowing = lights > 0.0 ? texture(cityMap, vec2(us, v)).r * lights : 0.0;
  vec3 ground = min(vec3(1.0), mix(night, albedo, lit) + add + cityLight * glowing);

  float ca = 0.0;
  vec3 cloud = vec3(0.0);
  if (cloudOn > 0.5) {
    ca = texture(cloudMap, vec2(uc, v)).r * cover * (0.25 + 0.75 * lit);
    cloud = cloudColour * (0.12 + 0.88 * lit);
  }
  // The cloud over the ground, premultiplied as the canvas wants it.
  colour = vec4(cloud * ca + ground * cover * (1.0 - ca), ca + cover * (1.0 - ca));
}`;

const NAMES = ['size', 'radius', 'specular', 'settled', 'cloudOn', 'banded', 'phase', 'surfaceTurn', 'cloudTurn', 'shadowAt', 'shadowDepth', 'mapH', 'spin', 'tilt', 'light', 'rim', 'dusk', 'gain', 'night', 'cityLight', 'cloudColour', 'moon', 'map', 'cloudMap', 'cityMap'] as const;

let made: ForgedPlanetGl | null | undefined;

/** The GPU's planets, made on first use; null where they cannot be (see above). */
export function forgedPlanetGl(k: GlConstants): ForgedPlanetGl | null {
  if (made !== undefined) return made;
  made = null;
  if (typeof document === 'undefined' || new URLSearchParams(location.search).get('planets') === 'cpu') return made;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return made;
  const program = link(gl);
  if (!program) return made;
  canvas.addEventListener('webglcontextlost', () => {
    made = null;
  });

  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const at = Object.fromEntries(NAMES.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<(typeof NAMES)[number], WebGLUniformLocation | null>;
  gl.uniform1i(at.map, 0);
  gl.uniform1i(at.cloudMap, 1);
  gl.uniform1i(at.cityMap, 2);
  gl.uniform3fv(at.light, k.light);
  gl.uniform3fv(at.night, k.night.map((c) => c / 255));
  gl.uniform3fv(at.cityLight, k.cityLight.map((c) => c / 255));
  gl.uniform1f(at.shadowAt, k.shadow);
  gl.uniform1f(at.shadowDepth, k.shadowDepth);
  gl.uniform1f(at.mapH, k.mapH);
  gl.disable(gl.BLEND);

  const textures = new Map<string, WebGLTexture>();
  const textureOf = (name: string, upload: () => void): WebGLTexture => {
    let t = textures.get(name);
    if (!t) {
      t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      upload();
      // Round the longitude, not past the poles.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      textures.set(name, t);
    }
    return t;
  };
  const grey = (name: string, data: Uint8Array): WebGLTexture =>
    textureOf(name, () => {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, k.mapW, k.mapH, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    });

  made = {
    shade(p, time, moon) {
      if (p.size > canvas.width) {
        canvas.width = canvas.height = Math.ceil(p.size / 64) * 64;
      }
      // The sprite sits in the canvas's bottom left, where gl_FragCoord counts from; the 2D canvas counts rows from the top.
      gl.viewport(0, 0, p.size, p.size);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(
        gl.TEXTURE_2D,
        textureOf(p.mapName, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, p.map)),
      );
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, grey(p.cloud.kind, p.cloud.data));
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, p.city ? grey('city', p.city) : grey(p.cloud.kind, p.cloud.data));
      gl.uniform1f(at.size, p.size);
      gl.uniform1f(at.radius, p.radius);
      gl.uniform1f(at.specular, p.specular);
      gl.uniform1f(at.settled, p.settled ? 1 : 0);
      gl.uniform1f(at.cloudOn, p.cloud.enabled ? 1 : 0);
      gl.uniform1f(at.banded, p.cloud.banded ? 1 : 0);
      gl.uniform1f(at.phase, p.cloud.phase);
      gl.uniform1f(at.surfaceTurn, time * k.surfaceRate * p.cloud.direction);
      gl.uniform1f(at.cloudTurn, time * k.cloudRate * p.cloud.direction);
      gl.uniform2f(at.spin, Math.cos(p.spin), Math.sin(p.spin));
      gl.uniform2f(at.tilt, Math.cos(p.tilt), Math.sin(p.tilt));
      gl.uniform3fv(at.rim, p.rim.map((c) => c / 255));
      gl.uniform3fv(at.dusk, p.dusk.map((c) => c / 255));
      gl.uniform3fv(at.gain, p.gain);
      gl.uniform3fv(at.cloudColour, p.cloud.colour.map((c) => c / 255));
      gl.uniform4f(at.moon, moon?.x ?? 0, moon?.y ?? 0, moon?.z ?? 0, moon?.radius ?? 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return { canvas, x: 0, y: canvas.height - p.size };
    },
  };
  return made;
}

function link(gl: WebGL2RenderingContext): WebGLProgram | null {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('forged planets: shader did not compile, painting them on the CPU', gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('forged planets: shader did not link, painting them on the CPU', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}
