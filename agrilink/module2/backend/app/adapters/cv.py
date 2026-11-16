"""Computer-vision adapter.

Two implementations of the same interface (`analyze_many(files, profile) -> dict`, `learn(files, grade, ref)`):

  - AgriLinkVisionCV (used when M2_CV_URL is set, e.g. http://127.0.0.1:8000): sends the photos to the
    AgriLink ML service (/vision/analyze), which measures blemishes, colour and photo quality and compares
    the photos with fruit already graded by farmer doctors. Doctor-confirmed grades are sent back
    (/vision/gallery) so the reference gallery and the learned grader improve with every visit.
  - SimulatedCV (default, and whenever a named scenario profile is chosen): fixed values per profile for
    repeatable scenarios and tests, otherwise values derived from the image bytes.

The AI grade is always provisional; a farmer doctor confirms it (see domain/quality.review).
"""
from __future__ import annotations

import hashlib
import os
from typing import Optional

import httpx

PROFILES = {
    "good": {"defect_pct": 3.0, "colour_score": 0.82, "est_weight_g": 236.0, "confidence": 0.92, "flags": []},
    "borderline": {"defect_pct": 11.5, "colour_score": 0.58, "est_weight_g": 184.0, "confidence": 0.86, "flags": []},
    "poor": {"defect_pct": 23.0, "colour_score": 0.52, "est_weight_g": 168.0, "confidence": 0.88, "flags": []},
    "pest": {"defect_pct": 6.0, "colour_score": 0.76, "est_weight_g": 220.0, "confidence": 0.84, "flags": ["fruit_fly_signs"]},
    "blurry": {"defect_pct": 4.0, "colour_score": 0.80, "est_weight_g": 230.0, "confidence": 0.31, "flags": []},
}


class CVUnavailable(RuntimeError):
    pass


class SimulatedCV:
    name = "simulated-cv-v0"

    def analyze(self, data: bytes, profile: Optional[str] = None) -> dict:
        if profile:
            if profile not in PROFILES:
                raise ValueError(f"unknown simulation profile '{profile}'")
            res = dict(PROFILES[profile])
            res["flags"] = list(res["flags"])
            res["basis"] = f"scenario profile '{profile}'"
        else:
            h = hashlib.sha256(data).digest()
            res = {
                "defect_pct": round(1 + h[0] / 255 * 19, 1),
                "colour_score": round(0.45 + h[1] / 255 * 0.5, 2),
                "est_weight_g": round(165 + h[2] / 255 * 125),
                "confidence": round(0.55 + h[3] / 255 * 0.43, 2),
                "flags": ["fruit_fly_signs"] if h[4] < 18 else [],
                "basis": "derived from image bytes",
            }
        res.update({"model": self.name, "simulated": True})
        return res

    def analyze_many(self, files: list, profile: Optional[str] = None) -> dict:
        return self.analyze(b"".join(files), profile)

    def learn(self, files: list, grade: str, ref: Optional[str] = None) -> Optional[dict]:
        return None


class AgriLinkVisionCV(SimulatedCV):
    def __init__(self, base_url: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.name = "agrilink-vision"

    def analyze_many(self, files: list, profile: Optional[str] = None) -> dict:
        if profile:                       # named scenarios stay repeatable
            return super().analyze_many(files, profile)
        try:
            r = httpx.post(f"{self.base_url}/vision/analyze", timeout=self.timeout,
                           files=[("files", (f"photo{i}.jpg", data, "application/octet-stream")) for i, data in enumerate(files)])
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise CVUnavailable("photo grading service is not reachable") from e
        res = r.json()
        res.pop("features", None)
        return res

    def learn(self, files: list, grade: str, ref: Optional[str] = None) -> Optional[dict]:
        if not files:
            return None
        r = httpx.post(f"{self.base_url}/vision/gallery", timeout=self.timeout,
                       data={"grade": grade, "source": "farmer_doctor", "ref": ref or ""},
                       files=[("files", (f"photo{i}.jpg", data, "application/octet-stream")) for i, data in enumerate(files)])
        r.raise_for_status()
        return r.json()


def make_cv():
    url = os.getenv("M2_CV_URL")
    return AgriLinkVisionCV(url) if url else SimulatedCV()


cv_service = make_cv()
