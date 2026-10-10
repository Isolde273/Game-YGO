"""Extract an editable foreground matte for the JP015 overframe composition.

Development-only OpenCV step. The daily print builder reads the saved matte.
The original illustration is never stretched or regenerated.
"""
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / 'research/locr-rates/finish-references'
OUT = ROOT / 'research/locr-rates/revision-20261008'
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW = ROOT / 'test-results/material-revision-20261008'
PREVIEW.mkdir(parents=True, exist_ok=True)
art = cv2.imread(str(REF / 'art015.jpg'))
h, w = art.shape[:2]
# The silhouette guide is in the native 624px illustration coordinates.
outline = np.array([
    (0,76),(53,49),(30,94),(29,124),(66,135),(106,153),(151,202),
    (186,205),(191,150),(211,110),(236,99),(263,112),(286,134),
    (318,137),(307,74),(288,16),(309,15),(353,37),(382,82),
    (388,51),(385,0),(580,0),(554,38),(566,63),(548,88),
    (531,112),(533,143),(564,116),(581,127),(601,153),(576,177),
    (599,200),(624,197),(624,273),(603,291),(604,330),(590,351),
    (581,323),(569,328),(562,365),(543,350),(550,317),(517,310),
    (492,336),(499,364),(526,413),(531,428),(496,432),(472,424),
    (483,465),(472,490),(489,539),(461,571),(434,540),(408,528),
    (374,548),(347,558),(324,602),(306,574),(283,559),(265,529),
    (226,516),(211,500),(204,468),(181,446),(153,441),(129,440),
    (137,486),(151,514),(174,546),(165,606),(147,579),(129,565),
    (112,576),(89,591),(77,613),(71,624),(0,624),(0,589),(29,550),
    (32,533),(12,518),(0,508),(0,382),(50,413),(67,410),(80,376),
    (73,340),(61,329),(0,326),(0,240),(0,199),(0,137),
], np.float32)
outline[:, 0] *= w / 624
outline[:, 1] *= h / 624
guide = np.zeros((h, w), np.uint8)
cv2.fillPoly(guide, [np.int32(outline)], 255)
mask = np.full((h, w), cv2.GC_BGD, np.uint8)
mask[cv2.dilate(guide, np.ones((19, 19), np.uint8)) > 0] = cv2.GC_PR_BGD
mask[guide > 0] = cv2.GC_PR_FGD
inner = cv2.erode(guide, np.ones((17, 17), np.uint8)) > 0
mask[inner] = cv2.GC_FGD
b, g, r = np.moveaxis(art.astype(float), 2, 0)
electric = (g > r * 1.11) & (b > r * 1.15) & (g > 78)
mask[electric & (guide > 0)] = cv2.GC_PR_BGD
mask[electric & (g > r * 1.32) & (g > 135)] = cv2.GC_BGD
# Open sky between the extended left wing and the left leg is a hole, not
# part of the creature. Mark it explicitly to avoid carrying a cyan patch.
cv2.fillPoly(mask,[np.int32([(0,278),(58,289),(72,339),(60,389),(0,370)])],cv2.GC_BGD)
cv2.grabCut(art, mask, None, np.zeros((1,65)), np.zeros((1,65)), 8, cv2.GC_INIT_WITH_MASK)
matte = np.uint8((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)) * 255
# Keep the drawn edge of the creature, avoiding a cut just inside its outline.
matte = cv2.morphologyEx(matte, cv2.MORPH_CLOSE, np.ones((3,3), np.uint8))
matte = cv2.dilate(matte, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3)))
matte = cv2.GaussianBlur(matte, (3,3), .45)
count, labels, stats, _ = cv2.connectedComponentsWithStats(np.uint8(matte > 100))
for component in range(1, count):
    if stats[component, cv2.CC_STAT_AREA] < 160:
        matte[labels == component] = 0
cv2.imwrite(str(OUT / 'art015-subject-mask.png'), matte)
cv2.imwrite(str(OUT / 'art015-subject-guide.png'), guide)
background = np.full_like(art, (39,26,19))
alpha = matte[...,None].astype(float) / 255
preview = np.uint8(art * alpha + background * (1-alpha))
cv2.imwrite(str(PREVIEW / 'subject-matte.jpg'), preview)
source = cv2.resize(cv2.imread(str(REF/'clean-of.jpg')), (590,860))
code_mask = np.zeros((860,590),np.uint8)
code_mask[606:635,424:551] = 255
underprint = cv2.inpaint(source,code_mask,4,cv2.INPAINT_TELEA)
cv2.imwrite(str(OUT/'clean-of-surround-underprint.png'),underprint)
print('Saved native-resolution JP015 foreground matte:', w, 'x', h)
