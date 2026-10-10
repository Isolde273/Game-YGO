"""Draw deterministic, offline brush-paper artwork for the home terminal."""
from pathlib import Path
import random
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'public' / 'assets'


def brush(draw, rng, bounds, color):
    x, y, w, h = bounds
    points = []
    for i in range(25):
        t = i / 24
        points.append((x + t * w + rng.uniform(-10, 10), y + rng.uniform(-12, 12)))
    for i in range(24, -1, -1):
        t = i / 24
        points.append((x + t * w + rng.uniform(-12, 12) - h * .36, y + h + rng.uniform(-14, 14)))
    draw.polygon(points, fill=color)


def panel(name, width, height, accent, seed, paper=False):
    rng = random.Random(seed)
    im = Image.new('RGB', (width, height), '#171d23')
    d = ImageDraw.Draw(im)
    # Broad, broken charcoal strokes, with pale slivers of the paper below.
    for _ in range(45):
        x, y = rng.randrange(-100, width), rng.randrange(-45, height)
        v = rng.randrange(21, 43)
        brush(d, rng, (x, y, rng.randrange(80, 310), rng.randrange(14, 75)), (v, v + 3, v + 6))
    if paper:
        d.polygon([(width * .62, -15), (width, -15), (width, height), (width * .47, height)], fill='#d3cdbb')
        for _ in range(55):
            x, y = rng.randrange(int(width * .49), width), rng.randrange(-20, height)
            brush(d, rng, (x, y, rng.randrange(12, 130), rng.randrange(2, 16)), rng.choice(['#b7b4a8', '#c2bdad', '#ded7c5']))
        for _ in range(12):
            x, y = rng.randrange(int(width * .48), int(width * .59)), rng.randrange(height)
            brush(d, rng, (x, y, rng.randrange(8, 40), rng.randrange(3, 20)), '#222b31')
    else:
        center = width * (.66 if name == 'open' else .8)
        for _ in range(24):
            x, y = rng.uniform(center - width * .13, center + width * .04), rng.uniform(height * .08, height * .83)
            brush(d, rng, (x, y, rng.uniform(25, width * .12), rng.uniform(5, height * .18)), accent)
        for _ in range(25):
            x, y = rng.uniform(center - width * .15, width), rng.uniform(0, height)
            brush(d, rng, (x, y, rng.uniform(7, 75), rng.uniform(2, 15)), '#171d23')
    if name == 'open':
        for _ in range(12):
            brush(d, rng, (rng.uniform(-25, 80), rng.uniform(-5, height), rng.uniform(30, 130), rng.uniform(3, 15)), '#742626')
    # Fine worn ink, diagonal scratches and scattered pigment.
    for _ in range(width * height // 110):
        x, y = rng.randrange(width), rng.randrange(height)
        base = im.getpixel((x, y))
        tone = rng.choice([12, 65, 110])
        color = tuple(int(c * .82 + tone * .18) for c in base)
        d.line((x, y, x + rng.randrange(1, 4), y - rng.randrange(0, 3)), fill=color, width=1)
    for _ in range(50):
        x, y = rng.randrange(width), rng.randrange(height)
        base = im.getpixel((x, y))
        color = tuple(int(c * .85 + 95 * .15) for c in base)
        d.line((x, y, x + rng.randrange(8, 70), y - rng.randrange(2, 18)), fill=color, width=1)
    # Uneven paper edges, printed registration marks and chipped corners.
    border = '#d5ccba'
    d.line([(0, 1), (width - 1, 1), (width - 1, height - 2), (1, height - 2), (1, 1)], fill=border, width=2)
    for _ in range(65):
        x = rng.randrange(width)
        y = rng.choice([0, height - 3])
        d.rectangle((x, y, x + rng.randrange(2, 16), y + rng.randrange(1, 5)), fill=rng.choice([border, '#1b2227']))
    for x, y in [(1, 1), (width - 20, 1), (1, height - 5), (width - 22, height - 5)]:
        d.rectangle((x, y, x + 18, y + 4), fill=border)
    if name == 'open':
        for x in range(width - 105, width - 16, 7):
            d.rectangle((x, height - 13, x + rng.randrange(1, 4), height - 5), fill=border)
    im.save(OUT / f'home-{name}-paper.png', optimize=True)


panel('open', 900, 256, '#a9322d', 41)
panel('album', 440, 216, '#28546a', 42)
panel('warehouse', 440, 216, '#28546a', 43)
panel('shop', 900, 190, '#28546a', 44, paper=True)
panel('settings', 400, 118, '#28546a', 45)
print('Home terminal paper artwork prepared.')
