"""Colour Blender's storm front into the game's texture.

    Blender --background --factory-startup --python scripts/forged/render_solar_plasma.py -- /tmp/solar-plasma
    python3 scripts/forged/render_prominences.py /tmp/solar-plasma

Requires Pillow. Writes sun-front.webp.
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageFilter

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp')
OUT = Path(__file__).resolve().parents[2] / 'src/render/looks/forged'

# (deep H-alpha crimson -> fiery orange -> brilliant solar gold -> incandescent white-gold)
RAMP = (
    (.00, (120, 14, 6)),
    (.22, (232, 54, 10)),
    (.48, (255, 158, 28)),
    (.72, (255, 232, 128)),
    (1.00, (255, 254, 242)),
)


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def sample_ramp(ramp, t):
    x = max(0.0, min(1.0, t))
    for i in range(1, len(ramp)):
        t1, c1 = ramp[i]
        if x <= t1:
            t0, c0 = ramp[i - 1]
            k = (x - t0) / max(1e-6, t1 - t0)
            return (
                c0[0] + (c1[0] - c0[0]) * k,
                c0[1] + (c1[1] - c0[1]) * k,
                c0[2] + (c1[2] - c0[2]) * k,
            )
    return ramp[-1][1]


def glowing(core_img, halo_source, tight_r=1.8, wide_r=5.5, tight_w=.22, wide_w=.18):
    """Combine crisp filamentary plasma strands with a soft chromospheric halo without washing out loop separation."""
    body = core_img.convert('RGBa')
    halo = halo_source.convert('RGBa')
    tight = halo.filter(ImageFilter.GaussianBlur(tight_r))
    wide = halo.filter(ImageFilter.GaussianBlur(wide_r))
    pixels = []
    for p, b1, b2 in zip(body.getdata(), tight.getdata(), wide.getdata()):
        # Halo fills in around and softly behind the filaments, while crisp strands dominate where p is dense
        halo_a = b1[3] * tight_w + b2[3] * wide_w
        alpha = min(255.0, p[3] + halo_a * (1.0 - p[3] / 255.0 * .55))
        if alpha < .5:
            pixels.append((0, 0, 0, 0))
            continue
        rgb = tuple(
            min(255, round((p[i] + (b1[i] * tight_w + b2[i] * wide_w) * (1.0 - p[3] / 255.0 * .35)) / alpha * 255.0))
            for i in range(3)
        )
        pixels.append((*rgb, round(alpha)))
    result = Image.new('RGBA', core_img.size)
    result.putdata(pixels)
    return result


def colorize_front(raw_img):
    """Map the CME blast halo into a glowing shockwave ring with white-gold crest and fiery trailing wake."""
    ramp = RAMP
    w, h = raw_img.size
    src = list(raw_img.getdata())
    peak_r = max([80] + [p[0] for p in src]) / 255.0
    peak_g = max([55] + [p[1] for p in src]) / 255.0
    peak_b = max([45] + [p[2] for p in src]) / 255.0

    core_out = Image.new('RGBA', (w, h))
    halo_out = Image.new('RGBA', (w, h))
    core_pixels = []
    halo_pixels = []

    for idx, px in enumerate(src):
        r, g, b = px[:3]
        if r == 0 and g == 0 and b == 0:
            core_pixels.append((0, 0, 0, 0))
            halo_pixels.append((0, 0, 0, 0))
            continue
        ux = (idx % w + .5) / w * 2.0 - 1.0
        uy = (idx // w + .5) / h * 2.0 - 1.0
        rad = math.hypot(ux, uy)
        edge_env = smoothstep(.98, .85, rad) * smoothstep(.34, .48, rad)
        d_norm = min(1.3, (r / 255.0) / peak_r) * edge_env
        if d_norm <= .003:
            core_pixels.append((0, 0, 0, 0))
            halo_pixels.append((0, 0, 0, 0))
            continue
        h_norm = min(1.3, (g / 255.0) / peak_g)
        b_norm = min(1.3, (b / 255.0) / peak_b)
        density = 1.0 - math.exp(-d_norm * 2.0)
        temp = min(1.0, .32 * density + .50 * h_norm + .24 * b_norm)
        cr, cg, cb = sample_ramp(ramp, temp)
        alpha = min(1.0, (density ** .92) * 1.10)
        core_pixels.append((round(cr), round(cg), round(cb), round(alpha * 255.0)))

        hr, hg, hb = sample_ramp(ramp, min(.45, temp * .5))
        halo_pixels.append((round(hr), round(hg), round(hb), round(min(1.0, density ** .75) * 255.0)))

    core_out.putdata(core_pixels)
    halo_out.putdata(halo_pixels)
    return glowing(core_out, halo_out, tight_r=2.5, wide_r=8.0, tight_w=.28, wide_w=.22)


if __name__ == '__main__':
    front = colorize_front(Image.open(SRC / 'front.png').convert('RGBA'))
    front.save(OUT / 'sun-front.webp', quality=90, method=6)
    print('sun-front', (OUT / 'sun-front.webp').stat().st_size, 'bytes')
