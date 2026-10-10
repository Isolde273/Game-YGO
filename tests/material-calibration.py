"""Print registration regressions, independent of the WebGL light controls."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'public/material-review/assets'
REF=ROOT/'research/locr-rates/finish-references'
manifest=json.loads((ASSETS.parent/'samples.json').read_text(encoding='utf-8'))
sources={'LOCR-JP076':'clean-sr','LOCR-JP015':'clean-ur','LOCR-JP048':'clean-sr048'}
report=[]
for sample in manifest:
    key=sample['id'];front=np.asarray(Image.open(ASSETS/(key+'-front.jpg')).convert('RGB'),dtype=float)
    mask=np.asarray(Image.open(ASSETS/(key+'-mask.png')))
    normal=Image.open(ASSETS/(key+'-normal.png'))
    assert front.shape==(860,590,3),key+' front dimensions'
    assert mask.shape==(860,590,4) and normal.size==(590,860),key+' optical dimensions'
    layout=sample['calibration']
    ax0,ay0,ax1,ay1=layout['attribute']
    assert mask[ay0:ay1,ax0:ax1,2].max()==0,key+' title intrudes into attribute icon'
    if not sample['overframe']:
        source=np.asarray(Image.open(REF/(sample['sourcePrint']+'.jpg')).convert('RGB'),dtype=float)
        _,_,_,y1=layout['art'];x0,_,x1,frameY1=layout['frame']
        # Includes the original lower frame, card code and space above text.
        band=(slice(y1+2,layout['text'][1]),slice(x0,x1))
        difference_pixels=np.abs(front[band]-source[band])
        if sample.get('border'):
            border=np.asarray(Image.open(ASSETS.parent/sample['border']).convert('L'))
            # PSE's inset foil is intentionally silver; the card code and
            # every pixel outside that calibrated mask still match the scan.
            difference_pixels=difference_pixels[border[band]==0]
        difference=float(difference_pixels.mean())
        assert difference<2.5,(key,'bottom frame / code band overwritten',difference)
        if sample['kind']<3:
            assert mask[y1:frameY1,x0:x1,0].max()==0,key+' foil spills below illustration'
        # Source edge grain remains, rather than an added uniform flat border.
        if sample['kind']!=5:
            rim_difference=float(np.abs(front[100:600,:8]-source[100:600,:8]).mean())
            assert rim_difference<3,(key,'original outer rim overwritten',rim_difference)
        report.append({'id':key,'bottomFrameMeanDifference':round(difference,3)})
    if key in ('SR','SER'):
        x0,y0,x1,y1=layout['attribute']
        expected=Image.new('L',(590,860));draw=ImageDraw.Draw(expected)
        draw.ellipse((x0,y0,x1,y1),fill=255)
        draw.ellipse(layout['symbols'][0],fill=255)
        assert np.array_equal(mask[25:145,480:575,0],np.asarray(expected)[25:145,480:575]),key+' icon mask'
        # Historical faulty rectangle was over the right bracket / green field.
        assert mask[123,534,0]==0 and mask[126,508,0]==255,key+' continuous mark shifted'
        assert mask[64,523,0]==255 and mask[64,554,0]==0,key+' attribute shifted'
    if key.startswith('PSER'):
        border=np.asarray(Image.open(ASSETS.parent/sample['border']).convert('L'))
        fx0,fy0,fx1,fy1=layout['frame']
        ax0,ay0,ax1,ay1=layout.get('artWindow',layout['art'])
        expected=np.zeros((860,590),bool);expected[fy0:fy1,fx0:fx1]=True;expected[ay0:ay1,ax0:ax1]=False
        assert not np.any(border[~expected]),key+' inset foil intrudes into art or card code'
        minimum=2000 if sample['cardId']=='LOCR-JP015' or not sample['overframe'] else 100 if layout.get('insetFrameVisible') else 0
        assert (border>200).sum()>=minimum,key+' inset frame missing'
        if layout.get('insetFrameVisible') is False:
            assert not np.any(border),key+' invented an inset frame behind full-bleed subject'
        if sample['overframe']:
            assert (border[expected]<10).sum()>500,key+' inset foil must be occluded by the foreground'
        else:
            assert np.all(border[expected]==255),key+' ordinary inset frame has missing sides'
        yy,xx=np.mgrid[:860,:590];rim=(xx<14)|(xx>=576)|(yy<14)|(yy>=846)
        chroma=front.max(axis=2)-front.min(axis=2)
        assert np.quantile(chroma[rim],.95)<8,(key,'permanent colour in metallic rim')
        assert mask[0,295,0]==255 and mask[700,300,0]==255,key+' film must cover rim and text'
    if key=='GMR':
        assert sample['film']==next(s['film'] for s in manifest if s['id']=='PSER')
        assert mask[:25,:,3].max()==255 and (mask[:25,:,3]>80).sum()>1000,'GMR perimeter missing'
        assert np.ptp(np.asarray(normal))>150,'GMR raised glyph normals missing'

out=ROOT/'test-results/material-review';out.mkdir(parents=True,exist_ok=True)
(out/'calibration.json').write_text(json.dumps({'passed':True,'samples':len(manifest),
    'checks':['59:86 textures','per-source lower art/frame/code registration','source rim texture',
        'attribute and continuous icon masks','neutral PSE rim','PSE full-card coverage','GMR raised perimeter'],
    'registration':report},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Print calibration passed: {len(manifest)} samples; lower frames/codes, rim, icon registration and full-card masks.')
