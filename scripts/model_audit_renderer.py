#!/usr/bin/env python3
"""Deterministic OBJ audit renderer with a real software Z-buffer."""

from __future__ import annotations

import hashlib
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


BACKGROUND = np.array([31, 37, 35], dtype=np.uint8)


def normalize(value):
    value = np.asarray(value, dtype=np.float64)
    length = np.linalg.norm(value)
    return value / max(length, 1e-12)


@lru_cache(maxsize=4)
def read_mtl_colors(path):
    colors = {"default": np.array([0.62, 0.66, 0.63], dtype=np.float64)}
    if not path.exists():
        return colors
    current = "default"
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        parts = raw_line.strip().split()
        if not parts:
            continue
        if parts[0] == "newmtl" and len(parts) > 1:
            current = " ".join(parts[1:])
        elif parts[0] == "Kd" and len(parts) >= 4:
            colors[current] = np.clip(np.array([float(parts[1]), float(parts[2]), float(parts[3])]), 0.0, 1.0)
    return colors


@lru_cache(maxsize=4)
def parse_obj(path):
    vertices = []
    normals = []
    triangles = []
    material = "default"
    object_name = "default"

    def parse_index(raw, count):
        value = int(raw)
        return value - 1 if value > 0 else count + value

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        parts = raw_line.strip().split()
        if not parts or parts[0].startswith("#"):
            continue
        if parts[0] == "v" and len(parts) >= 4:
            vertices.append(tuple(float(value) for value in parts[1:4]))
        elif parts[0] == "vn" and len(parts) >= 4:
            normals.append(tuple(float(value) for value in parts[1:4]))
        elif parts[0] in ("o", "g") and len(parts) > 1:
            object_name = " ".join(parts[1:])
        elif parts[0] == "usemtl" and len(parts) > 1:
            material = " ".join(parts[1:])
        elif parts[0] == "f" and len(parts) >= 4:
            corners = []
            for token in parts[1:]:
                values = token.split("/")
                vertex_index = parse_index(values[0], len(vertices))
                normal_index = parse_index(values[2], len(normals)) if len(values) > 2 and values[2] else None
                corners.append((vertex_index, normal_index))
            for index in range(1, len(corners) - 1):
                triangles.append({
                    "corners": (corners[0], corners[index], corners[index + 1]),
                    "material": material,
                    "object": object_name,
                })
    return np.asarray(vertices, dtype=np.float64), np.asarray(normals, dtype=np.float64), triangles


def camera_basis(camera, target):
    camera = np.asarray(camera, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    forward = normalize(target - camera)
    helper = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    if abs(np.dot(forward, helper)) > 0.98:
        helper = np.array([0.0, 1.0, 0.0], dtype=np.float64)
    right = normalize(np.cross(forward, helper))
    up = normalize(np.cross(right, forward))
    return camera, right, up, forward


def project_vertices(vertices, camera, target, width, height, focal):
    camera, right, up, forward = camera_basis(camera, target)
    relative = vertices - camera
    camera_space = np.stack((relative @ right, relative @ up, relative @ forward), axis=1)
    z = camera_space[:, 2]
    screen = np.empty((len(vertices), 2), dtype=np.float64)
    screen[:, 0] = width * 0.5 + camera_space[:, 0] * focal / np.maximum(z, 1e-8)
    screen[:, 1] = height * 0.54 - camera_space[:, 1] * focal / np.maximum(z, 1e-8)
    return camera_space, screen


def render_passes(obj_path, mtl_path, camera, target, width=1100, height=760, focal=980.0):
    vertices, normals, triangles = parse_obj(obj_path)
    material_colors = read_mtl_colors(mtl_path)
    camera_space, screen = project_vertices(vertices, camera, target, width, height, focal)
    z_buffer = np.full((height, width), np.inf, dtype=np.float64)
    normal_buffer = np.zeros((height, width, 3), dtype=np.float64)
    beauty = np.broadcast_to(BACKGROUND, (height, width, 3)).copy()
    orientation = np.broadcast_to(BACKGROUND, (height, width, 3)).copy()
    object_id = np.zeros((height, width, 3), dtype=np.uint8)
    light_a = normalize(np.array([-0.4, -0.55, 0.72]))
    light_b = normalize(np.array([0.62, -0.15, 0.45]))
    object_colors = {}

    for triangle in triangles:
        position_indices = [corner[0] for corner in triangle["corners"]]
        if any(index < 0 or index >= len(vertices) for index in position_indices):
            continue
        camera_triangle = camera_space[position_indices]
        if np.any(camera_triangle[:, 2] <= 0.02):
            continue
        projected = screen[position_indices]
        min_x = max(0, int(math.floor(projected[:, 0].min())))
        max_x = min(width - 1, int(math.ceil(projected[:, 0].max())))
        min_y = max(0, int(math.floor(projected[:, 1].min())))
        max_y = min(height - 1, int(math.ceil(projected[:, 1].max())))
        if min_x > max_x or min_y > max_y:
            continue
        x0, y0 = projected[0]
        x1, y1 = projected[1]
        x2, y2 = projected[2]
        denominator = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(denominator) < 1e-10:
            continue
        xs, ys = np.meshgrid(np.arange(min_x, max_x + 1) + 0.5, np.arange(min_y, max_y + 1) + 0.5)
        weight_0 = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / denominator
        weight_1 = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / denominator
        weight_2 = 1.0 - weight_0 - weight_1
        inside = (weight_0 >= -1e-7) & (weight_1 >= -1e-7) & (weight_2 >= -1e-7)
        if not np.any(inside):
            continue
        inv_z = weight_0 / camera_triangle[0, 2] + weight_1 / camera_triangle[1, 2] + weight_2 / camera_triangle[2, 2]
        depth = 1.0 / np.maximum(inv_z, 1e-12)
        depth_region = z_buffer[min_y:max_y + 1, min_x:max_x + 1]
        visible = inside & (depth < depth_region)
        if not np.any(visible):
            continue

        world_triangle = vertices[position_indices]
        face_normal = normalize(np.cross(world_triangle[1] - world_triangle[0], world_triangle[2] - world_triangle[0]))
        triangle_normals = []
        for _, normal_index in triangle["corners"]:
            if normal_index is None or normal_index < 0 or normal_index >= len(normals):
                triangle_normals.append(face_normal)
            else:
                triangle_normals.append(normalize(normals[normal_index]))
        triangle_normals = np.asarray(triangle_normals)
        interpolated = (
            weight_0[..., None] * triangle_normals[0] / camera_triangle[0, 2]
            + weight_1[..., None] * triangle_normals[1] / camera_triangle[1, 2]
            + weight_2[..., None] * triangle_normals[2] / camera_triangle[2, 2]
        ) / inv_z[..., None]
        interpolated /= np.maximum(np.linalg.norm(interpolated, axis=2, keepdims=True), 1e-12)
        illumination = 0.52 + 0.38 * np.maximum(0.0, interpolated @ light_a) + 0.18 * np.maximum(0.0, interpolated @ light_b)
        base = material_colors.get(triangle["material"], material_colors["default"])
        shaded = np.power(np.clip(base[None, None, :] * illumination[..., None], 0.0, 1.0), 1.0 / 2.2)
        shaded = np.asarray(shaded * 255.0, dtype=np.uint8)
        orientation_color = np.array([75, 190, 124] if denominator < 0.0 else [224, 68, 55], dtype=np.uint8)
        if triangle["object"] not in object_colors:
            digest = hashlib.sha256(triangle["object"].encode("utf-8")).digest()
            object_colors[triangle["object"]] = np.array([64 + digest[0] % 160, 64 + digest[1] % 160, 64 + digest[2] % 160], dtype=np.uint8)

        beauty_region = beauty[min_y:max_y + 1, min_x:max_x + 1]
        normal_region = normal_buffer[min_y:max_y + 1, min_x:max_x + 1]
        orientation_region = orientation[min_y:max_y + 1, min_x:max_x + 1]
        object_region = object_id[min_y:max_y + 1, min_x:max_x + 1]
        depth_region[visible] = depth[visible]
        beauty_region[visible] = shaded[visible]
        normal_region[visible] = interpolated[visible]
        orientation_region[visible] = orientation_color
        object_region[visible] = object_colors[triangle["object"]]

    occupied = np.isfinite(z_buffer)
    normal_image = np.broadcast_to(BACKGROUND, (height, width, 3)).copy()
    normal_encoded = np.asarray(np.clip(normal_buffer * 0.5 + 0.5, 0.0, 1.0) * 255.0, dtype=np.uint8)
    normal_image[occupied] = normal_encoded[occupied]
    depth_image = np.broadcast_to(BACKGROUND, (height, width, 3)).copy()
    if np.any(occupied):
        near = np.percentile(z_buffer[occupied], 1)
        far = np.percentile(z_buffer[occupied], 99)
        normalized_depth = np.clip((z_buffer - near) / max(far - near, 1e-8), 0.0, 1.0)
        depth_gray = np.asarray((1.0 - normalized_depth) * 230.0 + 15.0, dtype=np.uint8)
        depth_image[occupied] = depth_gray[occupied][:, None]
    return {
        "beauty": Image.fromarray(beauty, "RGB"),
        "normal": Image.fromarray(normal_image, "RGB"),
        "depth": Image.fromarray(depth_image, "RGB"),
        "orientation": Image.fromarray(orientation, "RGB"),
        "object-id": Image.fromarray(object_id, "RGB"),
    }


def add_title(image, title):
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, image.width, 52), fill=(18, 23, 22))
    draw.text((22, 19), title, fill=(225, 232, 228))
    return image


def render_obj_audit_suite(obj_path, audit_dir, preview_path):
    obj_path = Path(obj_path)
    audit_dir = Path(audit_dir)
    preview_path = Path(preview_path)
    audit_dir.mkdir(parents=True, exist_ok=True)
    mtl_path = obj_path.with_suffix(".mtl")
    cameras = {
        "front": ((-11.8, 0.0, 3.0), (0.2, 0.0, 1.9), "Front / lower end"),
        "back": ((11.8, 0.0, 3.1), (0.2, 0.0, 1.9), "Back / upper end"),
        "left": ((0.0, -12.5, 2.8), (0.2, 0.0, 1.9), "Left side"),
        "side": ((0.0, 12.5, 2.8), (0.2, 0.0, 1.9), "Right side"),
    }
    for name, (camera, target, title) in cameras.items():
        passes = render_passes(obj_path, mtl_path, camera, target, 720, 500, 640.0)
        add_title(passes["beauty"], f"{title} | software Z-buffer").save(audit_dir / f"generated-{name}.png", optimize=True)
        print(f"Rendered audit view: {name}", flush=True)

    preview = render_passes(obj_path, mtl_path, (-9.8, -10.8, 6.5), (0.4, 0.0, 1.9), 960, 640, 760.0)["beauty"]
    add_title(preview, "Industrial Timber Staircase | exported OBJ | software Z-buffer").save(preview_path, optimize=True)
    print("Rendered package preview", flush=True)

    detail_passes = render_passes(obj_path, mtl_path, (-4.4, -5.6, 3.1), (-0.4, -1.92, 1.65), 840, 580, 700.0)
    output_names = {
        "beauty": "BevelDetail_ZBuffer.png",
        "normal": "BevelNormals_ZBuffer.png",
        "depth": "BevelDepth_ZBuffer.png",
        "orientation": "BevelOrientation_ZBuffer.png",
        "object-id": "BevelObjectId_ZBuffer.png",
    }
    for mode, image in detail_passes.items():
        add_title(image, f"Side bevel detail | {mode} | software Z-buffer").save(audit_dir / output_names[mode], optimize=True)
    print("Rendered bevel diagnostic passes", flush=True)

    metadata = {
        "version": 1,
        "renderer": "deterministic software rasterizer",
        "visibility": "per-pixel Z-buffer with perspective-correct depth",
        "shadows": "disabled to isolate topology and custom-normal shading",
        "passes": output_names,
        "objSha256": hashlib.sha256(obj_path.read_bytes()).hexdigest(),
    }
    (audit_dir / "zbuffer-render-report.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {name: audit_dir / f"generated-{name}.png" for name in cameras}
