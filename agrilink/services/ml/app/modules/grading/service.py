"""Rule-based grade check. Input comes from photo analysis (CV model, TODO) or a consultant entry.
Thresholds are placeholders to calibrate with buyers."""
SPEC = {
    "A": {"min_weight_g": 300, "min_colour": 0.75, "max_blemish_pct": 2},
    "B": {"min_weight_g": 250, "min_colour": 0.60, "max_blemish_pct": 8},
    "C": {"min_weight_g": 200, "min_colour": 0.40, "max_blemish_pct": 20},
}
ORDER = {"A": 0, "B": 1, "C": 2, "reject": 3}


def grade_fruit(weight_g: float, colour_idx: float, blemish_pct: float) -> str:
    for g in ("A", "B", "C"):
        s = SPEC[g]
        if weight_g >= s["min_weight_g"] and colour_idx >= s["min_colour"] and blemish_pct <= s["max_blemish_pct"]:
            return g
    return "reject"


def explain_miss(weight_g, colour_idx, blemish_pct, want: str) -> list[str]:
    """Tip codes; the client translates them."""
    s, tips = SPEC[want], []
    if weight_g < s["min_weight_g"]:
        tips.append("tip_size")
    if colour_idx < s["min_colour"]:
        tips.append("tip_colour")
    if blemish_pct > s["max_blemish_pct"]:
        tips.append("tip_blemish")
    return tips


def assess(weight_g, colour_idx, blemish_pct, target_grade):
    grade = grade_fruit(weight_g, colour_idx, blemish_pct)
    meets = target_grade is None or ORDER[grade] <= ORDER[target_grade]
    return {"grade": grade, "meets_target": meets, "target_grade": target_grade,
            "tips": [] if meets else explain_miss(weight_g, colour_idx, blemish_pct, target_grade),
            "needs_consultant_review": grade == "reject" or not meets}
