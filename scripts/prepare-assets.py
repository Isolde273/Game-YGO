from PIL import Image, ImageDraw
from pathlib import Path
import collections

root = Path(__file__).resolve().parents[1] / 'public' / 'assets'
# Retain all white print inside the official package silhouettes.
for filename, polygon in [
    ('locr-box-source.png', [(73,34),(177,20),(225,35),(225,256),(127,291),(73,263)]),
    ('locr-pack-source.png', [(89,26),(211,26),(211,280),(89,280)])
]:
    source=root/filename
    if not source.exists():
        continue
    im=Image.open(source).convert('RGBA')
    mask=Image.new('L',(im.width*4,im.height*4))
    ImageDraw.Draw(mask).polygon([(x*4,y*4) for x,y in polygon],fill=255)
    mask=mask.resize(im.size,Image.Resampling.LANCZOS)
    im.putalpha(mask)
    im=im.crop(im.getbbox())
    im.save(root/filename.replace('-source',''))
    print(filename.replace('-source',''),im.size)
# Remove only the neutral background connected to the case photograph edges.
for filename in ['case-source.jpg']:
    source = root / filename
    if not source.exists():
        continue
    im = Image.open(source).convert('RGBA')
    w, h = im.size
    pixels = im.load()
    queue = collections.deque()
    seen = set()
    for x in range(w):
        queue.extend([(x, 0), (x, h-1)])
    for y in range(h):
        queue.extend([(0, y), (w-1, y)])
    while queue:
        x, y = queue.popleft()
        if (x,y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        seen.add((x,y))
        r,g,b,a = pixels[x,y]
        if min(r,g,b) > 219 and max(r,g,b)-min(r,g,b) < 14:
            pixels[x,y] = (r,g,b,0)
            queue.extend([(x-1,y),(x+1,y),(x,y-1),(x,y+1)])
    bbox=im.getbbox()
    if bbox:
        im=im.crop(bbox)
    dest=root / ('case.png' if filename=='case-source.jpg' else filename)
    im.save(dest)
    print(dest.name, im.size)
