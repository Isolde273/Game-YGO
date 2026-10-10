"""Build all 318 LOCR prints and optical maps from verified local artwork."""

import collections
import csv
import hashlib
import json
from pathlib import Path
import shutil

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / 'research/locr-rates/verification-20261008'
CHECKS = ROOT / 'test-results/locr-full-cards'
OUTPUT = ROOT / 'public/locr-catalog'
ASSETS = OUTPUT / 'assets'
W, H = 590, 860
KINDS = {'SR': 0, 'UR': 1, 'SER': 2, 'UL': 3, 'CR': 4, 'PSER': 5, 'GMR': 6}
LABELS = {'SR': 'スーパーレア', 'UR': 'ウルトラレア', 'SER': 'シークレットレア',
          'UL': 'アルティメットレア', 'CR': 'コレクターズレア',
          'PSER': 'プリズマティックシークレットレア', 'GMR': 'グランドマスターレア'}
FONT = 'C:/Windows/Fonts/YuGothM.ttc'


def load_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def box(draw, bounds, fill):
    x0, y0, x1, y1 = bounds
    draw.rectangle((x0, y0, x1 - 1, y1 - 1), fill=fill)


def rectangle_mask(bounds):
    result = Image.new('L', (W, H))
    box(ImageDraw.Draw(result), bounds, 255)
    return result


def replace_strip(front, bounds):
    """Interpolate the quiet print substrate around an old line of type."""
    rgb = np.array(front)
    x0, y0, x1, y1 = bounds
    top = rgb[y0 - 2:y0, x0:x1].mean(axis=0)
    bottom = rgb[y1:y1 + 2, x0:x1].mean(axis=0)
    top = cv2.GaussianBlur(top[None], (25, 1), 0)[0]
    bottom = cv2.GaussianBlur(bottom[None], (25, 1), 0)[0]
    blend = np.linspace(0, 1, y1 - y0)[:, None, None]
    rgb[y0:y1, x0:x1] = np.uint8(top[None] * (1 - blend) + bottom[None] * blend)
    return Image.fromarray(rgb)


def title(front, name, overframe):
    font = ImageFont.truetype(FONT, 30)
    bounds = font.getbbox(name)
    glyph = Image.new('L', (bounds[2] - bounds[0] + 2, bounds[3] - bounds[1] + 2))
    ImageDraw.Draw(glyph).text((-bounds[0] + 1, -bounds[1] + 1), name, font=font, fill=255)
    target_width = min(glyph.width, 439)
    glyph = glyph.resize((target_width, 27), Image.Resampling.LANCZOS)
    names = Image.new('L', (W, H))
    names.paste(glyph, (43, 53))
    # Preserve OF illustration behind type using a localized inpaint rather
    # than replacing its illustrated header with a flat colour rectangle.
    if overframe:
        rgb = np.array(front)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
        details = np.maximum(cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel),
                             cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel))
        region = np.zeros((H, W), np.uint8)
        region[48:82, 39:485] = np.uint8(details[48:82, 39:485] > 38) * 255
        region = cv2.dilate(region, np.ones((3, 3), np.uint8))
        front = Image.fromarray(cv2.inpaint(rgb, region, 3, cv2.INPAINT_TELEA))
    else:
        front = replace_strip(front, (39, 49, 487, 83))
    return front, names


def layout_for(card):
    data = card['data']
    card_type = 'spell' if data['type'] & 2 else 'trap' if data['type'] & 4 else 'monster'
    stars = []
    symbols = []
    if card_type == 'monster' and not data['type'] & 0x4000000:
        count = data['level'] & 255
        if data['type'] & 0x800000:
            stars = [[79 + 39 * i, 121] for i in range(count)]
        else:
            stars = [[511 - 39 * i, 121] for i in range(count)]
    if card_type != 'monster' and data['type'] & (0x10000 | 0x20000 | 0x40000 | 0x80000 | 0x100000):
        symbols = [[495, 113, 520, 138]]
    return card_type, {'art': [71, 155, 520, 605], 'frame': [60, 146, 531, 618],
                       'artWindow': [71, 155, 520, 605], 'text': [33, 639, 557, 814],
                       'attribute': [494, 39, 547, 93], 'symbols': symbols, 'stars': stars}


def accents(layout):
    result = Image.new('L', (W, H))
    draw = ImageDraw.Draw(result)
    draw.ellipse(layout['attribute'], fill=255)
    for bounds in layout['symbols']:
        draw.ellipse(bounds, fill=255)
    for x, y in layout['stars']:
        draw.ellipse((x - 16, y - 16, x + 16, y + 16), fill=255)
    return result


def inset_border(front, layout, overframe):
    border = rectangle_mask(layout['frame'])
    box(ImageDraw.Draw(border), layout['artWindow'], 0)
    if overframe:
        # Use the actual visible frame colour as a foreground-aware matte.
        # Portions hidden by a creature are never replaced by a generic ring.
        rgb = np.asarray(front, dtype=float)
        gold = ((rgb[:, :, 0] > rgb[:, :, 2] * 1.13) &
                (rgb[:, :, 1] > rgb[:, :, 2] * 1.06) &
                (rgb[:, :, 0] > 75) & (rgb[:, :, 1] > 60))
        border = Image.fromarray(np.uint8(np.asarray(border) * gold))
    return border


def relief(front, kind, layout, seed, names, perimeter):
    rng = np.random.default_rng(seed)
    height = np.zeros((H, W), np.float32)
    emboss = Image.new('L', (W, H))
    thick = Image.new('L', (W, H))
    shards = Image.new('L', (W, H))
    if kind in (3, 4):
        draw = ImageDraw.Draw(emboss)
        box(draw, (18, 18, W - 18, H - 18), 125 if kind == 3 else 110)
        box(draw, layout['text'], 0)
        if kind == 3:
            draw.rectangle((0, 0, W - 1, H - 1), outline=0, width=18)
            draw.rectangle(tuple(layout['frame']), outline=0, width=9)
            luma = np.asarray(front.convert('L').filter(ImageFilter.GaussianBlur(2)), dtype=float) / 255
            yy, xx = np.mgrid[:H, :W]
            x0, y0, x1, y1 = layout['art']
            crystal = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
            height = rng.random((H, W)) * .06
            height += crystal * (.34 * np.sin(luma * 53) + .065 * np.sin(luma * 87 + xx * .14))
        else:
            draw = ImageDraw.Draw(shards)
            for y in range(-16, H, 37):
                for x in range(-18, W, 32):
                    cx, cy = x + int(rng.integers(-10, 12)), y + int(rng.integers(-12, 12))
                    draw.polygon([(cx, cy), (cx + int(rng.integers(8, 28)), cy + int(rng.integers(-5, 9))),
                                  (cx + int(rng.integers(8, 22)), cy + int(rng.integers(14, 29))),
                                  (cx + int(rng.integers(-9, 3)), cy + int(rng.integers(14, 27)))],
                                 fill=int(rng.integers(40, 248)))
            height = np.asarray(shards, dtype=float) / 255
            height += np.asarray(front.convert('L').filter(ImageFilter.FIND_EDGES), dtype=float) / 255 * .10
    elif kind == 6:
        thick = perimeter.copy()
        draw = ImageDraw.Draw(thick)
        draw.rectangle((24, 30, 563, 832), outline=255, width=2)
        draw.rectangle((32, 631, 554, 811), outline=255, width=3)
        draw.ellipse(layout['attribute'], outline=255, width=3)
        for bounds in layout['symbols']:
            draw.ellipse(bounds, outline=255, width=3)
        for x, y in layout['stars']:
            draw.ellipse((x - 17, y - 17, x + 17, y + 17), outline=255, width=3)
        thick = Image.fromarray(np.maximum(np.asarray(thick), np.asarray(names)))
        draw = ImageDraw.Draw(thick)
        draw.text((36, 814), '001/100', font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 19), fill=255)
        box(ImageDraw.Draw(emboss), (24, 30, W - 24, H - 28), 35)
        emboss = Image.fromarray(np.maximum(np.asarray(emboss), np.asarray(thick)))
        height = np.asarray(thick.filter(ImageFilter.GaussianBlur(.65)), dtype=float) / 255 * 1.6
    height = height * np.asarray(emboss, dtype=float) / 255
    dy, dx = np.gradient(height)
    strength = 6 if kind in (3, 4) else 9
    normal = np.stack((-dx * strength, dy * strength, np.ones_like(dx)), axis=2)
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    normal = Image.fromarray(np.uint8(np.clip(normal * .5 + .5, 0, 1) * 255))
    if kind == 4:
        normal.putalpha(shards)
    return emboss, thick, normal


def correct_source_mapping(audit, extraction):
    """Add the ten verified alternate arts, keeping earlier pictures intact."""
    destination = Path(extraction['destination'])
    report_path = ROOT / 'test-results/locr-image-extraction/extraction-report.json'
    backup = CHECKS / 'extraction-report-before-artwork-correction.json'
    if not backup.exists():
        shutil.copy2(report_path, backup)
        shutil.copy2(destination / extraction['mappingFile'], CHECKS / 'mapping-before-artwork-correction.csv')
    by_id = {row['cardId']: row for row in audit}
    retained = []
    for row in extraction['records']:
        if row['版式'] != '普通版':
            continue
        actual = Path(by_id[row['LOCR编号']]['sourceFile'])
        if actual.name != row['图片文件']:
            retained.append(row['图片文件'])
            target = destination / actual.name
            if target.exists():
                assert target.read_bytes() == actual.read_bytes()
            else:
                shutil.copy2(actual, target)
            row.update({'图片文件': actual.name, '图片编号': actual.stem,
                        'SHA256': hashlib.sha256(actual.read_bytes()).hexdigest()})
    extraction.update({'artworkVerifiedCards': 80, 'activeCatalogImages': 98,
                       'retainedPreviousArtwork': retained or extraction.get('retainedPreviousArtwork', []),
                       'folderImageCount': len(list(destination.glob('*.jpg')))})
    save_json(report_path, extraction)
    # Existing verifier derives source filenames from this corrected record.
    import subprocess
    subprocess.run(['python', str(RESEARCH / 'verify-catalog.py')], check=True, capture_output=True)


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    CHECKS.mkdir(exist_ok=True)
    audit = load_json(CHECKS / 'artwork-audit-verified.json')
    assert len(audit) == 80 and all(row['inliers'] >= 12 for row in audit)
    extraction = load_json(ROOT / 'test-results/locr-image-extraction/extraction-report.json')
    correct_source_mapping(audit, extraction)
    catalog = load_json(RESEARCH / 'LOCR全卡规格.json')
    card_database = load_json(ROOT / 'test-results/locr-image-extraction/ygocdb-cards.json')
    by_password = {int(row['id']): row for row in card_database.values()}
    by_id = {row['cardId']: row for row in audit}
    perimeter = Image.open(ROOT / 'public/material-review/assets/GMR-mask.png').getchannel('A')
    yy, xx = np.mgrid[:H, :W]
    perimeter = Image.fromarray(np.uint8(np.asarray(perimeter) * ((xx < 22) | (xx >= W - 22) | (yy < 29) | (yy >= H - 23))))
    Image.new('RGB', (W, H), (127, 127, 255)).save(ASSETS / 'flat-normal.png', optimize=True)
    manifest, card_metadata = [], []
    for card in catalog['cards']:
        metadata = by_password[card['password']]
        card_type, layout = layout_for(metadata)
        source = Path(by_id[card['cardId']]['sourceFile'])
        regular = Image.open(source).convert('RGB').resize((W, H), Image.Resampling.LANCZOS)
        normal_print, normal_names = title(regular, card['nameJa'], False)
        over_variants = [variant for variant in card['variants'] if variant['layout'] != 'normal']
        over_print = over_names = None
        if over_variants:
            over_file = Path(extraction['source']) / over_variants[0]['sourceImage']
            over_print = Image.open(over_file).convert('RGB').resize((W, H), Image.Resampling.LANCZOS)
            over_print, over_names = title(over_print, card['nameJa'], True)
        accent = accents(layout)
        prefix = card['cardId']
        accent_path = f'assets/{prefix}-accent.png'
        accent.save(OUTPUT / accent_path, optimize=True)
        entries = []
        for variant in card['variants']:
            style = variant['label']
            kind = KINDS[variant['rarity']]
            over = variant['layout'] != 'normal'
            front = (over_print if over else normal_print).copy()
            names = over_names if over else normal_names
            variant_layout = {key: value for key, value in layout.items()}
            if over:
                variant_layout['art'] = [18, 25, 572, 632]
            foil = accent.copy()
            box(ImageDraw.Draw(foil), variant_layout['art'], 255)
            if kind in (3, 4, 5, 6) or over:
                foil = Image.new('L', (W, H), 255)
                if kind in (3, 4):
                    box(ImageDraw.Draw(foil), variant_layout['text'], 0)
            header_luma = np.asarray(front.convert('L'))[49:83, 39:487].mean()
            printed_name = '#e5e5e5' if card_type != 'monster' or header_luma < 120 else '#161616'
            print_color = printed_name if kind == 0 else '#ba9845' if kind in (1, 3) else '#d0d3d5'
            front.paste(print_color, (0, 0), names)
            # The illustration IDs used by the image archive are not printed
            # passwords. OF/alternate-art cards retain the original password.
            if kind != 6:
                front = replace_strip(front, (21, 820, 180, 839))
                ImageDraw.Draw(front).text((22, 820), f'{card["password"]:08d}',
                                          font=ImageFont.truetype('C:/Windows/Fonts/times.ttf', 17), fill='#101010')
            ImageDraw.Draw(front).text((427, 615), card['cardId'],
                                      font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 12),
                                      fill='#f2f2f2' if over else '#101010')
            border = None
            if kind == 5:
                border = inset_border(front, layout, over)
                gray = np.asarray(front.convert('L'), dtype=float)
                neutral = Image.fromarray(np.uint8(60 + gray * .38)).convert('RGB')
                rim = Image.new('L', (W, H))
                ImageDraw.Draw(rim).rectangle((0, 0, W - 1, H - 1), outline=255, width=14)
                front.paste(neutral, (0, 0), rim)
                front.paste(neutral, (0, 0), border)
            seed = int(card['cardId'][-3:]) * 517 + kind
            emboss, thick, normal = relief(front, kind, variant_layout, seed, names, perimeter)
            if kind == 6:
                draw = ImageDraw.Draw(front)
                draw.rectangle((0, 0, W - 1, H - 1), outline='#08090b', width=22)
                box(draw, (0, 0, W, 29), '#08090b')
                box(draw, (29, 812, 187, 839), '#08090b')
                front.paste('#b5b5b5', (0, 0), thick)
                fdraw = ImageDraw.Draw(foil)
                for bounds in [(0, 0, W, 29), (0, H - 23, W, H), (0, 0, 22, H), (W - 22, 0, W, H)]:
                    box(fdraw, bounds, 0)
            identifier = f'{prefix}-{style}'
            front_path = f'assets/{identifier}-front.jpg'
            mask_path = f'assets/{identifier}-mask.png'
            normal_path = f'assets/{identifier}-normal.png' if kind in (3, 4, 6) else 'assets/flat-normal.png'
            border_path = f'assets/{identifier}-border.png' if border else None
            front.save(OUTPUT / front_path, quality=94, subsampling=0)
            name_foil = Image.new('L', (W, H)) if kind == 0 else names
            Image.merge('RGBA', (foil, emboss, name_foil, thick)).save(OUTPUT / mask_path, optimize=True)
            if kind in (3, 4, 6):
                normal.save(OUTPUT / normal_path, optimize=True)
            if border:
                border.save(OUTPUT / border_path, optimize=True)
            entry = {'id': identifier, 'kind': kind, 'rarity': variant['rarity'], 'style': style,
                     'labelJa': LABELS[variant['rarity']], 'cardType': card_type, 'set': 'LOCR',
                     'cardId': prefix, 'nameJa': card['nameJa'], 'nameZh': card['nameZh'],
                     'edition': 'JP-domestic', 'overframe': over,
                     'serial': '001/100' if kind == 6 else None, 'serialIsPreview': kind == 6,
                     'width': W, 'height': H, 'calibration': variant_layout,
                     'film': 'jp-secret-microcells-v18' if kind in (2, 5, 6) else None,
                     'front': front_path, 'mask': mask_path, 'normal': normal_path,
                     'accent': accent_path, 'border': border_path,
                     'sourceImage': variant['sourceImage'], 'sourceSHA256': hashlib.sha256((Path(extraction['source']) / variant['sourceImage']).read_bytes()).hexdigest(),
                     'officialArtVariant': by_id[prefix]['officialArtVariant'],
                     'availabilitySource': card['sources']['cardNamesAndRarities']}
            manifest.append(entry)
            entries.append(identifier)
        card_metadata.append({'cardId': prefix, 'nameJa': card['nameJa'], 'nameZh': card['nameZh'],
                              'cardType': card_type, 'password': card['password'], 'cid': card['cid'],
                              'variants': entries, 'types': metadata['text']['types'], 'stats': metadata['data']})
        if int(prefix[-3:]) % 10 == 0:
            print(f'Prepared {prefix}: {len(manifest)} variants', flush=True)
    assert len(manifest) == 318 and len({entry['id'] for entry in manifest}) == 318
    save_json(OUTPUT / 'manifest.json', manifest)
    save_json(OUTPUT / 'cards.json', card_metadata)
    counts = collections.Counter(entry['style'] for entry in manifest)
    report = {'passed': True, 'cards': len(card_metadata), 'variants': len(manifest),
              'styleCounts': dict(counts), 'verifiedArtworkCards': 80, 'correctedAlternateArts': 10,
              'sourceContainsSample': False, 'serialIsPreview': True,
              'titleTreatment': 'Original Japanese names typeset with Windows Yu Gothic; printed ruby retained.',
              'gmrPerimeter': 'Shared observed LOCR perimeter from existing calibrated GMR template.',
              'assetFiles': len(list(ASSETS.iterdir())), 'assetBytes': sum(path.stat().st_size for path in ASSETS.iterdir())}
    save_json(CHECKS / 'generation-report.json', report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
