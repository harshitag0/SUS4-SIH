"""Quality rules: AI sees, rules decide, human confirms.

Pure functions, no database. All thresholds are ILLUSTRATIVE: no public
Singapore buyer specification for Alphonso was found.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Grade(str, Enum):
    A = "A"
    B = "B"
    REJECT = "REJECT"


GRADE_RANK = {Grade.A: 2, Grade.B: 1, Grade.REJECT: 0}


class ReviewStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    PENDING_DOCTOR = "PENDING_DOCTOR"
    RETAKE_PHOTO = "RETAKE_PHOTO"


FLAG_LABELS = {
    "fruit_fly_signs": "Fruit fly signs",
    "anthracnose": "Anthracnose (dark lesions)",
    "sap_burn": "Sap burn",
}


@dataclass(frozen=True)
class QualitySpec:
    grade_a_max_defect_pct: float = 5.0
    grade_b_max_defect_pct: float = 15.0
    grade_a_min_colour: float = 0.70
    grade_b_min_colour: float = 0.50
    grade_a_min_weight_g: float = 200.0
    grade_b_min_weight_g: float = 170.0
    min_cv_confidence: float = 0.60
    # Visible in a photo and serious enough to reject on AI alone (still provisional).
    # Spongy tissue is internal and cannot be seen in a photo.
    blocking_flags: frozenset = frozenset({"fruit_fly_signs", "anthracnose"})

    def as_dict(self) -> dict:
        return {
            "grade_a": {"max_defect_pct": self.grade_a_max_defect_pct,
                        "min_colour": self.grade_a_min_colour,
                        "min_weight_g": self.grade_a_min_weight_g},
            "grade_b": {"max_defect_pct": self.grade_b_max_defect_pct,
                        "min_colour": self.grade_b_min_colour,
                        "min_weight_g": self.grade_b_min_weight_g},
            "min_cv_confidence": self.min_cv_confidence,
            "blocking_flags": sorted(self.blocking_flags),
            "illustrative": True,
        }


SPEC = QualitySpec()


def meets(grade: Grade, required: Grade) -> bool:
    return GRADE_RANK[grade] >= GRADE_RANK[required]


def cv_grade(cv: dict, spec: QualitySpec = SPEC) -> Grade:
    flags = set(cv.get("flags", []))
    if flags & spec.blocking_flags:
        return Grade.REJECT
    d, c, w = cv["defect_pct"], cv["colour_score"], cv["est_weight_g"]
    if d > spec.grade_b_max_defect_pct:
        return Grade.REJECT
    if d <= spec.grade_a_max_defect_pct and c >= spec.grade_a_min_colour and w >= spec.grade_a_min_weight_g:
        return Grade.A
    if c >= spec.grade_b_min_colour and w >= spec.grade_b_min_weight_g:
        return Grade.B
    return Grade.REJECT


@dataclass
class ReviewOutcome:
    status: ReviewStatus
    final_grade: Optional[Grade]
    provisional_grade: Optional[Grade]
    source: str
    disagree: bool = False
    open_flags: list = field(default_factory=list)
    reasons: list = field(default_factory=list)


def review(cv: Optional[dict], finding: Optional[dict], required: Grade,
           spec: QualitySpec = SPEC) -> ReviewOutcome:
    """cv: {defect_pct, colour_score, est_weight_g, confidence, flags}
    finding: {grade, cleared_flags}"""
    reasons: list = []
    prov: Optional[Grade] = None
    usable = cv is not None and cv["confidence"] >= spec.min_cv_confidence
    if cv is not None and not usable:
        reasons.append(f"AI confidence {cv['confidence']:.2f} is below {spec.min_cv_confidence:.2f}")
    if usable:
        prov = cv_grade(cv, spec)
        reasons.append(f"AI grade {prov.value}")

    if finding is not None:
        final = Grade(finding["grade"])
        disagree = prov is not None and prov != final
        reasons.append(f"Farmer doctor grade {final.value}" +
                       (f" overrides AI grade {prov.value}" if disagree else ""))
        open_flags = []
        if cv is not None:
            open_flags = sorted(set(cv.get("flags", [])) - set(finding.get("cleared_flags", [])))
        if open_flags and meets(final, required):
            reasons.append("AI flags not cleared by the doctor: " + ", ".join(open_flags))
        status = ReviewStatus.PASS if meets(final, required) else ReviewStatus.FAIL
        reasons.append(f"Contract requires grade {required.value} or better")
        return ReviewOutcome(status, final, prov, "doctor", disagree, open_flags, reasons)

    if cv is not None and not usable:
        return ReviewOutcome(ReviewStatus.RETAKE_PHOTO, None, None, "none", reasons=reasons)

    if prov is not None:
        if not meets(prov, required):
            reasons.append("AI suggests below the contracted grade; farmer doctor must confirm")
        else:
            reasons.append("Awaiting farmer doctor confirmation")
        return ReviewOutcome(ReviewStatus.PENDING_DOCTOR, None, prov, "ai_provisional",
                             open_flags=sorted(cv.get("flags", [])), reasons=reasons)

    reasons.append("No usable AI result and no farmer doctor finding")
    return ReviewOutcome(ReviewStatus.PENDING_DOCTOR, None, None, "none", reasons=reasons)


# Rule-based starting guidance for an intervention. Generic text: an agronomist
# must validate it before real use. The farmer doctor's own advice is added on top.
GUIDANCE = {
    "fruit_fly_signs": "Collect and destroy fallen fruit daily; set methyl eugenol traps as advised by the KVK.",
    "anthracnose": "Remove infected twigs and fruit; follow the KVK spray advisory and respect the pre-harvest interval.",
    "sap_burn": "De-sap fruit stem-down after harvest and avoid sap contact with the skin.",
    "high_defects": "Sort out bruised or blemished fruit at harvest; use cushioned crates and avoid dropping fruit.",
    "low_colour": "Delay harvest of under-mature fruit; harvest only at the agreed maturity stage.",
    "low_weight": "Thin the fruit load where practical and check irrigation during fruit development.",
}


def guidance_for(cv: Optional[dict], finding: Optional[dict], spec: QualitySpec = SPEC) -> list:
    keys: list = []
    flags = set((cv or {}).get("flags", [])) | set((finding or {}).get("pest_signs", []))
    for f in sorted(flags):
        if f in GUIDANCE:
            keys.append(f)
    if cv:
        if cv["defect_pct"] > spec.grade_a_max_defect_pct:
            keys.append("high_defects")
        if cv["colour_score"] < spec.grade_a_min_colour:
            keys.append("low_colour")
        if cv["est_weight_g"] < spec.grade_a_min_weight_g:
            keys.append("low_weight")
    if not keys:
        keys.append("high_defects")
    seen, res = set(), []
    for k in keys:
        if k not in seen:
            seen.add(k)
            res.append({"key": k, "text": GUIDANCE[k], "source": "rule"})
    return res
