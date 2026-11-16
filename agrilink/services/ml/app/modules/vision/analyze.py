"""Measurements from one mango photo, using classical computer vision (OpenCV / scikit-image).

Pipeline per photo:
  1. decode + EXIF-rotate + resize (longest side 640 px)
  2. quality gate: brightness, over-exposure, edge sharpness along the fruit outline
  3. fruit mask: mango hues (green -> yellow -> orange), largest blob, holes filled (so lesions stay inside)
     and a shape check (solidity, oval aspect ratio) to tell a fruit from leaves or background
  4. colour score: per-pixel hue mapped to ripeness (green 0.2 ... yellow 0.8 ... orange 1.0), blemishes excluded
  5. blemish %: pixels clearly darker than their surroundings on the fruit skin (shading-compensated)
  6. feature vector for the reference gallery (colour histograms, texture, measurements)

Size/weight cannot be measured from a photo without a scale reference, so it is reported as not measured.
"""
from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from skimage.feature import local_binary_pattern

MAX_SIDE = 640
# blur check (edge sharpness): generated test photos give 0.45-0.9 sharp and < 0.1 blurred; threshold 0.25.
# Re-check against real phone photos once doctor-graded photos are in the gallery.
# hue (OpenCV 0-179) -> ripeness colour score
HUE_PTS = [6, 16, 26, 36, 48, 70]
SCORE_PTS = [1.0, 0.95, 0.82, 0.6, 0.35, 0.2]


def load(data: bytes) -> np.ndarray:
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as e:
        raise ValueError("not_an_image") from e
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    return np.asarray(img)


def _fruit_mask(hsv: np.ndarray) -> tuple[np.ndarray | None, dict]:
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    cand = ((h >= 4) & (h <= 85) & (s >= 70) & (v >= 55)).astype(np.uint8) * 255
    k = max(3, int(min(hsv.shape[:2]) * 0.01) | 1)
    cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k * 3, k * 3)))
    contours, _ = cv2.findContours(cand, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, {"area_ratio": 0.0, "solidity": 0.0, "aspect": 0.0}
    c = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(c)
    hull = cv2.contourArea(cv2.convexHull(c)) or 1.0
    aspect = 0.0
    if len(c) >= 5:
        (_, _), (a, b), _ = cv2.fitEllipse(c)
        aspect = max(a, b) / max(1.0, min(a, b))
    mask = np.zeros(hsv.shape[:2], np.uint8)
    cv2.drawContours(mask, [c], -1, 255, thickness=cv2.FILLED)  # filled: dark lesions stay part of the fruit
    return mask, {"area_ratio": area / mask.size, "solidity": area / hull, "aspect": aspect, "contour": c}


def _edge_sharpness(gray: np.ndarray, mask: np.ndarray) -> float:
    """Gradient at the fruit outline relative to the fruit/background contrast. Sharp ~2-4, blurred < 1."""
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    band = cv2.dilate(mask, k) & ~cv2.erode(mask, k)
    if band.sum() == 0:
        return 0.0
    g = gray.astype(np.float32)
    mag = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    inner = g[cv2.erode(mask, k, iterations=2) > 0]
    outer = g[(cv2.dilate(mask, k, iterations=3) > 0) & (cv2.dilate(mask, k) == 0)]
    if inner.size == 0 or outer.size == 0:
        return 0.0
    contrast = abs(float(np.median(inner)) - float(np.median(outer))) + 8.0
    return float(np.percentile(mag[band > 0], 95)) / (4.0 * contrast)


def _blemishes(hsv: np.ndarray, skin: np.ndarray) -> tuple[float, int, np.ndarray]:
    v = hsv[..., 2].astype(np.float32)
    on = skin > 0
    if on.sum() == 0:
        return 0.0, 0, np.zeros_like(skin)
    med = float(np.median(v[on]))
    # local brightness of the skin (shading-compensated): blur only skin pixels
    ksz = max(15, int(np.sqrt(on.sum()) / 3) | 1)
    num = cv2.GaussianBlur(np.where(on, v, 0), (ksz, ksz), 0)
    den = cv2.GaussianBlur(on.astype(np.float32), (ksz, ksz), 0) + 1e-6
    local = num / den
    dark = on & (v < 0.72 * local) & (v < 0.85 * med)
    dark = cv2.morphologyEx(dark.astype(np.uint8) * 255, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(dark)
    min_blob = max(4, int(on.sum() * 0.0005))
    blobs = int(sum(1 for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_blob))
    return float((dark > 0).sum()) / float(on.sum()) * 100.0, blobs, dark


def features(rgb: np.ndarray, hsv: np.ndarray, skin: np.ndarray, m: dict) -> list[float]:
    on = skin > 0
    hue = hsv[..., 0][on]
    sat = hsv[..., 1][on]
    val = hsv[..., 2][on]
    def hist(x, bins, rng):
        hh, _ = np.histogram(x, bins=bins, range=rng)
        return (hh / max(1, hh.sum())).tolist()
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    lbp = local_binary_pattern(gray, 8, 1, method="uniform")[on]
    vec = hist(hue, 12, (0, 90)) + hist(sat, 4, (0, 256)) + hist(val, 4, (0, 256)) + hist(lbp, 10, (0, 10))
    vec += [m["defect_pct"] / 30.0, m["colour_score"], min(m["lesions"], 20) / 10.0, m["aspect"] / 2.0]
    return [round(float(x), 5) for x in vec]


def analyze_photo(data: bytes) -> dict:
    """Measurements and quality issues for one photo."""
    rgb = load(data)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    issues: list[str] = []
    brightness = float(hsv[..., 2].mean())
    overexposed = float((hsv[..., 2] >= 250).mean())
    if brightness < 45:
        issues.append("too_dark")
    if overexposed > 0.25:
        issues.append("overexposed")

    mask, shape = _fruit_mask(hsv)
    # a fruit is a separate object: it must not fill the frame or run along most of the photo's edge
    edge = 0.0
    if mask is not None:
        border = np.concatenate([mask[0], mask[-1], mask[:, 0], mask[:, -1]])
        edge = float((border > 0).mean())
    shaped = (mask is not None and shape["solidity"] >= 0.82 and 1.0 <= shape["aspect"] <= 2.4
              and shape["area_ratio"] <= 0.85 and edge <= 0.25)
    is_fruit = shaped and shape["area_ratio"] >= 0.03
    if not is_fruit:
        issues.append("fruit_too_small" if shaped and shape["area_ratio"] >= 0.004 else "no_fruit_found")
        return {"is_fruit": False, "issues": issues, "confidence": 0.15, "defect_pct": None, "colour_score": None,
                "lesions": 0, "sharpness": 0.0, "brightness": round(brightness, 1),
                "area_ratio": round(shape["area_ratio"], 3), "features": None}

    sharp = _edge_sharpness(gray, mask)
    if sharp < 0.25:
        issues.append("blurry")
    if shape["area_ratio"] < 0.06:
        issues.append("fruit_too_small")

    # skin = fruit minus a rim (outline pixels are shaded and mixed with background)
    rim = max(3, int(np.sqrt(shape["area_ratio"] * mask.size) * 0.06))
    skin = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (rim, rim)))
    defect_pct, lesions, dark = _blemishes(hsv, skin)
    clean = (skin > 0) & (dark == 0)
    hue = hsv[..., 0][clean].astype(np.float32)
    colour = float(np.interp(hue, HUE_PTS, SCORE_PTS).mean()) if hue.size else 0.0

    sharp_q = float(np.clip((sharp - 0.15) / 0.3, 0, 1))
    light_q = float(np.clip((brightness - 40) / 60, 0, 1) * (1 - np.clip((overexposed - 0.1) / 0.3, 0, 1)))
    size_q = float(np.clip(shape["area_ratio"] / 0.12, 0, 1))
    shape_q = float(np.clip((shape["solidity"] - 0.82) / 0.12, 0, 1))
    # sharpness is multiplicative: a blurred photo cannot be graded however well lit it is
    confidence = min(0.95, (0.3 + 0.7 * (0.45 * light_q + 0.3 * size_q + 0.25 * shape_q)) * (0.4 + 0.6 * sharp_q))

    m = {"is_fruit": True, "issues": issues, "confidence": round(confidence, 2),
         "defect_pct": round(defect_pct, 1), "colour_score": round(colour, 2), "lesions": lesions,
         "sharpness": round(sharp, 2), "brightness": round(brightness, 1), "area_ratio": round(shape["area_ratio"], 3),
         "solidity": round(shape["solidity"], 3), "aspect": round(shape["aspect"], 2)}
    m["features"] = features(rgb, hsv, skin, m)
    return m


def photo_quality(data: bytes) -> dict:
    """Stage photos without fruit (seedlings, planting, canopy): only what a photo can honestly show.
    Measures brightness, over-exposure and sharpness (variance of the Laplacian at 640 px), plus the share of
    green vegetation pixels as a descriptive figure. It does NOT judge plant health, variety or seed quality."""
    rgb = load(data)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    brightness = float(hsv[..., 2].mean())
    overexposed = float((hsv[..., 2] >= 250).mean())
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    vegetation = float(((h >= 30) & (h <= 90) & (s >= 50) & (v >= 40)).mean())
    issues = []
    if brightness < 45:
        issues.append("too_dark")
    if overexposed > 0.25:
        issues.append("overexposed")
    if sharpness < 40:             # calibrated on generated textures; re-check on real phone photos
        issues.append("blurry")
    if min(rgb.shape[:2]) < 240:
        issues.append("low_resolution")
    usable = not ({"too_dark", "overexposed", "blurry", "low_resolution"} & set(issues))
    return {"usable": usable, "issues": issues, "brightness": round(brightness, 1), "overexposed_pct": round(overexposed * 100, 1),
            "sharpness": round(sharpness, 1), "vegetation_pct": round(vegetation * 100, 1),
            "width": int(rgb.shape[1]), "height": int(rgb.shape[0])}
