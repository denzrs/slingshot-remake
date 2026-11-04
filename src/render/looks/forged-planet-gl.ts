import { LIGHT } from '../planet-common';
import { GLSL_HEAD, shade, type Shaded, type Stage } from './forged-gl';

/**
 * The sphere and cloud of a forged planet as a shader, the same picture as `paintSurface` and `paintClouds` in
 * `forged-planet.ts`, with what those could not afford: the limb lit by the depth of air the
 * eye looks through (out past the disc too), and the map's own light and dark read as relief where the light comes low.
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
uniform float uBand;
uniform float uSurfaceTurn;
uniform float uCloudTurn;
uniform float uPhase;
uniform float uShadow;
uniform float uShadowDepth;

/** How high the air reaches, in radii. */
const float SHELL = 0.1;

float luma(vec3 c) {
  return dot(c, vec3(0.3, 0.55, 0.15));
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
  if (cover <= 0.0) {
    outColor = vec4(outer, outerA);
    return;
  }
  float nz = sqrt(max(0.0, 1.0 - rr));
  vec3 n = vec3(p, nz);
  // The point on the sphere, turned about the vertical by the seed and tipped by the tilt, as longitude and latitude.
  float ty = p.y * uTilt.x + nz * uTilt.y;
  float tz = -p.y * uTilt.y + nz * uTilt.x;
  float tx = p.x * uSpin.x + tz * uSpin.y;
  float tzz = -p.x * uSpin.y + tz * uSpin.x;
  float u = atan(tx, tzz) / 6.2831853 + 0.5;
  float v = 0.5 + asin(clamp(ty, -1.0, 1.0)) / 3.1415927;
  float wave = sin(v * 9.424778 + uPhase);
  float surfaceU = u + uSurfaceTurn * (1.0 + uBand * 0.5 * wave);
  float cloudU = u + uCloudTurn * (1.0 + uBand * 0.8 * wave);
  vec3 albedo = min(vec3(1.0), textureLod(uMap, vec2(surfaceU, v), uLod).rgb * uGain);

  // Relief: the map's brightness taken as height, its slope on the screen tilting the surface towards or from the light. Read from a blurred level of the map: its sharp coasts would speckle.
  float height = luma(textureLod(uMap, vec2(surfaceU, v), uLod + 2.0).rgb);
  float slopeX = dFdx(height) * uR * 0.04;
  float slopeY = -dFdy(height) * uR * 0.04;
  vec3 bumped = normalize(n - vec3(slopeX, slopeY, 0.0) * uRelief);
  float lam = dot(n, uLight);
  float lamBumped = dot(bumped, uLight);
  float lit = clamp(0.06 + 0.98 * pow(max(0.0, lamBumped), 0.85), 0.0, 1.0);

  float cloud = uHasCloud * texture(uCloud, vec2(cloudU, v)).r;
  float shadow = 1.0 - uHasCloud * uShadowDepth * texture(uCloud, vec2(cloudU - uShadow, v)).r * (0.4 + 0.6 * lit);
  vec3 ground = mix(uNight, albedo * shadow, lit);

  // Night: the lights of settlements, under the cloud.
  float night = (1.0 - smoothstep(-0.3, 0.05, lam)) * 0.95;
  ground += uCityLight * uHasCity * texture(uCity, vec2(surfaceU, v)).r * night;

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

  float a = max(cover, outerA);
  outColor = vec4(col * cover + outer * (1.0 - cover), a);
}`;

/** What the shader needs to know of one planet. */
export interface PlanetShade {
  mapName: string;
  map: HTMLImageElement;
  cloudName: string;
  cloud: () => Uint8Array;
  city: (() => Uint8Array) | null;
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

/** Paints the sphere and its cloud as they stand at `time`, a sprite as wide as `half * 2`; the caller keeps it between beats. Null without shaders. */
export function shadePlanet(s: PlanetShade, time: number): Shaded | null {
  const size = s.half * 2;
  return shade(PLANET_SHADER, size, size, PLANET_LIMIT, (u, stage) => {
    const map = mapTexture(stage, s);
    const cloud = greyTexture(stage, s.cloudName, s.mapSize, s.cloud);
    const city = s.city ? greyTexture(stage, 'city', s.mapSize, s.city) : cloud;
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
  });
}
