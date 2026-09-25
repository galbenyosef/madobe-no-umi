#!/usr/bin/env python3
"""
Build the runtime assets for "Finestra" from source/coast.webp.

  python3 tools/build_assets.py              # writes assets/*
  python3 tools/build_assets.py --debug DIR  # also dumps visual checks to DIR

Needs numpy, scipy, Pillow and torch (MPS or CPU).

What it produces (all in assets/):
  land.webp      RGB,  the painted village / cliffs / mountains
  land_alpha.png L,    coverage of land.webp (land mask)
  sea.webp       RGB,  the painted sea with land, boats and sun glitter removed
  land_aux.png   L,    foliage (how much the painted trees sway in the wind)
  sea_aux.png    R = shore proximity (foam), G = shallow water, B = open water
  lights.png     R = lit windows / lamps, G = per-light id, B = warm halo (night)
  depth.json     grid of camera-space depth (metres) for the land mesh, log-quantised
  scene.json     camera model shared with the renderer
"""
import argparse
import base64
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from scipy import ndimage as ndi
from scipy.interpolate import RBFInterpolator

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "coast.webp"
OUT = ROOT / "assets"

# ---------------------------------------------------------------------------
# Camera model of the source photo (pinhole, pitched down, no roll)
# ---------------------------------------------------------------------------
W, H = 1672, 941
HFOV_DEG = 70.0
FOCAL = (W / 2) / math.tan(math.radians(HFOV_DEG / 2))
CX, CY = W / 2, H / 2
HORIZON = 172.5
PITCH = math.atan((CY - HORIZON) / FOCAL)  # radians, looking down
CAM_HEIGHT = 45.0  # metres above the sea
SCALE = 2  # painted textures are rendered at 2x for crisp edges on HiDPI
DEPTH_STEP = 4  # land mesh vertex spacing in source pixels

DEV = "mps" if torch.backends.mps.is_available() else "cpu"
DEBUG = None


def dbg(name, arr):
    if DEBUG is None:
        return
    a = np.asarray(arr)
    if a.dtype != np.uint8:
        a = (np.clip(a, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(a).save(DEBUG / name)


# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
def srgb_to_linear(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x):
    x = np.maximum(x, 0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def rgb_to_oklab(rgb):
    lin = srgb_to_linear(rgb)
    m1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                   [0.2119034982, 0.6806995451, 0.1073969566],
                   [0.0883024619, 0.2817188376, 0.6299787005]])
    lms = np.cbrt(np.maximum(np.einsum('...j,ij->...i', lin, m1), 0))
    m2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                   [1.9779984951, -2.4285922050, 0.4505937099],
                   [0.0259040371, 0.7827717662, -0.8086757660]])
    return np.einsum('...j,ij->...i', lms, m2)


def oklab_to_rgb(lab):
    m2i = np.array([[1.0, 0.3963377774, 0.2158037573],
                    [1.0, -0.1055613458, -0.0638541728],
                    [1.0, -0.0894841775, -1.2914855480]])
    lms = np.einsum('...j,ij->...i', lab, m2i) ** 3
    m1i = np.array([[4.0767416621, -3.3077115913, 0.2309699292],
                    [-1.2684380046, 2.6097574011, -0.3413193965],
                    [-0.0041960863, -0.7034186147, 1.7076147010]])
    return np.clip(linear_to_srgb(np.einsum('...j,ij->...i', lms, m1i)), 0, 1)


def luma(im):
    return im[..., 0] * 0.299 + im[..., 1] * 0.587 + im[..., 2] * 0.114


def hsv_parts(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    mx, mn = im.max(-1), im.min(-1)
    d = np.maximum(mx - mn, 1e-6)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, s, mx


# ---------------------------------------------------------------------------
# Masks
# ---------------------------------------------------------------------------
def boundary_lines():
    """Edges of the window frame / sill / plant in the photo (x or y as a function)."""
    left = lambda y: 230 + 0.04 * y          # green shutter, x = f(y)
    sill = lambda x: 742 + 0.277 * (x - 450)  # top of the sill rail, y = f(x)
    right = lambda y: 1551 - 0.042 * y        # right frame, x = f(y)
    return left, sill, right


def build_masks(im):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    left, sill, right = boundary_lines()
    interior = (xx < left(yy)) | (yy > sill(xx)) | (xx > right(yy))

    h, s, v = hsv_parts(im)
    lum = luma(im)

    # --- sky: per column, everything above the first run clearly darker than the sky.
    # The sky brightens towards the horizon; take that profile from the open-sea side
    # and shift it per column so the deeper blue on the left is not mistaken for hills.
    ref = np.percentile(lum[:, 880:1500], 25, axis=1)
    ridge = np.full(W, HORIZON)
    for x in range(W):
        if x > 835:
            continue
        local = ref + (lum[2:14, x].mean() - ref[2:14].mean())
        col = lum[: int(HORIZON) + 1, x] < local[: int(HORIZON) + 1] - 0.15
        run = np.convolve(col.astype(np.int32), np.ones(3, np.int32), "valid") == 3
        if run.any():
            ridge[x] = min(np.argmax(run), HORIZON)
    ridge = ndi.median_filter(ridge, size=3)
    sky = (yy < ridge[None, :]) & (yy < HORIZON) & ~interior

    # --- water: blue / teal hue, bright glitter, foam next to water
    below = yy > HORIZON
    water = below & (h > 140) & (h < 250) & (s > 0.14) & (v > 0.12)
    glitter = below & (v > 0.75) & (s < 0.45) & (im[..., 2] >= im[..., 0] - 0.03)
    cand = (water | glitter) & ~interior
    lab, _ = ndi.label(cand)
    sea = lab == lab[400, 1100]
    near = ndi.binary_dilation(sea, iterations=10)
    foam = near & below & (v > 0.65) & (s < 0.35) & (im[..., 2] >= im[..., 0] - 0.02) & ~interior
    sea = sea | foam

    # small bright holes inside the water are boats / specks -> repaint as water
    filled = ndi.binary_fill_holes(sea)
    holes = filled & ~sea
    hl, hn = ndi.label(holes)
    boats = np.zeros_like(sea)
    for i in range(1, hn + 1):
        m = hl == i
        a = m.sum()
        if a < 1500 and (v[m].mean() > 0.55 or a < 30):
            boats |= m
    # the tiny sailboat on the horizon is outside the flood fill; mask it by hand
    boats |= (np.abs(xx - 1395) < 6) & (yy > 166) & (yy < 182)
    # include hull shadows and wakes
    boats = ndi.binary_dilation(boats, iterations=4) & ~interior
    # rocks just under the surface show up as dark "islands" inside the water;
    # treat them as water so they get no foam ring and move with the waves
    islands = ndi.binary_fill_holes(sea | boats) & ~(sea | boats)
    il, iN = ndi.label(islands)
    for i in range(1, iN + 1):
        m = il == i
        if m.sum() > 4000:
            continue
        hm, sm, vm = np.median(h[m]), np.median(s[m]), np.median(v[m])
        if 120 < hm < 250 and vm < 0.5 and sm > 0.12:
            sea |= m
    sea_all = (sea | boats) & below
    land = ~sky & ~sea_all & ~interior
    # everything above the ridge and below the horizon that is not sea is land;
    # the band just above the horizon for x > ridge is sky
    return dict(interior=interior, sky=sky, sea=sea & ~boats, boats=boats,
                sea_all=sea_all, land=land, ridge=ridge)


# ---------------------------------------------------------------------------
# Filling helpers
# ---------------------------------------------------------------------------
def pushpull(img, mask):
    """Fill pixels where mask==0 with smooth colours pulled from mask>0."""
    img = img.astype(np.float64)
    m = mask.astype(np.float64)
    c = img * m[..., None]
    levels = []
    while min(m.shape) > 1 and m.min() < 1e-6:
        levels.append((c, m))
        h, w = m.shape
        h2, w2 = (h + 1) // 2, (w + 1) // 2
        cp = np.zeros((h2 * 2, w2 * 2, c.shape[2]))
        cp[:h, :w] = c
        mp = np.zeros((h2 * 2, w2 * 2))
        mp[:h, :w] = m
        cs = cp.reshape(h2, 2, w2, 2, -1).sum((1, 3))
        ms = mp.reshape(h2, 2, w2, 2).sum((1, 3))
        avg = cs / np.maximum(ms, 1e-9)[..., None]
        cov = np.minimum(ms, 1.0)
        c, m = avg * cov[..., None], cov
    col = c / np.maximum(m, 1e-9)[..., None]
    if m.min() < 1e-6:  # still holes at the coarsest level: use the global mean
        mean = c.reshape(-1, c.shape[2]).sum(0) / max(m.sum(), 1e-9)
        col[m < 1e-6] = mean
    for cl, ml in reversed(levels):
        h, w = ml.shape
        up = ndi.zoom(col, (2, 2, 1), order=1, mode="nearest")
        if up.shape[0] < h or up.shape[1] < w:
            up = np.pad(up, ((0, max(0, h - up.shape[0])), (0, max(0, w - up.shape[1])), (0, 0)), mode="edge")
        up = up[:h, :w]
        avg = cl / np.maximum(ml, 1e-9)[..., None]
        col = avg * ml[..., None] + up * (1 - ml[..., None])
    return col.astype(np.float32)


def mirror_fill(img, labels, interior, band=220):
    """Reflect the outside view across the frame edges into the frame region.

    Only a band next to each edge is filled; that is all the parallax can reveal.
    Returns the filled image, the reflected labels and a mask of filled pixels.
    """
    left, sill, right = boundary_lines()
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    best_d = np.full((H, W), np.inf, np.float32)
    src_x = np.zeros((H, W), np.float32)
    src_y = np.zeros((H, W), np.float32)

    def consider(d, sx, sy):
        ok = interior & (d >= 0) & (d < band) & (d < best_d)
        ok &= (sx >= 0) & (sx <= W - 1) & (sy >= 0) & (sy <= H - 1)
        ok2 = ok.copy()
        ixs = np.clip(np.round(sx).astype(int), 0, W - 1)
        iys = np.clip(np.round(sy).astype(int), 0, H - 1)
        ok2 &= ~interior[iys, ixs]
        best_d[ok2] = d[ok2]
        src_x[ok2] = sx[ok2]
        src_y[ok2] = sy[ok2]

    # left edge x = 230 + 0.04 y  -> line n = (1, -0.04)/|n|
    n = np.array([1.0, -0.04]) / math.hypot(1, 0.04)
    dist = -((xx - 230) * n[0] + yy * n[1])  # positive inside (left of the line)
    consider(dist, xx + 2 * dist * n[0], yy + 2 * dist * n[1])
    # sill y = 742 + 0.277 (x - 450) -> points below the line
    n = np.array([-0.277, 1.0]) / math.hypot(0.277, 1)
    dist = (xx - 450) * n[0] + (yy - 742) * n[1]
    consider(dist, xx - 2 * dist * n[0], yy - 2 * dist * n[1])
    # right edge x = 1551 - 0.042 y
    n = np.array([1.0, 0.042]) / math.hypot(1, 0.042)
    dist = (xx - 1551) * n[0] + yy * n[1]
    consider(dist, xx - 2 * dist * n[0], yy - 2 * dist * n[1])

    filled = np.isfinite(best_d)
    out = img.copy()
    for ch in range(img.shape[2]):
        vals = ndi.map_coordinates(img[..., ch], [src_y[filled], src_x[filled]], order=1, mode="nearest")
        out[..., ch][filled] = vals
    lab_out = labels.copy()
    ixs = np.clip(np.round(src_x[filled]).astype(int), 0, W - 1)
    iys = np.clip(np.round(src_y[filled]).astype(int), 0, H - 1)
    lab_out[filled] = labels[iys, ixs]
    return out, lab_out, filled


def remove_glitter(im, sea):
    """Sun glitter is baked into the photo; replace it with the local water colour
    so the renderer can draw its own glitter for any sun position."""
    lum = luma(im)
    filled = pushpull(im, sea.astype(np.float32))
    base = np.stack([ndi.median_filter(filled[..., c], size=21) for c in range(3)], -1)
    base_l = luma(base)
    h, s, v = hsv_parts(im)
    spark = sea & (lum > base_l + 0.06) & (s < 0.55)
    spark = ndi.binary_dilation(spark, iterations=1) & sea
    out = im.copy()
    out[spark] = base[spark]
    # the whole glitter path is also lifted; pull it back towards the left side's tone
    yy, xx = np.mgrid[0:H, 0:W]
    low = ndi.gaussian_filter(luma(out), 18)
    ref_rows = np.array([np.median(low[y, 900:1250]) if y > HORIZON else 0 for y in range(H)])
    excess = np.clip(low - ref_rows[:, None], 0, None)
    w = np.clip((xx - 1200) / 120.0, 0, 1) * sea
    out = out - (excess * w * 1.15)[..., None]
    return np.clip(out, 0, 1), spark


# ---------------------------------------------------------------------------
# Painterly filter: anisotropic Kuwahara (Kyprianidis et al. 2009)
# ---------------------------------------------------------------------------
def _gauss_blur(x, sigma):
    r = int(math.ceil(sigma * 3))
    t = torch.arange(-r, r + 1, device=x.device, dtype=x.dtype)
    k = torch.exp(-t * t / (2 * sigma * sigma))
    k = k / k.sum()
    c = x.shape[1]
    x = F.conv2d(F.pad(x, (r, r, 0, 0), mode="replicate"), k.view(1, 1, 1, -1).repeat(c, 1, 1, 1), groups=c)
    x = F.conv2d(F.pad(x, (0, 0, r, r), mode="replicate"), k.view(1, 1, -1, 1).repeat(c, 1, 1, 1), groups=c)
    return x


def akuwahara(img, radius=6.0, sectors=8, q=8.0, alpha=1.0, st_sigma=2.0, n_ang=32, n_rad=6, sharp=8.0):
    hh, ww, _ = img.shape
    x = torch.tensor(img.transpose(2, 0, 1)[None].copy(), device=DEV, dtype=torch.float32)
    sx = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], device=DEV, dtype=torch.float32) / 4
    xp = F.pad(x, (1, 1, 1, 1), mode="replicate")
    gx = F.conv2d(xp, sx.view(1, 1, 3, 3).repeat(3, 1, 1, 1), groups=3)
    gy = F.conv2d(xp, sx.t().reshape(1, 1, 3, 3).repeat(3, 1, 1, 1), groups=3)
    st = _gauss_blur(torch.cat([(gx * gx).sum(1, keepdim=True), (gx * gy).sum(1, keepdim=True),
                                (gy * gy).sum(1, keepdim=True)], 1), st_sigma)
    e, f, g = st[:, 0], st[:, 1], st[:, 2]
    tmp = torch.sqrt((e - g) ** 2 + 4 * f * f)
    l1, l2 = 0.5 * (e + g + tmp), 0.5 * (e + g - tmp)
    tx, ty = l1 - e, -f
    nrm = torch.sqrt(tx * tx + ty * ty)
    tx = torch.where(nrm > 1e-8, tx / nrm.clamp(min=1e-8), torch.ones_like(tx))
    ty = torch.where(nrm > 1e-8, ty / nrm.clamp(min=1e-8), torch.zeros_like(ty))
    aniso = torch.where(l1 + l2 > 1e-8, (l1 - l2) / (l1 + l2).clamp(min=1e-8), torch.zeros_like(l1))
    phi = torch.atan2(ty, tx)
    a = radius * torch.clamp((alpha + aniso) / alpha, 0.1, 2.0)
    b = radius * torch.clamp(alpha / (alpha + aniso), 0.1, 2.0)
    cphi, sphi = torch.cos(phi)[0], torch.sin(phi)[0]
    a, b = a[0], b[0]
    ys, xs = torch.meshgrid(torch.arange(hh, device=DEV, dtype=torch.float32),
                            torch.arange(ww, device=DEV, dtype=torch.float32), indexing="ij")
    nsum = torch.zeros(sectors, hh, ww, device=DEV)
    msum = torch.zeros(sectors, 3, hh, ww, device=DEV)
    ssum = torch.zeros(sectors, 3, hh, ww, device=DEV)
    sw = 2 * math.pi / sectors
    for ir in range(n_rad):
        rr = (ir + 0.5) / n_rad
        gw = math.exp(-(rr * rr) / (2 * 0.4 * 0.4))
        for ia in range(n_ang):
            th = (ia + 0.5) / n_ang * 2 * math.pi
            u, v = rr * math.cos(th), rr * math.sin(th)
            ox = (u * a) * cphi - (v * b) * sphi
            oy = (u * a) * sphi + (v * b) * cphi
            gxs = (xs + ox).clamp(0, ww - 1) / (ww - 1) * 2 - 1
            gys = (ys + oy).clamp(0, hh - 1) / (hh - 1) * 2 - 1
            smp = F.grid_sample(x, torch.stack([gxs, gys], -1)[None], mode="bilinear",
                                padding_mode="zeros", align_corners=True)[0]
            s2 = smp * smp
            for k in range(sectors):
                d = math.remainder(th - k * sw, 2 * math.pi)
                if abs(d) >= sw * 0.75:
                    continue
                wk = math.cos(d / (sw * 0.75) * math.pi / 2) ** 2 * gw
                nsum[k] += wk
                msum[k] += wk * smp
                ssum[k] += wk * s2
    m = msum / nsum[:, None].clamp(min=1e-8)
    var = (ssum / nsum[:, None].clamp(min=1e-8) - m * m).clamp(min=0).sum(1)
    sd = torch.sqrt(var + 1e-10) * 255
    wgt = 1.0 / (1.0 + (sd / sharp) ** q)
    wgt = wgt / wgt.sum(0, keepdim=True).clamp(min=1e-12)
    out = (m * wgt[:, None]).sum(0)
    return out.cpu().numpy().transpose(1, 2, 0)


def unsharp(img, sigma=1.2, amount=0.35):
    blur = np.stack([ndi.gaussian_filter(img[..., c], sigma) for c in range(3)], -1)
    return np.clip(img + (img - blur) * amount, 0, 1)


def anime_grade(rgb, kind="land"):
    """Push the photo towards an anime background palette (Oklab)."""
    lab = rgb_to_oklab(rgb)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(A, B)
    hue = np.arctan2(B, A)
    # chroma boost with soft roll-off
    boost = 1.28 if kind == "land" else 1.35
    C2 = C * boost / (1 + C * 1.2)
    C2 = np.maximum(C2, C * 1.05)
    # blues/cyans (sea, shutters) a little more vivid
    blue = np.clip(np.cos(hue - math.radians(-110)), 0, 1) ** 2
    C2 = C2 * (1 + 0.18 * blue)
    A, B = C2 * np.cos(hue), C2 * np.sin(hue)
    # gentle S-curve on lightness, lifted blacks
    Ls = L * L * (3 - 2 * L)
    L2 = 0.04 + 0.96 * (L * 0.65 + Ls * 0.35)
    # cool shadows, warm highlights
    sh = np.clip(1 - L2 / 0.55, 0, 1) ** 2
    hi = np.clip((L2 - 0.6) / 0.4, 0, 1) ** 2
    A = A + 0.012 * sh + 0.004 * hi
    B = B - 0.035 * sh + 0.014 * hi
    return oklab_to_rgb(np.stack([L2, A, B], -1))


# ---------------------------------------------------------------------------
# Geometry: rays, sea plane and land depth
# ---------------------------------------------------------------------------
def sea_depth(yy):
    """Camera-space depth (metres) where each pixel row meets the sea plane."""
    dy = ((CY - yy) / FOCAL) * math.cos(PITCH) - math.sin(PITCH)
    with np.errstate(divide="ignore"):
        return np.where(dy < -1e-5, CAM_HEIGHT / np.maximum(-dy, 1e-5), 1e6)


# Hand-placed depth anchors (x, y, metres) read off the photo.
DEPTH_ANCHORS = [
    # roofs right under the window
    (260, 700, 11), (400, 700, 13), (530, 690, 17), (260, 600, 12), (380, 600, 14), (520, 600, 19),
    (260, 540, 14), (380, 540, 16), (520, 540, 21),
    # peach / pink facades on the left
    (260, 480, 17), (300, 400, 19), (250, 320, 21), (330, 300, 23), (345, 470, 21),
    (420, 420, 28), (500, 380, 33), (430, 340, 30), (470, 520, 26), (535, 500, 30),
    # house below-left of the window and its terraces
    (450, 760, 17), (600, 770, 22), (680, 730, 27), (560, 660, 26), (650, 665, 31),
    # middle of the village
    (590, 420, 58), (610, 300, 72), (500, 280, 66), (470, 250, 70), (550, 255, 78), (620, 380, 70),
    # upper village and hill
    (250, 200, 115), (270, 150, 150), (400, 175, 135), (490, 185, 150), (380, 110, 260),
    (250, 105, 260), (460, 130, 230), (560, 200, 140), (590, 225, 120),
    # wooded promontory
    (640, 300, 110), (700, 350, 150), (700, 430, 140), (650, 460, 110), (720, 520, 135),
    (780, 470, 150), (760, 600, 120), (700, 620, 110), (650, 560, 105),
    # rocks in the water
    (760, 325, 320), (850, 335, 340), (780, 385, 280), (870, 470, 160), (900, 520, 150),
    (960, 500, 160), (1050, 510, 170), (950, 660, 105), (900, 700, 100), (1000, 660, 108),
    (720, 600, 115), (760, 640, 110), (800, 690, 100),
    # terraces at the foot of the hill
    (750, 760, 70), (850, 800, 70), (950, 850, 65), (1050, 880, 60), (1150, 920, 55), (800, 900, 55),
    (1100, 800, 72),
    # right-hand cliff with the umbrella pine
    (1300, 750, 85), (1300, 850, 80), (1400, 600, 75), (1450, 520, 75), (1500, 700, 60),
    (1500, 900, 45), (1350, 900, 55), (1200, 800, 85), (1380, 520, 80), (1530, 560, 70),
    # far coast and mountains
    (560, 175, 2500), (700, 176, 4000), (800, 173, 6000), (300, 60, 4000), (500, 100, 4500),
    (650, 150, 7000), (820, 168, 9000), (240, 45, 3800), (420, 70, 4200),
]


FAR_DEPTH = 900.0  # beyond this nothing shows measurable parallax


def build_depth(land_ext):
    anchors = [(x, y, min(z, FAR_DEPTH)) for x, y, z in DEPTH_ANCHORS]
    pts = np.array([(x, y) for x, y, _ in anchors], np.float64)
    vals = np.log(np.array([z for _, _, z in anchors], np.float64))
    gx = np.arange(0, W + DEPTH_STEP, DEPTH_STEP, dtype=np.float64)
    gy = np.arange(0, H + DEPTH_STEP, DEPTH_STEP, dtype=np.float64)
    gx[-1], gy[-1] = W, H
    GX, GY = np.meshgrid(gx, gy)
    rbf = RBFInterpolator(pts / 100.0, vals, kernel="thin_plate_spline", smoothing=2.0)
    logz = rbf(np.stack([GX.ravel(), GY.ravel()], -1) / 100.0).reshape(GX.shape)
    logz = np.clip(logz, math.log(9.0), math.log(FAR_DEPTH))
    z = np.exp(logz)
    # land always sits in front of the water behind it
    zs = sea_depth(GY)
    z = np.where(GY > HORIZON, np.minimum(z, zs * 0.96), z)
    return z.astype(np.float32), len(gx), len(gy)


# ---------------------------------------------------------------------------
# Night lights: windows read off the photo by hand, lamps and the far town
# ---------------------------------------------------------------------------
WINDOWS = [
    # upper village
    (240, 140, 246, 147), (233, 170, 238, 177), (262, 173, 267, 180), (275, 172, 280, 180),
    (287, 173, 292, 180), (305, 158, 308, 163), (312, 158, 315, 163), (363, 168, 368, 178),
    (385, 167, 390, 177), (402, 167, 405, 177), (412, 167, 417, 177), (298, 213, 307, 228),
    (327, 212, 330, 223), (363, 213, 368, 227), (392, 212, 396, 227), (417, 210, 423, 227),
    (440, 210, 445, 223),
    # pink house and its neighbours
    (466, 258, 471, 277), (479, 258, 485, 277), (514, 256, 521, 276), (541, 253, 547, 272),
    (517, 297, 525, 317), (542, 293, 548, 313), (437, 293, 445, 310), (470, 295, 490, 308),
    (488, 326, 492, 332), (498, 324, 503, 332), (367, 300, 373, 317), (380, 300, 385, 317),
    (397, 297, 402, 313), (422, 293, 427, 313), (438, 292, 447, 307),
    # yellow house on the right and the stone tower
    (593, 273, 598, 292), (603, 273, 608, 293), (568, 292, 573, 302), (672, 335, 677, 352),
    # facades under the window
    (245, 345, 272, 398), (250, 404, 282, 438), (356, 434, 377, 496), (282, 484, 303, 518),
    (446, 388, 464, 419), (497, 382, 503, 412), (500, 445, 505, 463), (589, 414, 601, 441),
    (550, 415, 555, 428), (428, 688, 457, 752), (559, 680, 577, 716), (611, 684, 633, 712),
]
LAMPS = [(712, 530), (745, 543), (781, 552), (814, 547), (668, 486), (872, 802), (958, 832), (1040, 858),
         (598, 466), (640, 640)]


def build_lights(land_ext):
    rng = np.random.default_rng(3)
    cov = np.zeros((H, W), np.float32)
    ids = np.zeros((H, W), np.float32)
    centers = []
    for x0, y0, x1, y1 in WINDOWS:
        i = rng.random()
        cov[y0:y1 + 1, x0:x1 + 1] = 1.0
        ids[y0:y1 + 1, x0:x1 + 1] = i
        centers.append(((x0 + x1) / 2, (y0 + y1) / 2, i))
    yy, xx = np.mgrid[0:H, 0:W]
    for x, y in LAMPS:
        i = 0.02 + rng.random() * 0.1  # lamps come on first
        cov = np.maximum(cov, np.clip(1.6 - np.hypot(xx - x, yy - y), 0, 1))
        ids[np.hypot(xx - x, yy - y) < 2] = i
        centers.append((x, y, i))
    # the town across the bay: specks along the far shore
    far = land_ext & (yy > 150) & (yy < 190) & (xx > 440) & (xx < 830)
    fy, fx = np.nonzero(far)
    pick = rng.choice(len(fy), size=160, replace=False)
    for k in pick:
        y, x = fy[k], fx[k]
        i = rng.random()
        cov[y, x] = max(cov[y, x], 0.6 + 0.4 * rng.random())
        ids[y, x] = i
        centers.append((x, y, i))
    cov *= land_ext
    # every pixel near a light carries that light's id so its halo switches with it
    pts = np.array([(c[0], c[1]) for c in centers])
    from scipy.spatial import cKDTree
    tree = cKDTree(pts)
    halo = ndi.gaussian_filter(cov, 5.0)
    halo = np.clip(halo / max(halo.max(), 1e-6) * 2.2, 0, 1)
    near = halo > 0.01
    _, nn = tree.query(np.stack([xx[near], yy[near]], -1))
    ids[near & (cov < 0.5)] = np.array([c[2] for c in centers])[nn][(cov[near] < 0.5)]
    return np.stack([cov, ids, halo], -1)


# ---------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------
def to_img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def upscale(a, s=SCALE):
    if a.ndim == 2:
        return np.asarray(to_img(a).resize((W * s, H * s), Image.LANCZOS)).astype(np.float32) / 255
    return np.asarray(to_img(a).resize((W * s, H * s), Image.LANCZOS)).astype(np.float32) / 255


def main():
    global DEBUG
    ap = argparse.ArgumentParser()
    ap.add_argument("--debug", type=str, default=None)
    args = ap.parse_args()
    if args.debug:
        DEBUG = Path(args.debug)
        DEBUG.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(exist_ok=True)
    t0 = time.time()

    im = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32) / 255
    assert im.shape[:2] == (H, W), im.shape
    mk = build_masks(im)
    print(f"masks  {time.time() - t0:5.1f}s")

    vis = im.copy()
    vis[mk["sky"]] = vis[mk["sky"]] * 0.4 + np.array([0.2, 1, 0.2]) * 0.6
    vis[mk["sea"]] = vis[mk["sea"]] * 0.4 + np.array([1, 0.1, 0.1]) * 0.6
    vis[mk["boats"]] = [1, 1, 0]
    vis[mk["interior"]] *= 0.3
    dbg("masks.png", vis)

    # labels: 0 sky, 1 sea, 2 land, 3 interior
    labels = np.full((H, W), 2, np.uint8)
    labels[mk["sky"]] = 0
    labels[mk["sea_all"]] = 1
    labels[mk["interior"]] = 3

    # --- reflect the view into the window-frame bands
    ext, lab_ext, filled = mirror_fill(im, labels, mk["interior"])
    dbg("mirror.png", ext)
    land_ext = lab_ext == 2
    sea_ext = lab_ext == 1

    # --- sea plate: remove glitter & boats, then fill everything else smoothly
    sea_valid = sea_ext & ~(mk["boats"])
    sea_clean, spark = remove_glitter(ext, sea_valid)
    dbg("sea_glitter_mask.png", spark.astype(np.float32))
    hq, sq, vq = hsv_parts(sea_clean)
    calm = sea_valid & ~((vq > 0.6) & (sq < 0.4))
    calm = ndi.binary_erosion(calm, iterations=2)
    sea_fill = pushpull(sea_clean, calm.astype(np.float32))
    sea_plate = np.where(sea_valid[..., None], sea_clean, sea_fill)
    dbg("sea_plate_1x.png", sea_plate)

    # --- painterly pass at 2x
    t1 = time.time()
    land_up = upscale(ext)
    land_paint = akuwahara(land_up, radius=10.0, n_ang=32, n_rad=6)
    land_paint = akuwahara(land_paint, radius=5.0, n_ang=24, n_rad=4)
    land_paint = unsharp(land_paint, 1.6, 0.4)
    land_paint = anime_grade(land_paint, "land")
    sea_up = upscale(sea_plate)
    sea_paint = akuwahara(sea_up, radius=12.0, n_ang=32, n_rad=6)
    sea_paint = akuwahara(sea_paint, radius=6.0, n_ang=24, n_rad=4)
    sea_paint = anime_grade(sea_paint, "sea")
    print(f"paint  {time.time() - t1:5.1f}s")

    # --- land RGBA: decontaminate the edge, alpha from the (upscaled) land mask
    land_a = upscale(ndi.gaussian_filter(land_ext.astype(np.float32), 0.6))
    core = land_a > 0.98
    core = ndi.binary_erosion(core, iterations=2)
    land_rgb = np.where(core[..., None], land_paint, pushpull(land_paint, core.astype(np.float32)))
    # colour and coverage ship separately: browsers may premultiply an RGBA image on
    # decode and lose the colour under transparent pixels, which shows as dark fringes
    to_img(land_rgb).save(OUT / "land.webp", quality=90, method=6)
    Image.fromarray((np.clip(land_a, 0, 1) * 255 + 0.5).astype(np.uint8)).save(OUT / "land_alpha.png", optimize=True)
    to_img(sea_paint).save(OUT / "sea.webp", quality=90, method=6)
    dbg("land_paint.png", land_paint)
    dbg("sea_paint.png", sea_paint)
    comp = land_rgb * land_a[..., None] + sea_paint * (1 - land_a[..., None])
    dbg("composite.png", comp)

    # --- aux maps (1x)
    h, s, v = hsv_parts(ext)
    foliage = land_ext & (((h > 55) & (h < 170) & (s > 0.18) & (v > 0.08) & (v < 0.75)) |
                          ((h > 285) & (h < 345) & (s > 0.3)))
    foliage = ndi.gaussian_filter(foliage.astype(np.float32), 1.5)
    to_img(foliage).save(OUT / "land_aux.png", optimize=True)

    dist = ndi.distance_transform_edt(~land_ext)
    shore = np.clip(1 - dist / 28.0, 0, 1) * (lab_ext != 0)
    hh_, ss_, vv_ = hsv_parts(sea_plate)
    shallow = sea_ext & (hh_ > 150) & (hh_ < 200) & (ss_ > 0.35)
    shallow = ndi.gaussian_filter(shallow.astype(np.float32), 4)
    open_w = ndi.gaussian_filter(sea_valid.astype(np.float32), 1)
    sea_aux = np.stack([shore, shallow, open_w], -1)
    to_img(sea_aux).save(OUT / "sea_aux.png")
    dbg("sea_aux.png", sea_aux)
    dbg("land_aux.png", foliage)

    # --- night lights (1x): R coverage, G light id, B halo
    lights = build_lights(land_ext)
    Image.fromarray((np.clip(lights, 0, 1) * 255 + 0.5).astype(np.uint8)).save(OUT / "lights.png", optimize=True)
    dbg("lights.png", np.clip(lights[..., [0, 2, 2]], 0, 1))

    # --- depth grid: log depth quantised to 16 bits, base64 in JSON (any static host serves it)
    z, nx, ny = build_depth(land_ext)
    zmin, zmax = float(z.min()), float(z.max())
    q = np.round((np.log(z) - math.log(zmin)) / (math.log(zmax) - math.log(zmin)) * 65535).astype("<u2")
    (OUT / "depth.json").write_text(json.dumps({
        "nx": nx, "ny": ny, "step": DEPTH_STEP, "zmin": zmin, "zmax": zmax,
        "encoding": "log-uint16-le-base64", "data": base64.b64encode(q.tobytes()).decode("ascii"),
    }))
    old_bin = OUT / "depth.bin"
    if old_bin.exists():
        old_bin.unlink()
    if DEBUG is not None:
        zz = np.log(z)
        dbg("depth.png", (zz - zz.min()) / (zz.max() - zz.min()))

    scene = {
        "image": {"width": W, "height": H, "scale": SCALE},
        "camera": {"hfov": HFOV_DEG, "focal": FOCAL, "cx": CX, "cy": CY,
                   "pitch": PITCH, "height": CAM_HEIGHT, "horizon": HORIZON},
        "depth": {"nx": nx, "ny": ny, "step": DEPTH_STEP},
    }
    (OUT / "scene.json").write_text(json.dumps(scene, indent=2))
    print(f"done   {time.time() - t0:5.1f}s")


if __name__ == "__main__":
    main()
