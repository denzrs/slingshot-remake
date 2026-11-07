"""
The crack map of the forged look: where an unstable planet's crust breaks, as an equirectangular map in the same frame as the
planet maps (`render_planets.py`), painted by Voronoi on a point of the unit sphere so it has no seam. It holds data, not colour:

- red: how far from a great fissure (0 on the fissure, 1 well inside a plate). The fissures are fractal Voronoi edges, so the
  big plates break up into smaller ones along their own edges.
- green: the same for the fine cracks that branch between them.
- blue: slow noise, the order the crust gives way in: the shader opens a crack where this lies under how far the damage has got.

The shader in `src/render/looks/forged-planet-gl.ts` reads it. Run it in the background:

    blender -b --python scripts/forged/render_cracks.py -- /abs/path/to/out

It writes `tex-cracks.png` (1024 × 512); `scripts/forged/pack.py` turns it into the WebP file the game loads.
"""
import importlib.util
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('render_planets', HERE / 'render_planets.py')
rp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rp)
ra = rp.ra


def warped(k, vec, scale, amount, detail=3):
    """The sphere point pushed about by noise, so straight Voronoi edges come out jagged (but not so finely that a small planet shows them as dots)."""
    n = k.nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = 0.6
    k.nt.links.new(vec, n.inputs['Vector'])
    centred = k.nt.nodes.new('ShaderNodeVectorMath')
    centred.operation = 'MULTIPLY_ADD'
    k.nt.links.new(n.outputs['Color'], centred.inputs[0])
    centred.inputs[1].default_value = (amount, amount, amount)
    centred.inputs[2].default_value = (-amount / 2, -amount / 2, -amount / 2)
    out = k.nt.nodes.new('ShaderNodeVectorMath')
    out.operation = 'ADD'
    k.nt.links.new(vec, out.inputs[0])
    k.nt.links.new(centred.outputs[0], out.inputs[1])
    return out.outputs[0]


def edges(k, vec, scale, detail, randomness, stretch):
    """Distance to the nearest Voronoi edge, scaled so 1 is well inside a cell."""
    v = k.nt.nodes.new('ShaderNodeTexVoronoi')
    v.feature = 'DISTANCE_TO_EDGE'
    v.inputs['Scale'].default_value = scale
    v.inputs['Detail'].default_value = detail
    v.inputs['Roughness'].default_value = 0.55
    v.inputs['Lacunarity'].default_value = 2.2
    v.inputs['Randomness'].default_value = randomness
    k.nt.links.new(vec, v.inputs['Vector'])
    return k.m('MINIMUM', k.m('MULTIPLY', v.outputs['Distance'], stretch), 1.0)


def build(out):
    sc = ra.scene()
    sc.render.film_transparent = False
    # Data, not colour: written as it is, without a view transform's curve.
    for transform in ('Raw', 'Standard'):
        try:
            sc.view_settings.view_transform = transform
            break
        except TypeError:
            continue
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0
    sc.view_settings.gamma = 1
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.active_object
    plane.scale = (2, 1, 1)
    if plane.name not in sc.collection.objects:
        sc.collection.objects.link(plane)
    k = rp.Kit()
    k.mat.name = 'cracks'

    great = edges(k, warped(k, k.vec, 2.2, 0.3), 2.6, 0.6, 0.95, 4.0)
    fine = edges(k, warped(k, k.vec, 5.0, 0.2), 6.5, 0.0, 1.0, 5.0)
    order = k.noise(1.4, detail=4, rough=0.5)

    comb = k.nt.nodes.new('ShaderNodeCombineColor')
    for i, value in enumerate((great, fine, order)):
        k.nt.links.new(value, comb.inputs[i])
    em = k.nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    k.nt.links.new(comb.outputs[0], em.inputs['Color'])
    out_node = k.nt.nodes.new('ShaderNodeOutputMaterial')
    k.nt.links.new(em.outputs[0], out_node.inputs['Surface'])
    plane.data.materials.append(k.mat)
    ra.camera(sc, (0, 0, 5), 2.0)
    ra.world(sc, '#000000', 0.0)
    ra.render(sc, '%s/tex-cracks.png' % out, 1024, 512)
    bpy.data.objects.remove(plane, do_unlink=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    build(args[0])
    print('rendered cracks', flush=True)
