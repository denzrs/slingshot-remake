import { LIGHT } from '../planet-common';
import { GLSL_HEAD, shade, type Shaded, type Stage } from './forged-gl';

/** The most hits an unstable planet shows cracks for: the biggest planet breaks at its ninth. */
export const MAX_IMPACTS = 8;
/** A map shines by itself where its colour, weighed by the planet's key (red above blue for lava), stands this high (0 → 1): from the first, in full at the second. */
export const EMIT_FROM = 0.3;
export const EMIT_FULL = 0.75;
/** A map is water, and mirrors the sun, where its colour weighed by the wet key (blue above red for a sea) stands this high. */
export const WET_FROM = 0.08;
export const WET_FULL = 0.25;
/** How tight the sun's glint on water is. */
export const GLINT_POWER = 90;

/**
 * The sphere and cloud of a forged planet as a shader, the same picture as `paintSurface` and `paintClouds` in
 * `forged-planet.ts`, with what those could not afford: the limb lit by the depth of air the
 * eye looks through (out past the disc too), and the map's own light and dark read as relief where the light comes low.
 * An unstable planet's crust breaks open round where it was hit, along the fissures of the Blender crack map, with magma glowing in them.
 */
const PLANET_SHADER = `${GLSL_HEAD}
uniform sampler2D uMap;
uniform sampler2D uCloud;
uniform sampler2D uCity;
uniform float uHalf;
uniform float uR;
uniform float uLod;
uniform vec2 uSpin;
uniform vec2 uTilt;
uniform vec3 uLight;
uniform vec3 uGain;
uniform vec3 uRim;
uniform vec3 uDusk;
uniform vec3 uNight;
uniform vec3 uCityLight;
uniform vec3 uCloudColour;
uniform float uSpecular;
uniform float uRelief;
uniform float uAir;
uniform float uHasCloud;
uniform float uHasCity;
uniform vec3 uEmitKey;
uniform float uEmit;
uniform float uEmitNight;
uniform vec3 uWetKey;
uniform float uWet;
uniform float uBand;
uniform float uSurfaceTurn;
uniform float uCloudTurn;
uniform float uPhase;
uniform float uShadow;
uniform float uShadowDepth;
uniform sampler2D uCracks;
uniform float uCrackLod;
uniform int uHits;
/** Each hit: where it struck, as a point on the disc (x, y), how far the surface had turned then (z) and how long ago it was (w, s). */
uniform vec4 uImpact[${MAX_IMPACTS}];
/** How near the planet is to breaking (0 → 1), and how bright its magma is now: the warning's pulse. */
uniform float uDanger;
uniform float uGlow;

/** How high the air reaches, in radii. */
const float SHELL = 0.1;

float luma(vec3 c) {
  return dot(c, vec3(0.3, 0.55, 0.15));
}

/** A point of the disc (p, its depth nz) as longitude and latitude of the map, before the planet's turn. */
vec2 mapAt(vec2 p, float nz) {
  float ty = p.y * uTilt.x + nz * uTilt.y;
  float tz = -p.y * uTilt.y + nz * uTilt.x;
  float tx = p.x * uSpin.x + tz * uSpin.y;
  float tzz = -p.x * uSpin.y + tz * uSpin.x;
  return vec2(atan(tx, tzz) / 6.2831853 + 0.5, 0.5 + asin(clamp(ty, -1.0, 1.0)) / 3.1415927);
}

/** A place on the map as a point of the unit sphere. */
vec3 onSphere(float u, float v) {
  float lon = u * 6.2831853;
  float lat = (v - 0.5) * 3.1415927;
  return vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
}

/** A point of the disc on the turning surface's map. */
vec2 surfaceAt(vec2 p) {
  vec2 at = mapAt(p, sqrt(max(0.0, 1.0 - dot(p, p))));
  float wave = sin(at.y * 9.424778 + uPhase);
  return vec2(at.x + uSurfaceTurn * (1.0 + uBand * 0.5 * wave), at.y);
}

/** The map's brightness at a point of the disc, taken as height. Read from a blurred level of the map: its sharp coasts would speckle. */
float heightAt(vec2 p) {
  return luma(textureLod(uMap, surfaceAt(p), uLod + 2.0).rgb);
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uHalf;
  float rr = dot(p, p);
  float dist = sqrt(rr);
  float top = (1.0 + SHELL) * (1.0 + SHELL);
  float deepest = sqrt(top - 1.0);
  vec2 side = p / max(dist, 1e-4);
  float sunward = dot(side, uLight.xy);
  // Past the disc: the air seen edge on, lit on the side the light is on.
  float beyond = dist >= 1.0 ? sqrt(max(0.0, top - rr)) / deepest : 0.0;
  float haze = beyond * beyond * beyond * smoothstep(-0.5, 0.7, sunward) * 0.2 * uAir;
  vec3 outer = uRim * haze;
  float outerA = haze;
  float cover = 1.0 - smoothstep(1.0 - 1.0 / uR, 1.0 + 1.0 / uR, dist);
  float nz = sqrt(max(0.0, 1.0 - rr));
  vec3 n = vec3(p, nz);
  // The point on the sphere, turned about the vertical by the seed and tipped by the tilt, as longitude and latitude.
  vec2 at = mapAt(p, nz);
  float u = at.x;
  float v = at.y;
  float wave = sin(v * 9.424778 + uPhase);
  float surfaceU = u + uSurfaceTurn * (1.0 + uBand * 0.5 * wave);
  float cloudU = u + uCloudTurn * (1.0 + uBand * 0.8 * wave);

  // The crack map turns with the surface. Its edges are kept a pixel wide, whatever the planet's size. The derivatives are taken before anything returns: they need every pixel of a quad to be here.
  vec3 crack = uHits > 0 ? textureLod(uCracks, vec2(surfaceU, v), uCrackLod).rgb : vec3(1.0);
  vec2 crackAa = max(fwidth(crack.rg), vec2(1e-3));
  if (cover <= 0.0) {
    outColor = vec4(outer, outerA);
    return;
  }
  vec3 albedo = min(vec3(1.0), textureLod(uMap, vec2(surfaceU, v), uLod).rgb * uGain);
  // Relief: the height's slope across the disc tilts the surface towards or from the light. It is measured a texel of the
  // blurred level apart, so it runs smoothly from texel to texel; the screen's derivatives held it flat over each texel and
  // each block of 2 × 2 pixels, which tiled a big planet in squares.
  vec2 slope = vec2(0.0);
  if (uRelief != 0.0) {
    float apart = 6.2831853 * exp2(uLod + 2.0) / float(textureSize(uMap, 0).x);
    vec2 dx = vec2(apart, 0.0);
    vec2 dy = vec2(0.0, apart);
    slope = vec2(heightAt(p + dx) - heightAt(p - dx), heightAt(p + dy) - heightAt(p - dy)) / (2.0 * apart) * 0.04;
  }
  vec3 bumped = normalize(n - vec3(slope, 0.0) * uRelief);
  float lam = dot(n, uLight);
  float lamBumped = dot(bumped, uLight);
  float lit = clamp(0.06 + 0.98 * pow(max(0.0, lamBumped), 0.85), 0.0, 1.0);

  float cloud = uHasCloud * texture(uCloud, vec2(cloudU, v)).r;
  float shadow = 1.0 - uHasCloud * uShadowDepth * texture(uCloud, vec2(cloudU - uShadow, v)).r * (0.4 + 0.6 * lit);
  vec3 ground = mix(uNight, albedo * shadow, lit);

  // Night: the lights of settlements, under the cloud.
  float night = (1.0 - smoothstep(-0.3, 0.05, lam)) * 0.95;
  ground += uCityLight * uHasCity * texture(uCity, vec2(surfaceU, v)).r * night;
  // What of the map shines by itself (lava's melt, by day and by night; a machine's lamps and a living world's veins, at night), under its smoke.
  float emit = uEmit * smoothstep(${EMIT_FROM.toFixed(2)}, ${EMIT_FULL.toFixed(2)}, dot(albedo, uEmitKey)) * mix(1.0, night / 0.95, uEmitNight);
  ground = max(ground, albedo * emit * 1.1);

  // The cloud, lit like the sphere under it.
  float shadeCloud = 0.12 + 0.88 * lit;
  float cloudA = cloud * (0.25 + 0.75 * lit);
  vec3 col = mix(ground, uCloudColour * shadeCloud, cloudA);

  // The depth of air along the eye's ray, deepest at the limb; going red towards dusk, as the light there has come through the most air itself.
  float depth = clamp((sqrt(top - rr) - nz) / deepest, 0.0, 1.0);
  float sunlit = smoothstep(-0.25, 0.6, lam);
  float dusk = smoothstep(-0.14, 0.0, lam) * (1.0 - smoothstep(0.0, 0.32, lam));
  // Some of it stays on the night side, so the dark limb still shows against the sky and the planet stays round.
  vec3 air = mix(uRim, uDusk, dusk * 0.7) * depth * depth * (0.3 + 0.7 * sunlit) * mix(0.32, 0.75, uAir);
  col += air;
  col += uDusk * dusk * 0.22;
  vec3 halfway = normalize(uLight + vec3(0.0, 0.0, 1.0));
  col += vec3(uSpecular * pow(max(0.0, dot(bumped, halfway)), 36.0));
  // Water mirrors the sun: a tight glint, on the flat sphere (a sea has no relief), under the cloud.
  float wet = uWet * smoothstep(${WET_FROM.toFixed(2)}, ${WET_FULL.toFixed(2)}, dot(albedo, uWetKey));
  col += vec3(1.0, 0.96, 0.88) * wet * pow(max(0.0, dot(n, halfway)), ${GLINT_POWER}.0) * (1.0 - cloudA);

  if (uHits > 0) {
    // How far the crust has given way here: round each hit, out to a reach that grows as the planet nears breaking, with a
    // ragged front (the map's slow noise), and near the end all over.
    vec3 here = onSphere(surfaceU, v);
    float reach = 0.4 + 1.2 * uDanger;
    float open = smoothstep(0.55, 1.0, uDanger) * smoothstep(0.6, 0.4, crack.b);
    float flash = 0.0;
    for (int i = 0; i < ${MAX_IMPACTS}; i++) {
      if (i >= uHits) break;
      vec4 hit = uImpact[i];
      vec2 hitAt = mapAt(hit.xy, sqrt(max(0.0, 1.0 - dot(hit.xy, hit.xy))));
      float hitWave = sin(hitAt.y * 9.424778 + uPhase);
      vec3 struck = onSphere(hitAt.x + hit.z * (1.0 + uBand * 0.5 * hitWave), hitAt.y);
      float away = acos(clamp(dot(here, struck), -1.0, 1.0));
      open = max(open, 1.0 - smoothstep(reach * 0.3, reach, away + (crack.b - 0.5) * 0.8));
      // A fresh hit flares white where it struck, then settles.
      flash += exp(-hit.w * 2.2) * (1.0 - smoothstep(0.0, 0.32, away));
    }
    // Great fissures widen as the crust opens; the fine cracks branch off them only where it is well open.
    float width = mix(0.035, 0.11, open);
    float great = (1.0 - smoothstep(width - crackAa.x, width + crackAa.x, crack.r)) * smoothstep(0.03, 0.2, open);
    float fine = (1.0 - smoothstep(0.05 - crackAa.y, 0.05 + crackAa.y, crack.g)) * smoothstep(0.45, 0.95, open);
    float heat = (1.0 - smoothstep(0.0, 0.35, crack.r)) * smoothstep(0.03, 0.3, open);
    // The plates char along their broken edges; the magma lights them from beneath, whatever the sun does.
    col *= 1.0 - 0.5 * heat;
    float core = 1.0 - smoothstep(0.0, width * 0.6 + crackAa.x, crack.r);
    vec3 lava = mix(vec3(0.95, 0.16, 0.06), vec3(1.0, 0.82, 0.5), core * (0.35 + 0.65 * uGlow));
    col = mix(col, lava * (0.55 + 0.75 * uGlow), great);
    col += vec3(0.85, 0.2, 0.06) * fine * (0.3 + 0.5 * uGlow);
    col += vec3(0.75, 0.08, 0.06) * heat * heat * (0.25 + 0.6 * uGlow);
    col += vec3(1.0, 0.75, 0.45) * min(flash, 1.0) * 0.9;
  }

  float a = max(cover, outerA);
  outColor = vec4(col * cover + outer * (1.0 - cover), a);
}`;

/** What the shader needs to know of one planet. */
export interface PlanetShade {
  mapName: string;
  map: HTMLImageElement;
  cloudName: string;
  cloud: () => Uint8Array;
  /** The lights of its night side, if it has any, and which map they are. */
  city: (() => Uint8Array) | null;
  cityName: string;
  mapSize: readonly [number, number];
  /** The planet's radius and the sprite's half width, in pixels. */
  radius: number;
  half: number;
  spin: number;
  tilt: number;
  gain: readonly number[];
  rim: readonly number[];
  dusk: readonly number[];
  night: readonly number[];
  cityLight: readonly number[];
  specular: number;
  /** What of the map glows by itself: its colour weighed by `emitKey` (lava: red above blue), how strongly (0 none), and whether only on the night side. */
  emitKey: readonly number[];
  emit: number;
  emitNight: boolean;
  /** How deeply the glow breathes (0 steady → 1 out at its lowest), a living world's slow pulse. */
  emitPulse: number;
  /** What of the map is water and mirrors the sun: its colour weighed by `wetKey`, and how brightly (0 none). */
  wetKey: readonly number[];
  wet: number;
  relief: number;
  air: boolean;
  cloudColour: readonly number[];
  band: boolean;
  surfaceRate: number;
  cloudRate: number;
  phase: number;
  shadow: number;
  shadowDepth: number;
}

/** An unstable planet's damage, as the shader shows it. */
export interface PlanetCracks {
  map: HTMLImageElement;
  /** Each hit: where it struck on the disc (x, y), how far the surface had turned then and how long ago it was (s). */
  impacts: Float32Array;
  hits: number;
  danger: number;
  glow: number;
}

/** How bright a breathing glow is at `time` (0 → 1): slow, and never quite in step from one planet to the next. */
export function emitBreath(pulse: number, time: number, phase: number): number {
  if (!pulse) return 1;
  const wave = 0.5 + 0.5 * Math.sin(time * 0.9 + phase) * Math.sin(time * 0.37 + phase * 2);
  return 1 - pulse * (1 - wave);
}

/** A planet's map: turning round means repeating sideways; mipmaps, read at the level the planet's size calls for. */
function mapTexture(stage: Stage, s: PlanetShade): WebGLTexture | null {
  return stage.texture(`map:${s.mapName}`, {
    upload(gl) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, s.map);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
  });
}

/** The crack map: data read as it is, mipmapped for small planets. */
function crackTexture(stage: Stage, map: HTMLImageElement): WebGLTexture | null {
  return stage.texture('cracks', {
    upload(gl) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, map);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
  });
}

/** One of the procedural maps, one channel. */
function greyTexture(stage: Stage, name: string, size: readonly [number, number], pixels: () => Uint8Array): WebGLTexture | null {
  return stage.texture(`grey:${name}`, {
    upload(gl) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size[0], size[1], 0, gl.RED, gl.UNSIGNED_BYTE, pixels());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
  });
}

/** The largest a planet is worked out at, in pixels: a map has only so much in it. */
const PLANET_LIMIT = 1536;

/** Paints the sphere and its cloud as they stand at `time`, a sprite as wide as `half * 2`, cracked open where `cracks` says; the caller keeps it between beats. Null without shaders. */
export function shadePlanet(s: PlanetShade, time: number, cracks: PlanetCracks | null = null): Shaded | null {
  const size = s.half * 2;
  return shade(PLANET_SHADER, size, size, PLANET_LIMIT, (u, stage) => {
    const map = mapTexture(stage, s);
    const cloud = greyTexture(stage, s.cloudName, s.mapSize, s.cloud);
    const city = s.city ? greyTexture(stage, s.cityName, s.mapSize, s.city) : cloud;
    if (!map || !cloud || !city) return;
    u.tex('uMap', 0, map);
    u.tex('uCloud', 1, cloud);
    u.tex('uCity', 2, city);
    u.f('uHalf', s.half / s.radius);
    u.f('uR', s.radius);
    u.f('uLod', Math.max(0, Math.log2(s.map.naturalWidth / (Math.PI * 2 * s.radius))));
    u.v2('uSpin', Math.cos(s.spin), Math.sin(s.spin));
    u.v2('uTilt', Math.cos(s.tilt), Math.sin(s.tilt));
    u.v3('uLight', LIGHT);
    u.v3('uGain', s.gain);
    u.v3('uRim', s.rim);
    u.v3('uDusk', s.dusk);
    u.v3('uNight', s.night);
    u.v3('uCityLight', s.cityLight);
    u.v3('uCloudColour', s.cloudColour);
    u.f('uSpecular', s.specular);
    u.v3('uEmitKey', s.emitKey);
    u.f('uEmit', s.emit * emitBreath(s.emitPulse, time, s.phase));
    u.f('uEmitNight', s.emitNight ? 1 : 0);
    u.v3('uWetKey', s.wetKey);
    u.f('uWet', s.wet);
    u.f('uRelief', s.relief);
    u.f('uAir', s.air ? 1 : 0);
    u.f('uHasCloud', s.air ? 1 : 0);
    u.f('uHasCity', s.city ? 1 : 0);
    u.f('uBand', s.band ? 1 : 0);
    u.f('uSurfaceTurn', time * s.surfaceRate);
    u.f('uCloudTurn', time * s.cloudRate);
    u.f('uPhase', s.phase);
    u.f('uShadow', s.shadow);
    u.f('uShadowDepth', s.shadowDepth);
    const crackMap = cracks ? crackTexture(stage, cracks.map) : null;
    if (cracks && crackMap) {
      u.tex('uCracks', 3, crackMap);
      u.f('uCrackLod', Math.max(0, Math.log2(cracks.map.naturalWidth / (Math.PI * 2 * s.radius))));
      u.v4s('uImpact', cracks.impacts);
      u.f('uDanger', cracks.danger);
      u.f('uGlow', cracks.glow);
    }
    // The sampler is bound to the map without cracks, so it never reads a unit left over from another shader.
    else u.tex('uCracks', 3, map);
    u.i('uHits', cracks && crackMap ? Math.min(cracks.hits, MAX_IMPACTS) : 0);
  });
}
