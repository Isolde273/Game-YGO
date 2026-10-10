"""Inspect every decoded frame in the first 15 seconds of the supplied video.

Rectify the print using artwork/text features, so hand motion is not confused
with motion of the foil. All measurements describe this recording, not a die.
"""
from pathlib import Path
import csv
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results/mirror-first15s'
FRAMES = OUT / 'rectified'
SHEETS = OUT / 'sheets'
for directory in (FRAMES, SHEETS):
    directory.mkdir(parents=True, exist_ok=True)
cap = cv2.VideoCapture(str(OUT / 'reference-720p.mp4'))
fps = cap.get(cv2.CAP_PROP_FPS)
ok, reference = cap.read()
assert ok, 'reference video is missing'
# Visible outer printed rim in the first 720x1280 frame (not the sleeve).
corners = np.float32([[30, 155], [619, 155], [600, 994], [52, 993]])
target = np.float32([[0, 0], [471, 0], [471, 687], [0, 687]])
rectifier = cv2.getPerspectiveTransform(corners, target)
mask = np.zeros(reference.shape[:2], np.uint8)
cv2.fillConvexPoly(mask, np.int32([[70, 190], [580, 190], [570, 962], [85, 960]]), 255)
sift = cv2.SIFT_create(nfeatures=2300, contrastThreshold=.025)
keypoints, descriptors = sift.detectAndCompute(reference, mask)
matcher = cv2.BFMatcher()
rows, reduced, visibility = [], [], []
index = 0
frame = reference
while ok and index / fps < 15:
    current_points, current_descriptors = sift.detectAndCompute(frame, None)
    pairs = matcher.knnMatch(descriptors, current_descriptors, k=2)
    good = [m for m, n in pairs if m.distance < .70 * n.distance]
    a = np.float32([keypoints[m.queryIdx].pt for m in good])
    b = np.float32([current_points[m.trainIdx].pt for m in good])
    transform, keep = cv2.findHomography(a, b, cv2.RANSAC, 2.5)
    assert transform is not None and keep.sum() >= 12, f'unreliable registration at {index}'
    projected = cv2.perspectiveTransform(a.reshape(-1, 1, 2), transform).reshape(-1, 2)
    error = np.linalg.norm(projected - b, axis=1)[keep.ravel() > 0]
    warp = rectifier @ np.linalg.inv(transform)
    upright = cv2.warpPerspective(frame, warp, (472, 688))
    visible = cv2.warpPerspective(np.full(frame.shape[:2], 255, np.uint8), warp, (472, 688))
    cv2.imwrite(str(FRAMES / f'{index:04d}.jpg'), upright, [cv2.IMWRITE_JPEG_QUALITY, 94])
    reduced.append(cv2.resize(upright, (236, 344)).astype(np.float32))
    visibility.append(cv2.resize(visible, (236, 344)) > 254)
    rows.append(dict(frame=index, seconds=round(index / fps, 5), inliers=int(keep.sum()),
                     medianErrorPx=round(float(np.median(error)), 4)))
    if index % 90 == 0:
        print('rectified', index, 'frames', flush=True)
    index += 1
    ok, frame = cap.read()
cap.release()
assert len(rows) == int(np.ceil(15 * fps))

# Every decoded frame appears once, in order, on the 15 contact sheets.
for second in range(15):
    selected = [r for r in rows if second <= r['seconds'] < second + 1]
    sheet = Image.new('RGB', (650, 1230), '#0c1521')
    draw = ImageDraw.Draw(sheet)
    for cell, row in enumerate(selected):
        im = Image.open(FRAMES / f"{row['frame']:04d}.jpg").resize((130, 189), Image.Resampling.LANCZOS)
        x, y = cell % 5 * 130, cell // 5 * 205
        sheet.paste(im, (x, y + 16))
        draw.text((x + 3, y + 1), f"{row['frame']:03d}  {row['seconds']:.3f}s", fill='white')
    sheet.save(SHEETS / f'{second:02d}-{second+1:02d}s.jpg', quality=87)

stack = np.stack(reduced)
hi, lo = stack.max(axis=3), stack.min(axis=3)
chroma = hi - lo
# Zero padding is outside the recorded image, not a dark foil measurement.
valid = np.stack(visibility)
baseline = np.nanquantile(np.where(valid, chroma, np.nan), .20, axis=0)
energy = np.maximum(chroma - baseline - 8, 0) * (hi > 135) * valid
column_profiles = energy[:, 18:326, :].mean(axis=1)
widths, spacings = [], []
for row, profile, v, high, low in zip(rows, column_profiles, valid, hi, lo):
    smooth = cv2.GaussianBlur(profile[None, :], (0, 0), .8)[0]
    # Suppress broad printed colour; retain narrow coloured diffraction bands.
    local = smooth - cv2.GaussianBlur(profile[None, :], (0, 0), 7)[0]
    peaks = []
    for i in np.argsort(local)[::-1]:
        if 21 < i < 214 and local[i] > 2.5 and all(abs(int(i) - p) > 40 for p in peaks):
            peaks.append(int(i))
        if len(peaks) == 3:
            break
    peaks.sort()
    row['bandCentersX'] = ';'.join(f'{p/236:.4f}' for p in peaks)
    row['visibleCardFraction'] = round(float(v.mean()), 4)
    row['saturatedBrightFraction'] = round(float(((high > 190) & (high-low > 65) & v).sum() / max(v.sum(), 1)), 4)
    row['neutralBrightFraction'] = round(float(((low > 210) & (high-low < 25) & v).sum() / max(v.sum(), 1)), 4)
    # Keep all 450 frames in the chronology. Estimate widths/spacings only
    # on full cards: a clipped edge can masquerade as a narrow colour band.
    measured_peaks = peaks if row['visibleCardFraction'] >= .98 else []
    for p in measured_peaks:
        left, right = p, p
        while left > 0 and local[left] > local[p] / 2:
            left -= 1
        while right < 235 and local[right] > local[p] / 2:
            right += 1
        widths.append((right-left)/236)
    spacings.extend((b-a)/236 for a, b in zip(measured_peaks, measured_peaks[1:]) if .25 < (b-a)/236 < .4)
time_map = np.clip(column_profiles / max(float(np.quantile(column_profiles, .98)), 1) * 255, 0, 255).astype(np.uint8)
time_map = cv2.applyColorMap(time_map, cv2.COLORMAP_INFERNO)
cv2.imwrite(str(OUT / 'registered-column-time-map.jpg'), cv2.resize(time_map, (636, 900)))

with (OUT / 'frames.csv').open('w', newline='', encoding='utf-8') as file:
    writer = csv.DictWriter(file, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
summary = dict(source='BV1LHXxYuEU3', resolution=[720, 1280], fps=fps,
               count=len(rows), first=rows[0], last=rows[-1],
               minimumInliers=min(r['inliers'] for r in rows),
               medianRegistrationErrorPx=float(np.median([r['medianErrorPx'] for r in rows])),
               narrowBandWidthFractionMedian=float(np.median(widths)),
               narrowBandWidthFractionP10P90=np.quantile(widths, [.1, .9]).tolist(),
               adjacentBandSpacingMedian=float(np.median(spacings)),
               partiallyClippedFrames=sum(r['visibleCardFraction'] < .98 for r in rows),
               bandMeasurementFrames=sum(r['visibleCardFraction'] >= .98 for r in rows),
               limitations=['No calibrated lighting or card normals',
                            'Chroma subtraction suppresses stable ink, not a laboratory separation of foil and sleeve',
                            'Short bars may include optical interference and video sampling'])
(OUT / 'analysis.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary))
