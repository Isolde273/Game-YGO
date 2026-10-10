"""Verify saved public sources and export the complete Japanese LOCR catalog."""

import collections
import csv
import hashlib
import json
from pathlib import Path
import re
import shutil
import unicodedata


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EXTRACTION = ROOT / 'test-results/locr-image-extraction'
OFFICIAL = 'https://www.yugioh-card.com/japan/products/locr/'
DATABASE = ('https://www.db.yugioh-card.com/yugiohdb/card_search.action'
            '?ope=1&sess=1&pid=1000009564000&rp=99999&request_locale=ja')
STARLIGHT = 'https://yugioh-starlight.com/archives/59735218.html'
RARITY_IDS = {3: 'SR', 4: 'UR', 5: 'SER', 6: 'UL', 16: 'CR', 36: 'PSER', 56: 'GMR'}
LONG_NAMES = {'SR': 'Super', 'UR': 'Ultra', 'SER': 'Secret', 'UL': 'Ultimate',
              'CR': 'Collectors', 'PSER': 'Prismatic Secret', 'GMR': 'Grandmaster'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def normalize(name):
    return ''.join(unicodedata.normalize('NFKC', name).split()).replace('−', '-').replace('—', '-')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_csv(path, rows):
    with path.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with path.open(encoding='utf-8-sig', newline='') as stream:
        assert list(csv.DictReader(stream)) == rows


def main():
    official_rows = read_json(HERE / 'official-db-rows.json')
    live_rows = read_json(HERE / 'starlight-rows.json')
    original = read_json(EXTRACTION / 'mapping-candidates.json')
    extraction = read_json(EXTRACTION / 'extraction-report.json')
    destination = Path(extraction['destination'])
    source = Path(extraction['source'])
    assert len(official_rows) == len(live_rows) == len(original) == 80
    expected_codes = {f'LOCR-JP{i:03d}' for i in range(1, 81)}
    assert {row['cardId'] for row in live_rows} == expected_codes
    assert {row['cardId'] for row in original} == expected_codes
    by_cid = {row['cid']: row for row in official_rows}
    by_code = {row['cardId']: row for row in live_rows}
    assert len(by_cid) == 80
    product_text = (HERE / 'official.txt').read_text(encoding='utf-8')
    for evidence in ['カード種類：全80種', 'ウルトラレア ･･･ 38種', 'スーパーレア ･･･ 42種',
                     '全カードにプリズマティックシークレットレア仕様とシークレットレア仕様も存在します。',
                     'プリズマティックシークレットレア仕様の内18種は「オーバーフレームカード」です。']:
        assert evidence in product_text, evidence

    catalog = []
    rarity_counts = collections.Counter()
    variant_counts = collections.Counter()
    image_to_variants = collections.defaultdict(list)
    image_to_card = {}
    for local in sorted(original, key=lambda row: row['cardId']):
        assert len(local['matches']) == 1
        match = local['matches'][0]
        official = by_cid[match['cid']]
        live = by_code[local['cardId']]
        assert normalize(local['nameJa']) == normalize(official['nameJa'])
        assert local['nameJa'] == live['nameJa']
        assert local['rarities'] == live['rarities']
        database_rarities = [RARITY_IDS[rid] for rid in official['rarityIds']]
        listed = live['rarities'].split(',')
        expected_rarities = {'SER', 'PSER'} | {key for key, name in LONG_NAMES.items() if name in listed}
        assert set(database_rarities) == expected_rarities, local['cardId']
        rarity_counts.update(database_rarities)
        has_overframe = 'Ultra(Overframe)' in listed
        assert has_overframe == ('Prismatic Secret(Overframe)' in listed)
        assert has_overframe == ('GMR' in database_rarities)
        assert has_overframe == (int(local['cardId'][-3:]) <= 18)
        password = int(match['id'])
        base_file = f'{password}.jpg'
        overframe_file = f'{password + 1}.jpg' if has_overframe else ''
        # Preserve the actual filename if the source uses leading zeroes.
        existing_base = next(row['图片文件'] for row in extraction['records']
                             if row['LOCR编号'] == local['cardId'] and row.get('版式', '普通版') == '普通版')
        base_file = existing_base
        if has_overframe:
            overframe_file = next(row['图片文件'] for row in extraction['records']
                                  if row['LOCR编号'] == local['cardId'] and row['版式'] == '出框版')
        card = {'cardId': local['cardId'], 'nameJa': official['nameJa'],
                'nameZh': match['nameZh'], 'cid': match['cid'], 'password': password,
                'databaseRarities': database_rarities, 'variants': [],
                'sources': {'cardNamesAndRarities': DATABASE, 'numberingAndOverframe': STARLIGHT,
                            'overallProductRules': OFFICIAL}}
        for rarity in database_rarities:
            layout = 'gmr' if rarity == 'GMR' else 'overframe' if rarity == 'PSER' and has_overframe else 'normal'
            label = rarity + '-OF' if layout == 'overframe' else rarity
            filename = overframe_file if layout in ('gmr', 'overframe') else base_file
            card['variants'].append({'rarity': rarity, 'layout': layout, 'label': label,
                                     'sourceImage': filename,
                                     'requiresGmrFrameRebuild': rarity == 'GMR'})
        if has_overframe:
            card['variants'].append({'rarity': 'UR', 'layout': 'overframe', 'label': 'UR-OF',
                                     'sourceImage': overframe_file, 'requiresGmrFrameRebuild': False})
        for variant in card['variants']:
            variant_counts[variant['label']] += 1
            image_to_variants[variant['sourceImage']].append(variant)
            image_to_card[variant['sourceImage']] = card
        catalog.append(card)
    assert set(by_cid) == {card['cid'] for card in catalog}
    assert dict(rarity_counts) == {'UR': 38, 'SER': 80, 'PSER': 80, 'GMR': 18, 'SR': 42, 'UL': 21, 'CR': 21}
    assert sum(variant_counts.values()) == 318
    assert variant_counts['PSER'] == 62 and variant_counts['PSER-OF'] == 18
    assert variant_counts['UR-OF'] == 18
    assert len(image_to_variants) == 98

    table = []
    for card in catalog:
        variants = card['variants']
        table.append({'LOCR编号': card['cardId'], '日文卡名': card['nameJa'], '中文卡名': card['nameZh'],
                      '卡片密码': str(card['password']), '官方数据库ID': str(card['cid']),
                      '普通卡框规格': '、'.join(v['label'] for v in variants if v['layout'] == 'normal'),
                      '出框规格': '、'.join(v['label'] for v in variants if v['layout'] == 'overframe'),
                      'GMR': '有' if 'GMR' in card['databaseRarities'] else '无',
                      '全部规格': '、'.join(v['label'] for v in variants),
                      '普通底图': next(v['sourceImage'] for v in variants if v['layout'] == 'normal'),
                      '出框构图底图': next((v['sourceImage'] for v in variants if v['layout'] == 'overframe'), ''),
                      '罕贵度来源': DATABASE, '收录编号与出框范围来源': STARLIGHT})
    catalog_document = {'set': 'LOCR', 'edition': 'JP-domestic', 'verifiedDate': '2026-10-08',
                        'cardCount': 80, 'imageCount': 98, 'variantCount': 318,
                        'rarityCounts': dict(rarity_counts), 'variantCounts': dict(variant_counts),
                        'notes': ['SER/PSER 对应官方缩写 SE/PSE。',
                                  '前18种的PSER使用出框版式，不额外生成普通卡框PSER。',
                                  'GMR的出框图片仅作构图来源，仍需重建专用外框和序号。',
                                  '318个规格不按GMR独立序号重复计数。'],
                        'cards': catalog}
    write_json(HERE / 'LOCR全卡规格.json', catalog_document)
    write_csv(HERE / 'LOCR全卡罕贵度核对表.csv', table)

    # Correct the earlier image-level table without changing any image files.
    mapping_path = destination / extraction['mappingFile']
    for path, name in [(mapping_path, 'LOCR卡图对照表-before-official-verification.csv'),
                       (EXTRACTION / 'extraction-report.json', 'extraction-report-before-official-verification.json')]:
        backup = HERE / name
        if not backup.exists():
            shutil.copy2(path, backup)
    image_records = []
    for previous in extraction['records']:
        filename = previous['图片文件']
        variants = image_to_variants[filename]
        assert digest(source / filename) == digest(destination / filename) == previous['SHA256']
        row = dict(previous)
        row['罕贵度记录'] = ','.join(LONG_NAMES[v['rarity']] + ('(Overframe)' if v['layout'] == 'overframe' else '')
                                   for v in variants)
        image_records.append(row)
    write_csv(mapping_path, image_records)
    extraction.update({'records': image_records, 'rarityRulesVerified': True,
                       'verifiedVariantCount': 318, 'rarityVerificationReport': str(HERE / 'REPORT.md'),
                       'gmrImageNote': '出框图仅作GMR构图底图，需重建GMR专用外框及序号。'})
    write_json(EXTRACTION / 'extraction-report.json', extraction)
    for filename in ['LOCR全卡规格.json', 'LOCR全卡罕贵度核对表.csv']:
        target = destination / filename
        if target.exists() and digest(target) != digest(HERE / filename):
            backup = HERE / ('previous-' + filename)
            if not backup.exists():
                shutil.copy2(target, backup)
        shutil.copy2(HERE / filename, target)

    report = [
        '# 日版 LOCR 全卡与罕贵度核对 · 2026-10-08', '',
        '结论：当前提取的80种卡完整覆盖日版 LIMIT OVER COLLECTION -THE RIVALS-。'
        '官方数据库的80个卡片ID及规范化卡名逐一匹配，无遗漏或多余；'
        '实时取得的完整收录表编号连续为LOCR-JP001～080，与原提取清单逐项一致。', '',
        '## 证据来源', '',
        f'- [KONAMI官方商品页]({OFFICIAL})：全80种、UR38/SR42、全卡SER/PSER、18种PSER出框、18种UR出框/GMR、21种UL和21种CR。',
        f'- [KONAMI官方完整卡片数据库]({DATABASE})：逐卡确认名称、官方ID及实际罕贵度，涵盖全部80种。',
        f'- [Starlight完整收录表]({STARLIGHT})：逐卡编号及18种出框范围，与官方逐卡罕贵度交叉核对。',
        '- 官方详情页另外抽查JP001、JP015、JP076的收录编号与罕贵度。',
        '- 原网页、解析后的逐卡记录、抓取时间与SHA-256保存在本目录；不是仅沿用旧会话结论。', '',
        '## 规则与数量', '',
        '| 规格 | 数量 |', '| --- | ---: |',
    ]
    report += [f'| {label} | {variant_counts[label]} |'
               for label in ['SR', 'UR', 'SER', 'UL', 'CR', 'PSER', 'UR-OF', 'PSER-OF', 'GMR']]
    report += ['', '共318个卡名/罕贵度/版式规格。OF表示出框版式，不是另一个罕贵度。'
               '官方SE/PSE与项目SER/PSER是同义缩写。GMR独立序号不重复计入规格数量。', '',
               'JP001～018：UR、SER、UR-OF、PSER-OF、GMR；JP019～038：UR、SER、PSER；'
               'JP039～080：SR、SER、PSER，并且每张另有UL或CR之一，分别21种。', '',
               '## 逐卡结果', '', '| 编号 | 日文卡名 | 中文卡名 | 全部规格 |', '| --- | --- | --- | --- |']
    report += [f"| {row['LOCR编号']} | {row['日文卡名']} | {row['中文卡名']} | {row['全部规格']} |" for row in table]
    report += ['', '## 输出与限制', '',
               '- `LOCR全卡罕贵度核对表.csv`：80行完整逐卡表；`LOCR全卡规格.json`：318个可供后续接入的规格。',
               '- 两个文件另复制到用户LOCR目录。原`LOCR卡图对照表.csv`已补全SER/PSER，并将GMR构图来源关联到出框图。',
               '- 已重新核对98张图片的来源与目标SHA-256；图片本身未修改。旧对照表与旧提取报告已备份。',
               '- GMR仍需独立外框/厚箔/序号处理，关联出框图不表示这张图片已是GMR成品。',
               '- 本核对确认收录与规格，不确定开包概率，也没有修改主游戏或绿色版。', '']
    (HERE / 'REPORT.md').write_text('\n'.join(report), encoding='utf-8')
    summary = {'passed': True, 'officialCards': 80, 'matchedLocalCards': 80, 'missing': [], 'extra': [],
               'variantCounts': dict(variant_counts), 'variantTotal': 318, 'imagesSHA256Verified': 98,
               'report': str(HERE / 'REPORT.md'), 'destination': str(destination)}
    write_json(HERE / 'verification-result.json', summary)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
