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


# The worlds after lava. Their colours are named as they should end up on the map (`hot`), since the game reads some of
# them as light or water: what glows is red well above blue (lava, a machine's lamps) or blue well above red (a living
# world's veins), and what shines like a sea is blue above red (ocean) or green above red (acid lakes).

def grid(k, across, down):
    """0 on the seams of a grid of `across` × `down` panels in the map's own longitude and latitude, 1 inside a panel; and a value per panel."""
    u = k.m('FRACT', k.m('MULTIPLY', k.sep.outputs['X'], across))
    v = k.m('FRACT', k.m('MULTIPLY', k.sep.outputs['Y'], down))
    edge = lambda f: k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.m('MINIMUM', f, k.m('SUBTRACT', 1.0, f)), 0.04), 30.0))
    cell = k.nt.nodes.new('ShaderNodeCombineXYZ')
    k.nt.links.new(k.m('FLOOR', k.m('MULTIPLY', k.sep.outputs['X'], across)), cell.inputs[0])
    k.nt.links.new(k.m('FLOOR', k.m('MULTIPLY', k.sep.outputs['Y'], down)), cell.inputs[1])
    white = k.nt.nodes.new('ShaderNodeTexWhiteNoise')
    white.noise_dimensions = '3D'
    k.nt.links.new(cell.outputs[0], white.inputs['Vector'])
    return k.m('MULTIPLY', edge(u), edge(v)), white.outputs['Value']


def facets(k, scale):
    """Flat cells of a crystal: a value per cell (Voronoi's colour) and 1 on the cells' edges."""
    v = k.nt.nodes.new('ShaderNodeTexVoronoi')
    v.inputs['Scale'].default_value = scale
    k.nt.links.new(k.vec, v.inputs['Vector'])
    sep = k.nt.nodes.new('ShaderNodeSeparateColor')
    k.nt.links.new(v.outputs['Color'], sep.inputs['Color'])
    edge = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(scale, 'DISTANCE_TO_EDGE'), 28.0)))
    return sep.outputs[0], edge


def deep(k):
    height = k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.2, 9, 0.6), 0.5), 2.2, 0.5)
    sea = k.ramp(k.clamp01(height), hot([(0.0, '#04162e'), (0.45, '#0a2f5e'), (0.62, '#1a5a96'), (0.7, '#3a90c0'), (0.72, '#d8cc90'), (0.76, '#3c7a38'), (1.0, '#2a5a28')]))
    return k.mix(sea, shown('#eef6ff'), k.cap(1.12, 1.35))


def reef(k):
    shelf = k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(3.0, 8, 0.6), 0.5), 2.6, 0.5))
    sea = k.ramp(shelf, hot([(0.0, '#06264a'), (0.4, '#0c4a80'), (0.6, '#1890b0'), (0.72, '#3cc8c8'), (0.8, '#8ae8d8'), (0.83, '#f0e2b0'), (0.88, '#5aa048'), (1.0, '#3a7a34')]))
    atoll = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(9.0, 'DISTANCE_TO_EDGE'), 22.0)))
    return k.mix(sea, shown('#7ae0d0'), k.m('MULTIPLY', atoll, k.m('MULTIPLY', k.clamp01(k.m('SUBTRACT', shelf, 0.45)), 1.4)))


def dunes(k):
    field = k.stretched(1.6, 1.0, 2.2, 6)
    ridge = k.m('MULTIPLY_ADD', k.m('SINE', k.m('MULTIPLY_ADD', field, 22.0, k.m('MULTIPLY', k.sep.outputs['X'], 60.0))), 0.5, 0.5)
    tone = k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.0, 8), 0.5), 1.2, k.m('MULTIPLY', ridge, 0.5))
    sand = k.ramp(k.clamp01(k.m('ADD', tone, 0.2)), hot([(0.0, '#6a3e1c'), (0.35, '#b47234'), (0.65, '#dca05a'), (1.0, '#f4d290')]))
    rock = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.noise(1.3, 6), 0.62), 10.0))
    return k.mix(sand, shown('#4a2e1e'), rock)


def salt(k):
    flats = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.noise(1.6, 7), 0.52), 7.0))
    cracks = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(14.0, 'DISTANCE_TO_EDGE'), 30.0)))
    pan = k.mix(shown('#f2ece0'), shown('#c8b8a0'), k.m('MULTIPLY', cracks, 0.7))
    field = k.stretched(2.0, 1.0, 2.6, 6)
    ridge = k.m('MULTIPLY_ADD', k.m('SINE', k.m('MULTIPLY', field, 40.0)), 0.5, 0.5)
    sand = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', ridge, 0.6, k.m('MULTIPLY', k.noise(3.0, 6), 0.4))), hot([(0.0, '#8a5228'), (0.5, '#c88a4c'), (1.0, '#ecc488')]))
    canyon = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.m('ABSOLUTE', k.m('SUBTRACT', k.noise(1.2, 5), 0.5)), 40.0)))
    return k.mix(k.mix(sand, pan, flats), shown('#3a2016'), k.m('MULTIPLY', canyon, 0.85))


def lakes(k):
    ground = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.6, 9), 0.5), 2.2, 0.5)), hot([(0.0, '#2e2a14'), (0.5, '#6a5a24'), (1.0, '#a08a3a')]))
    depth = k.m('SUBTRACT', k.noise(1.8, 6, 0.55), 0.55)
    lake = k.clamp01(k.m('MULTIPLY', depth, 14.0))
    rim = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.m('ABSOLUTE', depth), 40.0)))
    acid = k.ramp(k.clamp01(k.m('MULTIPLY', depth, 6.0)), hot([(0.0, '#a8d830'), (0.6, '#7ac028'), (1.0, '#4a9a24')]))
    return k.mix(k.mix(ground, shown('#1a1608'), k.m('MULTIPLY', rim, 0.8)), acid, lake)


def sulfur(k):
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.4, 9), 0.5), 2.4, 0.5)), hot([(0.0, '#8a6a18'), (0.45, '#d8b830'), (0.75, '#f0e070'), (1.0, '#fff4b0')]))
    streak = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.stretched(2.2, 1.0, 3.0, 7), 0.55), 6.0))
    pools = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(6.0), 3.2)), 3.0))
    return k.mix(k.mix(base, shown('#a04a18'), k.m('MULTIPLY', streak, 0.8)), shown('#5ab830'), k.m('MULTIPLY', pools, 0.9))


def graphite(k):
    layers = k.band(2.4, 2.0, 4.0, 8, 0.6)
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(3.4, 10), 0.5), 1.6, k.m('MULTIPLY', layers, 0.4))), hot([(0.0, '#08080a'), (0.5, '#1a1a1e'), (1.0, '#3a3a42')]))
    seams = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(4.0, 'DISTANCE_TO_EDGE'), 20.0)))
    return k.mix(base, shown('#56545e'), k.m('MULTIPLY', seams, 0.5))


def tar(k):
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.0, 9), 0.5), 2.0, 0.5)), hot([(0.0, '#050404'), (0.55, '#140e0a'), (1.0, '#2e2218')]))
    vein = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', warped_voronoi(k, 3.0, 0.5), 24.0)))
    return k.mix(base, shown('#6a6258'), k.m('MULTIPLY', vein, 0.6))


def amethyst(k):
    cell, edge = facets(k, 6.0)
    tone = k.ramp(cell, hot([(0.0, '#2a1048'), (0.4, '#5a2a8a'), (0.75, '#9a60d0'), (1.0, '#d8b0f4')]))
    return k.mix(tone, shown('#f4e8ff'), k.m('MULTIPLY', edge, 0.75))


def quartz(k):
    cell, edge = facets(k, 8.0)
    tone = k.ramp(cell, hot([(0.0, '#4a7a90'), (0.4, '#8ac0d4'), (0.75, '#cae8f0'), (1.0, '#f4fcff')]))
    return k.mix(tone, shown('#ffffff'), k.m('MULTIPLY', edge, 0.8))


def moss(k):
    height = k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(1.8, 9, 0.6), 0.5), 2.0, 0.5))
    land = k.ramp(height, hot([(0.0, '#160c26'), (0.42, '#2a1a40'), (0.46, '#1e4a2a'), (0.7, '#3a8a3a'), (1.0, '#8ac050')]))
    vein = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', warped_voronoi(k, 4.0, 0.5), 16.0)))
    onland = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', height, 0.45), 20.0))
    return k.mix(land, shown('#28d8e8'), k.m('MULTIPLY', vein, onland))


def coral(k):
    height = k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.6, 9, 0.62), 0.5), 2.4, 0.5))
    land = k.ramp(height, hot([(0.0, '#1a0c20'), (0.45, '#2e1430'), (0.5, '#a03a5a'), (0.7, '#e0705a'), (1.0, '#f8b890')]))
    spots = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(16.0), 4.0)), 2.0))
    onland = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', height, 0.5), 12.0))
    return k.mix(land, shown('#30c8f0'), k.m('MULTIPLY', spots, onland))


def panels(k):
    inside, cell = grid(k, 48.0, 24.0)
    plate = k.ramp(k.m('MULTIPLY_ADD', cell, 0.6, k.m('MULTIPLY', k.noise(4.0, 4), 0.4)), hot([(0.0, '#2a2e34'), (0.5, '#4a5058'), (1.0, '#7a808a')]))
    face = k.mix(shown('#0c0e12'), plate, inside)
    # Lamps along some seams, and whole districts of them: amber, read as light at night.
    district = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.noise(2.2, 4), 0.55), 8.0))
    lamps = k.m('MULTIPLY', k.m('SUBTRACT', 1.0, inside), k.m('MAXIMUM', district, k.m('GREATER_THAN', cell, 0.93)))
    trench = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.m('ABSOLUTE', k.m('SUBTRACT', k.sep.outputs['Y'], 0.5)), 60.0)))
    return k.mix(k.mix(face, shown('#ffa83a'), k.clamp01(lamps)), shown('#ffc060'), k.m('MULTIPLY', trench, 0.9))


def hive(k):
    cell, edge = facets(k, 11.0)
    plate = k.ramp(cell, hot([(0.0, '#3a3430'), (0.5, '#6a625a'), (1.0, '#9a9084')]))
    lit = k.m('MULTIPLY', edge, k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.noise(1.8, 4), 0.5), 8.0)))
    return k.mix(k.mix(plate, shown('#141210'), k.m('MULTIPLY', edge, 0.8)), shown('#ff9a40'), lit)


def cryo(k):
    base = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(3.0, 9), 0.5), 1.8, 0.5)), hot([(0.0, '#b8d4e4'), (0.6, '#e4f0f8'), (1.0, '#ffffff')]))
    # Tiger stripes: long fissures across the south pole, where the geysers stand.
    south = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.m('MULTIPLY', k.lat, -1.0), 0.75), 3.0))
    stripes = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.m('ABSOLUTE', k.m('SINE', k.m('MULTIPLY_ADD', k.noise(2.0, 4), 2.0, k.m('MULTIPLY', k.sep.outputs['X'], 25.0)))), 6.0)))
    frost = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(5.0, 'DISTANCE_TO_EDGE'), 18.0)))
    face = k.mix(base, shown('#7aa8c4'), k.m('MULTIPLY', frost, 0.4))
    return k.mix(face, shown('#2a6070'), k.m('MULTIPLY', stripes, south))


def locked(edge):
    """A world turned for good one face to its sun: ice on that face, molten rock on the one away from it (map middle,
    where the game turns it), cracked dark rock between. `edge` (−1 → 1) is how far the melt reaches round."""
    def recipe(k):
        sx = k.nt.nodes.new('ShaderNodeSeparateXYZ')
        k.nt.links.new(k.vec, sx.inputs['Vector'])
        reach = k.m('ADD', sx.outputs['X'], k.m('MULTIPLY', k.m('SUBTRACT', k.noise(2.2, 6), 0.5), 0.5))
        melt = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', reach, edge), 6.0))
        frozen = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', edge - 0.3, reach), 5.0))
        sea = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(3.0, 8, 0.6), 0.5), 2.0, 0.5)), hot([(0.0, '#7a1205'), (0.4, '#d23a0c'), (0.75, '#ff8a20'), (1.0, '#ffd27a')]))
        plates = k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', k.noise(4.0, 6), 0.52), 10.0))
        lava = k.mix(sea, shown('#1e1612'), plates)
        crust = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(3.4, 9), 0.5), 2.0, 0.5)), hot([(0.0, '#14100e'), (0.5, '#2e2622'), (1.0, '#504640')]))
        seams = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', warped_voronoi(k, 4.0, 0.3), 14.0)))
        crust = k.mix(crust, shown('#d8400c'), k.m('MULTIPLY', seams, k.clamp01(k.m('MULTIPLY', k.m('SUBTRACT', reach, edge - 0.25), 4.0))))
        ice = k.ramp(k.clamp01(k.m('MULTIPLY_ADD', k.m('SUBTRACT', k.noise(2.6, 9), 0.5), 2.0, 0.5)), hot([(0.0, '#7aa8cc'), (0.5, '#c4e0f4'), (1.0, '#f4fbff')]))
        crevasse = k.clamp01(k.m('SUBTRACT', 1.0, k.m('MULTIPLY', k.voronoi(3.0, 'DISTANCE_TO_EDGE'), 18.0)))
        ice = k.mix(ice, shown('#3a70a0'), k.m('MULTIPLY', crevasse, 0.5))
        return k.mix(k.mix(crust, lava, melt), ice, frozen)
    return recipe


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
    'lava-locked': locked(-0.35),
    'ice-locked': locked(0.15),
    'ice-cryo': cryo,
    'ocean-deep': deep,
    'ocean-reef': reef,
    'desert-dunes': dunes,
    'desert-salt': salt,
    'acid-lakes': lakes,
    'acid-sulfur': sulfur,
    'carbon-graphite': graphite,
    'carbon-tar': tar,
    'crystal-amethyst': amethyst,
    'crystal-quartz': quartz,
    'living-moss': moss,
    'living-coral': coral,
    'machine-panels': panels,
    'machine-hive': hive,
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
