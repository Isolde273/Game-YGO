"""Optimized glTF export shared by scene generation and re-export of the saved .blend."""
import bpy, json, base64, time
from pathlib import Path

def export_card_shop(scene,groups,meshes,colliders,root,start):
    ROOT=Path(root); OUT=ROOT/'art'/'blender'; ASSETS=ROOT/'public'/'assets'/'models'; START=start
    # Export evaluated mesh parts grouped by material. The editable source is untouched.
    source_scene=scene;export_scene=bpy.data.scenes.new('Optimized export');deps=bpy.context.evaluated_depsgraph_get();export_count=0;triangles=0
    for group_name,root in groups.items():
        export_root=bpy.data.objects.new(group_name,None);export_scene.collection.objects.link(export_root);export_root.matrix_world=root.matrix_world.copy();export_root['assetGroup']=group_name
        buckets={}
        for ob in meshes:
            if ob.parent!=root:continue
            evaluated=ob.evaluated_get(deps)
            try:me=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=deps)
            except RuntimeError:continue
            if me is None:continue
            transform=root.matrix_world.inverted()@ob.matrix_world
            for mi,mat in enumerate(me.materials):
                if mat is None:continue
                data=buckets.setdefault(mat,{'v':[],'f':[],'uv':[],'normals':[]})
                me.calc_loop_triangles()
                for tri in me.loop_triangles:
                    if tri.material_index!=mi:continue
                    face=[]
                    for li in tri.loops:
                        loop=me.loops[li];face.append(len(data['v']));data['v'].append(transform@me.vertices[loop.vertex_index].co)
                        normal=transform.to_3x3().inverted().transposed()@me.corner_normals[li].vector;data['normals'].append(normal.normalized())
                        # Box generated UVs are suitable for small parts; table top uses planar UV.
                        v=data['v'][-1]
                        data['uv'].append((v.x/21.6+.5,v.y/15.912+.5) if group_name=='Desk' and mat.name=='Oiled walnut' else (me.uv_layers.active.data[li].uv[:] if me.uv_layers.active else (v.x*.1,v.y*.1)))
                    data['f'].append(face)
            evaluated.to_mesh_clear()
        for mat,data in buckets.items():
            if not data['f']:continue
            assert len(data['v']) == len(data['normals']) == len(data['uv']), f'Incomplete corner data: {group_name} / {mat.name}'
            # Weld identical position/normal/UV corners before glTF export. Keep
            # hard edges and UV seams while avoiding three new vertices per face.
            lookup={};vertices=[];faces=[];corner_uv=[];corner_normals=[]
            for face in data['f']:
                ids=[]
                for index in face:
                    key=tuple(round(float(x),6) for x in (*data['v'][index],*data['normals'][index],*data['uv'][index]))
                    if key not in lookup:lookup[key]=len(vertices);vertices.append(data['v'][index])
                    ids.append(lookup[key])
                # Thin text strokes can produce zero-area triangles. Blender's
                # mesh builder removes them, so keep corner attributes aligned
                # with the accepted faces before applying custom normals.
                a,b,c=(vertices[i] for i in ids)
                if len(set(ids))<3 or (b-a).cross(c-a).length_squared<1e-18:continue
                faces.append(ids);corner_uv.extend(data['uv'][i] for i in face);corner_normals.extend(data['normals'][i] for i in face)
            me=bpy.data.meshes.new(group_name+' / '+mat.name);me.from_pydata(vertices,[],faces);me.update();me.materials.append(mat);me.uv_layers.new()
            assert len(me.loops)==len(corner_normals),f'Corner mismatch: {group_name} / {mat.name}'
            for i,uv in enumerate(corner_uv):me.uv_layers.active.data[i].uv=uv
            for p in me.polygons:p.use_smooth=True
            me.normals_split_custom_set(corner_normals)
            ob=bpy.data.objects.new(group_name+' / '+mat.name,me);export_scene.collection.objects.link(ob);ob.parent=export_root;export_count+=1;triangles+=len(data['f'])
    glb=ASSETS/'card-shop.glb'
    # glTF has no height-map slot. The exporter otherwise treats the grayscale
    # bump input as RGB normals, which darkens the entire tabletop in the game.
    # Keep the editable Blender materials intact; runtime recreates their bump.
    height_links=[]
    for mat in buckets_materials(export_scene):
        if not mat.use_nodes:continue
        for node in mat.node_tree.nodes:
            if node.type!='BSDF_PRINCIPLED':continue
            for link in list(node.inputs['Normal'].links):
                if link.from_node.type=='BUMP':
                    height_links.append((mat.node_tree,link.from_socket,link.to_socket))
                    mat.node_tree.links.remove(link)
    try:
        bpy.context.window.scene=export_scene
        bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_active_scene=True,export_apply=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_materials='EXPORT',export_extras=True)
    finally:
        bpy.context.window.scene=source_scene
        for tree,source,target in height_links:tree.links.new(source,target)
    payload=base64.b64encode(glb.read_bytes()).decode('ascii')
    (ROOT/'src'/'generated'/'card-shop-glb.js').write_text('// Generated by Blender: scripts/build-card-shop.py. Do not hand edit.\nexport const cardShopGLB="'+payload+'";\n',encoding='utf-8')
    meta={'blender':bpy.app.version_string,'source':'art/blender/card-shop.blend','model':'public/assets/models/card-shop.glb','sourceParts':len(meshes),'exportMeshes':export_count,'triangles':triangles,'bytes':glb.stat().st_size,'groups':list(groups),'colliders':colliders,'seconds':round(time.time()-START,2)}
    (OUT/'build-manifest.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    (ROOT/'src'/'generated'/'card-shop-meta.js').write_text('// Generated by Blender.\nexport const cardShopMeta='+json.dumps(meta,separators=(',',':'))+';\n',encoding='utf-8')
    print('EXPORT_COMPLETE',json.dumps(meta),flush=True)
    return meta

def buckets_materials(scene):
    return {mat for ob in scene.objects if ob.type=='MESH' for mat in ob.data.materials if mat}
