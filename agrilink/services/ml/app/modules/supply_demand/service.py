"""Supply-Demand engine: answers for the farmer.

- outlook(destination): is Alphonso needed there next season, how much, which grade, which month (with 80% range),
  versus registered-FPO supply (Singapore corridor) -> gap and need level.
- markets(): all destinations ranked for a farmer (growth, price, grade mix, treatment needs).
- recommend(district, grade_a_tons, grade_b_tons): what this farmer should target.
Forecasts are precomputed at training time; this module only reads the artifact.
"""
from __future__ import annotations

import joblib
import pandas as pd

from .model import ARTIFACT, GRADES, MONTHS, train

_cache: dict = {}
DISTRICT_MONTHS = {"Sindhudurg": [3, 4, 5], "Ratnagiri": [4, 5], "Raigad": [4, 5], "Palghar": [4, 5, 6]}
SUPPLY_DESTINATIONS = {"Singapore"}  # supply data currently covers the Singapore corridor


def artifact(retrain: bool = False) -> dict:
    if retrain or "art" not in _cache:
        if retrain or not ARTIFACT.exists():
            art = train()
        else:
            art = joblib.load(ARTIFACT)
        art.pop("models", None)
        _cache["art"] = art
    return _cache["art"]


def need_level(gap_pct: float | None) -> str:
    if gap_pct is None:
        return "unknown"
    return "high" if gap_pct >= 15 else "medium" if gap_pct >= 0 else "low"


def _r(x):
    return round(float(x), 1)


def outlook(destination: str) -> dict:
    a = artifact()
    d = pd.DataFrame(a["demand_fc"])
    d = d[d["destination"] == destination]
    if d.empty:
        raise KeyError(destination)
    s = pd.DataFrame(a["supply_fc"])
    s = s[s["destination"] == destination]
    has_supply = destination in SUPPLY_DESTINATIONS and not s.empty

    by_grade = []
    for g in GRADES:
        dg = d[d["grade"] == g]
        row = {"grade": g, "demand": _r(dg["mid"].sum()), "demand_lo": _r(dg["lo"].sum()), "demand_hi": _r(dg["hi"].sum()),
               "last_year": _r(dg["lag1"].sum())}
        if has_supply:
            sup = _r(s[s["grade"] == g]["mid"].sum())
            gap = row["demand"] - sup
            row.update(supply=sup, gap=_r(gap), gap_pct=_r(gap / row["demand"] * 100), need=need_level(gap / row["demand"] * 100))
        by_grade.append(row)

    by_month = []
    for m in MONTHS:
        dm = d[d["month"] == m]
        row = {"month": m, "demand": _r(dm["mid"].sum()), "demand_lo": _r(dm["lo"].sum()), "demand_hi": _r(dm["hi"].sum())}
        if has_supply:
            row["supply"] = _r(s[s["month"] == m]["mid"].sum())
            row["gap"] = _r(row["demand"] - row["supply"])
        by_month.append(row)

    total, last = float(d["mid"].sum()), float(d["lag1"].sum())
    hist = [h for h in a["history_demand"] if h["destination"] == destination]
    out = {
        "destination": destination, "year": a["target_year"],
        "demand": _r(total), "demand_lo": _r(d["lo"].sum()), "demand_hi": _r(d["hi"].sum()),
        "last_year": _r(last), "growth_pct": _r((total / last - 1) * 100),
        "by_grade": by_grade, "by_month": by_month,
        "peak_month": int(max(by_month, key=lambda r: r["demand"])["month"]),
        "history": {"years": [h["year"] for h in hist], "demand": [h["tons"] for h in hist]},
        "prices_usd_kg": {p["grade"]: p["avg_price_usd_kg"] for p in a["prices"] if p["destination"] == destination},
        "has_supply": has_supply,
        "model": model_card(),
    }
    if has_supply:
        sup_total = float(s["mid"].sum())
        gap = total - sup_total
        sh = [h for h in a["history_supply"] if h["destination"] == destination]
        out.update(supply=_r(sup_total), supply_lo=_r(s["lo"].sum()), supply_hi=_r(s["hi"].sum()),
                   gap=_r(gap), gap_pct=_r(gap / total * 100), need=need_level(gap / total * 100),
                   history_supply=[h["tons"] for h in sh],
                   most_needed_grade=max(by_grade, key=lambda r: r["gap"])["grade"])
    return out


def model_card() -> dict:
    a = artifact()
    return {k: a[k] for k in ("model", "trained_at", "data_source", "years", "rows", "metrics", "importance", "target_year")}


def markets() -> list[dict]:
    a = artifact()
    d = pd.DataFrame(a["demand_fc"])
    mk = {m["destination"]: m for m in a["markets"]}
    prices = pd.DataFrame(a["prices"])
    rows = []
    for dest, g in d.groupby("destination"):
        total, last = g["mid"].sum(), g["lag1"].sum()
        pa = prices[(prices["destination"] == dest) & (prices["grade"] == "A")]["avg_price_usd_kg"]
        rows.append({
            "destination": dest, "demand": _r(total), "growth_pct": _r((total / last - 1) * 100),
            "grade_a_share_pct": _r(g[g["grade"] == "A"]["mid"].sum() / total * 100),
            "price_a_usd_kg": float(pa.iloc[0]) if len(pa) else None,
            "premium": int(mk[dest]["premium"]), "needs_treatment": int(mk[dest]["needs_treatment"]),
            "air_hours": float(mk[dest]["air_hours"]),
        })
    return sorted(rows, key=lambda r: -r["demand"])


def _score(r, max_growth, max_price):
    return 0.5 * max(r["growth_pct"], 0) / max_growth + 0.3 * (r["price_a_usd_kg"] or 0) / max_price + 0.2 * r["grade_a_share_pct"] / 100


def recommend(district: str, grade_a_tons: float, grade_b_tons: float = 0.0) -> dict:
    """Personal plan: which market, grade and months to target, and how many tons."""
    months = DISTRICT_MONTHS.get(district, [4, 5])
    ms = markets()
    mg, mp = max(r["growth_pct"] for r in ms) or 1, max(r["price_a_usd_kg"] or 0 for r in ms) or 1
    ranked = sorted(ms, key=lambda r: -_score(r, mg, mp))
    top = []
    for r in ranked[:4]:
        reasons = []
        if r["growth_pct"] >= 10:
            reasons.append("fast_growth")
        if r["premium"]:
            reasons.append("premium_price")
        if r["air_hours"] <= 6:
            reasons.append("short_flight")
        if r["needs_treatment"]:
            reasons.append("needs_treatment")
        top.append({**r, "score": round(_score(r, mg, mp) * 100), "reasons": reasons})

    # Singapore corridor: match the farmer's grades to the forecast gap inside their harvest months
    sg = outlook("Singapore")
    a = artifact()
    d, s = pd.DataFrame(a["demand_fc"]), pd.DataFrame(a["supply_fc"])
    d, s = d[(d["destination"] == "Singapore") & d["month"].isin(months)], s[(s["destination"] == "Singapore") & s["month"].isin(months)]
    plan = []
    for g, have in (("A", grade_a_tons), ("B", grade_b_tons)):
        gap_by_month = {int(m): float(d[(d["grade"] == g) & (d["month"] == m)]["mid"].sum() - s[(s["grade"] == g) & (s["month"] == m)]["mid"].sum()) for m in months}
        window_gap = sum(v for v in gap_by_month.values() if v > 0)
        best_month = max(gap_by_month, key=gap_by_month.get)
        plan.append({"destination": "Singapore", "grade": g, "months": months, "best_month": best_month,
                     "window_gap": _r(window_gap), "your_tons": _r(have),
                     "suggested_tons": _r(min(have, window_gap)) if window_gap > 0 else 0.0,
                     "need": need_level(window_gap / max(1e-9, float(d[d["grade"] == g]["mid"].sum())) * 100) if window_gap > 0 else "low"})
    return {"district": district, "harvest_months": months, "singapore": {"need": sg["need"], "gap": sg["gap"], "gap_pct": sg["gap_pct"]},
            "plan": plan, "top_markets": top, "model": model_card()}
