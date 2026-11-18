import bpy
import bmesh
import math
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_pbr_mat(name, base_color, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


def create_curve_mesh(name, points_with_radius, bevel_depth=0.012, bevel_res=2, cyclic=False, mat=None):
    curve_data = bpy.data.curves.new(name=name + "_curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = bevel_depth
    curve_data.bevel_resolution = bevel_res
    curve_data.fill_mode = "FULL"
    curve_data.use_fill_caps = True

    spline = curve_data.splines.new(type="POLY")
    spline.points.add(len(points_with_radius) - 1)
    for i, (x, y, z, r) in enumerate(points_with_radius):
        spline.points[i].co = (x, y, z, 1.0)
        spline.points[i].radius = r
    spline.use_cyclic_u = cyclic

    curve_obj = bpy.data.objects.new(name + "_cobj", curve_data)
    bpy.context.collection.objects.link(curve_obj)
    bpy.context.view_layer.objects.active = curve_obj
    curve_obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    mesh_obj = bpy.context.view_layer.objects.active
    mesh_obj.name = name
    for poly in mesh_obj.data.polygons:
        poly.use_smooth = True
    if mat:
        mesh_obj.data.materials.append(mat)
    mesh_obj.select_set(False)
    return mesh_obj


def create_rounded_rect_pts(w, h, corner_r, corner_segs=14):
    hw = w * 0.5 - corner_r
    hh = h * 0.5 - corner_r
    corners = [
        (hw, hh, 0.0, math.pi * 0.5),
        (-hw, hh, math.pi * 0.5, math.pi),
        (-hw, -hh, math.pi, math.pi * 1.5),
        (hw, -hh, math.pi * 1.5, math.pi * 2.0),
    ]
    pts = []
    for cx, cy, a0, a1 in corners:
        for s in range(corner_segs):
            t = s / corner_segs
            a = a0 + (a1 - a0) * t
            pts.append((cx + math.cos(a) * corner_r, cy + math.sin(a) * corner_r))
    return pts


def create_uv_card_face_plane(name, w, h, corner_r, z_pos, flip_normal=False, mat=None):
    mesh = bpy.data.meshes.new(name + "_mesh")
    bm = bmesh.new()
    pts = create_rounded_rect_pts(w, h, corner_r, corner_segs=14)
    verts = [bm.verts.new((x, y, z_pos)) for (x, y) in pts]
    if flip_normal:
        verts.reverse()
    face = bm.faces.new(verts)

    uv_layer = bm.loops.layers.uv.new("UVMap")
    for loop in face.loops:
        co = loop.vert.co
        u = ((-co.x / w) + 0.5) if flip_normal else ((co.x / w) + 0.5)
        v = (co.y / h) + 0.5
        loop[uv_layer].uv = (max(0.0, min(1.0, u)), max(0.0, min(1.0, v)))

    bmesh.ops.triangulate(bm, faces=[face])
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    return obj


def create_extruded_card_core(name, w, h, corner_r, thickness, bevel_w, mat):
    mesh = bpy.data.meshes.new(name + "_mesh")
    bm = bmesh.new()
    pts = create_rounded_rect_pts(w, h, corner_r, corner_segs=14)
    bottom_verts = [bm.verts.new((x, y, -thickness * 0.5)) for (x, y) in pts]
    f_bot = bm.faces.new(list(reversed(bottom_verts)))
    ret = bmesh.ops.extrude_face_region(bm, geom=[f_bot])
    extruded_verts = [ele for ele in ret["geom"] if isinstance(ele, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=extruded_verts, vec=(0.0, 0.0, thickness))

    bmesh.ops.bevel(
        bm,
        geom=list(bm.edges),
        offset=bevel_w,
        offset_type="OFFSET",
        segments=2,
        profile=0.5,
        affect="EDGES",
    )
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    return obj


def spiral_scroll_pts(cx, cy, z, sx, sy, start_r, end_r, turns=1.4, steps=18):
    pts = []
    for i in range(steps):
        t = i / (steps - 1)
        ang = t * math.pi * 2.0 * turns
        rad = start_r * (1.0 - t) + end_r * t
        x = cx + sx * math.cos(ang) * rad
        y = cy + sy * math.sin(ang) * rad
        r_thick = 0.22 + math.sin(t * math.pi) * 0.92
        pts.append((x, y, z, r_thick))
    return pts


def add_faceted_gem(name, loc, rx, ry, rz, mat):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=loc)
    gem = bpy.context.view_layer.objects.active
    gem.name = name
    gem.scale = (rx, ry, rz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for poly in gem.data.polygons:
        poly.use_smooth = False
    if mat:
        gem.data.materials.append(mat)
    gem.select_set(False)
    return gem


def create_millegrain_beads(name, coords_3d, radius, mat):
    mesh = bpy.data.meshes.new(name + "_mesh")
    bm = bmesh.new()
    for (x, y, z) in coords_3d:
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius, matrix=Matrix_Trans(x, y, z))
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    return obj


def Matrix_Trans(x, y, z):
    from mathutils import Matrix
    return Matrix.Translation((x, y, z))


def join_objects(objs, final_name):
    bpy.ops.object.select_all(action="DESELECT")
    valid = [o for o in objs if o is not None]
    for o in valid:
        o.select_set(True)
    bpy.context.view_layer.objects.active = valid[0]
    if len(valid) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = final_name
    joined.select_set(False)
    return joined


def build_baroque_card_glb():
    clear_scene()

    W = 1.00
    H = 1.48
    CORNER_R = 0.108
    THICK = 0.024

    gold_mat = make_pbr_mat("GoldFoil3D", (0.91, 0.74, 0.44), metallic=0.96, roughness=0.18)
    rose_gold_mat = make_pbr_mat("RoseGoldFiligree", (0.92, 0.67, 0.59), metallic=0.93, roughness=0.22)
    ruby_mat = make_pbr_mat("CabochonRuby", (0.64, 0.07, 0.18), metallic=0.15, roughness=0.08)
    pearl_mat = make_pbr_mat("SalonPearl", (0.98, 0.94, 0.88), metallic=0.10, roughness=0.16)
    front_mat = make_pbr_mat("CardFrontMat", (0.96, 0.92, 0.86), metallic=0.45, roughness=0.38)
    back_mat = make_pbr_mat("CardBackMat", (0.14, 0.06, 0.16), metallic=0.55, roughness=0.36)

    core = create_extruded_card_core("CardGoldCore", W, H, CORNER_R, THICK, 0.006, gold_mat)

    front_face = create_uv_card_face_plane(
        "CardFrontCanvas", W - 0.032, H - 0.032, CORNER_R * 0.80, -THICK * 0.5 - 0.0008, flip_normal=True, mat=front_mat
    )
    back_face = create_uv_card_face_plane(
        "CardBackCanvas", W - 0.032, H - 0.032, CORNER_R * 0.80, THICK * 0.5 + 0.0008, flip_normal=False, mat=back_mat
    )

    filigree_parts = [core]
    gems = []
    pearls = []

    # 正反双面精雕皇家巴洛克边框、涡卷茛苕叶与珠边（Millegrain）
    for side_sign in (-1.0, 1.0):
        zf = side_sign * (THICK * 0.5 + 0.0038)
        outer_pts = [
            (x, y, zf, 1.05) for (x, y) in create_rounded_rect_pts(W - 0.042, H - 0.042, CORNER_R * 0.72, 7)
        ]
        filigree_parts.append(
            create_curve_mesh(f"OuterBorder_{side_sign}", outer_pts, bevel_depth=0.0062, bevel_res=2, cyclic=True, mat=gold_mat)
        )

        inner_pts = [
            (x, y, zf, 0.88) for (x, y) in create_rounded_rect_pts(W - 0.098, H - 0.098, CORNER_R * 0.50, 6)
        ]
        filigree_parts.append(
            create_curve_mesh(f"InnerBorder_{side_sign}", inner_pts, bevel_depth=0.0034, bevel_res=2, cyclic=True, mat=rose_gold_mat)
        )

        # 左右腰线皇家蔷薇花结（Side Rosettes）
        for sx in (-1.0, 1.0):
            rx = sx * (W * 0.5 - 0.048)
            gems.append(add_faceted_gem(f"SideGem_{side_sign}_{sx}", (rx, 0.0, zf + side_sign * 0.004), 0.014, 0.024, 0.009, ruby_mat))
            for sy_leaf in (-1.0, 1.0):
                leaf_pts = [
                    (rx, sy_leaf * 0.022, zf, 0.8),
                    (rx - sx * 0.028, sy_leaf * 0.075, zf + side_sign * 0.002, 0.95),
                    (rx, sy_leaf * 0.135, zf, 0.25),
                ]
                filigree_parts.append(
                    create_curve_mesh(f"SideLeaf_{side_sign}_{sx}_{sy_leaf}", leaf_pts, bevel_depth=0.004, bevel_res=2, mat=gold_mat)
                )

        # 四角双层巴洛克涡卷 + 切面红宝 + 珍珠簇
        for sx in (-1.0, 1.0):
            for sy in (-1.0, 1.0):
                cx = sx * (W * 0.5 - 0.102)
                cy = sy * (H * 0.5 - 0.102)
                scroll = spiral_scroll_pts(cx, cy, zf + side_sign * 0.0018, -sx, -sy, 0.078, 0.012, turns=1.35, steps=18)
                filigree_parts.append(
                    create_curve_mesh(f"Scroll_{side_sign}_{sx}_{sy}", scroll, bevel_depth=0.0048, bevel_res=2, mat=gold_mat)
                )
                wing_pts = [
                    (sx * (W * 0.5 - 0.048), sy * (H * 0.5 - 0.27), zf, 0.25),
                    (sx * (W * 0.5 - 0.088), sy * (H * 0.5 - 0.17), zf + side_sign * 0.0025, 1.05),
                    (sx * (W * 0.5 - 0.22), sy * (H * 0.5 - 0.074), zf, 0.30),
                ]
                filigree_parts.append(
                    create_curve_mesh(f"Wing_{side_sign}_{sx}_{sy}", wing_pts, bevel_depth=0.0042, bevel_res=2, mat=rose_gold_mat)
                )
                gems.append(
                    add_faceted_gem(
                        f"CornerGem_{side_sign}_{sx}_{sy}",
                        (sx * (W * 0.5 - 0.072), sy * (H * 0.5 - 0.072), zf + side_sign * 0.0038),
                        0.017,
                        0.017,
                        0.009,
                        ruby_mat,
                    )
                )
                pearls.append((sx * (W * 0.5 - 0.128), sy * (H * 0.5 - 0.068), zf + side_sign * 0.003))
                pearls.append((sx * (W * 0.5 - 0.068), sy * (H * 0.5 - 0.128), zf + side_sign * 0.003))

    # 正面(-Z)专属：新艺术穆夏式大教堂花拱 + 太阳神冠冕光芒 + 底部铭牌立体金框
    zf_front = -(THICK * 0.5 + 0.0044)
    arch_pts = []
    for i in range(29):
        t = i / 28.0
        ang = math.pi * (1.0 - t)
        ax = math.cos(ang) * (W * 0.5 - 0.088)
        ay = 0.21 + math.sin(ang) * 0.40 + (math.sin(ang) ** 3) * 0.048
        arch_pts.append((ax, ay, zf_front, 0.55 + math.sin(t * math.pi) * 0.72))
    filigree_parts.append(
        create_curve_mesh("FrontCathedralArch", arch_pts, bevel_depth=0.0046, bevel_res=2, mat=gold_mat)
    )
    # 拱顶 7 芒皇冠金辉
    for r_i in range(-3, 4):
        ang = math.pi * 0.5 + r_i * 0.22
        r_len = 0.062 if r_i == 0 else (0.046 if abs(r_i) % 2 == 1 else 0.034)
        ray_pts = [
            (math.cos(ang) * 0.018, 0.635 + math.sin(ang) * 0.012, zf_front - 0.002, 0.9),
            (math.cos(ang) * r_len, 0.635 + math.sin(ang) * r_len, zf_front, 0.18),
        ]
        filigree_parts.append(
            create_curve_mesh(f"CrownRay_{r_i}", ray_pts, bevel_depth=0.0036, bevel_res=2, mat=gold_mat)
        )
    gems.append(add_faceted_gem("FrontCrownGem", (0.0, 0.642, zf_front - 0.004), 0.022, 0.030, 0.011, ruby_mat))

    # 正面底部立体铭牌浮雕托框
    cartouche_pts = [
        (x, y - 0.525, zf_front, 0.85) for (x, y) in create_rounded_rect_pts(W - 0.20, 0.20, 0.032, 5)
    ]
    filigree_parts.append(
        create_curve_mesh("FrontCartoucheFrame", cartouche_pts, bevel_depth=0.0036, bevel_res=2, cyclic=True, mat=gold_mat)
    )

    # 背面(+Z)专属：凡尔赛星盘双环 + 36颗金珠 + 16芒立体金日 + 对称新月与百合花饰
    zf_back = THICK * 0.5 + 0.0052
    laurel_pts = [
        (math.cos(a * math.pi * 2 / 48) * 0.295, math.sin(a * math.pi * 2 / 48) * 0.455, zf_back, 0.95 + 0.28 * math.sin(a * 1.5))
        for a in range(48)
    ]
    filigree_parts.append(
        create_curve_mesh("BackLaurelOval", laurel_pts, bevel_depth=0.0056, bevel_res=2, cyclic=True, mat=gold_mat)
    )

    for b_i in range(36):
        ba = (b_i / 36.0) * math.pi * 2.0
        pearls.append((math.cos(ba) * 0.255, math.sin(ba) * 0.405, zf_back + 0.001))

    for ray in range(16):
        a = (ray / 16.0) * math.pi * 2.0
        r_len = 0.225 if ray % 2 == 0 else 0.145
        ray_pts = [
            (0.0, 0.0, zf_back + 0.006, 1.3),
            (math.cos(a) * r_len * 0.52, math.sin(a) * r_len * 0.52, zf_back + 0.0035, 0.78),
            (math.cos(a) * r_len, math.sin(a) * r_len, zf_back + 0.0006, 0.14),
        ]
        filigree_parts.append(
            create_curve_mesh(f"BackStarRay_{ray}", ray_pts, bevel_depth=0.0046, bevel_res=2, mat=gold_mat)
        )

    for sy in (-1.0, 1.0):
        cres_pts = []
        for i in range(17):
            t = (i / 16.0 - 0.5) * math.pi * 1.3
            cx = math.sin(t) * 0.125
            cy = sy * (0.335 - math.cos(t) * 0.072)
            cres_pts.append((cx, cy, zf_back + 0.003, math.cos(t * 0.9) * 1.15 + 0.15))
        filigree_parts.append(
            create_curve_mesh(f"BackCrescent_{sy}", cres_pts, bevel_depth=0.0046, bevel_res=2, mat=rose_gold_mat)
        )

    gems.append(add_faceted_gem("BackCenterGem", (0.0, 0.0, zf_back + 0.008), 0.036, 0.036, 0.015, ruby_mat))
    bead_obj = create_millegrain_beads("CardMillegrainPearls", pearls, 0.0058, pearl_mat)

    join_objects(filigree_parts, "CardBaroqueFrame")
    join_objects(gems, "CardCabochonGems")

    root = bpy.data.objects.new("BaroqueLenormandCard", None)
    bpy.context.collection.objects.link(root)
    for child_name in ("CardBaroqueFrame", "CardCabochonGems", "CardMillegrainPearls", "CardFrontCanvas", "CardBackCanvas"):
        obj = bpy.data.objects.get(child_name)
        if obj:
            obj.parent = root

    out_path = str(OUT_DIR / "baroque_card.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
    )
    print("Exported:", out_path)


if __name__ == "__main__":
    build_baroque_card_glb()
