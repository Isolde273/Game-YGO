"""Open the saved Blender source, inspect it independently, and render details."""
import bpy,json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root/'art/blender/card-shop.blend'))
scene=bpy.context.scene
named=['Desk','Mat','Binder','BinderCover','Warehouse','WarehouseFlapFront','WarehouseFlapBack','AlbumHint','ShopHint','Organizer','Cup','Tools','Dice','PhonePad','Phone','Room']
assert all(bpy.data.objects.get(n) for n in named)
assert any(o.name.startswith('Recessed screw head') for o in scene.objects)
assert any(o.name.startswith('Metal zipper tooth') for o in scene.objects)
assert any(o.name.startswith('Bottom speaker drilled hole') for o in scene.objects)
assert any(o.name.startswith('D6 beveled ivory die') for o in scene.objects)
assert any(o.name.startswith('Card archive storage bin') for o in scene.objects)
for prefix in ['Lamp','Weighted lamp','Slim die-cast lamp','Braided lamp','Graded card slab','Slab illustration','Slab printed grading','Card foil motif','Printed archive label','Original retail packaging','Retail package small print','Price ticket','Price numerals']:
    assert not any(o.name.startswith(prefix) for o in scene.objects),prefix
labels={name:bpy.data.objects[name].data.body for name in ['Warehouse player facing label','AlbumHint functional label','ShopHint functional label','Binder cover title']}
assert labels=={'Warehouse player facing label':'仓库','AlbumHint functional label':'收藏册','ShopHint functional label':'购买','Binder cover title':'收藏册'}
assert bpy.data.objects['Warehouse player facing label'].location.y < -1.19
assert all(o.data.font.packed_file for o in scene.objects if o.type=='FONT' and any(ord(c)>127 for c in o.data.body))
report={'version':bpy.app.version_string,'source':bpy.data.filepath,'objects':len(scene.objects),'groups':named,'packedImages':[i.name for i in bpy.data.images if i.packed_file],'cameras':[o.name for o in scene.objects if o.type=='CAMERA'],'details':{prefix:sum(o.name.startswith(prefix) for o in scene.objects) for prefix in ['Metal zipper tooth','Individual page edge','Saddle stitch','Dark pip bowl','Bottom speaker drilled hole','Card archive storage bin','Graded card slab']}}
report['entranceLabels']=labels;report['removedLampAndDisplayedCards']=True;report['shelfPackagingTextRemoved']=True
(root/'test-results/blender-source-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('BLENDER_SOURCE_VERIFIED',json.dumps(report),flush=True)
if '--render' in sys.argv:
    scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True
    for camera,file,width,height in [('Gameplay preview','card-shop-overview.png',1440,900),('Phone and tools details','phone-tools-detail.png',1200,900),('Binder and dice details','binder-dice-detail.png',1200,900),('Mug and deck case details','mug-deck-detail.png',1200,900)]:
        scene.camera=bpy.data.objects[camera];scene.render.resolution_x=width;scene.render.resolution_y=height
        scene.render.filepath=str(root/'art/blender'/file);bpy.ops.render.render(write_still=True)
        print('RENDER_SAVED',file,flush=True)
if '--render-entrances' in sys.argv:
    from mathutils import Vector
    scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
    scene.camera=bpy.data.objects['Gameplay preview'];scene.render.resolution_x=1280;scene.render.resolution_y=800
    scene.render.filepath=str(root/'test-results/room-entrances/blender-overview.png');bpy.ops.render.render(write_still=True)
    camera=bpy.data.objects['Mug and deck case details'];camera.location=(10.5,.4,5.4);target=Vector((7.98,5.55,.98));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera
    scene.render.resolution_x=1000;scene.render.resolution_y=760;scene.render.filepath=str(root/'test-results/room-entrances/blender-warehouse.png');bpy.ops.render.render(write_still=True)
