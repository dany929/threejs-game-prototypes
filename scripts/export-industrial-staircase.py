#!/usr/bin/env python3
"""Export the procedural staircase as Blender-friendly OBJ/MTL assets."""

from __future__ import annotations

import json
import math
import random
import shutil
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps
from model_audit_renderer import render_obj_audit_suite


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "exports" / "industrial-staircase-obj"
TEXTURES = OUTPUT / "Textures"
AUDIT_REPORT_SOURCE = ROOT / "artifacts" / "img2threejs" / "industrial-staircase" / "AUDIT_REPORT_RU.md"
SCALE = 1.0
STEP_COUNT = 15
SIDE_BOARD_COUNT = 20
RAIL_POST_COUNT = 5
RUN = 4.4
RISE = 3.55
WIDTH = 4.0
CHANNEL = 0.18
LANDING_LENGTH = 0.54
TUBE_SEGMENTS = 24
SIDE_BEVEL_SEGMENTS = 2
MATERIALS = ["Wood", "DarkWood", "PaintedTeal", "OxidizedMetal", "Fastener"]
MATERIAL_COLORS = {
    "Wood": (102, 82, 65),
    "DarkWood": (59, 51, 43),
    "PaintedTeal": (47, 96, 93),
    "OxidizedMetal": (101, 89, 77),
    "Fastener": (37, 42, 40),
}


def v_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def v_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def v_mul(a, scalar):
    return (a[0] * scalar, a[1] * scalar, a[2] * scalar)


def v_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def v_cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def v_normalize(value):
    length = math.sqrt(max(1e-16, v_dot(value, value)))
    return v_mul(value, 1.0 / length)


def to_obj(value):
    """Three.js X/run, Y/up, Z/width to OBJ X/run, Y/width, Z/up in meters."""
    return (value[0] * SCALE, value[2] * SCALE, value[1] * SCALE)


def direction_to_obj(value):
    return v_normalize((value[0], value[2], value[1]))


@dataclass
class MeshData:
    name: str
    vertices: list[tuple[float, float, float]] = field(default_factory=list)
    faces: list[list[int]] = field(default_factory=list)
    uvs: list[list[tuple[float, float]]] = field(default_factory=list)
    normals: list[tuple[float, float, float]] = field(default_factory=list)
    materials: list[int] = field(default_factory=list)

    def add_face(self, coords, material, uv=None, normals=None):
        mapped = [to_obj(point) for point in coords]
        if uv is None:
            uv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)][: len(mapped)]
        else:
            uv = list(uv)
        if normals is None:
            source_normal = v_normalize(v_cross(v_sub(coords[1], coords[0]), v_sub(coords[2], coords[0])))
            mapped_normals = [direction_to_obj(source_normal)] * len(mapped)
        else:
            mapped_normals = [direction_to_obj(normal) for normal in normals]
        winding_normal = v_cross(v_sub(mapped[1], mapped[0]), v_sub(mapped[2], mapped[0]))
        average_normal = v_normalize(tuple(sum(normal[axis] for normal in mapped_normals) for axis in range(3)))
        if v_dot(winding_normal, average_normal) < 0.0:
            mapped.reverse()
            mapped_normals.reverse()
            uv.reverse()
        start = len(self.vertices)
        self.vertices.extend(mapped)
        self.faces.append(list(range(start, start + len(mapped))))
        self.materials.append(material)
        self.uvs.append(uv)
        self.normals.extend(mapped_normals)

    def append(self, other: "MeshData"):
        offset = len(self.vertices)
        self.vertices.extend(other.vertices)
        self.faces.extend([[index + offset for index in face] for face in other.faces])
        self.uvs.extend(other.uvs)
        self.normals.extend(other.normals)
        self.materials.extend(other.materials)


def rotate_z(point, angle):
    c, s = math.cos(angle), math.sin(angle)
    return (point[0] * c - point[1] * s, point[0] * s + point[1] * c, point[2])


def add_box(mesh, center, size, material, rotation_z=0.0, uv_offset=(0.0, 0.0)):
    hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    corners = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    points = [v_add(rotate_z(point, rotation_z), center) for point in corners]
    for face in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        mesh.add_face(
            [points[index] for index in face],
            material,
            [(uv_offset[0], uv_offset[1]), (uv_offset[0] + 1.0, uv_offset[1]), (uv_offset[0] + 1.0, uv_offset[1] + 1.0), (uv_offset[0], uv_offset[1] + 1.0)],
        )


def add_beveled_box(mesh, center, size, material, bevel, segments=SIDE_BEVEL_SEGMENTS, rotation_z=0.0, uv_offset=(0.0, 0.0)):
    """Add a closed rounded box with welded positions and baked custom normals."""
    half = [dimension * 0.5 for dimension in size]
    bevel = min(bevel, min(half) * 0.45)
    core = [extent - bevel for extent in half]
    segments = max(1, int(segments))

    def add_surface(local_points, local_normals):
        world_points = [v_add(rotate_z(point, rotation_z), center) for point in local_points]
        world_normals = [v_normalize(rotate_z(normal, rotation_z)) for normal in local_normals]
        mapped = [to_obj(point) for point in world_points]
        mapped_normal = direction_to_obj(v_normalize(tuple(sum(normal[axis] for normal in world_normals) for axis in range(3))))
        winding_normal = v_cross(v_sub(mapped[1], mapped[0]), v_sub(mapped[2], mapped[0]))
        if v_dot(winding_normal, mapped_normal) < 0.0:
            world_points.reverse()
            world_normals.reverse()
        uv = [
            (uv_offset[0], uv_offset[1]),
            (uv_offset[0] + 1.0, uv_offset[1]),
            (uv_offset[0] + 1.0, uv_offset[1] + 1.0),
            (uv_offset[0], uv_offset[1] + 1.0),
        ][:len(world_points)]
        mesh.add_face(world_points, material, uv, world_normals)

    # Six large planar regions. Their normals remain perfectly flat.
    for axis in range(3):
        other = [candidate for candidate in range(3) if candidate != axis]
        for sign in (-1.0, 1.0):
            points = []
            for first, second in ((-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)):
                point = [0.0, 0.0, 0.0]
                point[axis] = sign * half[axis]
                point[other[0]] = first * core[other[0]]
                point[other[1]] = second * core[other[1]]
                points.append(tuple(point))
            normal = [0.0, 0.0, 0.0]
            normal[axis] = sign
            add_surface(points, [tuple(normal)] * 4)

    # Twelve quarter-cylinder edge strips.
    for axis_a, axis_b in ((0, 1), (0, 2), (1, 2)):
        axis_c = next(axis for axis in range(3) if axis not in (axis_a, axis_b))
        for sign_a in (-1.0, 1.0):
            for sign_b in (-1.0, 1.0):
                rings = []
                for segment in range(segments + 1):
                    angle = math.pi * 0.5 * segment / segments
                    point = [0.0, 0.0, 0.0]
                    point[axis_a] = sign_a * (core[axis_a] + bevel * math.cos(angle))
                    point[axis_b] = sign_b * (core[axis_b] + bevel * math.sin(angle))
                    normal = [0.0, 0.0, 0.0]
                    normal[axis_a] = sign_a * math.cos(angle)
                    normal[axis_b] = sign_b * math.sin(angle)
                    rings.append((point, tuple(normal)))
                for segment in range(segments):
                    points = []
                    normals = []
                    for ring_index, side_sign in ((segment, -1.0), (segment + 1, -1.0), (segment + 1, 1.0), (segment, 1.0)):
                        point = list(rings[ring_index][0])
                        point[axis_c] = side_sign * core[axis_c]
                        points.append(tuple(point))
                        normals.append(rings[ring_index][1])
                    add_surface(points, normals)

    # Eight rounded corner patches close the topology without open caps.
    for sign_x in (-1.0, 1.0):
        for sign_y in (-1.0, 1.0):
            for sign_z in (-1.0, 1.0):
                signs = (sign_x, sign_y, sign_z)

                def corner_arc(axis_a, axis_b, fixed_axis):
                    arc = []
                    for segment in range(segments + 1):
                        angle = math.pi * 0.5 * segment / segments
                        normal = [0.0, 0.0, 0.0]
                        normal[axis_a] = signs[axis_a] * math.cos(angle)
                        normal[axis_b] = signs[axis_b] * math.sin(angle)
                        point = [signs[axis] * core[axis] + bevel * normal[axis] for axis in range(3)]
                        point[fixed_axis] = signs[fixed_axis] * core[fixed_axis]
                        arc.append((tuple(point), tuple(normal)))
                    return arc

                boundary = corner_arc(0, 1, 2)
                boundary.extend(corner_arc(1, 2, 0)[1:])
                boundary.extend(corner_arc(2, 0, 1)[1:-1])
                center_normal = v_normalize(signs)
                center_point = tuple(signs[axis] * core[axis] + bevel * center_normal[axis] for axis in range(3))
                for index, current in enumerate(boundary):
                    following = boundary[(index + 1) % len(boundary)]
                    add_surface(
                        [center_point, current[0], following[0]],
                        [center_normal, current[1], following[1]],
                    )


def add_tube(mesh, start, end, radius, material, segments=TUBE_SEGMENTS):
    axis = v_normalize(v_sub(end, start))
    helper = (0.0, 1.0, 0.0) if abs(axis[1]) < 0.92 else (1.0, 0.0, 0.0)
    side = v_normalize(v_cross(axis, helper))
    up = v_normalize(v_cross(side, axis))
    start_ring = []
    end_ring = []
    radial_normals = []
    for index in range(segments):
        angle = math.tau * index / segments
        radial = v_add(v_mul(side, math.cos(angle) * radius), v_mul(up, math.sin(angle) * radius))
        radial_normals.append(v_normalize(radial))
        start_ring.append(v_add(start, radial))
        end_ring.append(v_add(end, radial))
    for index in range(segments):
        following = (index + 1) % segments
        mesh.add_face(
            [start_ring[index], start_ring[following], end_ring[following], end_ring[index]],
            material,
            [(index / segments, 0.0), (following / segments, 0.0), (following / segments, 1.0), (index / segments, 1.0)],
            [radial_normals[index], radial_normals[following], radial_normals[following], radial_normals[index]],
        )
    mesh.add_face(list(reversed(start_ring)), material, [(0.5, 0.5)] * segments)
    mesh.add_face(end_ring, material, [(0.5, 0.5)] * segments)


def build_staircase():
    flight = MeshData("SM_IndustrialStaircase_Flight")
    sides = MeshData("SM_IndustrialStaircase_Sides")
    supports = MeshData("SM_IndustrialStaircase_Supports")
    rails = MeshData("SM_IndustrialStaircase_Rails")
    step_depth = RUN / STEP_COUNT + 0.055
    step_rise = RISE / STEP_COUNT
    lane_width = (WIDTH - CHANNEL) * 0.5

    for index in range(STEP_COUNT):
        x = -RUN * 0.5 + step_depth * 0.5 + index * (RUN / STEP_COUNT)
        height = 0.08 + (index + 1) * step_rise
        for lane in (-1, 1):
            z = lane * (CHANNEL * 0.5 + lane_width * 0.5)
            add_box(flight, (x, height, z), (step_depth, 0.12, lane_width), 2)
            nose_x = -RUN * 0.5 + 0.035 + index * (RUN / STEP_COUNT)
            add_box(flight, (nose_x, height + 0.005, z), (0.08, 0.13, lane_width - 0.05), 0)
        riser_x = -RUN * 0.5 + index * (RUN / STEP_COUNT)
        add_box(flight, (riser_x, 0.08 + (index + 0.5) * step_rise, 0.0), (0.11, step_rise, WIDTH - 0.16), 1)

    for index in range(SIDE_BOARD_COUNT):
        board_height = max(0.3, ((index + 1) / SIDE_BOARD_COUNT) * RISE - 0.03)
        board_x = -RUN * 0.5 + (index + 0.5) * (RUN / SIDE_BOARD_COUNT)
        for side in (-1, 1):
            add_beveled_box(
                sides,
                (board_x, board_height * 0.5, side * (WIDTH * 0.5 - 0.05)),
                (RUN / SIDE_BOARD_COUNT - 0.022, board_height, 0.16),
                0,
                0.012,
                uv_offset=((index * 0.137) % 1.0, (side + 1) * 0.19),
            )

    slope_start = (-RUN * 0.5 - 0.12, 0.24, 0.0)
    slope_end = (RUN * 0.5 + 0.12, RISE + 0.22, 0.0)
    for side in (-1, 1):
        z = side * WIDTH * 0.5
        cap_start = (slope_start[0], slope_start[1], z)
        cap_end = (slope_end[0], slope_end[1], z)
        cap_delta = v_sub(cap_end, cap_start)
        cap_length = math.sqrt(v_dot(cap_delta, cap_delta))
        add_beveled_box(sides, v_mul(v_add(cap_start, cap_end), 0.5), (cap_length, 0.24, 0.22), 2, 0.018, rotation_z=math.atan2(cap_delta[1], cap_delta[0]))
        worn_start = (cap_start[0], cap_start[1] - 0.1, z)
        worn_end = (cap_end[0], cap_end[1] - 0.1, z)
        add_box(sides, v_mul(v_add(worn_start, worn_end), 0.5), (cap_length, 0.045, 0.225), 0, math.atan2(cap_delta[1], cap_delta[0]))
        add_beveled_box(sides, (0.0, 0.1, z), (RUN + 0.35, 0.2, 0.23), 1, 0.015)
        for plate_index, t in enumerate((0.22, 0.48, 0.74)):
            plate_x = cap_start[0] + cap_delta[0] * t
            plate_y = cap_start[1] + cap_delta[1] * t
            plate_z = z + side * 0.132
            add_box(sides, (plate_x, plate_y, plate_z), (0.17, 0.28, 0.045), 3, math.atan2(cap_delta[1], cap_delta[0]))
            for bolt_offset in (-0.045, 0.045):
                add_tube(
                    sides,
                    (plate_x, plate_y + bolt_offset, plate_z - side * 0.0125),
                    (plate_x, plate_y + bolt_offset, plate_z + side * 0.0125),
                    0.022,
                    4,
                )

    stringer_start = (-RUN * 0.5 + 0.12, 0.12, 0.0)
    stringer_end = (RUN * 0.5 - 0.06, RISE - 0.04, 0.0)
    stringer_delta = v_sub(stringer_end, stringer_start)
    stringer_length = math.sqrt(v_dot(stringer_delta, stringer_delta))
    for z in (-WIDTH * 0.42, 0.0, WIDTH * 0.42):
        add_box(
            supports,
            ((stringer_start[0] + stringer_end[0]) * 0.5, (stringer_start[1] + stringer_end[1]) * 0.5, z),
            (stringer_length, 0.16, 0.18),
            1,
            math.atan2(stringer_delta[1], stringer_delta[0]),
        )
    for index in range(STEP_COUNT):
        x = -RUN * 0.5 + (index + 0.5) * (RUN / STEP_COUNT)
        y = 0.08 + (index + 1) * step_rise - 0.13
        add_box(supports, (x, y, 0.0), (step_depth * 0.72, 0.11, WIDTH - 0.2), 1)
    add_box(supports, (0.28, RISE * 0.25, 0.0), (0.17, RISE * 0.5, 0.24), 1)

    rail_height = 1.08
    rail_start_x = -RUN * 0.5 - 0.25
    rail_end_x = RUN * 0.5 + 0.28
    for rail_index, z in enumerate((-WIDTH * 0.5, 0.0, WIDTH * 0.5)):
        lower_start = (rail_start_x, 0.44, z)
        lower_end = (rail_end_x, RISE + 0.44, z)
        upper_start = (lower_start[0], lower_start[1] + rail_height * 0.52, z)
        upper_end = (lower_end[0], lower_end[1] + rail_height * 0.52, z)
        add_tube(rails, lower_start, lower_end, 0.045, 3)
        add_tube(rails, upper_start, upper_end, 0.057, 3)
        for post_index in range(RAIL_POST_COUNT):
            t = post_index / (RAIL_POST_COUNT - 1)
            x = rail_start_x + 0.15 + (rail_end_x - 0.12 - (rail_start_x + 0.15)) * t
            base_y = 0.22 + (RISE + 0.22 - 0.22) * t
            post_start = (x, base_y, z)
            post_end = (x, base_y + rail_height, z)
            add_tube(rails, post_start, post_end, 0.047, 3)
            add_tube(rails, (x, base_y + 0.07, z - 0.0275), (x, base_y + 0.07, z + 0.0275), 0.078, 4)
        top_start = (rail_end_x + 0.2, RISE + 0.15, z)
        add_tube(rails, top_start, (top_start[0], top_start[1] + rail_height + 0.1, z), 0.055, 3)
        add_tube(rails, upper_end, (rail_end_x + 0.42, upper_end[1], z), 0.057, 3)

    add_box(flight, (RUN * 0.5 + 0.18, RISE + 0.04, 0.0), (LANDING_LENGTH, 0.18, WIDTH), 2)
    add_box(flight, (0.0, RISE * 0.52, 0.0), (RUN, 0.04, CHANNEL), 1, math.atan2(RISE, RUN))

    collider = MeshData("UCX_SM_IndustrialStaircase_00")
    add_box(collider, (0.0, RISE * 0.5, 0.0), (RUN, 0.38, WIDTH - 0.18), 0, math.atan2(RISE, RUN))
    landing_collider = MeshData("UCX_SM_IndustrialStaircase_01")
    add_box(landing_collider, (RUN * 0.5 + 0.18, RISE + 0.04, 0.0), (LANDING_LENGTH, 0.18, WIDTH), 0)
    return [flight, sides, supports, rails], [collider, landing_collider]


def make_textures():
    TEXTURES.mkdir(parents=True, exist_ok=True)
    size = 1024
    for material_index, material in enumerate(MATERIALS):
        seed = 4100 + material_index * 97
        rng = random.Random(seed)
        base = Image.new("RGB", (size, size), MATERIAL_COLORS[material])
        pixels = base.load()
        rough = Image.new("L", (size, size), 210)
        rough_pixels = rough.load()
        height = Image.new("L", (size, size), 128)
        height_pixels = height.load()
        metallic = Image.new("L", (size, size), 0)
        metallic_pixels = metallic.load()
        ao = Image.new("L", (size, size), 242)
        ao_pixels = ao.load()
        for y in range(size):
            for x in range(size):
                if material in ("Wood", "DarkWood"):
                    broad = math.sin(x * 0.055 + math.sin(y * 0.008) * 1.7)
                    fine = math.sin(x * 0.31 + math.sin(y * 0.021) * 0.8)
                else:
                    broad = math.sin(x * 0.018 + math.sin(y * 0.011) * 2.4)
                    fine = math.sin(x * 0.083 + y * 0.006)
                noise = rng.randint(-12, 12)
                if material in ("Wood", "DarkWood"):
                    variation = int(broad * 10 + fine * 5 + noise * 0.38)
                    rough_value = 225 + int(abs(fine) * 18) + noise // 5
                    height_value = 128 + int(broad * 14 + fine * 6)
                elif material == "PaintedTeal":
                    variation = int(broad * 5 + noise * 0.25)
                    rough_value = 196 + int(abs(fine) * 20) + noise // 4
                    height_value = 128 + int(broad * 5 + fine * 2)
                else:
                    mottled = math.sin(x * 0.031) * math.sin(y * 0.027)
                    variation = int(mottled * 15 + noise * 0.45)
                    rough_value = (170 if material == "OxidizedMetal" else 150) + int(abs(mottled) * 35) + noise // 3
                    height_value = 128 + int(mottled * 13 + noise * 0.3)
                color = MATERIAL_COLORS[material]
                pixels[x, y] = tuple(max(0, min(255, channel + variation)) for channel in color)
                rough_pixels[x, y] = max(0, min(255, rough_value))
                height_pixels[x, y] = max(0, min(255, height_value))
                metallic_pixels[x, y] = 118 if material == "OxidizedMetal" else (188 if material == "Fastener" else 0)
                ao_pixels[x, y] = max(208, min(255, 244 + noise // 3))

        if material in ("Wood", "DarkWood"):
            draw = ImageDraw.Draw(base)
            rough_draw = ImageDraw.Draw(rough)
            height_draw = ImageDraw.Draw(height)
            fiber_color = (54, 42, 32) if material == "Wood" else (29, 25, 21)
            for fiber_index in range(96):
                origin_x = rng.randrange(size)
                phase = rng.random() * math.tau
                points = []
                for y in range(-24, size + 25, 24):
                    x = origin_x + math.sin(y * 0.018 + phase) * rng.uniform(1.5, 5.0)
                    points.append((x, y))
                line_width = 1 if fiber_index < 78 else 2
                draw.line(points, fill=fiber_color, width=line_width)
                rough_draw.line(points, fill=245, width=line_width)
                height_draw.line(points, fill=112, width=line_width)
            for y in range(int(size * 0.84), size):
                damp = (y - size * 0.84) / (size * 0.16)
                for x in range(size):
                    color = base.getpixel((x, y))
                    base.putpixel((x, y), tuple(int(channel * (1.0 - damp * 0.34)) for channel in color))
                    rough.putpixel((x, y), min(255, int(rough.getpixel((x, y)) + damp * 12)))

        if material == "PaintedTeal":
            draw = ImageDraw.Draw(base)
            rough_draw = ImageDraw.Draw(rough)
            height_draw = ImageDraw.Draw(height)
            for _ in range(72):
                x = rng.randrange(size)
                if rng.random() < 0.72:
                    y = rng.choice((rng.randrange(0, 52), rng.randrange(size - 52, size)))
                else:
                    y = rng.randrange(size)
                length = rng.randrange(6, 42)
                width = rng.randrange(2, 8)
                draw.rounded_rectangle((x, y, min(size - 1, x + length), min(size - 1, y + width)), radius=2, fill=(100 + rng.randrange(20), 82 + rng.randrange(15), 62 + rng.randrange(12)))
                rough_draw.rectangle((x, y, min(size - 1, x + length), min(size - 1, y + width)), fill=235)
                height_draw.rectangle((x, y, min(size - 1, x + length), min(size - 1, y + width)), fill=112)

        if material in ("OxidizedMetal", "Fastener"):
            draw = ImageDraw.Draw(base, "RGB")
            rough_draw = ImageDraw.Draw(rough)
            height_draw = ImageDraw.Draw(height)
            for _ in range(130 if material == "OxidizedMetal" else 80):
                x = rng.randrange(size)
                y = rng.randrange(size)
                radius_x = rng.randrange(5, 38)
                radius_y = rng.randrange(4, 30)
                rust = (88 + rng.randrange(35), 60 + rng.randrange(24), 39 + rng.randrange(20))
                draw.ellipse((x - radius_x, y - radius_y, x + radius_x, y + radius_y), fill=rust)
                rough_draw.ellipse((x - radius_x, y - radius_y, x + radius_x, y + radius_y), fill=215 + rng.randrange(25))
                height_draw.ellipse((x - radius_x, y - radius_y, x + radius_x, y + radius_y), fill=118 + rng.randrange(15))
            for _ in range(55):
                x = rng.randrange(size)
                y = rng.randrange(size)
                length = rng.randrange(12, 90)
                draw.line((x, y, min(size - 1, x + length), y + rng.randrange(-2, 3)), fill=(135, 125, 110), width=1)
                rough_draw.line((x, y, min(size - 1, x + length), y), fill=118, width=1)

        height = height.filter(ImageFilter.GaussianBlur(0.7))
        h = height.load()
        normal = Image.new("RGB", (size, size), (128, 128, 255))
        normal_pixels = normal.load()
        for y in range(size):
            ym = (y - 1) % size
            yp = (y + 1) % size
            for x in range(size):
                xm = (x - 1) % size
                xp = (x + 1) % size
                dx = (h[xp, y] - h[xm, y]) / 255.0 * 3.0
                dy = (h[x, yp] - h[x, ym]) / 255.0 * 3.0
                nx, ny, nz = v_normalize((-dx, -dy, 1.0))
                normal_pixels[x, y] = (int((nx * 0.5 + 0.5) * 255), int((ny * 0.5 + 0.5) * 255), int((nz * 0.5 + 0.5) * 255))

        base.save(TEXTURES / f"T_Stair_{material}_BaseColor.png", optimize=True)
        rough.save(TEXTURES / f"T_Stair_{material}_Roughness.png", optimize=True)
        normal.save(TEXTURES / f"T_Stair_{material}_Normal.png", optimize=True)
        ao.save(TEXTURES / f"T_Stair_{material}_AO.png", optimize=True)
        metallic.save(TEXTURES / f"T_Stair_{material}_Metallic.png", optimize=True)


def write_obj(path, render_meshes):
    obj = ["mtllib SM_IndustrialStaircase.mtl"]
    position_offset = 0
    corner_offset = 0
    for mesh in render_meshes:
        obj.append(f"o {mesh.name}")
        unique_vertices = []
        position_indices = []
        vertex_lookup = {}
        for vertex in mesh.vertices:
            key = tuple(round(component, 6) for component in vertex)
            if key not in vertex_lookup:
                vertex_lookup[key] = len(unique_vertices)
                unique_vertices.append(vertex)
            position_indices.append(vertex_lookup[key])
        for vertex in unique_vertices:
            obj.append(f"v {vertex[0]:.6f} {vertex[1]:.6f} {vertex[2]:.6f}")
        for face_uv in mesh.uvs:
            for uv in face_uv:
                obj.append(f"vt {uv[0]:.6f} {uv[1]:.6f}")
        for normal in mesh.normals:
            obj.append(f"vn {normal[0]:.6f} {normal[1]:.6f} {normal[2]:.6f}")
        last_material = None
        for face_index, face in enumerate(mesh.faces):
            material = MATERIALS[mesh.materials[face_index]]
            if material != last_material:
                obj.append(f"usemtl M_Stair_{material}")
                last_material = material
            obj.append("f " + " ".join(
                f"{position_offset + position_indices[index] + 1}/{corner_offset + index + 1}/{corner_offset + index + 1}"
                for index in face
            ))
        position_offset += len(unique_vertices)
        corner_offset += len(mesh.vertices)
    path.write_text("\n".join(obj) + "\n", encoding="utf-8")
    mtl = []
    for material_index, material in enumerate(MATERIALS):
        color = MATERIAL_COLORS[material]
        roughness = (0.92, 1.0, 0.84, 0.69, 0.62)[material_index]
        metalness = (0.0, 0.0, 0.01, 0.48, 0.72)[material_index]
        mtl.extend([
            f"newmtl M_Stair_{material}",
            f"Kd {color[0] / 255:.6f} {color[1] / 255:.6f} {color[2] / 255:.6f}",
            "Ks 0.200000 0.200000 0.200000",
            f"Ns {(1.0 - roughness) * 250.0:.6f}",
            f"Pr {roughness:.6f}",
            f"Pm {metalness:.6f}",
            "illum 2",
            f"map_Kd Textures/T_Stair_{material}_BaseColor.png",
            f"map_Bump Textures/T_Stair_{material}_Normal.png",
            f"map_Pr Textures/T_Stair_{material}_Roughness.png",
            f"map_Pm Textures/T_Stair_{material}_Metallic.png",
            f"map_ao Textures/T_Stair_{material}_AO.png",
            "",
        ])
    path.with_suffix(".mtl").write_text("\n".join(mtl), encoding="utf-8")


def write_collision_obj(path, collision_meshes):
    obj = ["# Simplified collision proxies for SM_IndustrialStaircase"]
    vertex_offset = 0
    for mesh in collision_meshes:
        obj.append(f"o {mesh.name}")
        for vertex in mesh.vertices:
            obj.append(f"v {vertex[0]:.6f} {vertex[1]:.6f} {vertex[2]:.6f}")
        for face in mesh.faces:
            obj.append("f " + " ".join(str(vertex_offset + index + 1) for index in face))
        vertex_offset += len(mesh.vertices)
    path.write_text("\n".join(obj) + "\n", encoding="utf-8")


def write_manifest(render_meshes):
    total_faces = sum(len(mesh.faces) for mesh in render_meshes)
    total_triangles = sum(sum(max(1, len(face) - 2) for face in mesh.faces) for mesh in render_meshes)
    manifest = {
        "asset": "Industrial Timber Staircase",
        "source": "Procedural reconstruction from four user-supplied views",
        "formats": ["OBJ", "MTL"],
        "dimensionsMeters": {"length": round(RUN + 1.11, 2), "width": round(WIDTH, 2), "heightIncludingRails": 5.06},
        "coordinateSystem": {"up": "+Z", "forward": "+X", "units": "meters"},
        "stepCount": STEP_COUNT,
        "renderParts": [mesh.name for mesh in render_meshes],
        "materials": MATERIALS,
        "textureSets": {
            material: [f"T_Stair_{material}_{channel}.png" for channel in ("BaseColor", "Roughness", "Normal", "AO", "Metallic")]
            for material in MATERIALS
        },
        "geometry": {"polygons": total_faces, "trianglesAfterImport": total_triangles},
        "sideBevel": {
            "segments": SIDE_BEVEL_SEGMENTS,
            "targets": ["vertical side boards", "painted diagonal caps", "lower side beams"],
            "widthMeters": {"boards": 0.012, "diagonalCaps": 0.018, "lowerBeams": 0.015},
            "shading": "welded positions with baked custom normals",
        },
        "collisionFile": "UCX_SM_IndustrialStaircase.obj",
        "collisionGroups": ["UCX_SM_IndustrialStaircase_00", "UCX_SM_IndustrialStaircase_01"],
        "limitations": [
            "Proportions are reconstructed from photographs, not measured drawings.",
            "OBJ has no universal unit metadata; this package stores vertices in meters.",
            "MTL PBR extensions are importer-dependent; wire Roughness, AO and Metallic manually when they are ignored.",
            "Procedural tile textures approximate the photographed wear and are not photogrammetric captures.",
        ],
    }
    (OUTPUT / "asset-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    readme = f"""# Промышленная лестница — OBJ/MTL

Основная модель: `SM_IndustrialStaircase.obj` + `SM_IndustrialStaircase.mtl`. В OBJ сохранены отдельные группы Flight, Sides, Supports и Rails. Упрощённые коллайдеры находятся отдельно в `UCX_SM_IndustrialStaircase.obj`.

Импорт в Blender:

- используйте `File → Import → Wavefront (.obj)`;
- система координат файла: `Forward +X`, `Up +Z`;
- вершины записаны в метрах, поэтому масштаб для Blender равен 1.0;
- включите импорт материалов и сохранение отдельных объектов/групп.

Крупные боковые элементы имеют физическую фаску из двух сегментов: вертикальные доски 12 мм, диагональный профиль 18 мм, нижняя балка 15 мм. Позиции вершин сшиты, а пользовательские нормали уже записаны в OBJ. При обычном импорте их не нужно пересчитывать. Если фаска будет редактироваться в Blender, порядок обработки должен быть `Bevel → Weighted Normal` либо `Bevel → Shade Auto Smooth`.

Импорт в Unreal Engine:

- OBJ записан в метрах; если импортёр воспринимает единицу OBJ как сантиметр, задайте `Import Uniform Scale = 100`;
- коллайдеры импортируйте из отдельного OBJ и используйте как сложную или пользовательскую коллизию;
- для каждого материала подключите BaseColor с sRGB, а Roughness, Normal, AO и Metallic — без sRGB.

MTL содержит стандартные ссылки `map_Kd` и `map_Bump`, а также расширения `map_Pr`, `map_Pm` и `map_ao`. Поддержка последних трёх зависит от импортёра.

Размер объекта: примерно {round(RUN + 1.11, 2)} × {round(WIDTH, 2)} × 5.06 м вместе с перилами. Геометрия и износ восстановлены по фотографиям, поэтому это игровая реконструкция, а не точная производственная модель.
"""
    (OUTPUT / "README_IMPORT_RU.md").write_text(readme, encoding="utf-8")


def render_previews(_render_meshes):
    audit_dir = OUTPUT / "Audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    generated = render_obj_audit_suite(OUTPUT / "SM_IndustrialStaircase.obj", audit_dir, OUTPUT / "Preview.png")

    reference_dir = ROOT / "artifacts" / "img2threejs" / "industrial-staircase" / "reference"
    sheet = Image.new("RGB", (1600, 1560), (25, 29, 28))
    sheet_draw = ImageDraw.Draw(sheet)
    sheet_draw.text((28, 18), "Reference / generated audit views", fill=(230, 232, 226))
    for row, name in enumerate(("front", "back", "left", "side")):
        reference = Image.open(reference_dir / f"{name}.jpg").convert("RGB")
        render = Image.open(generated[name]).convert("RGB")
        reference = ImageOps.contain(reference, (730, 330), Image.Resampling.LANCZOS)
        render = ImageOps.contain(render, (730, 330), Image.Resampling.LANCZOS)
        y = 72 + row * 365
        sheet_draw.text((28, y - 26), f"{name.upper()} | reference", fill=(190, 200, 193))
        sheet_draw.text((825, y - 26), f"{name.upper()} | generated", fill=(190, 200, 193))
        sheet.paste(reference, (28 + (730 - reference.width) // 2, y + (330 - reference.height) // 2))
        sheet.paste(render, (825 + (730 - render.width) // 2, y + (330 - render.height) // 2))
    sheet.save(audit_dir / "ComparisonSheet.png", optimize=True)
    audit_contract = {
        "version": 1,
        "purpose": "Independent agent review of generated staircase against four supplied references",
        "views": {
            name: {
                "reference": f"artifacts/img2threejs/industrial-staircase/reference/{name}.jpg",
                "generated": f"Audit/generated-{name}.png",
            }
            for name in ("front", "back", "left", "side")
        },
        "scoreRange": [0, 1],
        "categories": [
            "silhouetteAndProportions",
            "componentStructure",
            "railAndTreadRepetition",
            "bevelTopologyAndShading",
            "materialsAndTextures",
            "fourViewConsistency",
        ],
        "materialEvidence": {
            material: [f"Textures/T_Stair_{material}_{channel}.png" for channel in ("BaseColor", "Roughness", "Normal", "AO", "Metallic")]
            for material in MATERIALS
        },
        "detailEvidence": {
            "beauty": "Audit/BevelDetail_ZBuffer.png",
            "normal": "Audit/BevelNormals_ZBuffer.png",
            "depth": "Audit/BevelDepth_ZBuffer.png",
            "faceOrientation": "Audit/BevelOrientation_ZBuffer.png",
            "objectId": "Audit/BevelObjectId_ZBuffer.png",
            "renderReport": "Audit/zbuffer-render-report.json",
        },
        "targetThreshold": 0.7,
        "requiredAgentOutput": [
            "category scores",
            "critical, high and medium mismatches",
            "root cause per mismatch: geometry, material or audit camera/render",
            "one bounded correction action: continue, refine-code, refine-spec, request-input or stop",
        ],
        "knownAuditLimitations": [
            "software renderer uses a per-pixel Z-buffer and does not calculate cast shadows",
            "beauty pass shows MTL base colors and baked custom normals rather than full PBR textures",
            "camera matching is approximate and must not override four-view geometric evidence",
        ],
    }
    (audit_dir / "audit-contract.json").write_text(json.dumps(audit_contract, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_package():
    required = [
        OUTPUT / "SM_IndustrialStaircase.obj",
        OUTPUT / "SM_IndustrialStaircase.mtl",
        OUTPUT / "UCX_SM_IndustrialStaircase.obj",
        OUTPUT / "asset-manifest.json",
        OUTPUT / "README_IMPORT_RU.md",
        OUTPUT / "Preview.png",
        OUTPUT / "Audit" / "ComparisonSheet.png",
        OUTPUT / "Audit" / "BevelDetail_ZBuffer.png",
        OUTPUT / "Audit" / "BevelNormals_ZBuffer.png",
        OUTPUT / "Audit" / "BevelDepth_ZBuffer.png",
        OUTPUT / "Audit" / "BevelOrientation_ZBuffer.png",
        OUTPUT / "Audit" / "BevelObjectId_ZBuffer.png",
        OUTPUT / "Audit" / "zbuffer-render-report.json",
        OUTPUT / "Audit" / "audit-contract.json",
    ]
    required.extend(TEXTURES / f"T_Stair_{material}_{channel}.png" for material in MATERIALS for channel in ("BaseColor", "Roughness", "Normal", "AO", "Metallic"))
    missing = [str(path) for path in required if not path.exists() or path.stat().st_size == 0]
    if missing:
        raise RuntimeError("Missing export files: " + ", ".join(missing))

    obj_content = required[0].read_text(encoding="utf-8")
    expected_groups = {
        "SM_IndustrialStaircase_Flight",
        "SM_IndustrialStaircase_Sides",
        "SM_IndustrialStaircase_Supports",
        "SM_IndustrialStaircase_Rails",
    }
    actual_groups = {line[2:] for line in obj_content.splitlines() if line.startswith("o ")}
    if actual_groups != expected_groups or "mtllib SM_IndustrialStaircase.mtl" not in obj_content:
        raise RuntimeError("OBJ groups or MTL link do not match the export contract")

    vertices = sum(line.startswith("v ") for line in obj_content.splitlines())
    uv_vertices = sum(line.startswith("vt ") for line in obj_content.splitlines())
    normals = sum(line.startswith("vn ") for line in obj_content.splitlines())
    if not vertices or not uv_vertices or uv_vertices != normals or vertices >= uv_vertices:
        raise RuntimeError("OBJ vertex, UV and normal streams are incomplete")
    current_group = None
    edge_usage = Counter()
    for line in obj_content.splitlines():
        if line.startswith("o "):
            current_group = line[2:]
            continue
        if line.startswith("vn "):
            normal = tuple(float(value) for value in line.split()[1:])
            length = math.sqrt(v_dot(normal, normal))
            if not math.isfinite(length) or abs(length - 1.0) > 0.002:
                raise RuntimeError(f"Invalid custom normal: {line}")
            continue
        if not line.startswith("f "):
            continue
        position_indices = []
        for token in line.split()[1:]:
            indices = [int(value) for value in token.split("/")]
            limits = (vertices, uv_vertices, normals)
            if len(indices) != 3 or any(index < 1 or index > limits[axis] for axis, index in enumerate(indices)):
                raise RuntimeError(f"Invalid OBJ face token: {token}")
            position_indices.append(indices[0])
        for first, second in zip(position_indices, position_indices[1:] + position_indices[:1]):
            edge_usage[(current_group, min(first, second), max(first, second))] += 1
    invalid_edges = [edge for edge, usage in edge_usage.items() if usage != 2]
    if invalid_edges:
        raise RuntimeError(f"OBJ contains open or non-manifold edges: {invalid_edges[:8]}")

    mtl_content = required[1].read_text(encoding="utf-8")
    for material in MATERIALS:
        if f"newmtl M_Stair_{material}" not in mtl_content:
            raise RuntimeError(f"Missing material in MTL: {material}")
        for channel, directive in (("BaseColor", "map_Kd"), ("Normal", "map_Bump"), ("Roughness", "map_Pr"), ("Metallic", "map_Pm"), ("AO", "map_ao")):
            expected = f"{directive} Textures/T_Stair_{material}_{channel}.png"
            if expected not in mtl_content:
                raise RuntimeError(f"Missing texture reference in MTL: {expected}")

    collision_content = required[2].read_text(encoding="utf-8")
    collision_groups = {line[2:] for line in collision_content.splitlines() if line.startswith("o ")}
    if collision_groups != {"UCX_SM_IndustrialStaircase_00", "UCX_SM_IndustrialStaircase_01"}:
        raise RuntimeError("Collision OBJ groups do not match the export contract")
    if any(path.suffix.lower() == ".fbx" for path in OUTPUT.rglob("*")):
        raise RuntimeError("FBX file found in OBJ-only package")

    for texture in required[14:]:
        with Image.open(texture) as image:
            if image.size != (1024, 1024):
                raise RuntimeError(f"Unexpected texture size: {texture}")


def main():
    previous_report = None
    for report_path in (
        AUDIT_REPORT_SOURCE,
        OUTPUT / "Audit" / "AUDIT_REPORT_RU.md",
    ):
        if report_path.exists():
            previous_report = report_path.read_text(encoding="utf-8")
            break
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)
    render_meshes, collision_meshes = build_staircase()
    make_textures()
    write_obj(OUTPUT / "SM_IndustrialStaircase.obj", render_meshes)
    write_collision_obj(OUTPUT / "UCX_SM_IndustrialStaircase.obj", collision_meshes)
    write_manifest(render_meshes)
    render_previews(render_meshes)
    if previous_report:
        (OUTPUT / "Audit" / "AUDIT_REPORT_RU.md").write_text(previous_report, encoding="utf-8")
    validate_package()
    archive = OUTPUT.parent / "IndustrialStaircase_OBJ_Textures.zip"
    if archive.exists():
        archive.unlink()
    shutil.make_archive(str(archive.with_suffix("")), "zip", OUTPUT.parent, OUTPUT.name)
    print(json.dumps({"output": str(OUTPUT), "archive": str(archive), "sizeBytes": archive.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
