"""Render the solar storm's expanding front in Blender, then pack it with render_prominences.py.

    Blender --background --factory-startup --python scripts/forged/render_solar_plasma.py -- /tmp/solar-plasma
    python3 scripts/forged/render_prominences.py /tmp/solar-plasma

One orthographic still: a ring of hot gas with lobes and streamers, its (density, heat, ridge) in the red, green and
blue channels for the packer to colour. The prominences themselves are drawn in the game (`forged-sun.ts`).
"""
import sys
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path(sys.argv[sys.argv.index('--') + 1])
OUT.mkdir(parents=True, exist_ok=True)
sc = bpy.context.scene
for obj in list(sc.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.cycles.use_denoising = False
sc.cycles.max_bounces = 0
sc.cycles.transparent_max_bounces = 24
sc.render.threads_mode = 'FIXED'
sc.render.threads = 6
sc.render.film_transparent = False
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Raw'
sc.view_settings.look = 'None'
sc.world.use_nodes = True
bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (0, 0, 0, 1)
bg.inputs['Strength'].default_value = 0


def make_front_material():
    """Seamless 360-degree Coronal Mass Ejection shockwave with radial plasma streamers and broken blast arcs."""
    mat = bpy.data.materials.new('solar_cme_front')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0

    coord = nt.nodes.new('ShaderNodeTexCoord')
    obj = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Object'], obj.inputs[0])

    def math_op(operation, a, b=0.0):
        node = nt.nodes.new('ShaderNodeMath')
        node.operation = operation
        for idx, val in enumerate((a, b)):
            if isinstance(val, (int, float)):
                node.inputs[idx].default_value = val
            else:
                nt.links.new(val, node.inputs[idx])
        return node.outputs[0]

    r2 = math_op('ADD', math_op('MULTIPLY', obj.outputs['X'], obj.outputs['X']), math_op('MULTIPLY', obj.outputs['Y'], obj.outputs['Y']))
    r = math_op('SQRT', r2)
    inv_r = math_op('DIVIDE', 1.0, math_op('MAXIMUM', .05, r))
    streamer_vec = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(math_op('MULTIPLY', obj.outputs['X'], math_op('MULTIPLY', inv_r, 2.2)), streamer_vec.inputs['X'])
    nt.links.new(math_op('MULTIPLY', obj.outputs['Y'], math_op('MULTIPLY', inv_r, 2.2)), streamer_vec.inputs['Y'])
    nt.links.new(math_op('MULTIPLY', r, 1.35), streamer_vec.inputs['Z'])

    n_lobe = nt.nodes.new('ShaderNodeTexNoise')
    n_lobe.noise_dimensions = '3D'
    n_lobe.inputs['Scale'].default_value = 1.6
    n_lobe.inputs['Detail'].default_value = 3.0
    n_lobe.inputs['Roughness'].default_value = .58
    n_lobe.inputs['Distortion'].default_value = .45
    nt.links.new(coord.outputs['Object'], n_lobe.inputs['Vector'])

    n_ray = nt.nodes.new('ShaderNodeTexNoise')
    n_ray.noise_dimensions = '3D'
    n_ray.inputs['Scale'].default_value = 4.2
    n_ray.inputs['Detail'].default_value = 5.0
    n_ray.inputs['Roughness'].default_value = .68
    n_ray.inputs['Distortion'].default_value = .65
    nt.links.new(streamer_vec.outputs['Vector'], n_ray.inputs['Vector'])

    r_shock = math_op('ADD', .81, math_op('ADD', math_op('MULTIPLY', math_op('SUBTRACT', n_lobe.outputs['Fac'], .5), .16), math_op('MULTIPLY', math_op('SUBTRACT', n_ray.outputs['Fac'], .5), .06)))
    dr = math_op('SUBTRACT', r, r_shock)

    inner_wake = math_op('EXPONENT', math_op('MULTIPLY', -58.0, math_op('POWER', math_op('MINIMUM', 0.0, dr), 2.0)))
    outer_rim = math_op('EXPONENT', math_op('MULTIPLY', -220.0, math_op('POWER', math_op('MAXIMUM', 0.0, dr), 2.0)))
    shell = math_op('SUBTRACT', math_op('ADD', inner_wake, outer_rim), 1.0)

    in_fade = math_op('MINIMUM', 1.0, math_op('MAXIMUM', 0.0, math_op('MULTIPLY', math_op('SUBTRACT', r, .52), 4.5)))
    out_fade = math_op('MINIMUM', 1.0, math_op('MAXIMUM', 0.0, math_op('MULTIPLY', math_op('SUBTRACT', 1.14, r), 4.5)))
    env = math_op('MULTIPLY', shell, math_op('MULTIPLY', in_fade, out_fade))

    lobe_mask = math_op('POWER', math_op('MAXIMUM', 0.0, math_op('SUBTRACT', n_lobe.outputs['Fac'], .18)), 1.35)
    rays = math_op('POWER', n_ray.outputs['Fac'], 1.75)
    filaments = math_op('MULTIPLY', lobe_mask, math_op('ADD', .18, math_op('MULTIPLY', 1.35, rays)))
    shock_crest = math_op('MULTIPLY', lobe_mask, math_op('EXPONENT', math_op('MULTIPLY', -320.0, math_op('POWER', dr, 2.0))))

    density = math_op('MINIMUM', 1.0, math_op('MULTIPLY', env, filaments))
    heat = math_op('MINIMUM', 1.0, math_op('MULTIPLY', env, math_op('ADD', math_op('MULTIPLY', shock_crest, 1.35), math_op('MULTIPLY', rays, .75))))
    ridge = math_op('MINIMUM', 1.0, math_op('MULTIPLY', env, math_op('POWER', n_ray.outputs['Fac'], 2.0)))

    rgb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(density, rgb.inputs['X'])
    nt.links.new(heat, rgb.inputs['Y'])
    nt.links.new(ridge, rgb.inputs['Z'])
    nt.links.new(rgb.outputs['Vector'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return mat


front_mat = make_front_material()

camera_data = bpy.data.cameras.new('orthographic bake')
camera_data.type = 'ORTHO'
camera = bpy.data.objects.new('orthographic bake', camera_data)
sc.collection.objects.link(camera)
sc.camera = camera


def camera_at(loc, target, scale, size):
    camera.location = loc
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.ortho_scale = scale
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100


def render(name):
    sc.render.filepath = str(OUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)


camera_at((0, 0, 6), (0, 0, 0), 2.5, (384, 384))
mesh = bpy.data.meshes.new('cme_halo_disc')
verts = [(-1.3, -1.3, 0), (1.3, -1.3, 0), (1.3, 1.3, 0), (-1.3, 1.3, 0)]
mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
mesh.update()
disc = bpy.data.objects.new('cme_halo_disc', mesh)
sc.collection.objects.link(disc)
disc.data.materials.append(front_mat)
render('front')
