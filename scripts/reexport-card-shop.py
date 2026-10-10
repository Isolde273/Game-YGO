"""Re-export the editable .blend after manual edits, without rebuilding geometry."""
import bpy,sys,json,time
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'scripts'))
from export_card_shop import export_card_shop
started=time.time();bpy.ops.wm.open_mainfile(filepath=str(root/'art/blender/card-shop.blend'))
meta=json.loads((root/'art/blender/build-manifest.json').read_text())
scene=bpy.context.scene
group_names=json.loads(scene['asset_groups']) if 'asset_groups' in scene else [o.name for o in scene.objects if o.type=='EMPTY' and o.parent is None]
groups={name:bpy.data.objects[name] for name in group_names}
colliders=json.loads(scene['colliders']) if 'colliders' in scene else meta['colliders']
if 'Warehouse' in groups and not any(c['group']=='Warehouse' for c in colliders):
    g=groups['Warehouse'];colliders.append({'name':'warehouse-cardboard-carton','group':'Warehouse','position':[g.location.x,g.location.z+1.015,-g.location.y],'size':[2.72,2.03,2.38],'yaw':g.rotation_euler.z})
for font in bpy.data.fonts:
    if Path(bpy.path.abspath(font.filepath)).is_file() and not font.packed_file:font.pack()
scene['asset_groups']=json.dumps(group_names);scene['colliders']=json.dumps(colliders)
bpy.ops.wm.save_as_mainfile(filepath=str(root/'art/blender/card-shop.blend'))
meshes=[o for o in bpy.context.scene.objects if o.parent in groups.values() and o.type in {'MESH','CURVE','FONT'}]
export_card_shop(scene,groups,meshes,colliders,root,started)
