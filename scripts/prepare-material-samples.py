"""Calibrated Japanese LOCR review prints and separate optical data.

Pillow/numpy only. Unwatermarked prints supply frames/text; clean independent
art replaces photographed reflections. No official SAMPLE fronts are used.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT/'research/locr-rates/finish-references'
OUT = ROOT/'public/material-review/assets'
OUT.mkdir(parents=True, exist_ok=True)
W, H = 590, 860  # Source scan and physical card ratio: 59:86.
LAYOUTS = {
    'LOCR-JP076': dict(source='clean-sr', art=(72,159,521,601),
        frame=(60,147,532,614), text=(29,632,564,815), attribute=(498,40,548,90),
        symbols=[(495,113,520,138)], stars=[]),
    'LOCR-JP015': dict(source='clean-ur', art=(71,158,524,605),
        frame=(59,148,535,614), text=(30,638,565,815), attribute=(499,37,553,91),
        symbols=[], stars=[(74,119),(114,119),(154,119),(194,119)]),
    'LOCR-JP048': dict(source='clean-sr048', art=(68,159,522,612),
        frame=(57,147,532,623), text=(29,643,563,815), attribute=(502,37,555,90),
        symbols=[], stars=[(395,121),(435,121),(475,121),(515,121)]),

}
OF = dict(art=(0,0,W,630),text=(30,630,566,813),attribute=(495,35,551,91),
          frame=(59,148,535,614), artWindow=(71,158,524,605),
          stars=[(74,119),(114,119),(154,119),(194,119)])
GMR = dict(art=(25,30,564,632),text=(33,632,554,812),attribute=(486,46,543,104),
           frame=(60,160,536,624), artWindow=(72,170,525,615),
           stars=[(79,134),(117,134),(154,134),(191,134)])
REGISTRATION=ROOT/'research/locr-rates/correction-20261007'
LAYERS=ROOT/'research/locr-rates/revision-20261008'

# Only combinations listed for the Japanese LOCR release are emitted.
CATALOG = {
    '003': ('ドラゴン・導きの呼笛', 'spell', ['UR','SER','GMR','UR-OF','PSER-OF']),
    '009': ('レッド・デーモンズ・チェーン', 'trap', ['UR','SER','GMR','UR-OF','PSER-OF']),
    '015': ('四天の龍 ダーク・リベリオン・エクシーズ・ドラゴン', 'monster', ['UR','SER','GMR','UR-OF','PSER-OF']),
    '045': ('白銀の城の召使い アリアンナ', 'monster', ['SR','SER','UL','PSER']),
    '048': ('応戦するＧ', 'monster', ['SR','SER','CR','PSER']),
    '069': ('墓守の刻印', 'spell', ['SR','SER','CR','PSER']),
    '076': ('原石の皇脈', 'spell', ['SR','SER','UL','PSER']),
    '077': ('異次元グランド', 'trap', ['SR','SER','CR','PSER']),
    '078': ('ウェルカム・ラビュリンス', 'trap', ['SR','SER','UL','PSER']),
}
for code in ('003','009','045','069','077','078'):
    LAYOUTS['LOCR-JP'+code] = dict(source='clean-'+code,
        art=(70,158,523,607), frame=(59,147,534,619), text=(30,636,563,815),
        attribute=(498,38,551,91), symbols=[(495,113,522,140)] if code=='009' else [],
        stars=[(395,120),(435,120),(475,120),(515,120)] if code=='045' else [])

def image(name):
    return Image.open(REF/(name+'.jpg')).convert('RGB').resize((W,H),Image.Resampling.LANCZOS)

def box(draw, xy, fill):
    # Layout boxes are half-open, as in PIL.crop/paste and calibration tests.
    x0,y0,x1,y1=xy
    draw.rectangle((x0,y0,x1-1,y1-1),fill=fill)

def ring(draw, xy, width, fill): draw.rectangle(xy,outline=fill,width=width)

def paste_art(front, file, bounds):
    x0,y0,x1,y1=bounds
    art=Image.open(REF/(file+'.jpg')).convert('RGB')
    front.paste(art.resize((x1-x0,y1-y0),Image.Resampling.LANCZOS),(x0,y0))

def title_mask(front, spell=False):
    rgb=np.asarray(front).astype(float)
    r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    keep=(r>155)&(g>165)&(b>155) if spell else (r<120)&(g<100)&(b<100)
    region=np.zeros((H,W),bool)
    if spell: region[44:88,40:282]=True
    else: region[45:88,40:283]=True
    return Image.fromarray((keep&region).astype('uint8')*255)

def dragon_title(position, width=452, serif=False):
    # The photographed UR name is dark/broken. Rebuild only these glyphs;
    # dimensions/position follow the Japanese source, including the ruby.
    glyph=Image.new('L',(1100,44));gd=ImageDraw.Draw(glyph)
    font=ImageFont.truetype(str(REF/'noto-serif-jp-title.ttf') if serif else 'C:/Windows/Fonts/YuGothM.ttc',31)
    gd.text((0,-4),'四天の龍 ダーク・リベリオン・エクシーズ・ドラゴン',font=font,fill=255)
    glyph=glyph.crop(glyph.getbbox()).resize((width,26),Image.Resampling.LANCZOS)
    mask=Image.new('L',(W,H));mask.paste(glyph,position)
    return mask

spell=image('clean-sr');paste_art(spell,'art076',LAYOUTS['LOCR-JP076']['art'])
spell_name=title_mask(spell,True)
monster=image('clean-ur');paste_art(monster,'art015',LAYOUTS['LOCR-JP015']['art'])
monster_name=dragon_title((40,54))
md=ImageDraw.Draw(monster);box(md,(39,34,497,89),'#171c32')
ruby=ImageFont.truetype('C:/Windows/Fonts/msgothic.ttc',9)
md.text((42,35),'してん   りゅう',font=ruby,fill='#d6dce9')
monster.paste('#b79952',(0,0),monster_name)
insect=image('clean-sr048');paste_art(insect,'art048',LAYOUTS['LOCR-JP048']['art'])
insect_name=title_mask(insect)

def projection(name):
    data=json.loads((REGISTRATION/(name+'-registration.json')).read_text())
    return np.asarray(data['homography'],dtype=float)

def transform(im, matrix):
    inv=np.linalg.inv(matrix);inv/=inv[2,2]
    return im.transform((W,H),Image.Transform.PERSPECTIVE,tuple(inv.flat)[:8],Image.Resampling.BICUBIC)

def registered_art(front, matrix, bounds):
    # Match the actual OF composition; never stretch the square illustration
    # to the full print. Perspective correction only compensates the scan.
    art=Image.open(REF/'art015.jpg').convert('RGB')
    warped=transform(art,matrix)
    yy,xx=np.mgrid[:H,:W];points=np.stack([xx,yy,np.ones_like(xx)],axis=0).reshape(3,-1)
    inverse=np.linalg.inv(matrix)@points
    sx=(inverse[0]/inverse[2]).reshape(H,W);sy=(inverse[1]/inverse[2]).reshape(H,W)
    edge=np.minimum.reduce([sx,sy,art.width-1-sx,art.height-1-sy])
    weight=np.clip(edge/16.,0,1);weight=weight*weight*(3-2*weight)
    x0,y0,x1,y1=bounds;weight*=((xx>=x0)&(xx<x1)&(yy>=y0)&(yy<y1))
    front.paste(warped,(0,0),Image.fromarray(np.uint8(weight*255)))

def draw_rank(front, x, y):
    # OF Xyz stars have a dark circular substrate, not the orange level
    # circles copied from the ordinary-card scan. Supersample the gold glyph.
    scale=4;im=Image.new('RGBA',(36*scale,36*scale));d=ImageDraw.Draw(im)
    d.ellipse((scale,scale,35*scale,35*scale),fill='#122036',outline='#65798a',width=scale)
    points=[]
    for i in range(10):
        a=-np.pi/2+i*np.pi/5;r=(13 if i%2==0 else 5.5)*scale
        points.append((18*scale+np.cos(a)*r,18*scale+np.sin(a)*r))
    d.polygon(points,fill='#d3b655');im=im.resize((36,36),Image.Resampling.LANCZOS)
    front.paste(im,(x-18,y-18),im)

def overframe_layers(front, matrix, layout, is_gmr, surround_print):
    """The creature crosses a real inset window; the square background does not.

    Keep the registered art at its existing scale. Only the foreground matte
    crosses the frame, with a darker printed surround underneath the creature.
    """
    clean = front.copy()
    delta = matrix @ np.linalg.inv(projection('clean-of')) if is_gmr else np.eye(3)
    surround = Image.new('L',(W,H))
    sd = ImageDraw.Draw(surround)
    box(sd,(0,0,W,630),255)
    box(sd,OF['frame'],0)
    frame_mask = Image.new('L',(W,H))
    fd = ImageDraw.Draw(frame_mask)
    box(fd,OF['frame'],255)
    box(fd,OF['artWindow'],0)
    neutral = np.asarray(image('clean-ur').convert('L'),dtype=float)
    frame = Image.fromarray(np.uint8(np.clip(neutral[:,:,None]*np.array([.84,.91,1.0]),0,255)))
    if is_gmr:
        surround = transform(surround,delta)
        frame_mask = transform(frame_mask,delta)
        frame = transform(frame,delta)
    # Retain the illustration's lightning in the darker surround without
    # carrying photographed rainbow reflections into the print texture.
    neutral = np.asarray(surround_print.convert('L'),dtype=float)
    dark = Image.fromarray(np.uint8(np.clip(neutral[:,:,None]*np.array([.69,.83,1.02]),0,255)))
    front.paste(dark,(0,0),surround)
    front.paste(frame,(0,0),frame_mask)
    matte = Image.open(LAYERS/'art015-subject-mask.png').convert('L')
    matte = transform(matte,matrix)
    limit = Image.new('L',(W,H));box(ImageDraw.Draw(limit),layout['art'],255)
    matte = Image.fromarray(np.minimum(np.asarray(matte),np.asarray(limit)))
    front.paste(clean,(0,0),matte)
    return front

def make_overframe(layout, is_gmr=False):
    source=Image.open(LAYERS/'clean-of-surround-underprint.png').convert('RGB')
    source.paste(Image.open(REF/'clean-of-header-underprint.png'),(0,0))
    matrix=projection('gmr015' if is_gmr else 'clean-of')
    front=source.copy()
    if is_gmr:
        # Only the header/extended artwork donor is reprojected. Neutral text
        # is restored separately; the GMR photograph supplies shape, not film.
        donor=transform(source,matrix@np.linalg.inv(projection('clean-of')))
        front.paste(donor.crop((0,0,W,632)),(0,0))
        x0,y0,x1,y1=layout['text']
        front.paste(source.crop(OF['text']).resize((x1-x0,y1-y0)),(x0,y0))
    surround_print = front.copy()
    registered_art(front,matrix,layout['art'])
    front = overframe_layers(front,matrix,layout,is_gmr,surround_print)
    # The donor underprint retains actual background contours. Do not replace
    # these with opaque homemade panels or leave the old scan type underneath.
    names=dragon_title((40,59 if is_gmr else 51),439 if is_gmr else 448,True)
    outline=names.filter(ImageFilter.MaxFilter(3))
    front.paste('#121520',(0,0),outline)
    front.paste('#c6c9cd',(0,0),names)
    ImageDraw.Draw(front).text((42,41 if is_gmr else 34),'してん   りゅう',font=ruby,fill='#eeeeee',stroke_width=1,stroke_fill='#121520')
    for x,y in layout['stars']: draw_rank(front,x,y)
    src=LAYOUTS['LOCR-JP015']['attribute'];dst=layout['attribute']
    icon=monster.crop(src).resize((dst[2]-dst[0],dst[3]-dst[1]),Image.Resampling.LANCZOS)
    alpha=Image.new('L',icon.size);ImageDraw.Draw(alpha).ellipse((1,1,icon.width-2,icon.height-2),fill=255)
    front.paste(icon,dst[:2],alpha)
    # Print the code over the continuous illustration. Copying an entire scan
    # strip here left a dark horizontal seam and clipped GMR's code.
    font=ImageFont.truetype('C:/Windows/Fonts/times.ttf',20)
    ImageDraw.Draw(front).text((430 if not is_gmr else 425,605 if not is_gmr else 607),
        'LOCR-JP015',font=font,fill='#f2f2f2',stroke_width=0)
    return front,names

of,of_name=make_overframe(OF)
gmr,gmr_name=make_overframe(GMR,True)

def gmr_perimeter():
    """Trace the observed perimeter, rather than invent a repeated alphabet.

    Grayscale coverage becomes neutral raised ink. This photographed shape
    reference is not a factory embossing die.
    """
    rgb=np.asarray(image('gmr015'),dtype=float)/255
    value=rgb.max(axis=2)
    coverage=np.clip((value-.30)/.46,0,1)
    yy,xx=np.mgrid[:H,:W]
    perimeter=(xx<22)|(xx>=W-22)|(yy<29)|(yy>=H-23)
    return Image.fromarray(np.uint8(coverage*perimeter*255))

perimeter=gmr_perimeter()
rng=np.random.default_rng(517)
shards=Image.new('L',(W,H));sd=ImageDraw.Draw(shards)
for y in range(-16,H,37):
    for x in range(-18,W,32):
        cx=x+int(rng.integers(-10,12));cy=y+int(rng.integers(-12,12))
        poly=[(cx,cy),(cx+int(rng.integers(8,28)),cy+int(rng.integers(-5,9))),
              (cx+int(rng.integers(8,22)),cy+int(rng.integers(14,29))),
              (cx+int(rng.integers(-9,3)),cy+int(rng.integers(14,27)))]
        sd.polygon(poly,fill=int(rng.integers(40,248)))

samples=[
    ('SR',0,'スーパーレア','LOCR-JP076','原石の皇脈',spell,spell_name,False),
    ('UR',1,'ウルトラレア','LOCR-JP015','四天の龍 ダーク・リベリオン・エクシーズ・ドラゴン',monster,monster_name,False),
    ('SER',2,'シークレットレア','LOCR-JP076','原石の皇脈',spell,spell_name,False),
    ('UL',3,'アルティメットレア','LOCR-JP076','原石の皇脈',spell,spell_name,False),
    ('CR',4,'コレクターズレア','LOCR-JP048','応戦するＧ',insect,insect_name,False),
    ('PSER',5,'プリズマティックシークレットレア','LOCR-JP076','原石の皇脈',spell,spell_name,False),
    ('GMR',6,'グランドマスターレア','LOCR-JP015','四天の龍 ダーク・リベリオン・エクシーズ・ドラゴン',gmr,gmr_name,True),
    ('UR-OF',1,'ウルトラレア / オーバーフレーム','LOCR-JP015','四天の龍 ダーク・リベリオン・エクシーズ・ドラゴン',of,of_name,True),
    ('PSER-OF',5,'プリズマティックシークレットレア / オーバーフレーム','LOCR-JP015','四天の龍 ダーク・リベリオン・エクシーズ・ドラゴン',of,of_name,True),
]

def extra_print(code):
    front=image('clean-'+code)
    paste_art(front,'art'+code,LAYOUTS['LOCR-JP'+code]['art'])
    rgb=np.asarray(front,dtype=float)
    region=np.zeros((H,W),bool);region[45:88,40:491]=True
    glyph=(rgb.max(axis=2)<125) if code in ('003','009','045') else (rgb.min(axis=2)>153)
    names=Image.fromarray(np.uint8(glyph&region)*255)
    return front,names

extra={code:extra_print(code) for code in ('003','009','045','069','077','078')}

def extra_overframe(code):
    """Register the independent illustration to this card's actual OF print.

    Retain the dark surround and visible inset gold frame from the scan, but
    derive illustration colour from independent art, not photographed foil.
    """
    source=image('of'+code)
    mat=np.asarray(json.loads((LAYERS/f'of{code}-registration.json').read_text())['homography'])
    art=transform(Image.open(REF/f'art{code}.jpg').convert('RGB'),mat)
    rgb=np.asarray(source,dtype=float)
    clean=np.asarray(art,dtype=float)
    gray=np.asarray(source.convert('L').filter(ImageFilter.GaussianBlur(1.2)),dtype=float)
    artgray=np.asarray(art.convert('L').filter(ImageFilter.GaussianBlur(1.2)),dtype=float)
    # Outside the window, retain only actual dark stock occluding the art.
    shade=np.clip((gray+22)/(artgray+22),.18,1)
    shade[159:608,71:523]=1
    cleaned=Image.fromarray(np.uint8(np.clip(clean*shade[:,:,None],0,255)))
    # A projective warp is black outside its source image. Leave the actual
    # surround visible there instead of pasting those empty pixels as bars.
    valid=transform(Image.new('L',(624,624),255),mat)
    limit=Image.new('L',(W,H));box(ImageDraw.Draw(limit),(18,25,573,630),255)
    coverage=np.minimum(np.asarray(valid,dtype=float),np.asarray(limit,dtype=float))/255
    yy,xx=np.mgrid[:H,:W]
    inverse=np.linalg.inv(mat)@np.stack([xx,yy,np.ones_like(xx)],axis=0).reshape(3,-1)
    sx=(inverse[0]/inverse[2]).reshape(H,W);sy=(inverse[1]/inverse[2]).reshape(H,W)
    edge=np.minimum.reduce([sx,sy,623-sx,623-sy])
    coverage*=np.clip(edge/18,0,1)
    # The green/pink surround in the OF print replaces the square art's blue
    # background. Keep it around the subject instead of extending that square.
    if code=='003':
        outside=(xx<71)|(xx>=523)|(yy<159)|(yy>=608)
        blue=(clean[:,:,2]>clean[:,:,0]*1.35)&(clean[:,:,2]>clean[:,:,1]*1.05)
        dark=clean.max(axis=2)<90
        keep=Image.fromarray(np.uint8(~(outside&(blue|dark)))*255).filter(ImageFilter.GaussianBlur(1))
        coverage*=np.asarray(keep)/255
    coverage=Image.fromarray(np.uint8(coverage*255))
    front=source.copy();front.paste(cleaned,(0,0),coverage)
    # Restore the genuine visible gold frame, excluding foreground crossings.
    frame=Image.new('L',(W,H));fd=ImageDraw.Draw(frame)
    box(fd,(59,147,534,619),255);box(fd,(71,159,523,608),0)
    visible_frame=(gray<artgray*.62)&(gray<100)
    border=Image.fromarray(np.uint8(np.asarray(frame,dtype=float)*visible_frame)) if code=='003' else Image.new('L',(W,H))
    front.paste(source,(0,0),border)
    normal,_=extra[code]
    # Keep the actual OF composition behind glyphs; only the glyphs/icons
    # and the quiet effect text are borrowed from the same Japanese card.
    header=Image.new('L',(W,H));box(ImageDraw.Draw(header),(24,25,491,87),255)
    header=header.filter(ImageFilter.GaussianBlur(8))
    front.paste(source,(0,0),header)
    title_region=np.zeros((H,W),bool);title_region[44:82,40:485]=True
    title_dark=rgb.max(axis=2)<100
    names=Image.fromarray(np.uint8(title_region&title_dark)*255)
    front.paste('#bca968',(0,0),names)
    type_mask=np.zeros((H,W),bool)
    type_mask[105:136,362:543]=True
    type_mask &= rgb.max(axis=2)<70
    front.paste('#171923',(0,0),Image.fromarray(np.uint8(type_mask)*255))
    for bounds in [(498,38,551,91)]+LAYOUTS['LOCR-JP'+code]['symbols']:
        icon=normal.crop(bounds);alpha=Image.new('L',icon.size)
        ImageDraw.Draw(alpha).ellipse((0,0,icon.width-1,icon.height-1),fill=255)
        front.paste(icon,bounds[:2],alpha)
    front.paste(normal.crop((30,637,563,815)),(30,637))
    layout=dict(art=(18,25,573,630),frame=(59,147,534,619),artWindow=(71,159,523,608),
        text=(30,637,563,815),attribute=(498,38,551,91),
        symbols=LAYOUTS['LOCR-JP'+code]['symbols'],stars=[],insetFrameVisible=code=='003')
    return front,names,layout,border

extra_of={code:extra_overframe(code) for code in ('003','009')}
choices={
    'SR': {'monster':'048','trap':'078'},
    'UR': {'spell':'003','trap':'009'},
    'SER': {'monster':'045','trap':'078'},
    'UL': {'monster':'045','trap':'078'},
    'CR': {'spell':'069','trap':'077'},
    'PSER': {'monster':'045','trap':'078'},
    'GMR': {'spell':'003','trap':'009'},
    'UR-OF': {'spell':'003','trap':'009'},
    'PSER-OF': {'spell':'003','trap':'009'},
}
originals={sample[0]:sample for sample in samples}
for style,types in choices.items():
    _,kind,label,*_=originals[style]
    for card_type,code in types.items():
        name,verified_type,available=CATALOG[code]
        assert card_type==verified_type and style in available,(style,code)
        over=style in ('GMR','UR-OF','PSER-OF')
        front,names=extra_of[code][:2] if over else (insect,insect_name) if code=='048' else extra[code]
        samples.append((style+'-'+card_type,kind,label,'LOCR-JP'+code,name,front,names,over))

manifest=[]
for key,kind,label,code,name,base,names,over in samples:
    number=code[-3:]
    style=key.removesuffix('-monster').removesuffix('-spell').removesuffix('-trap')
    assert style in CATALOG[number][2],(key,code)
    layout=extra_of[number][2] if over and number!='015' else (GMR if kind==6 else OF) if over else LAYOUTS[code]
    base=base.copy();d=ImageDraw.Draw(base)
    foil=Image.new('L',(W,H));f=ImageDraw.Draw(foil)
    emboss=Image.new('L',(W,H));e=ImageDraw.Draw(emboss)
    thick=Image.new('L',(W,H));t=ImageDraw.Draw(thick)
    accent=Image.new('L',(W,H));a=ImageDraw.Draw(accent)
    box(f,layout['art'],255)
    f.ellipse(layout['attribute'],fill=255)
    for symbol in layout.get('symbols',[]): f.ellipse(symbol,fill=255)
    for x,y in layout['stars']: f.ellipse((x-16,y-16,x+16,y+16),fill=255)
    a.ellipse(layout['attribute'],fill=255)
    for symbol in layout.get('symbols',[]): a.ellipse(symbol,fill=255)
    for x,y in layout['stars']: a.ellipse((x-16,y-16,x+16,y+16),fill=255)
    if kind in (3,4,5,6):
        box(f,(0,0,W,H),255)
        if kind in (3,4): box(f,layout['text'],0)
    if over: box(f,(0,0,W,H),255)
    if kind in (1,3): base.paste('#ba9845',(0,0),names)
    elif kind==0: pass
    else: base.paste('#d0d3d5',(0,0),names)
    # Keep the source edge texture/width, but give PSE its neutral metallic
    # substrate. All chromatic reflection comes from the shared optical film.
    if kind==5:
        neutral=np.asarray(base.convert('L'),dtype=float)
        neutral=Image.fromarray(np.uint8(60+neutral*.38)).convert('RGB')
        rim=Image.new('L',(W,H));ring(ImageDraw.Draw(rim),(0,0,W-1,H-1),14,255)
        base.paste(neutral,(0,0),rim)
        # The inset illustration frame is the same silver rainbow foil.
        # On OF cards the registered creature is printed above this frame.
        border=Image.new('L',(W,H));bd=ImageDraw.Draw(border)
        box(bd,layout['frame'],255)
        box(bd,layout.get('artWindow',layout['art']),0)
        if over and number=='015':
            foreground=transform(Image.open(LAYERS/'art015-subject-mask.png').convert('L'),projection('clean-of'))
            border=Image.fromarray(np.uint8(np.asarray(border,dtype=float)*(1.-np.asarray(foreground,dtype=float)/255.)))
        elif over:
            border=extra_of[number][3].copy()
        base.paste(neutral,(0,0),border)
        border.save(OUT/(key+'-border.png'),optimize=True)
    height=np.zeros((H,W),np.float32)
    if kind==3:
        box(e,(18,18,W-18,H-18),125);box(e,layout['text'],0)
        ring(e,(0,0,W-1,H-1),18,0);ring(e,layout['frame'],9,0)
        luma=np.asarray(base.convert('L').filter(ImageFilter.GaussianBlur(2)),dtype=float)/255
        yy,xx=np.mgrid[:H,:W];x0,y0,x1,y1=layout['art']
        crystal=(xx>=x0)&(xx<x1)&(yy>=y0)&(yy<y1)
        height=rng.random((H,W))*.06
        height+=crystal*(.34*np.sin(luma*53)+.065*np.sin(luma*87+xx*.14))
    elif kind==4:
        box(e,(18,18,W-18,H-18),110);box(e,layout['text'],0)
        height=np.asarray(shards,dtype=float)/255
        height+=np.asarray(base.convert('L').filter(ImageFilter.FIND_EDGES),dtype=float)/255*.10
    elif kind==6:
        box(f,(0,0,W,29),0);box(f,(0,H-23,W,H),0)
        box(f,(0,0,22,H),0);box(f,(W-22,0,W,H),0)
        ring(d,(0,0,W-1,H-1),22,'#08090b');box(d,(0,0,W,29),'#08090b')
        thick=perimeter.copy()
        if number!='015':
            perimeter_source=np.asarray(image('gmr'+number).convert('L'),dtype=float)
            yy,xx=np.mgrid[:H,:W]
            edge=(xx<22)|(xx>=W-22)|(yy<29)|(yy>=H-23)
            thick=Image.fromarray(np.uint8(np.clip((perimeter_source-76)/117,0,1)*edge*255))
        t=ImageDraw.Draw(thick)
        ring(t,(24,30,563,832),2,255);ring(t,(32,631,554,811),3,255)
        thick=Image.fromarray(np.maximum(np.asarray(thick),np.asarray(names)))
        t=ImageDraw.Draw(thick);t.ellipse(layout['attribute'],outline=255,width=3)
        for x,y in layout['stars']: t.ellipse((x-17,y-17,x+17,y+17),outline=255,width=3)
        box(d,(29,812,187,836),'#07090a')
        font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',19)
        t.text((36,814),'001/100',font=font,fill=255)
        base.paste('#b5b5b5',(0,0),thick)
        box(e,(24,30,W-24,H-28),35)
        emboss=Image.fromarray(np.maximum(np.asarray(emboss),np.asarray(thick)))
        height=np.asarray(thick.filter(ImageFilter.GaussianBlur(.65)),dtype=float)/255*1.6
    mask=Image.merge('RGBA',(foil,emboss,names,thick))
    height=height*np.asarray(emboss,dtype=float)/255
    dy,dx=np.gradient(height);strength=6.0 if kind in (3,4) else 9.0
    normal=np.stack((-dx*strength,dy*strength,np.ones_like(dx)),axis=2)
    normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    normal=Image.fromarray(np.uint8(np.clip(normal*.5+.5,0,1)*255))
    if kind==4: normal.putalpha(shards)
    base.save(OUT/(key+'-front.jpg'),quality=94,subsampling=0)
    mask.save(OUT/(key+'-mask.png'),optimize=True)
    normal.save(OUT/(key+'-normal.png'),optimize=True)
    accent.save(OUT/(key+'-accent.png'),optimize=True)
    manifest.append(dict(id=key,kind=kind,rarity=key.split('-')[0],labelJa=label,
        style=style,cardType=CATALOG[number][1],set='LOCR',
        sourcePrint=LAYOUTS[code]['source'],
        availabilitySource='https://yugioh-starlight.com/archives/59735218.html',
        cardId=code,nameJa=name,edition='JP-domestic',overframe=over,
        serial='001/100' if kind==6 else None,width=W,height=H,
        calibration={k:v for k,v in layout.items() if k!='source'},
        artRegistration=(('gmr015' if kind==6 else 'clean-of') if number=='015' else 'of'+number) if over else None,
        film='jp-secret-microcells-v17' if kind in (2,5,6) else None,
        accent='assets/'+key+'-accent.png',
        border=('assets/'+key+'-border.png') if kind==5 else None,
        front='assets/'+key+'-front.jpg',mask='assets/'+key+'-mask.png',normal='assets/'+key+'-normal.png'))
(OUT.parent/'samples.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared',len(manifest),'calibrated Japanese samples at 590x860;',round(sum(p.stat().st_size for p in OUT.iterdir())/1024),'KB')
