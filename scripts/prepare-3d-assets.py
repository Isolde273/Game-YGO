from pathlib import Path
from PIL import Image
import html, re, json, sys

root = Path(__file__).resolve().parents[1]
assets = root / 'public/assets'
box = Image.open(assets / 'locr-box-source.png').convert('RGB')
# A perspective transform straightens printed lines as well as the face outline.
# Bilinear QUAD sampling left the photograph's perspective skew in the cover.
def rectify(size, corners, filename, source=box):
    w, h = size
    destination = [(0, 0), (0, h - 1), (w - 1, h - 1), (w - 1, 0)]
    rows = []
    for (x, y), (u, v) in zip(destination, corners):
        rows.append([x, y, 1, 0, 0, 0, -u*x, -u*y, u])
        rows.append([0, 0, 0, x, y, 1, -v*x, -v*y, v])
    for col in range(8):
        pivot = max(range(col, 8), key=lambda i: abs(rows[i][col]))
        rows[col], rows[pivot] = rows[pivot], rows[col]
        scale = rows[col][col]
        rows[col] = [value / scale for value in rows[col]]
        for i in range(8):
            if i == col:
                continue
            factor = rows[i][col]
            rows[i] = [a - factor*b for a, b in zip(rows[i], rows[col])]
    coefficients = tuple(row[8] for row in rows)
    source.transform(size, Image.Transform.PERSPECTIVE, coefficients,
                  Image.Resampling.BICUBIC).save(assets / filename)

# The supplied 800px product reference has twice the actual print detail of
# the old 300px official thumbnail. Keep this source locally for reproduction.
reference = Image.open(assets / 'locr-package-reference.webp').convert('RGB')
rectify((1024, 1536), [(205, 238), (204, 748), (442, 708), (442, 214)], 'locr-box-front.png', reference)
rectify((896, 1536), [(111, 211), (112, 702), (202, 748), (203, 238)], 'locr-box-side.png', reference)
reference.crop((444, 194, 690, 718)).resize((1024, 2048), Image.Resampling.LANCZOS).save(assets / 'locr-pack-front.png')
import runpy
runpy.run_path(str(root / 'scripts' / 'prepare-lid-art.py'))
if '--box-only' in sys.argv:
    sys.exit(0)
search = root / 'research/carton-search.html'
if search.exists():
    records = []
    for match in re.findall(r'm="(.*?)"', search.read_text(encoding='utf-8')):
        try:
            entry = json.loads(html.unescape(match))
            if entry.get('murl'):
                records.append({k: entry.get(k) for k in ('t', 'murl', 'purl')})
        except (ValueError, TypeError):
            pass
    (root / 'research/carton-search-results.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    for entry in records[:6]:
        print(entry)

reference = Path(r'D:\夸克\txz-portable\txz-portable\resources\game\assets\main-Dz1ko2BI.js')
if reference.exists():
    source = reference.read_text(encoding='utf-8')
    for term in ('PerspectiveCamera(', 'BoxGeometry(', 'pointerdown', 'openBox', 'outerColor'):
        match = re.search(re.escape(term), source)
        if match:
            print(term, source[max(0, match.start()-90):match.start()+240])
