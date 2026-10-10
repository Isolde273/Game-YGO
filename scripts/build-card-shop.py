"""Blender-authored card shop. Run: blender -b --python scripts/build-card-shop.py.

All dimensions are game units, 1 unit = 0.1 m. Helpers accept Three.js (Y-up)
coordinates and convert to Blender Z-up. Source retains individually named parts;
the exported glTF joins evaluated meshes by material within each semantic group.
"""
import bpy, math, os, json, random, base64, time
from mathutils import Vector, Matrix
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'art'/'blender'; OUT.mkdir(parents=True,exist_ok=True)
ASSETS=ROOT/'public'/'assets'/'models'; ASSETS.mkdir(parents=True,exist_ok=True)
START=time.time(); random.seed(407)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials): bpy.data.materials.remove(data)
scene=bpy.context.scene; scene.unit_settings.system='METRIC'; scene.unit_settings.scale_length=.1
scene.render.engine='CYCLES'; scene.cycles.samples=32; scene.cycles.use_denoising=True
scene.render.resolution_x=1600; scene.render.resolution_y=1000; scene.render.resolution_percentage=100
scene.world.color=(.28,.28,.28)
scene.view_settings.view_transform='AgX'
groups={}; materials={}; meshes=[]; colliders=[]
chinese_font=bpy.data.fonts.load('C:/Windows/Fonts/msyh.ttc')
chinese_font.pack()

def xyz(v): return (v[0],-v[2],v[1])
def group(name,position=(0,0,0),yaw=0):
    ob=bpy.data.objects.new(name,None); scene.collection.objects.link(ob); ob.location=xyz(position); ob.rotation_euler.z=yaw; groups[name]=ob; return ob
def parent(ob,g):
    if g: ob.parent=g
    meshes.append(ob); return ob
def color(h):
    h=h.lstrip('#'); rgb=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb)+(1,)
def material(name,h,rough=.5,metal=0,emission=0,alpha=1):
    m=bpy.data.materials.new(name); m.diffuse_color=color(h); m.use_nodes=True
    m.node_tree.nodes.clear();p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');p.name='Principled BSDF';output=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(p.outputs['BSDF'],output.inputs['Surface'])
    p.inputs['Base Color'].default_value=color(h); p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if emission: p.inputs['Emission Color'].default_value=color(h);p.inputs['Emission Strength'].default_value=emission
    if alpha<1:p.inputs['Alpha'].default_value=alpha;m.diffuse_color=(*color(h)[:3],alpha);m.surface_render_method='DITHERED'
    materials[name]=m; return m
def finish(ob,name,mat,g,bevel=0,segments=3,smooth=True):
    ob.name=name;ob.data.materials.append(mat)
    if bevel:
        mod=ob.modifiers.new('Machined rounded edges','BEVEL');mod.width=bevel;mod.segments=segments
    if smooth:
        for p in ob.data.polygons:p.use_smooth=True
        mod=ob.modifiers.new('Face weighted normals','WEIGHTED_NORMAL');mod.keep_sharp=True;mod.weight=50
    return parent(ob,g)
def box(name,pos,size,mat,g=None,bevel=.025,yaw=0,segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.rotation_euler.z=yaw
    return finish(o,name,mat,g,min(bevel,min(size)*.45),segments)
def cyl(name,pos,radius,depth,mat,g=None,vertices=32,axis=(0,1,0),bevel=.008):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=xyz(pos));o=bpy.context.object;o.rotation_euler=Vector(xyz(axis)).to_track_quat('Z','Y').to_euler()
    return finish(o,name,mat,g,bevel,2)
def rod(name,a,b,r,mat,g=None,vertices=12):
    av,bv=Vector(a),Vector(b);d=bv-av;return cyl(name,(av+bv)/2,r,d.length,mat,g,vertices,d,0)
def sphere(name,pos,r,mat,g=None,segments=16,rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=r,location=xyz(pos));return finish(bpy.context.object,name,mat,g,0)
def torus(name,pos,major,minor,mat,g=None,axis=(0,1,0),major_segments=40,minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=major_segments,minor_segments=minor_segments,location=xyz(pos));o=bpy.context.object;o.rotation_euler=Vector(xyz(axis)).to_track_quat('Z','Y').to_euler();return finish(o,name,mat,g,0)
def line(name,points,r,mat,g=None,cyclic=False):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=1;curve.bevel_depth=r;curve.bevel_resolution=2
    sp=curve.splines.new('POLY');sp.points.add(len(points)-1)
    for p,v in zip(sp.points,points):p.co=(*xyz(v),1)
    sp.use_cyclic_u=cyclic;o=bpy.data.objects.new(name,curve);scene.collection.objects.link(o);o.data.materials.append(mat);return parent(o,g)
def text(name,body,pos,size,mat,g=None,flat=False,extrude=.001,align='CENTER'):
    curve=bpy.data.curves.new(name,'FONT');curve.body=body;curve.size=size;curve.align_x=align;curve.align_y='CENTER';curve.extrude=extrude;curve.resolution_u=3
    if any(ord(c)>127 for c in body):curve.font=chinese_font
    o=bpy.data.objects.new(name,curve);scene.collection.objects.link(o);o.location=xyz(pos)
    if not flat:o.rotation_euler.x=math.pi/2
    o.data.materials.append(mat);return parent(o,g)
def lathe(name,profile,mat,g=None,segments=64):
    vs=[];fs=[]
    for radius,height in profile:
        for i in range(segments):a=i*math.tau/segments;vs.append((radius*math.cos(a),radius*math.sin(a),height))
    for j in range(len(profile)-1):
        for i in range(segments):k=j*segments+i;n=j*segments+(i+1)%segments;fs.append((k,n,n+segments,k+segments))
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);scene.collection.objects.link(o);return finish(o,name,mat,g,0)
def rounded_path(w,d,r,y=0,count=8):
    p=[]
    for cx,cz,a0 in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for i in range(count+1):a=math.radians(a0+i*90/count);p.append((cx+r*math.cos(a),y,cz+r*math.sin(a)))
    return p
def stitches(g,w,d,y,mat,step=.10,r=.003):
    # Rounded seam uses cheap three-sided thread meshes; detail is actual geometry.
    points=rounded_path(w,d,.11,y,10)
    for a,b in zip(points,points[1:]+points[:1]):
        a,b=Vector(a),Vector(b);length=(b-a).length;n=max(1,round(length/step))
        for i in range(n):rod('Saddle stitch',a.lerp(b,i/n),a.lerp(b,(i+.44)/n),r,mat,g,3)
def screw(g,p,r=.029):
    cyl('Recessed screw head',p,r,.013,steel,g,16);box('Screw slot',(p[0],p[1]+.008,p[2]),(r*1.35,.003,.007),black,g,.001)
def collision(name,g,size,y=0):
    p=(g.location.x,g.location.z,-g.location.y);colliders.append({'name':name,'group':g.name,'position':[p[0],p[1]+y,p[2]],'size':size,'yaw':g.rotation_euler.z})

wood=material('Oiled walnut','#765033',.49);edge=material('End grain walnut','#493022',.68)
rubber=material('Rubber and zipper tape','#161e22',.93);fabric=material('Woven teal mat','#254144',.92)
leather=material('Oxblood leather','#68454a',.72);navy=material('Blue leather','#3e5360',.73)
brass=material('Satin brass','#b6a06a',.32,.72);steel=material('Brushed steel','#9da8ad',.26,.76)
black=material('Graphite metal','#202b31',.39,.5);paper=material('Warm card paper','#ded9c8',.89)
thread=material('Linen stitching','#998d6d',.94);cream=material('Glazed porcelain','#d9d9cd',.19)
coffee=material('Coffee surface','#241710',.17);glass=material('Cabinet glass','#aaccc9',.16,.05,alpha=.10)
wall=material('Warm plaster','#b6bcb5',.96);panel=material('Shop wall panels','#50656a',.86)
floor=material('Floor charcoal tile','#525e61',.92);light=material('Warm luminous diffuser','#fff0d7',.38,emission=2)
red=material('Shop vermilion','#a45444',.76);sleeve=material('Card sleeve blue','#465b70',.40)
screen=material('PhoneScreen','#132734',.21);ink=material('Fine charcoal printing','#30383a',.84)

def image_map(name,w,h,fn):
    image=bpy.data.images.new(name,width=w,height=h,alpha=False);pixels=[0.0]*(w*h*4)
    for y in range(h):
        for x in range(w):
            c=fn(x,y);i=(y*w+x)*4;pixels[i:i+4]=[*c,1]
    image.pixels.foreach_set(pixels);image.pack();return image
def wood_pixel(x,y):
    warp=y*.33+4*math.sin(x*.008)+2*math.sin(x*.020+y*.016)
    v=(math.sin(warp*2+math.sin(warp*.2))*1.8+math.sin(warp*.19)*4+math.sin(x*.18+y*3)*.6)
    return ((118+v)/255,(83+v*.8)/255,(56+v*.6)/255)
wood_image=image_map('Original walnut grain',1024,512,wood_pixel)
nodes=wood.node_tree.nodes;tx=nodes.new('ShaderNodeTexImage');tx.image=wood_image;wood.node_tree.links.new(tx.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.15;bump.inputs['Distance'].default_value=.015;wood.node_tree.links.new(tx.outputs['Color'],bump.inputs['Height']);wood.node_tree.links.new(bump.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])
cloth_image=image_map('Original woven textile',256,256,lambda x,y:((95+(x%4<2)*14+(y%4<2)*9)/255,)*3)
for mat in [fabric,leather,navy]:
    n=mat.node_tree.nodes;coord=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeVectorMath');mapping.operation='SCALE';mapping.inputs[3].default_value=36
    t=n.new('ShaderNodeTexImage');t.image=cloth_image;b=n.new('ShaderNodeBump');b.inputs['Strength'].default_value=.18;b.inputs['Distance'].default_value=.01
    mat.node_tree.links.new(coord.outputs['UV'],mapping.inputs[0]);mat.node_tree.links.new(mapping.outputs[0],t.inputs[0]);mat.node_tree.links.new(t.outputs[0],b.inputs['Height']);mat.node_tree.links.new(b.outputs[0],n.get('Principled BSDF').inputs['Normal'])

# 01 / Solid tabletop. Shallow seams and end-grain inset remain visible at close range.
g=group('Desk')
box('Continuous rounded walnut top',(0,-.195,0),(21.6,.46,15.912),wood,g,.18,segments=5)
for z in [-4.77,-1.59,1.59,4.77]:box('Fine board joint',(0,.036,z),(21.18,.002,.008),edge,g,.001)
box('Tabletop underside lip',(0,-.45,0),(21.42,.10,15.76),edge,g,.05)
for x in [-9.15,9.15]:
    box('Steel apron beam',(x,-.77,0),(.24,.54,13.9),black,g,.05)
    for z in [-6.42,6.42]:
        box('Powder coated square leg',(x,-3.98,z),(.43,6.4,.43),black,g,.05)
        cyl('Adjustable rubber foot',(x,-7.22,z),.28,.11,rubber,g)
        box('Welded corner bracket',(x,-.92,z),(.66,.32,.66),black,g,.045)
        screw(g,(x,-.746,z))
for z in [-6.42,6.42]:box('Steel cross beam',(0,-.77,z),(18.4,.54,.23),black,g,.035)
box('Inlaid brass desk number',(7.6,-.19,7.972),(1.37,.24,.014),brass,g,.009)
text('Table number engraving','TABLE  01',(7.6,-.185,7.984),.135,ink,g)

# 02 / Mat and welt, with proper thread segments and a quiet embossed footer.
g=group('Mat',(-.98,0,0));box('Soft rubber backing',(0,.018,0),(16.17,.034,12.136),rubber,g,.16,segments=5)
box('Fine woven play surface',(0,.037,0),(16.10,.014,12.07),fabric,g,.14,segments=5)
stitches(g,15.98,11.94,.046,thread,.12,.0038)
line('Printed inset boundary',rounded_path(15.66,11.62,.18,.046),.007,thread,g,True)
text('Mat foil signature','DUEL  ARCHIVE',(5.90,.046,5.37),.17,brass,g,True)
text('Mat small print','TRADING CARD CLUB   /   01',(5.90,.046,5.62),.071,thread,g,True)

# 04 / Two zippered nine-pocket binders. Each page block, zipper tooth and pull is real geometry.
g=group('Binder',(-8.64,.005,-5.32),.11)
cover_group=group('BinderCover',(-8.64,.005,-5.32),.11)
for layer in range(2):
    y=.21+layer*.40;cover=navy if layer==0 else leather
    box('Binder page block',(.06,y,0),(1.55,.27,2.31),paper,g,.02)
    for j in range(11):box('Individual page edge',(.09,y-.115+j*.022,.007),(1.51,.004,2.29),thread,g,.001)
    for side in [-1,1]:box('Padded binder cover',(0,y+side*.161,0),(1.80,.063,2.53),cover,cover_group if layer==1 and side==1 else g,.07,segments=4)
    box('Rounded binder spine',(-.82,y,0),(.19,.36,2.50),cover,g,.075)
    line('Zipper tape',[(x,y,z) for x,_,z in rounded_path(1.71,2.45,.10)],.025,rubber,g,True)
    for x in [-.854,.854]:
        for i in range(31):box('Metal zipper tooth',(x,y,-1.15+i*.076),(.041,.025,.034),steel,g,.005,segments=1)
    for z in [-1.225,1.225]:
        for i in range(21):box('Metal zipper tooth',(-.76+i*.076,y,z),(.034,.025,.041),steel,g,.005,segments=1)
    box('Zipper slider',(.85,y,.95),(.10,.071,.14),steel,g,.02)
    torus('Zipper pull loop',(.95,y+.025,1.06),.10,.020,steel,g,axis=(0,1,0),major_segments=24)
    # Fine gold corner plates and foil lettering are raised only 0.1 mm.
    if layer==1:
        top=y+.195;stitches(cover_group,1.65,2.36,top,thread,.085,.0028)
        text('Binder cover title','收藏册',(.05,top,-.18),.25,brass,cover_group,True)
        line('Binder foil diamond',[(-.23,top,-.87),(0,top,-1.05),(.23,top,-.87),(0,top,-.69)],.009,brass,cover_group,True)
collision('zippered-collection-binders',g,[2.09,.81,2.65],.414)

# Real corrugated cardboard storage entrance on the rear right of the desk.
cardboard=material('Natural kraft cardboard','#bf9561',.93)
cut_edge=material('Corrugated cut edges','#8e6a43',.95)
hint_ink=material('Subtle desk entrance ink','#8c8872',.95)
g=group('Warehouse',(7.98,.044,-5.55))
box('Warehouse floor',(0,.055,0),(2.72,.11,2.38),cardboard,g,.012)
for x in [-1.315,1.315]:box('Warehouse side wall',(x,.98,0),(.09,1.85,2.38),cardboard,g,.012)
for z in [-1.145,1.145]:
    box('Warehouse front rear panel',(0,.98,z),(2.54,1.85,.09),cardboard,g,.012)
    box('Warehouse panel folded edge',(0,1.87,z),(2.54,.042,.101),cut_edge,g,.005)
for x in [-1.27,1.27]:
    line('Warehouse vertical crease',[(x,.12,1.199),(x,1.83,1.199)],.006,cut_edge,g)
    for j in range(18):box('Warehouse corrugated flute',(x,1.893,-1.08+j*.124),(.012,.008,.045),cut_edge,g,.002,segments=1)
text('Warehouse player facing label','仓库',(0,1.08,1.197),.53,ink,g,extrude=.0018)
box('Warehouse front label underline',(0,.72,1.199),(1.18,.013,.009),cut_edge,g,.002)
for side,name in [(1,'WarehouseFlapFront'),(-1,'WarehouseFlapBack')]:
    flap=group(name,(7.98,.044,-5.55))
    o=box('Warehouse hinged cardboard flap',(0,1.946,side*.604),(2.55,.057,1.09),cardboard,flap,.009)
    o.rotation_euler.x=side*.065
    box('Warehouse flap fold line',(0,1.913,side*1.102),(2.53,.009,.022),cut_edge,flap,.002)
collision('warehouse-cardboard-carton',g,[2.72,2.03,2.38],1.015)

def entrance_hint(name,pos,label,direction):
    h=group(name,pos)
    text(name+' functional label',label,(0,.003,.34),.205,hint_ink,h,True,extrude=.0004)
    # Thin inlaid geometry, oriented toward the actual entrance rather than a HUD.
    dz=-.50 if direction=='rear' else -.34
    line(name+' arrow shaft',[(0,.002,.04),(0,.002,dz)],.012,hint_ink,h)
    line(name+' arrowhead',[(-.12,.002,dz+.14),(0,.002,dz),(.12,.002,dz+.14)],.012,hint_ink,h)
entrance_hint('AlbumHint',(-8.57,.047,-3.12),'收藏册','rear')
entrance_hint('ShopHint',(8.29,.047,2.44),'购买','rear')

# 05 / Deck accessories tray, flock lining, one open deck case, sleeve pile.
g=group('Organizer',(4.21,.005,-6.52))
box('Walnut accessory tray floor',(0,.085,0),(4.22,.17,1.24),wood,g,.085)
box('Tray flock liner',(0,.181,0),(4.03,.017,1.04),rubber,g,.05)
for x in [-2.06,2.06]:box('Tray side',(x,.28,0),(.095,.40,1.23),wood,g,.027)
for z in [-.57,.57]:box('Tray lip',(0,.24,z),(4.15,.31,.08),wood,g,.025)
for i,x in enumerate([-1.43,-.27]):
    mat=leather if not i else navy
    box('Deck case base',(x,.27,0),(.94,.15,.84),mat,g,.055)
    for xx in [x-.438,x+.438]:box('Deck case side',(xx,.82,0),(.065,1.08,.84),mat,g,.027)
    for z in [-.39,.39]:box('Deck case face',(x,.82,z),(.91,1.08,.065),mat,g,.027)
    for j in range(25):box('Sleeved deck leaf',(x,.36+j*.030,0),(.79,.013,.67),sleeve if j%2 else paper,g,.012)
    if i==0:
        box('Closed magnetic cover',(x,1.39,0),(.98,.12,.87),mat,g,.045)
        box('Magnetic front flap',(x,1.15,.46),(.95,.45,.056),mat,g,.035)
    else:
        lid=box('Open hinged lid',(x,1.58,-.43),(.97,.70,.07),mat,g,.035);lid.rotation_euler.x=math.radians(-22)
        text('Deck case inside emblem','100+', (x,1.68,-.384),.16,brass,g)
    box('Brass deck badge',(x,1.13,.493),(.31,.16,.019),brass,g,.015)
    text('Deck badge number','01' if not i else '02',(x,1.13,.506),.088,ink,g)
    for xx in [-.33,.33]:cyl('Flap rivet',(x+xx,1.16,.447),.022,.02,brass,g,16,axis=(0,0,1))
    for j in range(11):box('Deck case seam',(x-.38+j*.076,.44,.435),(.026,.012,.005),thread,g,.002)
box('Sleeve divider',(.45,.36,0),(.04,.36,1.04),brass,g,.008)
for i in range(12):box('Spare clear sleeve', (1.24,.201+i*.018,.015),(1.13,.013,.77),paper if i%3 else sleeve,g,.014)
box('Sleeve packet band',(1.24,.425,.015),(.30,.010,.76),navy,g,.008)
text('Sleeve packet label','SLEEVES',(1.24,.434,.014),.067,paper,g,True)
collision('deck-case-and-sleeve-tray',g,[4.28,1.98,1.32],.99)

# 06 / Hollow ceramic mug with rolled lip, a real handle and two liquid rings.
g=group('Cup',(8.87,.01,-2.75))
cyl('Cork coaster',(0,.04,0),.61,.072,edge,g,64);torus('Coaster stitched ring',(0,.081,0),.55,.004,thread,g,major_segments=64,minor_segments=4)
profile=[(.21,.085),(.29,.10),(.328,.18),(.376,.67),(.370,.79),(.357,.82),(.333,.817),(.323,.785),(.326,.70),(.289,.24),(.24,.20),(.0,.20)]
lathe('Ceramic mug hollow profile',profile,cream,g,64)
handle=torus('Glazed mug handle',(.397,.47,0),.247,.070,cream,g,axis=(0,0,1),major_segments=48,minor_segments=12);handle.scale.x=.86;handle.scale.z=1.15
cyl('Coffee liquid',(0,.727,0),.325,.005,coffee,g,64,bevel=0)
torus('Coffee meniscus',(0,.731,0),.312,.005,edge,g,major_segments=64,minor_segments=4)
text('Mug makers mark','DA',(0,.42,.352),.135,navy,g)
collision('ceramic-mug-and-coaster',g,[1.30,.84,1.25],.425)

# 07 / Leather tool mat, retractable knife, cap pen and precision scissors.
g=group('Tools',(8.72,.006,3.21),.12)
box('Tool rest leather',(0,.049,0),(1.42,.054,2.68),leather,g,.10);stitches(g,1.27,2.52,.079,thread,.09,.003)
rod('Pen barrel',(-.44,.14,-.99),(-.37,.14,.65),.045,black,g,24)
rod('Pen cap',(-.44,.14,-.99),(-.43,.14,-.51),.052,brass,g,24)
cyl('Pen end jewel',(-.438,.141,-1.0),.037,.018,navy,g,24,axis=(0,0,1))
rod('Pen cap clip',(-.38,.19,-.89),(-.36,.19,-.50),.009,steel,g,8)
box('Knife milled body',(.05,.141,-.10),(.26,.105,1.56),black,g,.055)
box('Knife metal rail',(.05,.2,-.10),(.19,.020,1.4),steel,g,.026)
for i in range(15):box('Knife thumb grip groove',(.05,.214,-.41+i*.044),(.13,.004,.014),rubber,g,.003)
box('Knife lock slider',(.05,.237,-.55),(.17,.038,.25),brass,g,.025)
box('Retracted blade face',(.05,.175,-.88),(.17,.018,.12),steel,g,.003)
for x,z in [(.40,.85),(.62,.88)]:torus('Scissor finger loop',(x,.138,z),.142,.029,navy,g,major_segments=32,minor_segments=8)
for x in [.42,.59]:rod('Scissor steel arm',(x,.128,.74),(.49,.128,-.56),.023,steel,g,8)
screw(g,(.5,.147,.4),.050)
collision('precision-tools-and-leather-rest',g,[1.47,.29,2.75],.151)

# 08 / Dice tray with recessed pips, a faceted twenty-sided die and metal token.
g=group('Dice',(-8.57,.009,-1.74),-.12)
box('Dice tray base',(0,.054,0),(1.89,.09,1.57),navy,g,.11)
box('Dice tray suede liner',(0,.108,0),(1.63,.014,1.32),rubber,g,.08)
for x in [-.9,.9]:box('Tray raised side',(x,.194,0),(.11,.27,1.53),navy,g,.04)
for z in [-.73,.73]:box('Tray raised lip',(0,.19,z),(1.81,.26,.10),navy,g,.04)
for x in [-.77,.77]:
    for z in [-.61,.61]:screw(g,(x,.22,z),.029)
die=box('D6 beveled ivory die',(-.36,.36,-.15),(.46,.46,.46),cream,g,.055,segments=4)
# Boolean dimples on three camera-facing sides; bowls are cut into the solid mesh.
for axis,values in [('top',[(-.11,-.11),(.11,.11),(-.11,.11),(.11,-.11), (0,0)]),('front',[(-.11,-.11),(.11,.11),(0,0)]),('right',[(-.1,-.1),(.1,.1)])]:
    for u,v in values:
        p=(-.36+u,.599,-.15+v) if axis=='top' else ((-.36+u,.36+v,.089) if axis=='front' else (-.121,.36+u,-.15+v))
        cutter=sphere('Die pip cutter',p,.043,ink,g,12,8)
        bpy.context.view_layer.objects.active=die;mod=die.modifiers.new('Recessed pip','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name)
        meshes.remove(cutter);bpy.data.objects.remove(cutter,do_unlink=True)
        q=Vector(p);q+=Vector((0,-.018,0) if axis=='top' else ((0,0,-.018) if axis=='front' else (-.018,0,0)))
        sphere('Dark pip bowl',q,.026,ink,g,12,8)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.29,location=xyz((.33,.36,-.2)));d20=finish(bpy.context.object,'D20 faceted counter',red,g,.006,1,False)
text('D20 engraved number','20',(.33,.619,-.20),.145,brass,g,True)
cyl('Metal first-player coin',(.39,.15,.39),.20,.034,brass,g,48);torus('Coin knurled rim',(.39,.17,.39),.175,.007,steel,g,major_segments=40)
text('Coin emblem','I',(.39,.176,.39),.22,ink,g,True)
collision('recessed-dice-and-token-tray',g,[1.96,.70,1.65],.353)

# 09 / Phone and its pad. Runtime swaps only the PhoneScreen material.
g=group('PhonePad',(8.3,0,.7),-.18)
box('Phone pad rubber',(0,.027,0),(1.54,.043,2.55),rubber,g,.12)
box('Phone pad leather',(0,.052,0),(1.48,.010,2.48),navy,g,.11);stitches(g,1.34,2.31,.059,thread,.08,.0028)
g=group('Phone',(8.3,.125,.7),-.18)
box('Milled anodized phone frame',(0,0,0),(1.074,.138,2.068),steel,g,.066,segments=6)
box('Phone black front gasket',(0,.062,0),(1.041,.023,2.030),rubber,g,.011,segments=5)
box('Phone polished glass',(0,.078,0),(1.007,.010,1.994),black,g,.004,segments=5)
# A planar top surface with normalized UVs for the existing interactive screen artwork.
verts=[(-.482,.966,.084),(.482,.966,.084),(.482,-.966,.084),(-.482,-.966,.084)];me=bpy.data.meshes.new('Phone screen UV plane');me.from_pydata(verts,[],[(3,2,1,0)]);me.uv_layers.new()
for i,uv in enumerate([(0,0),(1,0),(1,1),(0,1)]):me.uv_layers.active.data[i].uv=uv
o=bpy.data.objects.new('Phone screen',me);scene.collection.objects.link(o);o.data.materials.append(screen);parent(o,g)
box('Earpiece capsule',(0,.091,-.875),(.30,.013,.052),rubber,g,.006)
for i in range(9):box('Earpiece grille opening',(-.103+i*.026,.099,-.875),(.010,.002,.021),steel,g,.001)
cyl('Front camera lens',(.227,.094,-.873),.027,.009,black,g,24);cyl('Lens blue reflection',(.227,.100,-.873),.014,.004,navy,g,20)
box('Home gesture bar',(0,.094,.894),(.26,.004,.014),paper,g,.004)
box('Power key',(.544,0,-.35),(.028,.048,.25),steel,g,.013)
for z in [-.36,-.06]:box('Volume key',(-.544,0,z),(.028,.048,.19),steel,g,.013)
for x in [-.526,.526]:
    for z in [-.79,.79]:box('Antenna separator',(x,-.002,z),(.021,.110,.025),paper,g,.007)
box('USB-C recessed port',(0,0,1.037),(.218,.048,.012),rubber,g,.005)
box('USB-C inner tongue',(0,-.004,1.047),(.139,.009,.006),steel,g,.003)
for x in [-.38,-.325,-.270,.27,.325,.38]:cyl('Bottom speaker drilled hole',(x,0,1.039),.012,.009,rubber,g,12,axis=(0,0,1),bevel=0)
for x in [-.18,.18]:cyl('Pentalobe screw',(x,-.004,1.041),.014,.008,steel,g,12,axis=(0,0,1),bevel=0)

# 10 / Actual card-shop surroundings: panelled walls, shelves, singles case,
# labelled white storage bins, an adjacent play table and upholstered chairs.
g=group('Room')
box('Shop floor',(0,-7.38,-5),(66,.18,50),floor,g,.0)
for x in range(-30,32,4):box('Tile grout x',(x,-7.284,-5),(.017,.006,50),ink,g,.0)
for z in range(-28,22,4):box('Tile grout z',(0,-7.284,z),(66,.006,.017),ink,g,.0)
box('Rear plaster wall',(0,3.3,-13.9),(46,21.4,.32),wall,g,.04)
box('Rear wainscot',(0,-3.45,-13.69),(46,7.6,.18),panel,g,.015)
for x in range(-22,24,3):box('Wall stile',(x,-3.45,-13.56),(.10,7.6,.095),edge,g,.012)
box('Wall dado rail',(0,.33,-13.53),(46,.18,.22),wood,g,.035)
box('Baseboard',(0,-7.08,-13.46),(46,.31,.19),edge,g,.02)
box('Side wall',(-23,3.3,-5),(.3,21.4,18),panel,g,.02)
text('Store wall sign','DUEL   ARCHIVE',(0,7.9,-13.49),1.06,brass,g,extrude=.015)
text('Store wall descriptor','SINGLES  /  SEALED  /  PLAY SPACE',(0,6.70,-13.47),.225,paper,g)
box('Sign underline',(0,6.2,-13.46),(10.4,.035,.024),brass,g,.01)
# Rear merchandise wall: clean divisions with tiny real labels and thumb slots.
for sx in [-9.6,9.6]:
    box('Retail shelving back',(sx,-.40,-13.2),(6.75,11.6,.14),panel,g,.02)
    for x in [sx-3.38,sx+3.38]:box('Retail shelf upright',(x,-.40,-12.55),(.12,11.7,1.55),black,g,.02)
    for y in [-6.0,-4.05,-2.1,.0,2.1,4.7]:box('Walnut retail shelf',(sx,y,-12.49),(6.77,.14,1.59),wood,g,.03)
    for row in range(3):
        for col in range(5):
            x=sx-2.68+col*1.34;y=-5.26+row*1.95
            box('Card archive storage bin',(x,y,-12.38),(1.24,1.29,1.30),paper,g,.025)
            box('Storage bin lid',(x,y+.64,-12.38),(1.28,.085,1.33),paper,g,.02)
            box('Bin recessed thumb slot',(x,y+.21,-11.719),(.26,.065,.011),edge,g,.025)
            box('Bin label field',(x,y-.13,-11.711),(.66,.25,.008),navy,g,.004)
            box('Storage bin inset handle',(x,y+.21,-11.710),(.20,.028,.019),ink,g,.012)
            for side in [-1,1]:box('Storage bin lid rolled rim',(x+side*.61,y+.635,-12.38),(.025,.064,1.28),thread,g,.005)
    for row,y in enumerate([.63,2.80]):
        for col in range(6):
            x=sx-2.72+col*1.08;mat=[leather,navy,red][(col+row)%3]
            box('Retail sealed booster box',(x,y,-12.40),(.94,1.14,1.1),mat,g,.035)
            box('Retail box foil trim',(x,y,-11.84),(.80,.76,.010),brass,g,.015)
            box('Retail box center panel',(x,y,-11.832),(.72,.68,.008),mat,g,.009)
            box('Retail box folded lid',(x,y+.557,-12.40),(.96,.065,1.12),mat,g,.015)
            box('Retail box lid seam',(x,y+.588,-12.40),(.014,.006,1.02),ink,g,.002)
            for edge_x in [-.43,.43]:box('Retail embossed edge',(x+edge_x,y,-11.824),(.013,1.05,.008),brass,g,.003)
            line('Retail geometric foil crest',[(x-.18,y,-11.817),(x,y+.24,-11.817),(x+.18,y,-11.817),(x,y-.24,-11.817)],.012,brass,g,True)
            for v in [-.29,.29]:box('Retail packaging fine rule',(x,y+v,-11.818),(.48,.012,.009),paper,g,.003)
            box('Retail tamper seal',(x,y+.568,-11.835),(.12,.11,.018),paper,g,.006)
    box('Shelf underlight',(sx,4.59,-11.86),(6.2,.04,.045),light,g,.008)

# Low center glass showcase with three shelves of individually framed singles.
box('Singles display plinth',(0,-6.05,-11.25),(10.6,1.76,2.50),wood,g,.09)
box('Display cabinet rear',(0,-2.17,-12.43),(10.6,6.10,.09),panel,g,.01)
for x in [-5.23,0,5.23]:box('Display metal upright',(x,-2.14,-10.01),(.09,6.1,.10),black,g,.016)
for y in [-5.18,-3.2,-1.22,.8]:
    box('Display shelf',(0,y,-11.22),(10.51,.045,2.37),glass,g,.008)
    box('Display shelf front rail',(0,y,-10.01),(10.6,.079,.08),steel,g,.018)
box('Glass display front',(0,-2.16,-9.981),(10.42,5.90,.012),glass,g,.002)
box('Display top surround',(0,.85,-11.22),(10.7,.17,2.57),black,g,.05)
box('Display glass top',(0,.95,-11.22),(10.47,.035,2.33),glass,g,.01)
box('Display integrated LED',(0,.73,-10.1),(10.0,.045,.06),light,g,.008)
text('Singles case header','COLLECTOR SINGLES',(0,-5.97,-9.96),.33,brass,g)

# An adjacent long play table and two chairs, kept outside the active desk volume.
for sx in [-17.4,17.4]:
    box('Adjacent play table',(sx,-.88,-5.2),(6.6,.30,6.5),wood,g,.11)
    box('Adjacent play mat',(sx,-.719,-5.2),(5.1,.023,4.1),fabric,g,.06)
    for x in [-2.65,2.65]:
        for z in [-2.55,2.55]:box('Adjacent table leg',(sx+x,-4.12,-5.2+z),(.23,6.2,.23),black,g,.025)
    for z in [-9.9,-.3]:
        box('Chair seat',(sx,-3.39,z),(2.70,.35,2.6),leather,g,.14)
        for x in [-1.09,1.09]:
            for zz in [-1.04,1.04]:rod('Chair chrome leg',(sx+x,-3.54,z+zz),(sx+x*1.08,-7.21,z+zz*1.1),.060,steel,g)
        back=z+(-1.18 if z<-5 else 1.18)
        box('Padded chair back',(sx,-1.95,back),(2.65,2.52,.28),leather,g,.14)
        for x in [-1.06,1.06]:rod('Chair back support',(sx+x,-3.4,back),(sx+x,-.71,back),.059,steel,g)

# Pendant fixtures are present in the source environment, outside the central view.
for x in [-11,11]:
    rod('Pendant suspension',(x,13.8,-8.0),(x,9.1,-8.0),.023,black,g)
    cyl('Pendant upper housing',(x,9.13,-8.0),.57,.26,black,g,48)
    cyl('Pendant opal tube',(x,8.35,-8.0),.43,1.30,light,g,48)
    cyl('Pendant lower rim',(x,7.70,-8.0),.47,.06,brass,g,48)

# Lighting and Blender review cameras. Lights are recreated in the runtime scene.
def area(name,pos,target,energy,size,rgb):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=rgb
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=xyz(pos);ob.rotation_euler=(Vector(xyz(target))-ob.location).to_track_quat('-Z','Y').to_euler();return ob
area('Large warm shop softbox',(-8,16,9),(0,0,0),4900,12,(1,.93,.83))
area('Cool window fill',(13,10,0),(0,0,-1),3400,10,(.83,.92,1))
area('Back wall wash',(0,9,-8),(0,1,-13),2900,9,(1,.93,.84))
def camera(name,pos,target,lens=48):
    data=bpy.data.cameras.new(name);data.lens=lens;data.clip_end=300;ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=xyz(pos);ob.rotation_euler=(Vector(xyz(target))-ob.location).to_track_quat('-Z','Y').to_euler();return ob
scene.camera=camera('Gameplay preview',(0,16.0,18.7),(0,.0,-.2),41)
camera('Binder and dice details',(-7.1,5.3,1.0),(-8.6,.3,-4.0),56)
camera('Phone and tools details',(10.8,5.0,5.8),(8.5,.08,1.5),59)
camera('Mug and deck case details',(7.8,4.2,.6),(6.5,.65,-5.0),57)
for area_ui in bpy.context.screen.areas:
    if area_ui.type=='VIEW_3D':area_ui.spaces.active.region_3d.view_perspective='CAMERA'
scene['reference_document']='research/card-shop/REFERENCES.md'
scene['authoring']='Built and evaluated in Blender; object names and modifiers retained.'
scene['game_units']='1 game unit = 100 mm; table surface Y=0.044 in Three.js.'
blend_path=OUT/'card-shop.blend'
scene['asset_groups']=json.dumps(list(groups));scene['colliders']=json.dumps(colliders)
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
print('SOURCE_SAVED',blend_path,flush=True)

import sys
sys.path.insert(0,str(ROOT/'scripts'))
from export_card_shop import export_card_shop
export_card_shop(scene,groups,meshes,colliders,ROOT,START)
if '--render' in __import__('sys').argv:
    scene.render.filepath=str(OUT/'card-shop-overview.png');bpy.ops.render.render(write_still=True)
    scene.camera=bpy.data.objects['Phone and tools details'];scene.render.filepath=str(OUT/'phone-tools-detail.png');bpy.ops.render.render(write_still=True)
    scene.camera=bpy.data.objects['Binder and dice details'];scene.render.filepath=str(OUT/'binder-dice-detail.png');bpy.ops.render.render(write_still=True)
print('DONE_SECONDS',round(time.time()-START,2),flush=True)
