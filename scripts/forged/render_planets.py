"""
More planet maps for the forged look, each an equirectangular albedo painted by a shader (the same way `render_assets.py` paints the
first three: noise, voronoi and colour ramps on a point of the unit sphere, shown through an emission shader on a flat plane).
Run it in the background, no addon needed:

    blender -b --python scripts/forged/render_planets.py -- /abs/path/to/out [name ...]

It writes `tex-<name>.png` (1024 × 512) for every variant below, or only for the names given. `scripts/forged/pack.py` turns them
into the WebP files the game loads, and `src/render/looks/forged-assets.ts` lists which a planet of each style may wear.
"""
import importlib.util
import math
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('render_assets', HERE / 'render_assets.py')
ra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ra)

hex2c, math_node, ramp_node, sphere_vector = ra.hex2c, ra.math_node, ra.ramp_node, ra.sphere_vector


def background_scene():
    """`ra.scene()` without the window a background run does not have."""
    sc = bpy.data.scenes.get('slingshot_forged') or bpy.data.scenes.new('slingshot_forged')
    for o in list(sc.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
        try:
            sc.render.engine = engine
            break
        except TypeError:
            continue
    if sc.render.engine == 'CYCLES':
        sc.cycles.samples = 16
    sc.view_settings.view_transform = 'Standard'
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    w = bpy.data.worlds.get('forged_world') or bpy.data.worlds.new('forged_world')
    w.use_nodes = True
    sc.world = w
    bpy.context.window_manager  # noqa: B018 (touch, so a missing window manager fails here)
    return sc


def background_render(sc, path, size_x, size_y=None):
    sc.render.resolution_x = size_x
    sc.render.resolution_y = size_y or size_x
    sc.render.resolution_percentage = 100
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=sc.name)


ra.scene = background_scene
ra.render = background_render


# ------------------------------------------------------------- shader kit ----

class Kit:
    """Nodes of one material, with the sphere point they all read."""

    def __init__(self):
        self.mat = bpy.data.materials.new('planet')
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        for n in list(self.nt.nodes):
            self.nt.nodes.remove(n)
        self.vec, self.sep, lat = sphere_vector(self.nt)
        self.lat = lat.outputs[0]

    def noise(self, scale, detail=8, rough=0.55, distortion=0.0, vec=None):
        n = self.nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        if 'Distortion' in n.inputs:
            n.inputs['Distortion'].default_value = distortion
        self.nt.links.new(vec or self.vec, n.inputs['Vector'])
        return n.outputs['Fac']

    def stretched(self, scale, along, across, detail=8, rough=0.55):
        """Noise squeezed along the latitude (bands): the sphere point scaled by (along, along, across)."""
        sep = self.nt.nodes.new('ShaderNodeSeparateXYZ')
        self.nt.links.new(self.vec, sep.inputs['Vector'])
        comb = self.nt.nodes.new('ShaderNodeCombineXYZ')
        for i, k in enumerate((along, along, across)):
            self.nt.links.new(math_node(self.nt, 'MULTIPLY', sep.outputs[i], k).outputs[0], comb.inputs[i])
        return self.noise(scale, detail, rough, vec=comb.outputs[0])

    def voronoi(self, scale, feature='F1'):
        v = self.nt.nodes.new('ShaderNodeTexVoronoi')
        v.feature = feature
        v.inputs['Scale'].default_value = scale
        self.nt.links.new(self.vec, v.inputs['Vector'])
        return v.outputs['Distance']

    def m(self, op, a=None, b=None, c=None):
        return math_node(self.nt, op, a, b, c).outputs[0]

    def ramp(self, fac, stops):
        r = ramp_node(self.nt, stops)
        self.nt.links.new(fac, r.inputs['Fac'])
        return r.outputs['Color']

    def mix(self, a, b, fac, blend='MIX'):
        n = self.nt.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = blend
        self.nt.links.new(fac, n.inputs['Factor']) if not isinstance(fac, (int, float)) else n.inputs['Factor'].__setattr__('default_value', fac)
        for socket, value in (('A', a), ('B', b)):
            if isinstance(value, str):
                n.inputs[socket].default_value = hex2c(value)
            else:
                self.nt.links.new(value, n.inputs[socket])
        return n.outputs['Result']

    def band(self, scale, warp, frequency, detail=8, rough=0.6):
        """0 → 1 stripes along the latitude, bent by noise: the stuff of a gas giant."""
        noise = self.noise(scale, detail, rough)
        base = self.m('MULTIPLY', self.m('SINE', self.lat), frequency)
        wave = self.m('SINE', self.m('MULTIPLY_ADD', noise, warp, base))
        return self.m('MULTIPLY_ADD', wave, 0.5, 0.5)

    def spot(self, u, v, w, h):
        """A soft oval at (u, v) of the map, `w` × `h` across: 1 in its middle, 0 outside."""
        dx = self.m('MULTIPLY', self.m('SUBTRACT', self.sep.outputs['X'], u), 1.0 / w)
        dy = self.m('MULTIPLY', self.m('SUBTRACT', self.sep.outputs['Y'], v), 1.0 / h)
        d = self.m('SQRT', self.m('ADD', self.m('MULTIPLY', dx, dx), self.m('MULTIPLY', dy, dy)))
        n = self.nt.nodes.new('ShaderNodeMapRange')
        n.inputs['From Min'].default_value = 1.0
        n.inputs['From Max'].default_value = 0.2
        self.nt.links.new(d, n.inputs['Value'])
        return n.outputs['Result']

    def cap(self, start, end):
        """1 near the poles, 0 elsewhere."""
        n = self.nt.nodes.new('ShaderNodeMapRange')
        n.inputs['From Min'].default_value = start
        n.inputs['From Max'].default_value = end
        self.nt.links.new(self.m('ABSOLUTE', self.lat), n.inputs['Value'])
        return n.outputs['Result']

    def clamp01(self, v):
        return self.m('MINIMUM', self.m('MAXIMUM', v, 0.0), 1.0)


# ----------------------------------------------------------------- recipes ----

def desert(k):
    dunes = k.stretched(2.4, 1.0, 2.6, 8)
    ridges = k.m('MULTIPLY_ADD', k.m('SINE', k.m('MULTIPLY_ADD', dunes, 14.0, k.m('MULTIPLY', k.m('SINE', k.lat), 3.0))), 0.5, 0.5)
    height = k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.2, 8), 0.5), 1.8, k.m('MULTIPLY', ridges, 0.35))
    sand = k.ramp(k.clamp01(k.m('ADD', height, 0.35)), [(0.0, '#5a3a22'), (0.35, '#b87a3f'), (0.65, '#e3b36a'), (1.0, '#f8dc9c')])
    patch = k.m('SUBTRACT', k.noise(1.5, 6), 0.58)
    return k.mix(sand, '#2a2018', k.clamp01(k.m('MULTIPLY', patch, 9.0)))


def ocean(k):
    height = k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(1.7, 9, 0.58), 0.5), 1.9, 0.5)
    land = k.ramp(k.clamp01(height), [(0.0, '#0a2a5c'), (0.3, '#14468a'), (0.47, '#2a78c0'), (0.5, '#d9c68a'), (0.53, '#4f8a3a'), (0.7, '#2f6a2c'), (0.85, '#7a6a4a'), (1.0, '#f0f0f0')])
    return k.mix(land, '#f4fbff', k.cap(1.05, 1.3))


def moon(k):
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(3.0, 10), 0.5), 2.4, 0.5)), [(0.0, '#2c2c30'), (0.5, '#74747a'), (1.0, '#c8c6c0')])
    big = k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.m('MINIMUM', k.voronoi(5.0), 0.4), 2.5))
    small = k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.m('MINIMUM', k.voronoi(13.0), 0.4), 2.5))
    pits = k.m('ADD', k.m('MULTIPLY', big, big), k.m('MULTIPLY', k.m('MULTIPLY', small, small), 0.6))
    dark = k.m('MULTIPLY_ADD', k.m('MAXIMUM', pits, 0.0), -0.75, 1.0)
    return k.mix(base, '#000000', k.m('SUBTRACT', 1.0, dark))


def alien(k):
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.4, 9), 0.5), 2.4, 0.5)), [(0.0, '#2a1240'), (0.4, '#6a3aa0'), (0.7, '#c06ad0'), (1.0, '#ffc9ef')])
    veins = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(3.8, 'DISTANCE_TO_EDGE'), 13.0)))
    return k.mix(base, '#3cf0d0', k.m('MULTIPLY', veins, 0.9))


def neptune(k):
    bands = k.band(1.9, 2.2, 9.0)
    base = k.ramp(bands, [(0.0, '#0b2a6b'), (0.4, '#1f57c4'), (0.7, '#5aa2f0'), (1.0, '#d6ecff')])
    return k.mix(base, '#071540', k.m('MULTIPLY', k.spot(0.3, 0.36, 0.1, 0.07), 0.9))


def violet(k):
    swirl = k.band(2.6, 3.4, 8.0, 9, 0.62)
    return k.ramp(swirl, [(0.0, '#2c1a4a'), (0.3, '#7a4fa8'), (0.55, '#c7a3e0'), (0.8, '#f1dcf5'), (1.0, '#9c6ccf')])


def toxic(k):
    swirl = k.band(3.2, 3.0, 10.0, 10, 0.65)
    return k.ramp(swirl, [(0.0, '#243a12'), (0.3, '#5f8a1a'), (0.55, '#c5d24a'), (0.8, '#f0f0a0'), (1.0, '#7a9a2a')])


def crimson(k):
    swirl = k.band(2.2, 3.6, 7.0, 9, 0.6)
    return k.ramp(swirl, [(0.0, '#2a0a0a'), (0.3, '#8a1c14'), (0.55, '#e0502a'), (0.8, '#ffb070'), (1.0, '#5a1410')])


def stormy(k):
    base = k.ramp(k.band(1.8, 2.6, 12.0), [(0.0, '#3a1c16'), (0.22, '#a5623a'), (0.45, '#e0b27a'), (0.7, '#f3e0b8'), (0.88, '#c98a58'), (1.0, '#fff4dc')])
    spot = k.spot(0.62, 0.38, 0.09, 0.06)
    ring = k.m('MULTIPLY', k.m('SUBTRACT', 1.0, k.m('ABSOLUTE', k.m('SUBTRACT', spot, 0.5))), 0.0)
    return k.mix(k.mix(base, '#a8321a', k.m('MULTIPLY', spot, 0.95)), '#f6dcc0', k.m('MULTIPLY', ring, 0.0))


def glacier(k):
    ridges = k.stretched(2.0, 1.0, 3.4, 9)
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', ridges, 0.5), 2.4, 0.5)), [(0.0, '#7fb6e8'), (0.5, '#cfe8f8'), (1.0, '#ffffff')])
    crevasse = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(2.2, 'DISTANCE_TO_EDGE'), 16.0)))
    return k.mix(base, '#3f78b0', k.m('MULTIPLY', crevasse, 0.55))


def methane(k):
    swirl = k.band(2.4, 2.4, 6.0, 9)
    return k.ramp(swirl, [(0.0, '#0e5a6a'), (0.45, '#3fb0c0'), (0.8, '#bff0f0'), (1.0, '#f0ffff')])


def dusty(k):
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.6, 9), 0.5), 2.0, 0.5)), [(0.0, '#bcd2e4'), (0.6, '#e6f1fa'), (1.0, '#ffffff')])
    dirt = k.m('SUBTRACT', k.noise(1.8, 7), 0.56)
    return k.mix(base, '#6a5a4a', k.clamp01(k.m('MULTIPLY', dirt, 8.0)))


def rose(k):
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.4, 9), 0.5), 2.2, 0.5)), [(0.0, '#8a5a80'), (0.5, '#d8a8c8'), (1.0, '#fff0f6')])
    crack = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(2.8, 'DISTANCE_TO_EDGE'), 12.0)))
    return k.mix(base, '#5a2a50', k.m('MULTIPLY', crack, 0.6))


# Lava: the game reads the hot parts of these maps as light (red well above blue), so a crust is kept dark and only what is
# molten runs to orange and yellow. The map comes out in sRGB of the colours as given, so `shown` names a colour as it
# should end up on the map: the dark crust would otherwise come out mid grey.

def shown(h):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = h.lstrip('#')
    return '#' + ''.join('%02x' % round(lin(int(h[i:i + 2], 16)) * 255) for i in (0, 2, 4))


def hot(stops):
    return [(at, shown(c)) for at, c in stops]


def warped_voronoi(k, scale, warp, feature='DISTANCE_TO_EDGE'):
    """Voronoi cells on the sphere point pushed about by noise, so their edges wander like flows rather than tiles."""
    n = k.nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 2.5
    n.inputs['Detail'].default_value = 4
    k.nt.links.new(k.vec, n.inputs['Vector'])
    push = k.nt.nodes.new('ShaderNodeVectorMath')
    push.operation = 'MULTIPLY_ADD'
    k.nt.links.new(n.outputs['Color'], push.inputs[0])
    push.inputs[1].default_value = (warp, warp, warp)
    k.nt.links.new(k.vec, push.inputs[2])
    v = k.nt.nodes.new('ShaderNodeTexVoronoi')
    v.feature = feature
    v.inputs['Scale'].default_value = scale
    k.nt.links.new(push.outputs[0], v.inputs['Vector'])
    return v.outputs['Distance']


def rivers(k):
    crust = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(3.0, 10), 0.5), 2.2, 0.5)), hot([(0.0, '#0e0a09'), (0.5, '#241b18'), (1.0, '#3e322c')]))
    vein = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', warped_voronoi(k, 2.6, 0.45), 11.0)))
    heat = k.m('MULTIPLY', vein, k.clamp01(k.m('MULTIPLY_ADD', k.noise(1.4, 4), 1.6, -0.2)))
    glow = k.ramp(heat, hot([(0.0, '#3a0904'), (0.35, '#9a1e08'), (0.7, '#f25a12'), (1.0, '#ffc870')]))
    return k.mix(crust, glow, k.clamp01(k.m('MULTIPLY', heat, 1.6)))


def magma(k):
    sea = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.6, 8, 0.6), 0.5), 2.0, 0.5)), hot([(0.0, '#7a1205'), (0.4, '#d23a0c'), (0.75, '#ff8a20'), (1.0, '#ffd27a')]))
    plates = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.noise(1.6, 6), 0.47), 14.0))
    tone = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(5.0, 8), 0.5), 2.0, 0.5)), hot([(0.0, '#100b09'), (0.6, '#2a201b'), (1.0, '#463830')]))
    seams = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', warped_voronoi(k, 5.0, 0.25), 14.0)))
    crust = k.mix(tone, shown('#e84a10'), k.m('MULTIPLY', seams, 0.8))
    return k.mix(sea, crust, plates)


def ash(k):
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.4, 10), 0.5), 2.4, 0.5)), hot([(0.0, '#15110f'), (0.5, '#2e2723'), (1.0, '#52463e')]))
    pools = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.noise(4.0, 6), 0.62), 10.0))
    fissure = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.m('ABSOLUTE', k.m('SUBTRACT', k.stretched(2.0, 1.0, 3.0, 8), 0.5)), 30.0)))
    heat = k.m('MAXIMUM', pools, k.m('MULTIPLY', fissure, 0.8))
    glow = k.ramp(heat, hot([(0.0, '#4a0b04'), (0.5, '#e03a0a'), (1.0, '#ffbe5a')]))
    return k.mix(base, glow, heat)


RECIPES = {
    'rock-desert': desert,
    'rock-ocean': ocean,
    'rock-moon': moon,
    'rock-alien': alien,
    'gas-neptune': neptune,
    'gas-violet': violet,
    'gas-toxic': toxic,
    'gas-crimson': crimson,
    'gas-stormy': stormy,
    'ice-glacier': glacier,
    'ice-methane': methane,
    'ice-dusty': dusty,
    'ice-rose': rose,
    'lava-rivers': rivers,
    'lava-magma': magma,
    'lava-ash': ash,
}


def build(out, name):
    sc = ra.scene()
    sc.render.film_transparent = False
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.active_object
    plane.scale = (2, 1, 1)
    sc.collection.objects.link(plane) if plane.name not in sc.collection.objects else None
    k = Kit()
    colour = RECIPES[name](k)
    out_node = k.nt.nodes.new('ShaderNodeOutputMaterial')
    em = k.nt.nodes.new('ShaderNodeEmission')
    k.nt.links.new(colour, em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    k.nt.links.new(em.outputs[0], out_node.inputs['Surface'])
    plane.data.materials.append(k.mat)
    ra.camera(sc, (0, 0, 5), 2.0)
    ra.world(sc, '#000000', 0.0)
    ra.render(sc, '%s/tex-%s.png' % (out, name), 1024, 512)
    bpy.data.objects.remove(plane, do_unlink=True)


def main(out, only=None):
    for name in RECIPES:
        if not only or name in only:
            build(out, name)
            print('rendered', name, flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(args[0], args[1:] or None)
