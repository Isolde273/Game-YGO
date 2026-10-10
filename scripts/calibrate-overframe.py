"""Development-only registration / header cleanup. Requires OpenCV.

Output is small offline research data; the normal sample generator still
requires only Pillow/numpy. No official SAMPLE images enter this pipeline.
"""
from pathlib import Path
import json
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'research/locr-rates/finish-references'
OUT=ROOT/'research/locr-rates/correction-20261007'
art=cv2.imread(str(REF/'art015.jpg'))
sift=cv2.SIFT_create();ka,da=sift.detectAndCompute(art,None)
for name in ['clean-of','gmr015']:
    source=cv2.resize(cv2.imread(str(REF/(name+'.jpg'))),(590,860))
    kb,db=sift.detectAndCompute(source,None)
    pairs=cv2.BFMatcher().knnMatch(da,db,k=2)
    good=[m for m,n in pairs if m.distance<.7*n.distance]
    src=np.float32([ka[m.queryIdx].pt for m in good]);dst=np.float32([kb[m.trainIdx].pt for m in good])
    matrix,keep=cv2.findHomography(src,dst,cv2.RANSAC,3)
    errors=np.linalg.norm(cv2.perspectiveTransform(src[:,None,:],matrix)[:,0,:]-dst,axis=1)[keep.ravel()>0]
    data=dict(homography=matrix.tolist(),matches=len(good),inliers=int(keep.sum()),medianError=float(np.median(errors)))
    (OUT/(name+'-registration.json')).write_text(json.dumps(data,indent=2))
    print(name,data['inliers'],'inliers; median reprojection error',round(data['medianError'],3),'px')

source=cv2.imread(str(REF/'clean-of.jpg'))[:180].copy()
b,g,r=np.moveaxis(source.astype(float),2,0)
mask=np.zeros(source.shape[:2],np.uint8)
gold=(r>22)&(r>g*.97)&(g>b*1.02)
mask[44:92,35:507]=gold[44:92,35:507]*255
ruby=(r>125)&(g>125)&(b<r*1.22)
mask[30:46,40:146]=ruby[30:46,40:146]*255
mask=cv2.dilate(mask,np.ones((3,3),np.uint8),iterations=2)
for x in (74,114,154,194): cv2.circle(mask,(x,119),19,255,-1)
cv2.ellipse(mask,(523,63),(30,30),0,0,360,255,-1)
clean=cv2.inpaint(source,mask,4,cv2.INPAINT_TELEA)
cv2.imwrite(str(REF/'clean-of-header-underprint.png'),clean)
print('Prepared header underprint; original photographed name/icons removed, extended art retained.')
