"""
Renders the images of the forged look: the ship and its team-colour mask, the defense turret (body, mask, barrel), the pickup coin, the black hole, and the
albedo maps of the three planet styles. Run it inside Blender 4.2+ (e.g. through the Blender MCP server):

    exec(open('scripts/forged/render_assets.py').read()); main('/abs/path/to/out', only=None)

`only` is a list of 'ship', 'turret', 'coin', 'hole', 'rock', 'gas', 'ice' (None renders all). It works in a scene of its own,
`slingshot_forged`, and leaves the open file's other scenes alone. `scripts/forged/pack.py` turns the PNGs it writes
into the WebP files the game loads from `src/render/forged/`.
"""
import math

import bmesh
import bpy
from mathutils import Vector

TAU = math.tau


def hex2c(h, a=1.0):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (a,)


def scene():
    sc = bpy.data.scenes.get('slingshot_forged') or bpy.data.scenes.new('slingshot_forged')
    bpy.context.window.scene = sc
    for o in list(sc.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    sc.render.engine = 'BLENDER_EEVEE'
    sc.view_settings.view_transform = 'Standard'
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    w = bpy.data.worlds.get('forged_world') or bpy.data.worlds.new('forged_world')
    w.use_nodes = True
    sc.world = w
    return sc


def world(sc, color, strength):
    bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = hex2c(color)
    bg.inputs['Strength'].default_value = strength


def look_at(o, target=(0, 0, 0)):
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()


def camera(sc, loc, ortho, target=None):
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = ortho
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    co.location = loc
    if target is None:
        co.rotation_euler = (0, 0, 0)
    else:
        look_at(co, target)
    sc.camera = co


def light(sc, name, loc, energy, color, size=4):
    l = bpy.data.lights.new(name, 'AREA')
    l.energy = energy
    l.color = color[:3]
    l.size = size
    o = bpy.data.objects.new(name, l)
    sc.collection.objects.link(o)
    o.location = loc
    look_at(o)


def mat(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = color
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = emit
        b.inputs['Emission Strength'].default_value = strength
    return m


def emissive(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = color
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def render(sc, path, size_x, size_y=None):
    sc.render.resolution_x = size_x
    sc.render.resolution_y = size_y or size_x
    sc.render.resolution_percentage = 100
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------- ship ----

HULL = [(15, 0), (-2, -5), (-11, -11), (-7, -3.5), (-11, 0), (-7, 3.5), (-11, 11), (-2, 5)]
S = 0.1


def ship_objects(sc):
    """The ship in world units (1 unit = 10 field units), nose along +x. Returns (hull, others)."""
    me = bpy.data.meshes.new('hull')
    bm = bmesh.new()
    per = [bm.verts.new((x * S, y * S, 0)) for x, y in HULL]
    bot = [bm.verts.new((x * S, y * S, -0.16)) for x, y in HULL]
    nose = bm.verts.new((1.45, 0, 0.12))
    peak = bm.verts.new((-0.15, 0, 0.42))
    tail = bm.verts.new((-0.95, 0, 0.2))

    def face(*v):
        try:
            bm.faces.new(v)
        except ValueError:
            pass

    face(nose, per[1], peak)
    face(nose, peak, per[7])
    face(peak, per[1], per[2], per[3], tail)
    face(peak, tail, per[5], per[6], per[7])
    face(tail, per[3], per[4], per[5])
    for i in range(len(HULL)):
        j = (i + 1) % len(HULL)
        face(per[i], bot[i], bot[j], per[j])
    face(*reversed(bot))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    hull = bpy.data.objects.new('hull', me)
    sc.collection.objects.link(hull)
    bev = hull.modifiers.new('bevel', 'BEVEL')
    bev.width = 0.025
    bev.segments = 2
    bev.limit_method = 'ANGLE'
    # near-white paint: the team colour is multiplied over it, so the lighting stays
    hull.data.materials.append(mat('hull_paint', (0.8, 0.8, 0.82, 1), 0.15, 0.45))
    others = []

    def add(obj):
        others.append(obj)
        return obj

    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0.28, 0, 0.38), segments=24, ring_count=12)
    c = add(bpy.context.active_object)
    c.scale = (0.32, 0.17, 0.12)
    c.data.materials.append(mat('canopy', hex2c('#0b1a33'), 0.0, 0.05))
    for sy in (-0.2, 0.2):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.09, depth=0.28, location=(-1.0, sy, 0.1), rotation=(0, math.radians(90), 0))
        add(bpy.context.active_object).data.materials.append(mat('nozzle', hex2c('#2a3550'), 0.9, 0.35))
    for sy in (-1.1, 1.1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.045, location=(-1.05, sy, 0.03))
        add(bpy.context.active_object).data.materials.append(mat('tip', hex2c('#e8e4d8'), 0, 0.3, hex2c('#e8e4d8'), 6))
    for sy in (-1, 1):
        me2 = bpy.data.meshes.new('intake')
        b2 = bmesh.new()
        pts = [(-0.05, sy * 0.12), (-0.75, sy * 0.62), (-0.55, sy * 0.2), (-0.2, sy * 0.1)]
        zs = [0.40, 0.17, 0.30, 0.43]
        vs = [b2.verts.new((x, y, z)) for (x, y), z in zip(pts, zs)]
        try:
            b2.faces.new(vs[::-1] if sy > 0 else vs)
        except ValueError:
            pass
        b2.to_mesh(me2)
        b2.free()
        ob = bpy.data.objects.new('intake', me2)
        sc.collection.objects.link(ob)
        ob.modifiers.new('s', 'SOLIDIFY').thickness = 0.02
        me2.materials.append(mat('intake', (0.04, 0.07, 0.14, 1), 0.6, 0.25))
        others.append(ob)
    return hull, others


def build_ship(out):
    sc = scene()
    hull, others = ship_objects(sc)
    camera(sc, (-0.15, 0, 8), 3.2)
    light(sc, 'key', (-3, 3.5, 5), 480, hex2c('#fff1d6'), 4)
    light(sc, 'rim', (3, -3, 3), 200, hex2c('#ffffff'), 3)
    world(sc, '#808a99', 0.3)
    try:
        sc.eevee.use_raytracing = True
    except Exception:
        pass
    render(sc, out + '/ship.png', 256)
    # the mask: only the paint, white, over nothing
    for o in others:
        o.hide_render = True
    hull.data.materials[0] = emissive('mask', (1, 1, 1, 1), 1.0)
    hull.modifiers['bevel'].width = 0.025
    render(sc, out + '/ship-mask.png', 256)


# ---------------------------------------------------------------- coin ----

def build_coin(out):
    sc = scene()
    bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=0.22, vertices=96)
    coin = bpy.context.active_object
    bev = coin.modifiers.new('b', 'BEVEL')
    bev.width = 0.06
    bev.segments = 4
    coin.data.materials.append(mat('coin', hex2c('#16294d'), 0.85, 0.3))
    # a shallow groove where the glowing ring will sit
    bpy.ops.mesh.primitive_torus_add(major_radius=0.82, minor_radius=0.05, location=(0, 0, 0.1))
    groove = bpy.context.active_object
    groove.data.materials.append(mat('groove', hex2c('#050b16'), 0.3, 0.6))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.7, depth=0.04, vertices=96, location=(0, 0, 0.12))
    inlay = bpy.context.active_object
    inlay.data.materials.append(mat('inlay', hex2c('#0b1a33'), 0.7, 0.2))
    camera(sc, (0, 0, 8), 2.3)
    light(sc, 'key', (-3, 3, 5), 450, hex2c('#fff1d6'), 4)
    light(sc, 'rim', (3, -3, 3), 220, hex2c('#62b6ff'), 3)
    world(sc, '#25406b', 0.4)
    render(sc, out + '/coin.png', 128)


# ----------------------------------------------------------- black hole ----

def ramp_node(nt, stops):
    n = nt.nodes.new('ShaderNodeValToRGB')
    cr = n.color_ramp
    while len(cr.elements) > 1:
        cr.elements.remove(cr.elements[-1])
    cr.elements[0].position = stops[0][0]
    cr.elements[0].color = hex2c(stops[0][1])
    for p, c in stops[1:]:
        cr.elements.new(p).color = hex2c(c)
    return n


def math_node(nt, op, a=None, b=None, c=None):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n


def annulus(sc, name, radius, r_in, r_out, stops, strength, rot=(0, 0, 0), loc=(0, 0, 0), doppler=True, top_only=False):
    bpy.ops.mesh.primitive_circle_add(vertices=128, radius=radius, fill_type='NGON', location=loc, rotation=rot)
    o = bpy.context.active_object
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    mix = nt.nodes.new('ShaderNodeMixShader')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vl = nt.nodes.new('ShaderNodeVectorMath')
    vl.operation = 'LENGTH'
    nt.links.new(tc.outputs['Object'], vl.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = r_in
    mr.inputs['From Max'].default_value = r_out
    mr.clamp = True
    nt.links.new(vl.outputs['Value'], mr.inputs['Value'])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 1.6
    nz.inputs['Detail'].default_value = 4
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    streak = math_node(nt, 'MULTIPLY_ADD', nz.outputs['Fac'], 0.7, 0.65)
    rr = vl.outputs['Value']
    lo = nt.nodes.new('ShaderNodeMapRange')
    lo.inputs['From Min'].default_value = r_in
    lo.inputs['From Max'].default_value = r_in + (r_out - r_in) * 0.12
    lo.clamp = True
    nt.links.new(rr, lo.inputs['Value'])
    hi = nt.nodes.new('ShaderNodeMapRange')
    hi.inputs['From Min'].default_value = r_out
    hi.inputs['From Max'].default_value = r_in + (r_out - r_in) * 0.4
    hi.clamp = True
    nt.links.new(rr, hi.inputs['Value'])
    a = math_node(nt, 'MULTIPLY', lo.outputs['Result'], hi.outputs['Result'])
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    if doppler:
        dn = math_node(nt, 'DIVIDE', sep.outputs['X'], math_node(nt, 'MAXIMUM', rr, 0.001).outputs[0])
        bright = math_node(nt, 'MULTIPLY_ADD', dn.outputs[0], -0.45, 1.0)
    else:
        bright = math_node(nt, 'ADD', 1.0, 0.0)
    if top_only:
        dn2 = math_node(nt, 'DIVIDE', sep.outputs['Y'], math_node(nt, 'MAXIMUM', rr, 0.001).outputs[0])
        bright = math_node(nt, 'MULTIPLY', bright.outputs[0], math_node(nt, 'MULTIPLY_ADD', dn2.outputs[0], 0.5, 0.55).outputs[0])
    col = ramp_node(nt, stops)
    nt.links.new(mr.outputs['Result'], col.inputs['Fac'])
    nt.links.new(col.outputs['Color'], em.inputs['Color'])
    st = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', bright.outputs[0], streak.outputs[0]).outputs[0], strength)
    nt.links.new(st.outputs[0], em.inputs['Strength'])
    nt.links.new(a.outputs[0], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    try:
        m.surface_render_method = 'BLENDED'
    except Exception:
        pass
    o.data.materials.append(m)
    return o


def build_hole(out):
    sc = scene()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=64, ring_count=32)
    bpy.context.active_object.data.materials.append(emissive('horizon', (0, 0, 0, 1), 0.0))
    annulus(sc, 'disk', 3.6, 1.3, 3.6, [(0.0, '#ffe9b8'), (0.25, '#ffa940'), (0.6, '#e8501a'), (1.0, '#5a0f06')], 2.6)
    annulus(sc, 'lensed', 1.9, 1.0, 1.9, [(0.0, '#ffe9b8'), (0.3, '#ffa940'), (1.0, '#e8501a')], 2.4, rot=(math.radians(90), 0, 0), loc=(0, 0.6, 0), top_only=True)
    annulus(sc, 'photon', 1.05, 1.0, 1.05, [(0.0, '#ffffff'), (1.0, '#fff0c8')], 5.0, rot=(math.radians(90), 0, 0), loc=(0, -0.2, 0), doppler=False)
    camera(sc, (0, -8, 2.3), 8.2, target=(0, 0, 0))
    world(sc, '#000000', 0.0)
    render(sc, out + '/hole.png', 512)


# -------------------------------------------------------- planet albedo ----

def sphere_vector(nt):
    """Nodes turning the plane's UV into a point on the unit sphere (an equirectangular map)."""
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs['Vector'])
    lon = math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', sep.outputs['X'], 0.5).outputs[0], TAU)
    lat = math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', sep.outputs['Y'], 0.5).outputs[0], math.pi)
    cl = math_node(nt, 'COSINE', lat.outputs[0])
    x = math_node(nt, 'MULTIPLY', cl.outputs[0], math_node(nt, 'COSINE', lon.outputs[0]).outputs[0])
    y = math_node(nt, 'MULTIPLY', cl.outputs[0], math_node(nt, 'SINE', lon.outputs[0]).outputs[0])
    z = math_node(nt, 'SINE', lat.outputs[0])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(x.outputs[0], comb.inputs[0])
    nt.links.new(y.outputs[0], comb.inputs[1])
    nt.links.new(z.outputs[0], comb.inputs[2])
    return comb.outputs[0], sep, lat


def build_albedo(out, kind):
    sc = scene()
    sc.render.film_transparent = False
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.active_object
    plane.scale = (2, 1, 1)
    m = bpy.data.materials.new('albedo_' + kind)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    outn = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    vec, sep, lat = sphere_vector(nt)
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Detail'].default_value = 12
    noise.inputs['Roughness'].default_value = 0.6
    nt.links.new(vec, noise.inputs['Vector'])
    if kind == 'gas':
        noise.inputs['Scale'].default_value = 1.8
        base = math_node(nt, 'MULTIPLY', math_node(nt, 'SINE', lat.outputs[0]).outputs[0], 12.0)
        warp = math_node(nt, 'MULTIPLY_ADD', noise.outputs['Fac'], 2.6, base.outputs[0])
        s = math_node(nt, 'SINE', warp.outputs[0])
        h = math_node(nt, 'MULTIPLY_ADD', s.outputs[0], 0.5, 0.5)
        color = ramp_node(nt, [(0.0, '#3a1c16'), (0.22, '#a5623a'), (0.45, '#e0b27a'), (0.7, '#f3e0b8'), (0.88, '#c98a58'), (1.0, '#fff4dc')])
        nt.links.new(h.outputs[0], color.inputs['Fac'])
        col_out = color.outputs['Color']
    elif kind == 'ice':
        noise.inputs['Scale'].default_value = 2.4
        vor = nt.nodes.new('ShaderNodeTexVoronoi')
        vor.feature = 'DISTANCE_TO_EDGE'
        vor.inputs['Scale'].default_value = 2.6
        nt.links.new(vec, vor.inputs['Vector'])
        crack = math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', math_node(nt, 'SMOOTH_MIN', vor.outputs['Distance'], 0.05, 0.03).outputs[0], 12.0).outputs[0])
        shade = ramp_node(nt, [(0.0, '#9fc4e8'), (0.5, '#d6ecfa'), (1.0, '#f4fbff')])
        nt.links.new(math_node(nt, 'MULTIPLY_ADD', math_node(nt, 'SUBTRACT', noise.outputs['Fac'], 0.5).outputs[0], 2.2, 0.5).outputs[0], shade.inputs['Fac'])
        mixc = nt.nodes.new('ShaderNodeMix')
        mixc.data_type = 'RGBA'
        mixc.blend_type = 'MULTIPLY'
        nt.links.new(shade.outputs['Color'], mixc.inputs['A'])
        dark = nt.nodes.new('ShaderNodeCombineXYZ')
        crack_c = math_node(nt, 'MULTIPLY_ADD', math_node(nt, 'MAXIMUM', crack.outputs[0], 0.0).outputs[0], -0.3, 1.0)
        for i in range(3):
            nt.links.new(crack_c.outputs[0], dark.inputs[i])
        mixc.inputs['Factor'].default_value = 1.0
        nt.links.new(dark.outputs[0], mixc.inputs['B'])
        col_out = mixc.outputs['Result']
    else:
        noise.inputs['Scale'].default_value = 2.6
        height = math_node(nt, 'MULTIPLY_ADD', math_node(nt, 'SUBTRACT', noise.outputs['Fac'], 0.5).outputs[0], 2.6, 0.5)
        terrain = ramp_node(nt, [(0.0, '#3a1f2b'), (0.3, '#8e3f35'), (0.55, '#d98b55'), (0.8, '#f2c88a'), (1.0, '#fff1d0')])
        nt.links.new(height.outputs[0], terrain.inputs['Fac'])
        vor = nt.nodes.new('ShaderNodeTexVoronoi')
        vor.feature = 'F1'
        vor.inputs['Scale'].default_value = 5.0
        nt.links.new(vec, vor.inputs['Vector'])
        pit = math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', math_node(nt, 'MINIMUM', vor.outputs['Distance'], 0.4).outputs[0], 2.5).outputs[0])
        pit2 = math_node(nt, 'MULTIPLY', pit.outputs[0], pit.outputs[0])
        crater = math_node(nt, 'MULTIPLY_ADD', math_node(nt, 'MAXIMUM', pit2.outputs[0], 0.0).outputs[0], -0.55, 1.0)
        mixc = nt.nodes.new('ShaderNodeMix')
        mixc.data_type = 'RGBA'
        mixc.blend_type = 'MULTIPLY'
        mixc.inputs['Factor'].default_value = 1.0
        nt.links.new(terrain.outputs['Color'], mixc.inputs['A'])
        dark = nt.nodes.new('ShaderNodeCombineXYZ')
        for i in range(3):
            nt.links.new(crater.outputs[0], dark.inputs[i])
        nt.links.new(dark.outputs[0], mixc.inputs['B'])
        col_out = mixc.outputs['Result']
    nt.links.new(col_out, em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs[0], outn.inputs['Surface'])
    plane.data.materials.append(m)
    camera(sc, (0, 0, 5), 2.0)
    world(sc, '#000000', 0.0)
    render(sc, out + '/tex-%s.png' % kind, 1024, 512)


# -------------------------------------------------------------- turret ----

def box(loc, dims, material, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = dims
    o.data.materials.append(material)
    if bevel:
        bevelled(o, bevel)
    return o


def bevelled(o, width, segments=3):
    # the scale is applied first, so the bevel is the same width on every side
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    return o


def cylinder_x(x, z, radius, length, material, y=0.0, vertices=48):
    """A cylinder lying along +x, centred at x."""
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=length, vertices=vertices, location=(x, y, z), rotation=(0, math.radians(90), 0))
    o = bpy.context.active_object
    o.data.materials.append(material)
    return o


def hexagon(x, z, radius, height, material, bevel=0.02):
    """A hexagonal slab with a flat side towards +x and -x (Blender puts the first corner of a six-sided cylinder on +y)."""
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=height, vertices=6, location=(x, 0, z))
    o = bpy.context.active_object
    o.data.materials.append(material)
    return bevelled(o, bevel, 2)


def turret_lighting(sc):
    camera(sc, (0, 0, 8), 3.2)
    light(sc, 'key', (-3, 3.5, 5), 520, hex2c('#fff1d6'), 4)
    light(sc, 'rim', (3, -3, 3), 220, hex2c('#ffffff'), 3)
    world(sc, '#808a99', 0.35)
    try:
        sc.eevee.use_raytracing = True
    except Exception:
        pass


PAINT = (0.8, 0.8, 0.82, 1)
STEEL = (0.3, 0.34, 0.4, 1)
HEAD_X = 0.55


def build_turret(out):
    """The turret's body: a hexagonal emplacement (it echoes the hexagon skin of the defense's area) with the race the
    mount turns in. The surface point is the origin, the planet lies towards -x, the mount's pivot is at x = 0.55. The
    paint is near-white: the team colour is multiplied over it."""
    sc = scene()
    paint = mat('turret_paint', PAINT, 0.15, 0.45)
    steel = mat('turret_steel', STEEL, 0.9, 0.32)
    dark = mat('turret_dark', hex2c('#04080f'), 0.3, 0.6)
    beacon = emissive('turret_beacon', (1, 0.95, 0.85, 1), 9.0)
    painted, others = [], []

    # two tiers of armour, the upper one inside the lower
    painted.append(hexagon(HEAD_X, 0.07, 0.92, 0.14, paint, 0.035))
    painted.append(hexagon(HEAD_X, 0.19, 0.72, 0.1, paint, 0.03))
    # a steel band between them, and the race the mount turns in
    others.append(hexagon(HEAD_X, 0.155, 0.75, 0.03, steel, 0.01))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=0.07, vertices=64, location=(HEAD_X, 0, 0.27))
    race = bpy.context.active_object
    race.data.materials.append(steel)
    others.append(race)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.44, minor_radius=0.018, location=(HEAD_X, 0, 0.31), major_segments=64)
    groove = bpy.context.active_object
    groove.data.materials.append(dark)
    others.append(groove)
    # teeth round the race
    for k in range(24):
        a = k / 24 * TAU
        others.append(box((HEAD_X + math.cos(a) * 0.5, math.sin(a) * 0.5, 0.27), (0.05, 0.025, 0.07), dark, rot=(0, 0, a)))

    # a beacon on every corner of the lower tier, and bolts between them
    for k in range(6):
        a = math.radians(30 + 60 * k)
        px, py = HEAD_X + math.cos(a) * 0.84, math.sin(a) * 0.84
        bpy.ops.mesh.primitive_cylinder_add(radius=0.065, depth=0.07, vertices=20, location=(px, py, 0.17))
        post = bpy.context.active_object
        post.data.materials.append(steel)
        others.append(post)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.034, location=(px, py, 0.22), segments=16, ring_count=8)
        lamp = bpy.context.active_object
        lamp.data.materials.append(beacon)
        others.append(lamp)
        b = a + math.radians(30)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.025, vertices=12, location=(HEAD_X + math.cos(b) * 0.66, math.sin(b) * 0.66, 0.15))
        bolt = bpy.context.active_object
        bolt.data.materials.append(steel)
        others.append(bolt)

    # vents on the upper tier, on the side towards the planet
    for y in (-0.28, 0, 0.28):
        others.append(box((HEAD_X - 0.52, y, 0.245), (0.16, 0.07, 0.012), dark))
    # braces that tie the plinth to the ground
    for sy in (-1, 1):
        others.append(box((HEAD_X - 0.95, sy * 0.52, 0.06), (0.4, 0.2, 0.12), steel, rot=(0, 0, sy * math.radians(-18)), bevel=0.03))

    turret_lighting(sc)
    render(sc, out + '/turret-base.png', 384)
    for o in sc.objects:
        if o.type == 'MESH' and o not in painted:
            o.hide_render = True
    em = emissive('mask', (1, 1, 1, 1), 1.0)
    for o in painted:
        o.data.materials[0] = em
    render(sc, out + '/turret-mask.png', 384)


def build_barrel(out):
    """The mount and its twin barrels, pointing along +x with the pivot at the origin (the middle of the race)."""
    sc = scene()
    paint = mat('mount_paint', PAINT, 0.15, 0.45)
    steel = mat('mount_steel', STEEL, 0.9, 0.32)
    bright = mat('mount_bright', (0.72, 0.76, 0.82, 1), 0.9, 0.25)
    dark = mat('mount_dark', hex2c('#04080f'), 0.3, 0.6)
    z = 0.36
    painted = []
    # the mount: a rounded housing with a raised hub on top, cheeks at its sides
    painted.append(box((0.02, 0, z - 0.04), (0.74, 0.7, 0.2), paint, bevel=0.07))
    hub = cylinder_x(0.02, z + 0.1, 0.22, 0.1, steel, vertices=40)
    hub.rotation_euler = (0, 0, 0)
    painted.append(box((0.5, 0, z + 0.0), (0.55, 0.46, 0.15), paint, bevel=0.05))
    for sy in (-1, 1):
        box((-0.12, sy * 0.4, z - 0.02), (0.36, 0.1, 0.16), steel, bevel=0.03)
    # a sensor pod on one cheek
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.07, location=(0.12, -0.42, z + 0.04), segments=24, ring_count=12)
    bpy.context.active_object.data.materials.append(dark)
    # the twin barrels, their muzzle brakes and bores
    for sy in (-1, 1):
        cylinder_x(0.78, z + 0.01, 0.07, 0.95, steel, y=sy * 0.13, vertices=32)
        cylinder_x(1.12, z + 0.01, 0.1, 0.2, bright, y=sy * 0.13, vertices=32)
        cylinder_x(1.215, z + 0.01, 0.05, 0.02, dark, y=sy * 0.13, vertices=24)
        for x in (1.06, 1.17):
            box((x, sy * 0.13, z + 0.1), (0.03, 0.2, 0.025), dark)
    box((1.0, 0, z + 0.01), (0.5, 0.06, 0.1), steel)
    # the cover over the breech, a seam down the middle
    box((0.5, 0, z + 0.08), (0.5, 0.022, 0.01), dark)

    turret_lighting(sc)
    render(sc, out + '/turret-barrel.png', 384)
    for o in sc.objects:
        if o.type == 'MESH' and o not in painted:
            o.hide_render = True
    em = emissive('mask', (1, 1, 1, 1), 1.0)
    for o in painted:
        o.data.materials[0] = em
    render(sc, out + '/turret-barrel-mask.png', 384)


BUILDERS = {
    'turret': lambda out: (build_turret(out), build_barrel(out)),
    'ship': build_ship,
    'coin': build_coin,
    'hole': build_hole,
    'rock': lambda out: build_albedo(out, 'rock'),
    'gas': lambda out: build_albedo(out, 'gas'),
    'ice': lambda out: build_albedo(out, 'ice'),
}


def main(out, only=None):
    for name, build in BUILDERS.items():
        if only is None or name in only:
            build(out)
            print('rendered', name)
