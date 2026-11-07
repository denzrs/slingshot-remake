"""Packs the PNGs `render_assets.py`, `render_planets.py`, `render_cracks.py` and `hole-frames.mjs` wrote (`hole`, `white`) into the WebP files the game loads: `python3 scripts/forged/pack.py <png dir>`."""
import sys
from pathlib import Path

from PIL import Image

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[2] / 'src' / 'render' / 'looks' / 'forged'
OUT.mkdir(parents=True, exist_ok=True)

# name -> (size to scale to or None, quality)
FILES = {
    'ship': (None, 90),
    'ship-mask': (None, 90),
    'turret-base': (None, 90),
    'turret-mask': (None, 90),
    'turret-barrel': (None, 90),
    'turret-barrel-mask': (None, 90),
    'coin': (None, 90),
    'hole': (None, 70),
    'white': (None, 80),
    'tex-rock': ((512, 256), 85),
    'tex-gas': ((512, 256), 85),
    'tex-ice': ((512, 256), 85),
    # Data for the shader (`render_cracks.py`), at full size: its thin fissures would blur away at half.
    'tex-cracks': ((1024, 512), 75),
}
# The planet variants `render_planets.py` paints.
for variant in ('rock-desert', 'rock-ocean', 'rock-moon', 'rock-alien', 'gas-neptune', 'gas-violet', 'gas-toxic', 'gas-crimson', 'gas-stormy', 'ice-glacier', 'ice-methane', 'ice-dusty', 'ice-rose'):
    FILES['tex-' + variant] = ((512, 256), 85)

for name, (size, quality) in FILES.items():
    if not (SRC / f'{name}.png').exists():
        continue  # a folder with only some of the images packs just those
    image = Image.open(SRC / f'{name}.png').convert('RGBA')
    if size:
        image = image.convert('RGB').resize(size, Image.LANCZOS)
    image.save(OUT / f'{name}.webp', 'WEBP', quality=quality, method=6)
    print(name, (OUT / f'{name}.webp').stat().st_size, 'bytes')
