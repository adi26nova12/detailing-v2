"""
APEX DETAIL STUDIO — cinematic hero frame renderer.

Renders the scroll-driven hero image sequence: a metallic emerald coupe on a wet
black-concrete floor inside a dark studio, lit by floating light strips that
ignite one at a time while the camera orbits and cranes.

This is a small deferred-shading rasterizer written on numpy. It exists so the
site has a real, physically-plausible sequence to drive today. The output is
byte-compatible with the Higgsfield pipeline (see tools/extract_frames.py and
HIGGSFIELD.md) -- same filenames, same manifest -- so photoreal frames can be
dropped in later without touching a line of site code.

    python tools/render_sequence.py --frames 420 --width 1600

Coordinate system: +X forward (nose), +Y up, +Z to the car's left. Metres.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------

MAT_NONE = 0
MAT_PAINT = 1
MAT_TIRE = 2
MAT_RIM = 3
MAT_HEADLIGHT = 4
MAT_TAILLIGHT = 5
MAT_TRIM = 6  # grille, vents, shadow gaps

EMERALD = np.array([0.0105, 0.0720, 0.0435], dtype=np.float32)
TITANIUM = np.array([0.62, 0.64, 0.65], dtype=np.float32)


# --------------------------------------------------------------------------
# small maths helpers
# --------------------------------------------------------------------------

def normalize(v, axis=-1, eps=1e-9):
    return v / np.maximum(np.linalg.norm(v, axis=axis, keepdims=True), eps)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-12), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def catmull_rom(keys, t):
    """keys: list of (t, value_array). Returns smoothly interpolated value."""
    ts = [k[0] for k in keys]
    vs = [np.asarray(k[1], dtype=np.float64) for k in keys]
    n = len(keys)
    if t <= ts[0]:
        return vs[0]
    if t >= ts[-1]:
        return vs[-1]
    i = max(0, min(n - 2, int(np.searchsorted(ts, t) - 1)))
    span = ts[i + 1] - ts[i]
    u = (t - ts[i]) / span
    p0 = vs[max(0, i - 1)]
    p1 = vs[i]
    p2 = vs[i + 1]
    p3 = vs[min(n - 1, i + 2)]
    u2, u3 = u * u, u * u * u
    return 0.5 * (
        (2 * p1)
        + (-p0 + p2) * u
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * u3
    )


def curve(xs, ys, x):
    return np.interp(x, xs, ys)


# --------------------------------------------------------------------------
# procedural coupe
# --------------------------------------------------------------------------

# Silhouette control curves. Tuned to M4-Competition-ish proportions:
# 4.80 m long, 1.90 m wide, 1.39 m tall, 2.86 m wheelbase.
_TOP_X = [-2.40, -2.10, -1.70, -1.30, -1.05, -0.70, -0.15, 0.40, 0.85, 1.10, 1.45, 1.90, 2.25, 2.45, 2.52]
_TOP_Y = [0.94, 1.04, 1.10, 1.13, 1.17, 1.355, 1.392, 1.372, 1.20, 1.115, 1.085, 1.075, 1.015, 0.90, 0.74]

_BOT_X = [-2.45, -2.20, -1.90, -1.20, 0.00, 1.20, 1.95, 2.25, 2.52]
_BOT_Y = [0.44, 0.30, 0.185, 0.150, 0.135, 0.150, 0.185, 0.30, 0.46]

_HW_X = [-2.45, -2.22, -1.95, -1.45, -0.60, 0.35, 1.10, 1.65, 2.10, 2.35, 2.52]
_HW_Y = [0.34, 0.63, 0.830, 0.900, 0.902, 0.896, 0.882, 0.858, 0.812, 0.630, 0.09]

_ROOF_X = [-1.30, -1.05, -0.70, -0.15, 0.40, 0.85, 1.10]
_ROOF_Y = [0.870, 0.790, 0.700, 0.648, 0.664, 0.760, 0.860]

# sill -> beltline width profile (fraction of max half width)
_SHAPE_S = [0.00, 0.10, 0.28, 0.52, 0.78, 1.00]
_SHAPE_W = [0.575, 0.800, 0.938, 0.998, 1.000, 0.972]

BELT_X = [-2.45, -1.40, 0.20, 1.15, 2.52]
BELT_Y = [1.010, 1.000, 0.975, 0.952, 0.930]

WHEEL_X = 1.43
WHEEL_Z = 0.625          # inner edge; the outer face lands just inside the flank
WHEEL_R = 0.378
TIRE_W = 0.235
ARCH_R = 0.455
ARCH_CY = 0.020


class Mesh:
    def __init__(self):
        self.V: list[np.ndarray] = []
        self.F: list[tuple[int, int, int]] = []
        self.M: list[int] = []

    def add(self, verts: np.ndarray, faces: np.ndarray, mat: int, ref=None) -> None:
        """`ref` is a point inside the part (or "axis" for the body); faces are
        re-wound so their geometric normal points away from it. Winding is easy
        to get backwards when lofting, and an inward normal silently turns the
        whole surface into a mirror via the Fresnel term."""
        verts = np.asarray(verts, dtype=np.float64)
        faces = np.asarray(faces, dtype=np.int64)
        a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
        nrm = np.cross(b - a, c - a)
        centroid = (a + b + c) / 3.0
        if ref is None:
            inside = verts.mean(axis=0)[None, :]
        elif isinstance(ref, str) and ref == "axis":
            # the body is long and thin: compare against the spine at each station
            inside = np.stack([
                centroid[:, 0],
                np.full(len(centroid), 0.68),
                np.zeros(len(centroid)),
            ], axis=1)
        else:
            inside = np.asarray(ref, dtype=np.float64)[None, :]
        flip = np.sum(nrm * (centroid - inside), axis=1) < 0.0
        faces[flip] = faces[flip][:, ::-1]

        base = len(self.V)
        self.V.extend(verts)
        for f, fl in zip(faces, flip):
            self.F.append((int(f[0]) + base, int(f[1]) + base, int(f[2]) + base))
            self.M.append(mat)

    def finish(self):
        return (
            np.asarray(self.V, dtype=np.float32),
            np.asarray(self.F, dtype=np.int32),
            np.asarray(self.M, dtype=np.int32),
        )


def _ring(x: float, k: int = 22) -> np.ndarray:
    """One lofted cross-section: closed ring of 2k points, flat top and floor."""
    top = float(curve(_TOP_X, _TOP_Y, x))
    bot = float(curve(_BOT_X, _BOT_Y, x))
    hw = float(curve(_HW_X, _HW_Y, x))
    belt = float(curve(BELT_X, BELT_Y, x))
    roof_hw = float(curve(_ROOF_X, _ROOF_Y, x)) if -1.30 <= x <= 1.10 else hw * 0.93

    # bias samples toward the shoulder and the roof edge where curvature is high
    v = np.linspace(0.0, 1.0, k)
    v = v ** 1.06
    ys = bot + (top - bot) * v

    zs = np.empty(k)
    for i, y in enumerate(ys):
        if y <= belt or top <= belt + 1e-4:
            s = np.clip((y - bot) / max(belt - bot, 1e-4), 0.0, 1.0)
            zs[i] = hw * float(curve(_SHAPE_S, _SHAPE_W, s))
        else:
            base_w = hw * float(curve(_SHAPE_S, _SHAPE_W, 1.0))
            tt = (y - belt) / max(top - belt, 1e-4)
            # fast tuck-in just above the beltline == greenhouse tumblehome
            zs[i] = lerp(base_w, roof_hw, float(smoothstep(0.0, 1.0, tt ** 0.62)))

    # wheel arch cut-outs, applied only to the outer flanks
    arch = 0.0
    for wx in (WHEEL_X, -WHEEL_X):
        d2 = ARCH_R * ARCH_R - (x - wx) ** 2
        if d2 > 0.0:
            arch = max(arch, ARCH_CY + math.sqrt(d2))
    if arch > 0.0:
        flank = smoothstep(0.34, 0.60, np.abs(zs))
        ys = np.maximum(ys, lerp(ys, np.full_like(ys, arch), flank))

    right = np.stack([np.full(k, x), ys, zs], axis=1)
    left = np.stack([np.full(k, x), ys[::-1], -zs[::-1]], axis=1)
    return np.concatenate([right, left], axis=0)


def _loft(mesh: Mesh) -> None:
    xs = np.concatenate([
        np.linspace(-2.45, -1.10, 16),
        np.linspace(-1.05, 1.10, 26)[1:],
        np.linspace(1.15, 2.52, 16),
    ])
    rings = [_ring(x) for x in xs]
    n = len(rings[0])
    verts = np.concatenate(rings, axis=0)

    faces = []
    for s in range(len(rings) - 1):
        a = s * n
        b = (s + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, b + i, b + j))
            faces.append((a + i, b + j, a + j))

    mesh.add(verts, np.asarray(faces), MAT_PAINT, ref="axis")

    # fan caps so the body stays closed (matters for backface culling)
    for ring, inward in ((rings[-1], (1.6, 0.68, 0.0)), (rings[0], (-1.6, 0.68, 0.0))):
        cap_v = np.concatenate([ring, ring.mean(0)[None, :]], axis=0)
        cap_f = np.asarray([(i, (i + 1) % n, n) for i in range(n)])
        mesh.add(cap_v, cap_f, MAT_PAINT, ref=inward)


def _cylinder(mesh, centre, radius, half_w, mat, segs=34, axis_scale=1.0):
    ang = np.linspace(0.0, 2.0 * math.pi, segs, endpoint=False)
    cy = centre[1] + np.cos(ang) * radius
    cx = centre[0] + np.sin(ang) * radius * axis_scale
    inner = np.stack([cx, cy, np.full(segs, centre[2] - half_w)], axis=1)
    outer = np.stack([cx, cy, np.full(segs, centre[2] + half_w)], axis=1)
    verts = np.concatenate([inner, outer], axis=0)
    faces = []
    for i in range(segs):
        j = (i + 1) % segs
        faces.append((i, segs + i, segs + j))
        faces.append((i, segs + j, j))
    mesh.add(verts, np.asarray(faces), mat)


def _disc(mesh, centre, radius, mat, segs=34, dish=0.0, facing=1.0):
    ang = np.linspace(0.0, 2.0 * math.pi, segs, endpoint=False)
    rim = np.stack([
        centre[0] + np.sin(ang) * radius,
        centre[1] + np.cos(ang) * radius,
        np.full(segs, centre[2]),
    ], axis=1)
    hub = np.array([[centre[0], centre[1], centre[2] - dish]])
    verts = np.concatenate([rim, hub], axis=0)
    faces = [(i, (i + 1) % segs, segs) for i in range(segs)]
    ref = (centre[0], centre[1], centre[2] - facing * max(radius, 0.1))
    mesh.add(verts, np.asarray(faces), mat, ref=ref)


def _annulus(mesh, centre, r_in, r_out, mat, segs=34, facing=1.0):
    ang = np.linspace(0.0, 2.0 * math.pi, segs, endpoint=False)
    cs, sn = np.cos(ang), np.sin(ang)
    inner = np.stack([centre[0] + sn * r_in, centre[1] + cs * r_in, np.full(segs, centre[2])], axis=1)
    outer = np.stack([centre[0] + sn * r_out, centre[1] + cs * r_out, np.full(segs, centre[2])], axis=1)
    verts = np.concatenate([inner, outer], axis=0)
    faces = []
    for i in range(segs):
        j = (i + 1) % segs
        faces.append((i, segs + i, segs + j))
        faces.append((i, segs + j, j))
    mesh.add(verts, np.asarray(faces), mat,
             ref=(centre[0], centre[1], centre[2] - facing * max(r_out, 0.1)))


def _wheel(mesh, wx, wz):
    side = 1.0 if wz > 0 else -1.0
    cz = wz + side * TIRE_W * 0.5
    centre = (wx, WHEEL_R, cz)
    _cylinder(mesh, centre, WHEEL_R, TIRE_W * 0.5, MAT_TIRE, segs=40)
    # tyre sidewall as an annulus, so it can never occlude the rim face
    _annulus(mesh, (wx, WHEEL_R, cz + side * TIRE_W * 0.5), WHEEL_R * 0.66, WHEEL_R,
             MAT_TIRE, segs=40, facing=side)
    # rim face sits proud of the sidewall, dished toward the hub
    face_z = cz + side * (TIRE_W * 0.5 + 0.004)
    _disc(mesh, (wx, WHEEL_R, face_z), WHEEL_R * 0.66, MAT_RIM,
          segs=40, dish=side * 0.075, facing=side)
    # brake disc glimpsed behind the spokes
    _disc(mesh, (wx, WHEEL_R, face_z - side * 0.085), WHEEL_R * 0.52, MAT_TRIM,
          segs=28, facing=side)


def _lamp(mesh, centre, scale, mat, res=9):
    u = np.linspace(0.0, math.pi, res)
    v = np.linspace(0.0, 2.0 * math.pi, res * 2, endpoint=False)
    uu, vv = np.meshgrid(u, v, indexing="ij")
    x = np.sin(uu) * np.cos(vv) * scale[0] + centre[0]
    y = np.cos(uu) * scale[1] + centre[1]
    z = np.sin(uu) * np.sin(vv) * scale[2] + centre[2]
    verts = np.stack([x.ravel(), y.ravel(), z.ravel()], axis=1)
    w = res * 2
    faces = []
    for i in range(res - 1):
        for j in range(w):
            j2 = (j + 1) % w
            a, b = i * w + j, i * w + j2
            c, d = (i + 1) * w + j, (i + 1) * w + j2
            faces.append((a, c, d))
            faces.append((a, d, b))
    mesh.add(verts, np.asarray(faces), mat)


def build_car():
    mesh = Mesh()
    _loft(mesh)
    for wx in (WHEEL_X, -WHEEL_X):
        for wz in (WHEEL_Z, -WHEEL_Z):
            _wheel(mesh, wx, wz)
    for sz in (0.62, -0.62):
        _lamp(mesh, (2.245, 0.905, sz), (0.075, 0.062, 0.215), MAT_HEADLIGHT)
        # smoked rear units -- the palette forbids red, so these stay dark glass
        _lamp(mesh, (-2.205, 0.965, sz * 0.80), (0.050, 0.048, 0.215), MAT_TAILLIGHT)
    # lower intake
    _cylinder(mesh, (2.20, 0.42, 0.0), 0.13, 0.60, MAT_TRIM, segs=14, axis_scale=0.35)
    return mesh.finish()


def face_normals(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return normalize(np.cross(b - a, c - a).astype(np.float32))


def vertex_normals(V, F):
    fn = face_normals(V, F)
    vn = np.zeros_like(V)
    for k in range(3):
        np.add.at(vn, F[:, k], fn)
    return normalize(vn)


# --------------------------------------------------------------------------
# studio environment  (equirectangular, rebuilt per frame from cached layers)
# --------------------------------------------------------------------------

ENV_W, ENV_H = 768, 384

# azimuth centre, azimuth sigma, elevation centre, elevation sigma, tint, radiance
# Bright and narrow: a light rail seen from 5 m subtends only a couple of
# degrees. That ratio is what produces long crisp streaks instead of milk.
STRIPS = [
    (0.00, 0.26, 0.250, 0.0075, (1.00, 1.00, 1.02), 13.0),   # key rail, over the spine
    (0.52, 0.15, 0.205, 0.0060, (0.97, 1.00, 1.00), 9.0),    # left ceiling rail
    (-0.52, 0.15, 0.205, 0.0060, (0.97, 1.00, 1.00), 9.0),   # right ceiling rail
    (0.88, 0.11, 0.395, 0.0090, (0.90, 0.99, 0.95), 8.0),    # rear rim rail
    (0.30, 0.055, 0.520, 0.0150, (1.00, 0.99, 0.96), 5.0),   # low floating panel
    (-0.30, 0.055, 0.520, 0.0150, (1.00, 0.99, 0.96), 5.0),
    (0.13, 0.34, 0.128, 0.0045, (0.82, 1.00, 0.90), 7.0),    # high emerald slit
]


class Environment:
    """Pre-blurred strip layers; per-frame the strips are just re-weighted."""

    def __init__(self):
        u = (np.arange(ENV_W) + 0.5) / ENV_W          # 0..1 azimuth
        v = (np.arange(ENV_H) + 0.5) / ENV_H          # 0 = up, 1 = down
        uu, vv = np.meshgrid(u, v)
        self.layers = []
        for az, aw, ev, eh, tint, rad in STRIPS:
            du = np.abs(((uu - (az * 0.5 + 0.5)) + 0.5) % 1.0 - 0.5)
            band = np.exp(-0.5 * (du / aw) ** 2) * (np.abs(du) < aw * 2.6)
            elev = np.exp(-0.5 * ((vv - ev) / eh) ** 2)
            layer = (band * elev * rad)[..., None] * np.asarray(tint, dtype=np.float32)
            self.layers.append(layer.astype(np.float32))

        # matte walls / black concrete floor gradient
        base = np.zeros((ENV_H, ENV_W, 3), dtype=np.float32)
        wall = (0.0030 + 0.0042 * np.clip(1.0 - np.abs(vv - 0.34) * 2.2, 0, 1))[..., None]
        base += wall * np.array([0.86, 0.94, 1.0], dtype=np.float32)
        floor = smoothstep(0.52, 1.0, vv)[..., None]
        base = base * (1.0 - floor * 0.76)
        self.base = base.astype(np.float32)

        self.blur_mid = [gaussian_filter(l, (4, 4, 0), mode="wrap") for l in self.layers]
        # the "irradiance" level is cosine-ish, so normalise it back down --
        # a blur conserves total energy and would otherwise read as an overcast sky
        self.blur_wide = [gaussian_filter(l, (30, 30, 0), mode="wrap") * 0.55
                          for l in self.layers]
        self.base_wide = gaussian_filter(self.base, (30, 30, 0), mode="wrap")

    def build(self, weights, exposure):
        w = np.asarray(weights, dtype=np.float32)
        sharp = self.base.copy()
        mid = self.base.copy()
        wide = self.base_wide.copy()
        for i, wi in enumerate(w):
            if wi <= 1e-4:
                continue
            sharp += self.layers[i] * wi
            mid += self.blur_mid[i] * wi
            wide += self.blur_wide[i] * wi
        return sharp * exposure, mid * exposure, wide * exposure


def sample_env(env, d):
    """Bilinear equirectangular lookup for direction array d (..., 3)."""
    h, w = env.shape[:2]
    u = (np.arctan2(d[..., 2], d[..., 0]) / (2.0 * math.pi) + 0.5) * w - 0.5
    v = (np.arccos(np.clip(d[..., 1], -1.0, 1.0)) / math.pi) * h - 0.5
    u0 = np.floor(u).astype(np.int32)
    v0 = np.clip(np.floor(v).astype(np.int32), 0, h - 1)
    fu = (u - u0)[..., None]
    fv = (v - v0)[..., None]
    u0 %= w
    u1 = (u0 + 1) % w
    v1 = np.clip(v0 + 1, 0, h - 1)
    return (
        env[v0, u0] * (1 - fu) * (1 - fv)
        + env[v0, u1] * fu * (1 - fv)
        + env[v1, u0] * (1 - fu) * fv
        + env[v1, u1] * fu * fv
    )


# --------------------------------------------------------------------------
# camera choreography
# --------------------------------------------------------------------------
# (azimuth deg, elevation deg, distance, target height, focal fov deg, roll deg)
CAM_KEYS = [
    (0.00, (-46.0, 2.2, 6.30, 0.62, 31.0, -1.4)),
    (0.14, (-33.0, 3.4, 6.05, 0.66, 31.5, -1.0)),
    (0.30, (-12.0, 5.0, 5.80, 0.70, 32.5, -0.5)),
    (0.46, (14.0, 7.2, 6.15, 0.74, 33.5, 0.0)),
    (0.60, (40.0, 8.5, 6.85, 0.78, 33.0, 0.4)),
    (0.74, (64.0, 11.0, 7.40, 0.80, 32.0, 0.7)),
    (0.88, (84.0, 14.5, 7.95, 0.82, 30.5, 0.5)),
    (1.00, (99.0, 18.5, 8.40, 0.84, 29.5, 0.0)),
]


def camera_at(t):
    az, el, dist, ty, fov, roll = catmull_rom(CAM_KEYS, t)
    a, e = math.radians(az), math.radians(el)
    eye = np.array([
        math.cos(a) * math.cos(e) * dist,
        math.sin(e) * dist + ty,
        math.sin(a) * math.cos(e) * dist,
    ])
    target = np.array([0.10, ty, 0.0])
    return eye, target, fov, math.radians(roll)


def view_matrix(eye, target, roll):
    fwd = normalize(target - eye)
    up0 = np.array([0.0, 1.0, 0.0])
    right = normalize(np.cross(fwd, up0))
    up = np.cross(right, fwd)
    if abs(roll) > 1e-6:
        c, s = math.cos(roll), math.sin(roll)
        right, up = right * c + up * s, up * c - right * s
    return np.stack([right, up, -fwd], axis=0)


# --------------------------------------------------------------------------
# rasteriser
# --------------------------------------------------------------------------

class GBuffer:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.depth = np.full((h, w), np.inf, dtype=np.float32)
        self.normal = np.zeros((h, w, 3), dtype=np.float32)
        self.pos = np.zeros((h, w, 3), dtype=np.float32)
        self.mat = np.zeros((h, w), dtype=np.int32)
        self.mirror = np.zeros((h, w), dtype=bool)


def rasterize(gb, V, N, F, M, R, T, fov, mirrored, FN=None, FC=None):
    """Project and scan-convert the mesh into the G-buffer.

    Backfaces are rejected on the geometric normal rather than the screen-space
    winding, so the test cannot silently invert when a part is lofted the other
    way round or mirrored under the floor.
    """
    h, w = gb.h, gb.w
    cam = (V - T) @ R.T                       # view space, -Z forward
    z = -cam[:, 2]
    f = (0.5 * h) / math.tan(math.radians(fov) * 0.5)
    safe = np.maximum(z, 1e-4)
    sx = cam[:, 0] * f / safe + w * 0.5
    sy = -cam[:, 1] * f / safe + h * 0.5

    tri_z = z[F]
    keep = (tri_z > 0.12).all(axis=1)
    keep &= np.sum(FN * (T[None, :] - FC), axis=1) > 0.0

    x0, x1, x2 = sx[F[:, 0]], sx[F[:, 1]], sx[F[:, 2]]
    y0, y1, y2 = sy[F[:, 0]], sy[F[:, 1]], sy[F[:, 2]]
    area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    keep &= np.abs(area) > 1e-7

    bx0 = np.floor(np.minimum(np.minimum(x0, x1), x2))
    bx1 = np.ceil(np.maximum(np.maximum(x0, x1), x2))
    by0 = np.floor(np.minimum(np.minimum(y0, y1), y2))
    by1 = np.ceil(np.maximum(np.maximum(y0, y1), y2))
    keep &= (bx1 >= 0) & (bx0 < w) & (by1 >= 0) & (by0 < h)

    idx = np.nonzero(keep)[0]
    inv_z = (1.0 / safe).astype(np.float32)

    for ti in idx:
        i0, i1, i2 = F[ti]
        ax, ay = x0[ti], y0[ti]
        bx, by = x1[ti], y1[ti]
        cx, cy = x2[ti], y2[ti]
        lo_x = max(int(bx0[ti]), 0)
        hi_x = min(int(bx1[ti]) + 1, w)
        lo_y = max(int(by0[ti]), 0)
        hi_y = min(int(by1[ti]) + 1, h)
        if lo_x >= hi_x or lo_y >= hi_y:
            continue

        px = np.arange(lo_x, hi_x, dtype=np.float32) + 0.5
        py = np.arange(lo_y, hi_y, dtype=np.float32) + 0.5
        gx = px[None, :]
        gy = py[:, None]

        inv_area = 1.0 / area[ti]
        w0 = ((bx - gx) * (cy - gy) - (cx - gx) * (by - gy)) * inv_area
        w1 = ((cx - gx) * (ay - gy) - (ax - gx) * (cy - gy)) * inv_area
        w2 = 1.0 - w0 - w1
        mask = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not mask.any():
            continue

        iz = w0 * inv_z[i0] + w1 * inv_z[i1] + w2 * inv_z[i2]
        depth = 1.0 / np.maximum(iz, 1e-8)

        sub = gb.depth[lo_y:hi_y, lo_x:hi_x]
        mask &= depth < sub
        if not mask.any():
            continue

        my, mx = np.nonzero(mask)
        d = depth[my, mx]
        b0 = (w0[my, mx] * inv_z[i0]) * d
        b1 = (w1[my, mx] * inv_z[i1]) * d
        b2 = (w2[my, mx] * inv_z[i2]) * d
        bw = np.stack([b0, b1, b2], axis=1).astype(np.float32)

        ry = my + lo_y
        rx = mx + lo_x
        gb.depth[ry, rx] = d
        gb.normal[ry, rx] = bw @ N[[i0, i1, i2]]
        gb.pos[ry, rx] = bw @ V[[i0, i1, i2]]
        gb.mat[ry, rx] = M[ti]
        gb.mirror[ry, rx] = mirrored


# --------------------------------------------------------------------------
# shading
# --------------------------------------------------------------------------

def hash_noise(p, seed=0.0):
    q = np.sin(p[..., 0] * 127.1 + p[..., 1] * 311.7 + p[..., 2] * 74.7 + seed) * 43758.5453
    return q - np.floor(q)


def ggx(n_dot_h, rough):
    a = np.maximum(rough * rough, 1e-4)
    d = n_dot_h * n_dot_h * (a * a - 1.0) + 1.0
    return (a * a) / (math.pi * d * d + 1e-9)


DIRECT_LIGHTS = [
    # direction toward the light, colour, strip index it belongs to
    (np.array([0.15, 0.94, 0.30]), np.array([1.00, 1.00, 1.02]), 0),
    (np.array([-0.72, 0.42, 0.55]), np.array([0.90, 1.00, 0.96]), 3),
    (np.array([0.55, 0.30, -0.78]), np.array([1.00, 0.99, 0.94]), 4),
    (np.array([-0.30, 0.20, 0.93]), np.array([0.84, 1.00, 0.92]), 6),
]


def shade(gb, eye, env_sharp, env_mid, env_wide, weights, coat, exposure):
    h, w = gb.h, gb.w
    hit = np.isfinite(gb.depth)
    N = normalize(gb.normal)
    P = gb.pos
    Vv = normalize(eye.astype(np.float32)[None, None, :] - P)
    ndv = np.clip(np.sum(N * Vv, axis=-1), 1e-4, 1.0)[..., None]

    # Pressed body lines. A lofted shell is smooth everywhere, and smooth
    # panels read as soap; the creases are what let the strip reflections
    # snap and give the surface its shoulder.
    is_body = (gb.mat == MAT_PAINT)
    if is_body.any():
        flank = np.clip(np.abs(N[..., 2]) - 0.35, 0.0, 1.0) * is_body
        sc = P[..., 1] - (0.685 + 0.030 * P[..., 0])
        N[..., 1] += np.exp(-0.5 * (sc / 0.050) ** 2) * np.sign(sc) * 0.34 * flank
        sill = P[..., 1] - 0.360
        N[..., 1] += np.exp(-0.5 * (sill / 0.045) ** 2) * np.sign(sill) * 0.20 * flank

        deck = np.clip(N[..., 1] - 0.55, 0.0, 1.0) * is_body
        hood = deck * smoothstep(1.05, 1.35, P[..., 0])
        for zc in (0.40, -0.40):
            dz = P[..., 2] - zc
            N[..., 2] += np.exp(-0.5 * (dz / 0.060) ** 2) * np.sign(dz) * 0.30 * hood
        N = normalize(N)
        Vv = normalize(eye.astype(np.float32)[None, None, :] - P)
        ndv = np.clip(np.sum(N * Vv, axis=-1), 1e-4, 1.0)[..., None]

    mat = gb.mat
    is_paint = (mat == MAT_PAINT)
    # reclassify the greenhouse as glass from position + normal
    belt = np.interp(P[..., 0], BELT_X, BELT_Y).astype(np.float32)
    is_glass = is_paint & (P[..., 1] > belt + 0.012) & (np.abs(N[..., 1]) < 0.74)
    is_paint = is_paint & ~is_glass

    # ---- micro-scratches / swirl marks, dissolved by the ceramic coat
    scratch_amt = float(1.0 - coat)
    swirl = np.zeros((h, w), dtype=np.float32)
    if scratch_amt > 1e-3:
        r = np.linalg.norm(P[..., [0, 2]] - np.array([0.6, 0.0], dtype=np.float32), axis=-1)
        arcs = np.sin(r * 190.0 + hash_noise(P * 9.0) * 6.0) * np.sin(P[..., 1] * 220.0 + 1.7)
        fine = hash_noise(P * 260.0, 3.1)
        swirl = (np.clip(arcs, 0.0, 1.0) ** 3 * 0.85 + fine * 0.35) * scratch_amt

    # forged double-spoke pattern, cut into the rim face in screen space
    is_rim = (mat == MAT_RIM)
    spoke_gap = np.zeros((h, w), dtype=np.float32)
    if is_rim.any():
        wx = np.where(P[..., 0] >= 0.0, WHEEL_X, -WHEEL_X)
        ang = np.arctan2(P[..., 1] - WHEEL_R, P[..., 0] - wx)
        rad = np.hypot(P[..., 1] - WHEEL_R, P[..., 0] - wx) / (WHEEL_R * 0.66)
        pattern = np.abs(np.cos(5.0 * ang)) * np.abs(np.cos(10.0 * ang + 0.35))
        gap = smoothstep(0.58, 0.24, pattern) * smoothstep(0.28, 0.46, rad) * smoothstep(1.00, 0.86, rad)
        spoke_gap = gap * is_rim

    rough = np.full((h, w), 0.9, dtype=np.float32)
    rough[is_paint] = lerp(0.215, 0.042, coat)
    rough[is_glass] = 0.030
    rough[is_rim] = 0.10
    rough += spoke_gap * 0.55
    # Rubber gets a real sheen: a matte tyre is black-on-black against a dark
    # studio floor, which leaves the rim looking like a disc floating in space.
    rough[mat == MAT_TIRE] = 0.56
    rough[mat == MAT_TRIM] = 0.42
    rough += swirl * 0.30

    Rv = normalize(2.0 * np.sum(N * Vv, axis=-1)[..., None] * N - Vv)
    spec_sharp = sample_env(env_sharp, Rv)
    spec_mid = sample_env(env_mid, Rv)
    spec_wide = sample_env(env_wide, Rv)
    irr = sample_env(env_wide, N)

    blend = np.clip((rough - 0.05) / 0.25, 0.0, 1.0)[..., None]
    blend2 = np.clip((rough - 0.30) / 0.45, 0.0, 1.0)[..., None]
    refl = lerp(lerp(spec_sharp, spec_mid, blend), spec_wide, blend2)

    fres = 0.04 + 0.96 * (1.0 - ndv) ** 5

    col = np.zeros((h, w, 3), dtype=np.float32)

    # base colour per material
    base = np.zeros((h, w, 3), dtype=np.float32)
    base[is_paint] = EMERALD
    # a little life in the rubber, or the tyre silhouette vanishes into the
    # floor and the car reads as floating
    base[mat == MAT_TIRE] = np.array([0.030, 0.031, 0.033], dtype=np.float32)
    base[mat == MAT_RIM] = TITANIUM * 0.16
    base[mat == MAT_TRIM] = np.array([0.020, 0.021, 0.023], dtype=np.float32)
    base[is_glass] = np.array([0.010, 0.012, 0.013], dtype=np.float32)

    metal_mask = (mat == MAT_RIM)[..., None]

    # basecoat: emerald pigment lit by the studio's diffuse irradiance
    col += base * irr * 2.6 * (1.0 - metal_mask)

    # aluminium flake suspended in the basecoat -- sparse, angle dependent
    flake = (hash_noise(P * 520.0, 7.7) ** 9)[..., None]
    col += np.where(is_paint[..., None], flake * refl * 0.22, 0.0)

    # clearcoat / metal: Fresnel-weighted environment reflection
    # Satin graphite forged wheels. A near-mirror F0 turns the rim face into a
    # bright disc the moment it squares up to the camera, which reads as a
    # hubcap rather than a wheel.
    f0 = np.where(metal_mask, TITANIUM[None, None, :] * 0.20,
                  np.full(3, 0.042, dtype=np.float32))
    fres_col = f0 + (1.0 - f0) * ((1.0 - ndv) ** 5)
    col += refl * fres_col
    # the gaps between spokes look through to the caliper and the dark barrel
    col *= (1.0 - spoke_gap * 0.90)[..., None]

    # direct area-light highlights, energy-clamped so a mirror clearcoat
    # cannot produce a single blown pixel
    for ldir, lcol, strip in DIRECT_LIGHTS:
        wgt = float(weights[strip])
        if wgt <= 1e-3:
            continue
        L = ldir.astype(np.float32) / np.linalg.norm(ldir)
        H = normalize(L[None, None, :] + Vv)
        ndh = np.clip(np.sum(N * H, axis=-1), 0.0, 1.0)
        ndl = np.clip(np.sum(N * L[None, None, :], axis=-1), 0.0, 1.0)
        s = np.minimum(ggx(ndh, np.maximum(rough, 0.055)), 700.0) * ndl * wgt
        col += (s * 0.0045)[..., None] * lcol.astype(np.float32)
        col += (ndl * wgt * 0.42)[..., None] * base * lcol.astype(np.float32)

    # scratch haze: light scattered by damaged clearcoat
    col += (swirl * 0.055)[..., None] * np.array([0.55, 0.62, 0.60], dtype=np.float32) * is_paint[..., None]

    # emissive lamps
    lit = float(np.clip(weights[0] * 0.4 + 0.6, 0.6, 1.0))
    col[mat == MAT_HEADLIGHT] = np.array([2.9, 3.25, 3.3], dtype=np.float32) * lit
    tail = (mat == MAT_TAILLIGHT)
    col[tail] = (refl * 0.22 + np.array([0.012, 0.014, 0.014], dtype=np.float32))[tail]

    col *= exposure
    col[~hit] = 0.0
    return col, hit


def floor_and_fog(col, gb, eye, R, fov, env_wide, weights, exposure, t):
    """Composite the black-concrete floor, the wet reflection and volumetric fog."""
    h, w = gb.h, gb.w
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    f = (0.5 * h) / math.tan(math.radians(fov) * 0.5)
    dirs_cam = np.stack([(xx + 0.5 - w * 0.5) / f, -(yy + 0.5 - h * 0.5) / f, -np.ones_like(xx)], axis=-1)
    dirs = normalize(dirs_cam @ R)          # R rows are the basis -> transpose applied

    hit = np.isfinite(gb.depth)
    dy = dirs[..., 1]
    to_floor = dy < -1e-4
    tf = np.where(to_floor, -eye[1] / np.where(to_floor, dy, -1.0), 400.0)
    tf = np.minimum(tf, 400.0)
    fp = eye.astype(np.float32)[None, None, :] + dirs * tf[..., None]
    fdist = np.linalg.norm(fp - eye.astype(np.float32)[None, None, :], axis=-1)

    # concrete: broad pour-mottling plus a fine tooth
    m = (
        np.sin(fp[..., 0] * 0.9 + 1.3) * np.sin(fp[..., 2] * 1.1)
        + np.sin(fp[..., 0] * 3.7) * np.sin(fp[..., 2] * 4.1) * 0.4
    )
    tooth = hash_noise(fp * 46.0, 2.2)
    concrete = (0.0075 + 0.0045 * (m * 0.5 + 0.5) + 0.0035 * tooth)[..., None]
    concrete = concrete * np.array([0.90, 0.95, 1.0], dtype=np.float32)

    # the floor is polished, so it also mirrors the light strips
    fr = dirs.copy()
    fr[..., 1] = -fr[..., 1]
    gloss = sample_env(env_wide, fr) * 0.30
    fdim = np.exp(-fdist * 0.10)[..., None]
    floor_col = (concrete + gloss * fdim) * exposure

    valid_floor = to_floor & ~hit & np.isfinite(tf)
    out = np.where(valid_floor[..., None], floor_col, col)

    # mirrored geometry -> attenuate, tint and it becomes the wet reflection
    mir = gb.mirror & hit
    if mir.any():
        depth_fade = np.exp(-np.clip(gb.depth - eye[1] * 0.4, 0, None) * 0.075)[..., None]
        refl = col * 0.30 * depth_fade
        blurred = gaussian_filter(refl, (5.0, 1.6, 0), mode="nearest")
        refl = lerp(refl, blurred, 0.62)
        out = np.where(mir[..., None], refl + floor_col * 0.72, out)

    # distance fog + a soft horizon glow so walls read as matte, not empty
    depth = np.where(hit, gb.depth, np.where(valid_floor, fdist, 90.0))
    fog = 1.0 - np.exp(-np.clip(depth - 3.2, 0, None) * 0.030)
    fog_col = np.array([0.0075, 0.0090, 0.0098], dtype=np.float32) * exposure
    horizon = smoothstep(0.22, -0.02, dirs[..., 1])[..., None]
    fog_col = fog_col * (1.0 + horizon * 2.2)
    out = lerp(out, fog_col, fog[..., None] * 0.85)

    # volumetric shafts falling from the ceiling rails
    shaft = np.zeros((h, w), dtype=np.float32)
    for i, (az, aw, ev, eh, tint, rad) in enumerate(STRIPS[:4]):
        wgt = float(weights[i])
        if wgt <= 1e-3:
            continue
        ang = np.arctan2(dirs[..., 2], dirs[..., 0])
        d = np.abs(((ang - az * math.pi) + math.pi) % (2 * math.pi) - math.pi)
        beam = np.exp(-(d / (aw * 1.9)) ** 2)
        vert = smoothstep(-0.45, 0.55, dirs[..., 1])
        shaft += beam * vert * wgt * 0.030
    out += shaft[..., None] * np.array([0.86, 0.98, 0.94], dtype=np.float32) * exposure

    # floating dust, drifting with the sequence
    rng = np.random.default_rng(7)
    n = 240
    px = rng.random(n)
    pz = rng.random(n)
    py = rng.random(n)
    dust_pos = np.stack([
        (px * 2 - 1) * 5.0,
        py * 2.6 + 0.12,
        (pz * 2 - 1) * 4.4,
    ], axis=1).astype(np.float32)
    dust_pos[:, 1] += np.sin(t * 6.0 + px * 12.0) * 0.16
    dust_pos[:, 0] += np.cos(t * 4.2 + pz * 9.0) * 0.22
    dc = (dust_pos - eye.astype(np.float32)[None, :]) @ R.T
    dz = -dc[:, 2]
    ok = dz > 0.35
    dsx = (dc[ok, 0] * f / dz[ok] + w * 0.5).astype(np.int32)
    dsy = (-dc[ok, 1] * f / dz[ok] + h * 0.5).astype(np.int32)
    inside = (dsx >= 1) & (dsx < w - 1) & (dsy >= 1) & (dsy < h - 1)
    bright = (0.10 / (dz[ok][inside] + 0.4))[..., None] * exposure
    layer = np.zeros((h, w, 3), dtype=np.float32)
    np.add.at(layer, (dsy[inside], dsx[inside]), bright * np.array([0.9, 1.0, 0.96], dtype=np.float32))
    out += gaussian_filter(layer, (1.1, 1.1, 0))

    return out


def post(col, t, seed):
    """Bloom, ACES, grain, aberration, vignette."""
    h, w = col.shape[:2]
    bright = np.clip(col - 0.85, 0.0, None)
    bloom = gaussian_filter(bright, (7, 7, 0)) * 0.75 + gaussian_filter(bright, (26, 26, 0)) * 0.55
    col = col + bloom

    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    col = np.clip((col * (a * col + b)) / (col * (c * col + d) + e), 0.0, 1.0)

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (xx / w - 0.5) * 2.0
    ny = (yy / h - 0.5) * 2.0
    r2 = nx * nx + ny * ny

    # chromatic aberration toward the frame edges
    shift = (r2 * 1.6).astype(np.float32)
    xr = np.clip(xx + shift * nx * 1.1, 0, w - 1).astype(np.int32)
    xb = np.clip(xx - shift * nx * 1.1, 0, w - 1).astype(np.int32)
    col[..., 0] = col[yy.astype(np.int32), xr, 0]
    col[..., 2] = col[yy.astype(np.int32), xb, 2]

    col *= (1.0 - 0.42 * np.clip(r2 * 0.62, 0, 1) ** 1.5)[..., None]

    # graded toward graphite shadows and cool titanium highlights
    lum = col.mean(axis=-1, keepdims=True)
    col = col * (1.0 + (np.array([-0.02, 0.03, 0.02], dtype=np.float32)) * (1.0 - lum))

    rng = np.random.default_rng(seed)
    col += (rng.random((h, w, 1), dtype=np.float32) - 0.5) * 0.016
    return np.clip(col, 0.0, 1.0)


# --------------------------------------------------------------------------
# sequence schedule -- maps scroll progress onto the reveal
# --------------------------------------------------------------------------

def schedule(t):
    """Returns (strip weights, exposure, ceramic-coat amount)."""
    # strips ignite one at a time between 0.46 and 0.92
    order = [0, 3, 1, 2, 6, 4, 5]
    weights = np.zeros(len(STRIPS), dtype=np.float32)
    for slot, idx in enumerate(order):
        start = 0.06 + slot * 0.118
        weights[idx] = float(smoothstep(start, start + 0.16, t))
    # the key light is barely alive at the very start -- only the lamps read
    weights[0] = max(weights[0], float(smoothstep(0.0, 0.10, t)) * 0.10)

    exposure = float(lerp(0.26, 1.00, smoothstep(0.02, 0.62, t)))
    coat = float(smoothstep(0.17, 0.44, t))
    return weights, exposure, coat


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=420)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--out", default=None)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--end", type=int, default=None)
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = args.out or os.path.join(root, "assets", "sequence", "hero")
    os.makedirs(out_dir, exist_ok=True)

    W = args.width
    H = int(round(W * 9 / 16))

    V, F, M = build_car()
    N = vertex_normals(V, F)
    FN = face_normals(V, F)
    FC = V[F].mean(axis=1)
    Vm = V.copy()
    Vm[:, 1] *= -1.0
    Nm = N.copy()
    Nm[:, 1] *= -1.0
    FNm = FN.copy()
    FNm[:, 1] *= -1.0
    FCm = FC.copy()
    FCm[:, 1] *= -1.0
    print(f"mesh: {len(V)} verts, {len(F)} tris -> {W}x{H}, {args.frames} frames", flush=True)

    env = Environment()
    first, last = args.start, args.end if args.end is not None else args.frames
    t_start = time.time()

    for i in range(first, last):
        t = i / (args.frames - 1)
        weights, exposure, coat = schedule(t)
        eye, target, fov, roll = camera_at(t)
        R = view_matrix(eye, target, roll).astype(np.float32)
        eye32 = eye.astype(np.float32)

        gb = GBuffer(W, H)
        rasterize(gb, V, N, F, M, R, eye32, fov, False, FN, FC)
        rasterize(gb, Vm, Nm, F, M, R, eye32, fov, True, FNm, FCm)

        es, em, ew = env.build(weights, exposure)
        col, _ = shade(gb, eye32, es, em, ew, weights, coat, 1.0)
        col = floor_and_fog(col, gb, eye32, R, fov, ew, weights, exposure, t)
        col = post(col, t, seed=1000 + i)

        img = Image.fromarray((col * 255.0 + 0.5).astype(np.uint8), "RGB")
        img.save(os.path.join(out_dir, f"frame_{i + 1:04d}.webp"), "WEBP",
                 quality=args.quality, method=4)

        if (i - first) % 10 == 0 or i == last - 1:
            done = i - first + 1
            el = time.time() - t_start
            eta = el / done * (last - first - done)
            print(f"  frame {i + 1}/{args.frames}  {el:6.1f}s elapsed  ~{eta:6.1f}s left", flush=True)

    total = sum(
        os.path.getsize(os.path.join(out_dir, f))
        for f in os.listdir(out_dir) if f.endswith(".webp")
    )
    manifest = {
        "source": "procedural",
        "pattern": "assets/sequence/hero/frame_{index}.webp",
        "pad": 4,
        "start": 1,
        "count": args.frames,
        "width": W,
        "height": H,
        "bytes": total,
        "scenes": {
            "reveal": [0.00, 0.20],
            "orbit": [0.20, 0.46],
            "coating": [0.17, 0.44],
            "ignite": [0.46, 0.92],
            "crane": [0.74, 1.00],
        },
    }
    with open(os.path.join(os.path.dirname(out_dir), "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"done -- {total / 1e6:.1f} MB total", flush=True)


if __name__ == "__main__":
    sys.exit(main() or 0)
