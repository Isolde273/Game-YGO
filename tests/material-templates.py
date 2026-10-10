"""Verify sample availability against the independently archived LOCR card list."""
from pathlib import Path
import json
import re
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT/'public/material-review/samples.json').read_text(encoding='utf-8'))
rows = {}
for line in (ROOT/'research/locr-rates/locr-cardlist.txt').read_text(encoding='utf-8').splitlines():
    match = re.match(r'(LOCR-JP\d{3}) 「(.+)」 (.+)', line)
    if match and match[1] not in rows:
        rows[match[1]] = (match[2], match[3])
assert len(rows) == 80
types = {'003':'spell','009':'trap','015':'monster','045':'monster','048':'monster',
         '069':'spell','076':'spell','077':'trap','078':'trap'}
requirements = {'SR':'Super','UR':'Ultra','UL':'Ultimate','CR':'Collectors',
                'GMR':'Grandmaster','UR-OF':'Ultra(Overframe)',
                'PSER-OF':'Prismatic Secret(Overframe)'}
seen = set()
for sample in manifest:
    style, code = sample['style'], sample['cardId']
    assert sample['set'] == 'LOCR' and sample['edition'] == 'JP-domestic'
    name, available = rows[code]
    assert sample['nameJa'] == name
    assert sample['cardType'] == types[code[-3:]]
    if style in requirements:
        assert requirements[style] in available.split(','), (code, style, available)
    elif style == 'PSER':
        assert 'Prismatic Secret(Overframe)' not in available, 'OF-only PSER used as ordinary card'
    else:
        assert style == 'SER'  # Every LOCR card also has SER.
    pair = (style, sample['cardType'])
    assert pair not in seen, pair
    seen.add(pair)
    root = ROOT/'public/material-review'
    mask = np.asarray(Image.open(root/sample['mask']))
    accent = np.asarray(Image.open(root/sample['accent']))
    expected = Image.new('L', (590,860)); draw = ImageDraw.Draw(expected)
    layout = sample['calibration']
    draw.ellipse(layout['attribute'], fill=255)
    for symbol in layout.get('symbols', []): draw.ellipse(symbol, fill=255)
    for x,y in layout['stars']: draw.ellipse((x-16,y-16,x+16,y+16), fill=255)
    assert np.array_equal(accent, np.asarray(expected)), (sample['id'], 'misregistered header foil')
    assert (mask[:,:,2]>0).sum()>300, (sample['id'], 'missing title foil')
    if style == 'UR-OF':
        assert np.all(mask[:,:,0]==255), (sample['id'], 'UR-OF has an unfoiled region')
assert len(seen) == 27
print('LOCR templates passed: 27 real rarity/type pairs, header masks and full-card UR-OF coverage.')
