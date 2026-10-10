"""Add the accepted PSER-OF channels to the ten verified vol.2 prints, offline."""
import importlib.util
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/vol2-catalog'
spec = importlib.util.spec_from_file_location('locr_builder', ROOT / 'scripts/prepare-locr-catalog.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
cards = {card['cardId']: card for card in json.loads((OUTPUT / 'cards.json').read_text(encoding='utf-8'))}
manifest = json.loads((OUTPUT / 'manifest.json').read_text(encoding='utf-8'))
for entry in manifest:
    card = cards[entry['cardId']]
    # Keep the verified original print for inventory fallback and reproducible input.
    source = entry.get('sourceFront', entry['front'])
    front = Image.open(OUTPUT / source).convert('RGB')
    front, names = builder.title(front, card['nameJa'], True)
    front.paste('#d0d3d5', (0, 0), names)
    card_type, layout = builder.layout_for({'data': card['stats']})
    border = builder.inset_border(front, layout, True)
    neutral = Image.fromarray(np.uint8(60 + np.asarray(front.convert('L'), dtype=float) * .38)).convert('RGB')
    rim = Image.new('L', front.size)
    ImageDraw.Draw(rim).rectangle((0, 0, 589, 859), outline=255, width=14)
    front.paste(neutral, (0, 0), rim)
    front.paste(neutral, (0, 0), border)
    prefix = f"assets/{entry['id']}"
    front.save(OUTPUT / f'{prefix}-finish-front.jpg', quality=94, subsampling=0)
    zero = Image.new('L', front.size)
    Image.merge('RGBA', (Image.new('L', front.size, 255), zero, names, zero)).save(OUTPUT / f'{prefix}-mask.png', optimize=True)
    builder.accents(layout).save(OUTPUT / f'{prefix}-accent.png', optimize=True)
    border.save(OUTPUT / f'{prefix}-border.png', optimize=True)
    layout['art'] = [18, 25, 572, 632]
    entry.update(sourceFront=source, front=f'{prefix}-finish-front.jpg', kind=5,
                 mask=f'{prefix}-mask.png', normal='../locr-catalog/assets/flat-normal.png',
                 accent=f'{prefix}-accent.png', border=f'{prefix}-border.png',
                 calibration=layout, film='jp-secret-microcells-v18', cardType=card_type)
(OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'vol.2: {len(manifest)} PSER-OF finishes generated from verified local prints.')
