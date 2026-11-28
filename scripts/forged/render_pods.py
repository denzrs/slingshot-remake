"""
Renders the escape pods of the forged look, each a body and a team-colour mask like the ship. Run it inside Blender 4.2+,
with `render_assets.py` beside it for its stage and the ship:

    exec(open('scripts/forged/render_pods.py').read()); main('/abs/path/to/out', only=None)

or headless: `Blender -b --python-expr "exec(open('scripts/forged/render_pods.py').read()); main('/abs/out')"`.
`only` is a list of the designs to render ('mini', 'ufo'; None renders both). `scripts/forged/pack.py` turns the PNGs
into the WebP files the game loads.

- 'mini', the shot-down players' pod: a mini shuttle of the ship's make (Einfach's pod in the round), seen at a slant from above. Since it turns to fly, it
  is rendered from `MINI_FRAMES` headings, the light staying where it is (`pod-mini-00.png` …); pack.py sets the frames
  into one sheet, `MINI_COLUMNS` to a row, and `forged-pods.ts` picks the frame.
- 'ufo', the spectators' UFO: a saucer, the same from every side, so one frame at a slant.
"""
import math

import bpy

exec(open('scripts/forged/render_assets.py').read())  # noqa: S102 — the shared stage: scene, camera, lights, materials, the ship

# The UFO: pixels across, and the world units the camera frames.
SIZE = 192
FRAME = 2.0

# The mini ship: how many headings, frames to a row, pixels across a frame, the world units a frame spans, how far
# above the horizon it is seen from (degrees). Keep in step
# with `MINI` in `src/render/looks/forged-pods.ts`.
MINI_FRAMES = 32
MINI_COLUMNS = 8
MINI_PX = 96
MINI_VIEW = 3.0
MINI_ELEVATION = 60
# Where its beacon sits (x ahead, y to the left, z up, world units): on the back, behind the canopy.
MINI_BULB = (-0.3, 0, 0.27)


def paint():
    """Near-white paint: the team colour is multiplied over it, so the lighting stays."""
    return mat('pod_paint', (0.8, 0.8, 0.82, 1), 0.15, 0.45)


def metal(color='#8a8f99', rough=0.35):
    return mat('pod_metal', hex2c(color), 0.9, rough)


def bulb():
    """The beacon's lamp, unlit: the game lights it."""
    return mat('pod_bulb', hex2c('#d8d2c0'), 0.0, 0.2)


def put(obj, material, painted, parts):
    obj.data.materials.append(material)
    parts.append((obj, painted))
    return obj


def sphere(x, y, z, radius, material, painted, parts, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=(x, y, z), segments=32, ring_count=16)
    o = bpy.context.active_object
    o.scale = scale
    return put(o, material, painted, parts)


def smooth(parts):
    for o, _ in parts:
        for p in o.data.polygons:
            p.use_smooth = True


def stage(sc, elevation, view):
    """The camera at `elevation` degrees above the horizon, looking from the front (-y), and the forged light."""
    e = math.radians(elevation)
    camera(sc, (0, -8 * math.cos(e), 8 * math.sin(e)), view, (0, 0, 0))
    light(sc, 'key', (-3, 3.5, 5), 480, hex2c('#fff1d6'), 4)
    light(sc, 'rim', (3, -3, 3), 200, hex2c('#ffffff'), 3)
    world(sc, '#808a99', 0.3)
    try:
        sc.eevee.use_raytracing = True
    except Exception:
        pass


# ------------------------------------------------------------ the mini ship ----

def shuttle(sc):
    """
    The mini shuttle, Einfach's pod in the round and made of the ship's stuff: a rounded fuselage in the team colour
    with a cut-off tail, two short swept wings at the back, the ship's dark canopy forward, its nozzles and wing-tip
    lights. Nose along +x, about 1.7 world units long (the ship is 2.5). Returns (painted, others).
    """
    painted, others = [], []

    def paint_part(o):
        o.data.materials.append(mat('hull_paint', (0.8, 0.8, 0.82, 1), 0.15, 0.45))
        painted.append(o)
        return o

    def other(o, material):
        o.data.materials.append(material)
        others.append(o)
        return o

    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0.05, 0, 0.05), segments=48, ring_count=24)
    body = paint_part(bpy.context.active_object)
    body.scale = (0.8, 0.27, 0.23)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=0.42, location=(-0.52, 0, 0.04), rotation=(0, math.radians(90), 0), vertices=48)
    tail = paint_part(bpy.context.active_object)
    tail.scale = (0.95, 1.1, 1)
    # The wings, Einfach's trapezoids, thin and tipped up a little.
    for sy in (-1, 1):
        me = bpy.data.meshes.new('wing')
        bm = bmesh.new()
        pts = [(0.08, 0.2, 0.0), (-0.36, 0.78, 0.07), (-0.64, 0.78, 0.07), (-0.52, 0.2, 0.0)]
        vs = [bm.verts.new((x, sy * y, z)) for x, y, z in pts]
        bm.faces.new(vs if sy > 0 else vs[::-1])
        bm.to_mesh(me)
        bm.free()
        wing = bpy.data.objects.new('wing', me)
        sc.collection.objects.link(wing)
        wing.modifiers.new('s', 'SOLIDIFY').thickness = 0.05
        bev = wing.modifiers.new('b', 'BEVEL')
        bev.width = 0.012
        bev.segments = 2
        paint_part(wing)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.04, location=(-0.62, sy * 0.79, 0.07))
        other(bpy.context.active_object, mat('tip', hex2c('#e8e4d8'), 0, 0.3, hex2c('#e8e4d8'), 6))
    # A band round the tail, where the hatch is.
    bpy.ops.mesh.primitive_torus_add(major_radius=0.215, minor_radius=0.012, location=(-0.4, 0, 0.04), rotation=(0, math.radians(90), 0), major_segments=48, minor_segments=8)
    t = bpy.context.active_object
    t.scale = (1, 1.1, 0.95)
    other(t, mat('band', hex2c('#3a4150'), 0.9, 0.35))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0.36, 0, 0.17), segments=32, ring_count=16)
    canopy = other(bpy.context.active_object, mat('canopy', hex2c('#0b1a33'), 0.0, 0.05))
    canopy.scale = (0.26, 0.15, 0.1)
    for sy in (-0.11, 0.11):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.075, depth=0.16, location=(-0.78, sy, 0.04), rotation=(0, math.radians(90), 0), vertices=24)
        other(bpy.context.active_object, mat('nozzle', hex2c('#2a3550'), 0.9, 0.35))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.055, location=MINI_BULB)
    other(bpy.context.active_object, bulb())
    for o in painted + others:
        if o.type == 'MESH':
            for p in o.data.polygons:
                p.use_smooth = True
    return painted, others


def build_mini(out):
    """The mini shuttle, rendered turning: frame k is headed k / MINI_FRAMES of a turn clockwise on the screen."""
    sc = scene()
    painted, others = shuttle(sc)
    rig = bpy.data.objects.new('rig', None)
    sc.collection.objects.link(rig)
    for o in painted + others:
        o.parent = rig
    stage(sc, MINI_ELEVATION, MINI_VIEW)
    paints = [o.data.materials[0] for o in painted]
    white = emissive('mask', (1, 1, 1, 1), 1.0)
    for k in range(MINI_FRAMES):
        # Clockwise on the screen, as the game's angles turn (y down).
        rig.rotation_euler = (0, 0, -k / MINI_FRAMES * 2 * math.pi)
        for o, m in zip(painted, paints):
            o.data.materials[0] = m
        for o in others:
            o.hide_render = False
        render(sc, f'{out}/pod-mini-{k:02d}.png', MINI_PX)
        # the mask: only the paint, white, over nothing
        for o in painted:
            o.data.materials[0] = white
        for o in others:
            o.hide_render = True
        render(sc, f'{out}/pod-mini-mask-{k:02d}.png', MINI_PX)


# ---------------------------------------------------------------- the UFO ----

def ufo(parts):
    """The spectators' UFO: a flat saucer in the team colour on a metal rim, a glass dome, a panel ring and eight rim lights."""
    sphere(0, 0, 0, 0.56, paint(), True, parts, (1, 1, 0.22))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.53, minor_radius=0.045, location=(0, 0, 0), major_segments=64, minor_segments=12)
    put(bpy.context.active_object, metal('#9aa0aa', 0.3), False, parts)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.36, minor_radius=0.014, location=(0, 0, 0.1), major_segments=64, minor_segments=8)
    put(bpy.context.active_object, metal('#3a4150'), False, parts)
    sphere(0, 0, 0.08, 0.24, mat('dome', hex2c('#9fd8ff'), 0.0, 0.05), False, parts, (1, 1, 0.85))
    for k in range(8):
        a = k / 8 * 2 * math.pi
        sphere(math.cos(a) * 0.5, math.sin(a) * 0.5, 0.05, 0.035, bulb(), False, parts)


def build_ufo(out):
    sc = scene()
    parts = []
    ufo(parts)
    smooth(parts)
    # Seen at 25 degrees above the horizon: a saucer from straight above is a circle.
    stage(sc, 25, FRAME)
    render(sc, f'{out}/pod-ufo.png', SIZE)
    white = emissive('mask', (1, 1, 1, 1), 1.0)
    for o, painted in parts:
        if painted:
            o.data.materials[0] = white
        else:
            o.hide_render = True
    render(sc, f'{out}/pod-ufo-mask.png', SIZE)


DESIGNS = {'mini': build_mini, 'ufo': build_ufo}


def main(out, only=None):
    for name, build in DESIGNS.items():
        if only is None or name in only:
            build(out)
            print('rendered pod', name)
