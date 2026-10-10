import hashlib
import json
from pathlib import Path

import cv2
from PIL import Image, ImageDraw

output = Path('test-results/ui-reference-study')
output.mkdir(parents=True, exist_ok=True)
for key, filename, step in [
    ('purchase', '购买界面模仿.mp4', 1),
    ('settings', '设置界面模仿.mp4', 2),
]:
    source = Path('C:/Users/Isolde/Desktop') / filename
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frames = []
    for frame_number in range(total):
        ok, frame = cap.read()
        if not ok:
            raise RuntimeError(f'Cannot decode {key} frame {frame_number}')
        if frame_number % step:
            continue
        im = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        im.thumbnail((250, 140))
        frames.append((frame_number, im))
    cap.release()
    sheets = []
    for start in range(0, len(frames), 32):
        group = frames[start:start + 32]
        sheet = Image.new('RGB', (1000, 1248), '#0b132a')
        draw = ImageDraw.Draw(sheet)
        for index, (number, im) in enumerate(group):
            x, y = (index % 4) * 250, (index // 4) * 156
            draw.text((x + 4, y + 2), f'{number:03d} / {number / fps:.3f}s', fill='white')
            sheet.paste(im, (x, y + 16))
        name = f'{key}-{start // 32 + 1:02d}.jpg'
        sheet.save(output / name, quality=89)
        sheets.append(name)
    report = {
        'source': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'fps': fps, 'frames': total, 'step': step, 'sampledFrames': len(frames),
        'sheets': sheets,
    }
    (output / f'{key}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{key}: {total} frames, {len(frames)} sampled, {len(sheets)} sheets')
