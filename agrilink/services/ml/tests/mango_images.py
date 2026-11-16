"""Generated mango photos for tests: an oval fruit with a hue gradient, shading, skin texture and optional dark
spots on a textured table. Not real photos — they only check that the measurements move in the right direction."""
import io

import cv2
import numpy as np
from PIL import Image


def mango(hue=20, spots=0, spot_r=7, blur=0, size=0.32, bg=(120, 110, 100), seed=0, fmt="JPEG", angle=25) -> bytes:
    rng = np.random.default_rng(seed)
    H, W = 480, 640
    img = np.zeros((H, W, 3), np.float32)
    img[:] = bg
    img += rng.normal(0, 6, img.shape)                       # table texture
    if size > 0:
        mask = np.zeros((H, W), np.uint8)
        a, b = int(W * size), int(W * size * 0.68)
        cv2.ellipse(mask, (W // 2, H // 2), (a, b), angle, 0, 360, 255, -1)
        yy, xx = np.mgrid[0:H, 0:W]
        d = np.sqrt(((xx - W / 2) / a) ** 2 + ((yy - H / 2) / b) ** 2)
        shade = np.clip(1.0 - 0.28 * d ** 2, 0.55, 1.0)       # rounder fruit is darker at the edge
        hsv = np.zeros((H, W, 3), np.float32)
        hsv[..., 0] = hue + 6 * (xx / W - 0.5)                 # slight hue gradient across the fruit
        hsv[..., 1] = 200
        hsv[..., 2] = 235 * shade
        fruit = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2RGB).astype(np.float32)
        fruit += rng.normal(0, 4, fruit.shape)                 # skin texture
        for _ in range(spots):
            for _try in range(50):
                px, py = int(rng.integers(W // 2 - a, W // 2 + a)), int(rng.integers(H // 2 - b, H // 2 + b))
                if d[py, px] < 0.75:
                    break
            r = int(rng.integers(max(2, spot_r - 3), spot_r + 3))
            cv2.circle(fruit, (px, py), r, (55, 38, 20), -1)
        img = np.where(mask[..., None] > 0, fruit, img)
    img = np.clip(img, 0, 255).astype(np.uint8)
    if blur:
        img = cv2.GaussianBlur(img, (0, 0), blur)
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, fmt, quality=92)
    return buf.getvalue()
