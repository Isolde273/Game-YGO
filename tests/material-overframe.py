"""Check OF subject registration and frame occlusion against physical photos."""
from pathlib import Path
import json
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / 'research/locr-rates/finish-references'
ASSETS = ROOT / 'public/material-review/assets'
sift = cv2.SIFT_create()


def match_features(sample, photo, sample_region, photo_region):
    ka, da = sift.detectAndCompute(sample, sample_region)
    kb, db = sift.detectAndCompute(photo, photo_region)
    assert da is not None and db is not None, 'missing subject features'
    pairs = cv2.BFMatcher().knnMatch(da, db, k=2)
    good = [m for m, n in pairs if m.distance < .70 * n.distance]
    assert len(good) >= 4, 'too few subject correspondences'
    src = np.float32([ka[m.queryIdx].pt for m in good])
    dst = np.float32([kb[m.trainIdx].pt for m in good])
    matrix, keep = cv2.findHomography(src, dst, cv2.RANSAC, 3)
    assert matrix is not None, 'subject cannot match the physical card'
    return src[keep.ravel() > 0], dst[keep.ravel() > 0]


def protrusion_region(offset=0):
    region = np.zeros((860, 590), np.uint8)
    region[95 + offset:148 + offset, 285:345] = 255  # crest
    region[445 + offset:620, 28:58] = 255           # left claw
    region[315 + offset:380 + offset, 536:566] = 255  # right fingers
    return region


def inside_region(points, region):
    points = np.int32(np.rint(points))
    points[:, 0] = np.clip(points[:, 0], 0, 589)
    points[:, 1] = np.clip(points[:, 1], 0, 859)
    return region[points[:, 1], points[:, 0]] > 0


central = np.zeros((860, 590), np.uint8)
central[175:600, 90:510] = 255
clean_photo = cv2.resize(cv2.imread(str(REF / 'clean-of.jpg')), (590, 860))
photo_protrusions = protrusion_region()
report = []
for key, reference in [('UR-OF', 'clean-of'), ('PSER-OF', 'clean-of'), ('GMR', 'gmr015')]:
    sample = cv2.imread(str(ASSETS / (key + '-front.jpg')))
    photo = cv2.resize(cv2.imread(str(REF / (reference + '.jpg'))), (590, 860))
    src, dst = match_features(sample, photo, central, central)
    median = float(np.median(np.linalg.norm(src - dst, axis=1)))
    assert len(src) >= 10, (key, 'too few real subject features', len(src))
    assert median < 2.5, (key, 'dragon pose/scale/crop differs from real card', median)

    # GMR's foil-lit photo conceals most fine protrusion features. Compare
    # these silhouettes to the clearer UR-OF photo of the same illustration;
    # central registration above still uses the actual GMR reference.
    protrusions = protrusion_region(10 if key == 'GMR' else 0)
    fg_src, fg_dst = match_features(
        sample, clean_photo, np.maximum(central, protrusions),
        np.maximum(central, photo_protrusions))
    matched = inside_region(fg_src, protrusions) & inside_region(fg_dst, photo_protrusions)
    landmarks = np.unique(np.rint(fg_src[matched]), axis=0)
    assert len(landmarks) >= 3, (key, 'missing out-of-frame subject landmarks', len(landmarks))

    # An unobstructed patch outside the inner frame must remain dark stock.
    # The old full-square paste raises this patch to 120-143 rather than 28-34.
    surround = float(sample[432:444, 551:562].mean())
    assert surround < 70, (key, 'square artwork covers the dark surround', surround)
    cx, cy = (79, 134) if key == 'GMR' else (74, 119)
    b, g, r = map(int, sample[cy + 6, cx + 10])
    assert r < 130 and b >= r, (key, 'ordinary orange rank circle copied into OF', r, g, b)
    report.append(dict(id=key, inliers=len(src),
                       subjectMedianDisplacementPx=round(median, 3),
                       foregroundLandmarksOutsideWindow=len(landmarks),
                       surroundBrightness=round(surround, 2)))

# Spell/trap OF subjects have their own composition; do not reuse the dragon
# window or its protrusion landmarks for these designs.
for number in ('003', '009'):
    for style in ('UR-OF', 'PSER-OF', 'GMR'):
        key=style+('-spell' if number=='003' else '-trap')
        sample=cv2.imread(str(ASSETS/(key+'-front.jpg')))
        photo=cv2.imread(str(REF/('of'+number+'.jpg')))
        src,dst=match_features(sample,photo,central,central)
        median=float(np.median(np.linalg.norm(src-dst,axis=1)))
        assert len(src)>=30 and median<2.5,(key,'real OF composition registration',len(src),median)
        report.append(dict(id=key,inliers=len(src),subjectMedianDisplacementPx=round(median,3)))

out = ROOT / 'test-results/material-review/overframe-registration.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({'passed': True, 'checks': [
    'central pose/scale/crop against each physical card photo',
    'foreground silhouettes against clean UR-OF photo',
    'dark surround is not overwritten by square art', 'OF dark rank substrate'],
    'samples': report}, indent=2))
print(json.dumps({'passed': True, 'samples': report}))
