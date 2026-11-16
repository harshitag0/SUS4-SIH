"""Photo grading for a quality check: several photos -> one result Module 2 can review.

Result keys match Module 2's CV adapter contract: defect_pct, colour_score, est_weight_g, confidence, flags,
plus model, grade_hint, per-photo details, gallery comparison and plain-language notes. The AI grade is always
provisional: a farmer doctor confirms it, and confirmed photos are added to the reference gallery.
"""
from __future__ import annotations

import numpy as np

from . import gallery
from .analyze import analyze_photo

MODEL = "agrilink-vision-v1"
TYPICAL_WEIGHT_G = 230.0     # Alphonso export fruit is roughly 200-300 g; weight is confirmed at packhouse weighing
# Same thresholds as Module 2's quality spec (size excluded: not measurable from a photo)
A_MAX_DEFECT, B_MAX_DEFECT, A_MIN_COLOUR, B_MIN_COLOUR = 5.0, 15.0, 0.70, 0.50

ISSUE_TEXT = {
    "too_dark": "Photo is too dark — take it in daylight.",
    "overexposed": "Photo is over-exposed — avoid direct glare.",
    "blurry": "Photo is blurry — hold the phone still and tap to focus on the fruit.",
    "no_fruit_found": "No mango found in the photo — fill the frame with the fruit.",
    "fruit_too_small": "Fruit is small in the frame — move closer.",
    "not_an_image": "File could not be read as an image.",
}


def grade_hint(defect: float, colour: float, flags: list[str]) -> str:
    if "anthracnose" in flags or defect > B_MAX_DEFECT:
        return "REJECT"
    if defect <= A_MAX_DEFECT and colour >= A_MIN_COLOUR:
        return "A"
    if colour >= B_MIN_COLOUR:
        return "B"
    return "REJECT"


def analyze(photos: list[bytes]) -> dict:
    per = []
    for i, data in enumerate(photos):
        try:
            m = analyze_photo(data)
        except ValueError:
            m = {"is_fruit": False, "issues": ["not_an_image"], "confidence": 0.0, "defect_pct": None, "colour_score": None, "features": None}
        m["index"] = i
        m["sha"] = gallery.sha(data)
        per.append(m)

    usable = [m for m in per if m["is_fruit"] and m["confidence"] >= 0.5 and "blurry" not in m["issues"]]
    base = usable or [m for m in per if m["is_fruit"]]
    notes: list[str] = []
    for m in per:
        for iss in m["issues"]:
            notes.append(f"Photo {m['index'] + 1}: {ISSUE_TEXT.get(iss, iss)}")

    if not base:
        return {"model": MODEL, "simulated": False, "defect_pct": 0.0, "colour_score": 0.0, "est_weight_g": TYPICAL_WEIGHT_G,
                "size_measured": False, "confidence": 0.1, "flags": [], "grade_hint": None, "photos_used": 0,
                "photos": [_public(m) for m in per], "gallery": None, "notes": notes or ["No usable photo."],
                "basis": "photo analysis (no usable photo)"}

    defect = float(np.mean([m["defect_pct"] for m in base]))
    colour = float(np.mean([m["colour_score"] for m in base]))
    lesions = max(m["lesions"] for m in base)
    flags = ["anthracnose"] if defect >= 6 and lesions >= 6 else []
    confidence = float(np.mean([m["confidence"] for m in base])) * (0.6 + 0.4 * len(usable) / len(per))
    hint = grade_hint(defect, colour, flags)

    # compare with photos farmer doctors already graded
    feats = np.mean([m["features"] for m in base], axis=0).round(5).tolist()
    cmp = gallery.compare(feats)
    if cmp["neighbour_grade"] and cmp["gallery_size"] >= 10:
        if cmp["neighbour_grade"] != hint:
            confidence *= 0.85
            notes.append(f"Most similar doctor-graded photos were grade {cmp['neighbour_grade']}, measurements say {hint} — doctor to confirm.")
        if cmp["seen_similar"] is False:
            confidence *= 0.85
            notes.append("Nothing similar in the doctor-graded photos yet — doctor to confirm.")
    if cmp["learned"] and cmp["learned"]["grade"] != hint and cmp["learned"]["probability"] >= 0.6:
        confidence *= 0.85
        notes.append(f"Learned grader suggests {cmp['learned']['grade']} ({int(cmp['learned']['probability'] * 100)}%).")

    notes.insert(0, f"Blemishes {defect:.1f}% of visible skin, colour score {colour:.2f} "
                    f"({'ripe yellow-orange' if colour >= 0.75 else 'turning' if colour >= 0.5 else 'mostly green'}).")
    if flags:
        notes.insert(1, f"{lesions} dark lesions found — possible anthracnose, doctor to confirm.")
    notes.append("Size is not measured from photos; weight is confirmed at packhouse weighing.")

    return {"model": MODEL, "simulated": False, "defect_pct": round(defect, 1), "colour_score": round(colour, 2),
            "est_weight_g": TYPICAL_WEIGHT_G, "size_measured": False, "confidence": round(min(confidence, 0.98), 2),
            "flags": flags, "grade_hint": hint, "photos_used": len(base), "photos": [_public(m) for m in per],
            "gallery": cmp, "features": feats, "notes": notes, "basis": f"photo analysis of {len(base)} of {len(per)} photo(s)"}


def learn(photos: list[bytes], grade: str, source: str, ref: str | None) -> dict:
    """Add doctor-confirmed photos to the reference gallery (and retrain the learned grader)."""
    added = []
    for data in photos:
        try:
            m = analyze_photo(data)
        except ValueError:
            continue
        if not m["is_fruit"] or m["confidence"] < 0.5 or "blurry" in m["issues"]:
            continue          # only clear photos become reference examples
        added.append(gallery.add(gallery.sha(data), m["features"], grade, source, ref,
                                 {k: m[k] for k in ("defect_pct", "colour_score", "lesions", "confidence")}))
    return {"added": sum(1 for a in added if a["added"]), "skipped": len(photos) - sum(1 for a in added if a["added"]), **gallery.status()}


def _public(m: dict) -> dict:
    return {k: v for k, v in m.items() if k not in ("features",)}
