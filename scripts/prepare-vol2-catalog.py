"""Build the separate vol.2 pool from verified set rows and the local card archive."""
import concurrent.futures
import json
import re
import hashlib
import importlib.util
import subprocess
import sys
import urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/vol2-catalog'
PASSWORDS = [12381100, 13331639, 87116928, 99585850, 98630720,
             31801517, 98127546, 22850702, 91530236, 40366667]

def official(row):
    url = f"https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid={row['cid']}&request_locale=ja"
    path = ROOT / f"test-results/vol2-official-{row['cid']}.html"
    if not path.exists():
        path.write_text(urllib.request.urlopen(url).read().decode('utf-8'), encoding='utf-8')
    text = path.read_text(encoding='utf-8')
    matches = re.findall(r'(LOSP-JP\d+)\s*</div>\s*<div[^>]*>\s*LIMIT OVER SPECIAL PACK Vol\.2', text)
    assert len(matches) == 1, (row['jp_name'], matches)
    return row, matches[0], url

def main():
    module_spec = importlib.util.spec_from_file_location('locr_builder', ROOT / 'scripts/prepare-locr-catalog.py')
    builder = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(builder)
    db = json.loads((ROOT / 'test-results/locr-image-extraction/ygocdb-cards.json').read_text(encoding='utf-8'))
    by_password = {v['id']: v for v in db.values()}
    archive = Path(json.loads((ROOT / 'test-results/locr-image-extraction/extraction-report.json').read_text(encoding='utf-8'))['source'])
    (OUTPUT / 'assets').mkdir(parents=True, exist_ok=True)
    cards, prints = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        verified = list(pool.map(official, [by_password[p] for p in PASSWORDS]))
    for row, code, url in sorted(verified, key=lambda x: x[1]):
        source = archive / f"{row['id'] + 1}.jpg"
        assert source.exists(), source
        front = Image.open(source).convert('RGB').resize((590, 860), Image.Resampling.LANCZOS)
        front, names = builder.title(front, row['jp_name'], True)
        front.paste('#d0d3d5', (0, 0), names)
        patch = front.crop((428, 606, 571, 614)).resize((143, 25))
        front.paste(patch, (428, 614))
        ImageDraw.Draw(front).text((431, 616), code, font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 12), fill='#eeeeee')
        identifier = f'{code}-PSER-OF'
        filename = f'assets/{identifier}-front.jpg'
        front.save(OUTPUT / filename, quality=94, subsampling=0)
        cards.append({'cardId': code, 'nameJa': row['jp_name'], 'nameZh': row['cn_name'],
                      'cardType': 'trap' if row['data']['type'] & 4 else 'spell' if row['data']['type'] & 2 else 'monster',
                      'password': row['id'], 'cid': row['cid'], 'variants': [identifier],
                      'types': row['text']['types'], 'stats': row['data']})
        prints.append({'id': identifier, 'cardId': code, 'rarity': 'PSER', 'style': 'PSER-OF',
                       'edition': 'JP-domestic', 'overframe': True, 'front': filename,
                       'officialArtVariant': 1, 'assetRoot': 'vol2-catalog',
                       'availabilitySource': url, 'sourceImage': source.name,
                       'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest()})
    assert len(cards) == 10 and {c['cardId'] for c in cards} == {f'LOSP-JP{i:03}' for i in range(11,21)}
    for name, data in [('cards', cards), ('manifest', prints)]:
        (OUTPUT / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-vol2-finishes.py')], check=True)
    print(json.dumps([{'code': c['cardId'], 'name': c['nameZh']} for c in cards], ensure_ascii=False))

if __name__ == '__main__':
    main()
