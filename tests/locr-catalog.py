"""Check all produced prints against the independently saved official list."""

from pathlib import Path
import collections
import json

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/locr-catalog'
manifest = json.loads((OUTPUT / 'manifest.json').read_text(encoding='utf-8'))
cards = json.loads((OUTPUT / 'cards.json').read_text(encoding='utf-8'))
official = json.loads((ROOT / 'research/locr-rates/verification-20261008/official-db-rows.json').read_text(encoding='utf-8'))
by_cid = {row['cid']: row for row in official}
rarity_ids = {3: 'SR', 4: 'UR', 5: 'SER', 6: 'UL', 16: 'CR', 36: 'PSER', 56: 'GMR'}
assert len(cards) == 80
assert len(manifest) == len({entry['id'] for entry in manifest}) == 318
assert {card['cardId'] for card in cards} == {f'LOCR-JP{i:03d}' for i in range(1, 81)}
assert {card['cid'] for card in cards} == set(by_cid)
loaded = {}
def array(path):
    if path not in loaded:
        im = Image.open(OUTPUT / path)
        assert im.size == (590, 860), path
        im.verify()
        loaded[path] = np.asarray(Image.open(OUTPUT / path))
    return loaded[path]

for card in cards:
    entries = [entry for entry in manifest if entry['cardId'] == card['cardId']]
    assert {entry['rarity'] for entry in entries} == {rarity_ids[rid] for rid in by_cid[card['cid']]['rarityIds']}
    assert card['variants'] == [entry['id'] for entry in entries]
    has_overframe = int(card['cardId'][-3:]) <= 18
    assert any(entry['style'] == 'UR-OF' for entry in entries) == has_overframe
    assert any(entry['style'] == 'PSER-OF' for entry in entries) == has_overframe
    assert not has_overframe or not any(entry['style'] == 'PSER' for entry in entries)
    for entry in entries:
        assert entry['cardType'] == card['cardType']
        assert entry['width'] == 590 and entry['height'] == 860
        for field in ['front', 'mask', 'normal', 'accent', 'border']:
            if entry.get(field):
                assert entry[field].startswith('assets/') and '..' not in entry[field]
                array(entry[field])
        mask = array(entry['mask'])
        assert mask.shape == (860, 590, 4)
        assert np.count_nonzero(array(entry['accent'])) > 2000
        if entry['rarity'] == 'SR':
            assert np.count_nonzero(mask[:, :, 2]) == 0, 'SR name must remain printed'
        else:
            assert np.count_nonzero(mask[:, :, 2]) > 300, entry['id']
        assert not np.any(mask[100:, :, 2]), 'Name foil escaped the header'
        if entry['rarity'] in ('PSER',) or entry['style'] == 'UR-OF':
            assert np.all(mask[:, :, 0] == 255)
        if entry['rarity'] in ('UL', 'CR'):
            assert not np.any(mask[647:805, 40:549, 1]), 'Effect text should not be embossed'
            normal = array(entry['normal'])
            assert normal[:, :, :2].std() > 2
        if entry['rarity'] == 'CR':
            assert array(entry['normal']).shape[2] == 4
        if entry['rarity'] == 'GMR':
            assert entry['serialIsPreview'] and entry['serial'] == '001/100'
            assert np.count_nonzero(mask[:, :, 3]) > 10000
            assert not np.any(mask[:20, :, 0])
        else:
            assert entry['serial'] is None
        if entry['border']:
            border = array(entry['border'])
            assert not np.any(border[159:601, 75:516])
            assert not np.any(border[640:])
    # Free maps between cards; the test should not accumulate a full texture atlas.
    loaded.clear()
counts = dict(collections.Counter(entry['style'] for entry in manifest))
assert counts == {'UR': 38, 'SER': 80, 'PSER-OF': 18, 'GMR': 18, 'UR-OF': 18,
                  'PSER': 62, 'SR': 42, 'UL': 21, 'CR': 21}
result = {'passed': True, 'cards': 80, 'variants': 318, 'styleCounts': counts,
          'checks': ['official per-card rarity agreement', 'all local maps decode',
                     'printed SR names', 'foil/relief mask boundaries', 'preview-only GMR serials']}
(ROOT / 'test-results/locr-full-cards/asset-validation.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
