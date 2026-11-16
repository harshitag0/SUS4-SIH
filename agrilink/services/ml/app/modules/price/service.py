"""Price (cost) prediction engine: answers for the farmer.

- outlook(district, grade, demand_change_pct): weekly market price for next season with 80% range, the farmer's
  harvest-window price, fair export offer, local-market net, and how a demand change moves the price.
- evaluate_offers(district, offers): for each buyer offer -> what the farmer actually keeps, vs selling locally,
  vs the predicted fair price in the delivery week -> accept / negotiate (with counter-offer) / sell locally.
"""
from __future__ import annotations

from datetime import date

import joblib
import numpy as np
import pandas as pd

from .model import ARTIFACT, forecast, train
from ..supply_demand import service as sd

# Post-harvest costs the farmer/FPO pays to sell export-grade fruit (Rs/kg) — editable assumptions
EXPORT_COST = {"packing_grading": 25, "cold_chain_transport": 12, "docs_phyto": 3, "fpo_fee": 5}
EXPORT_COST_TOTAL = sum(EXPORT_COST.values())
MANDI_COMMISSION_PCT, MANDI_TRANSPORT = 6, 5
DISTRICT_WEEKS = {"Sindhudurg": range(0, 6), "Ratnagiri": range(1, 7), "Raigad": range(2, 8), "Palghar": range(3, 9)}
_cache: dict = {}


def artifact(retrain: bool = False) -> dict:
    if retrain or "art" not in _cache:
        _cache.clear()
        _cache["art"] = train() if (retrain or not ARTIFACT.exists()) else joblib.load(ARTIFACT)
    return _cache["art"]


def model_card() -> dict:
    a = artifact()
    return {k: a[k] for k in ("model", "trained_at", "data_source", "years", "rows", "metrics", "importance", "target_year")}


def market_net(price: float) -> float:
    return price * (1 - MANDI_COMMISSION_PCT / 100) - MANDI_TRANSPORT


def drivers(demand_change_pct: float = 0.0) -> dict:
    """Next-season inputs from the Supply-Demand engine (Singapore corridor)."""
    o = sd.outlook("Singapore")
    supply_ratio = o["supply"] / o["history_supply"][-1]
    demand = o["demand"] * (1 + demand_change_pct / 100)
    gap = (demand - o["supply"]) / demand * 100
    return {"supply_ratio": round(supply_ratio, 3), "gap_pct": round(gap, 1), "base_gap_pct": o["gap_pct"],
            "demand_tons": round(demand), "supply_tons": round(o["supply"])}


def table(demand_change_pct: float = 0.0) -> tuple[pd.DataFrame, dict]:
    key = round(demand_change_pct)
    if key not in _cache:
        a, d = artifact(), drivers(key)
        # average over a small band around the gap so the tree model responds smoothly to the demand slider
        runs = [forecast(a, d["supply_ratio"], d["gap_pct"] + delta) for delta in (-2, 0, 2)]
        t = runs[1].copy()
        for c in ("lo", "mid", "hi"):
            t[c] = np.round(np.mean([r[c].to_numpy() for r in runs], axis=0))
        _cache[key] = (t, d)
    return _cache[key]


def week_of(day: date) -> int:
    """Season week index: 0 = Mar W4 (from 22 March) ... 11 = Jun W3."""
    return int(min(11, max(0, (day - date(day.year, 3, 22)).days // 7)))


def outlook(district: str, grade: str = "A", demand_change_pct: float = 0.0) -> dict:
    if district not in DISTRICT_WEEKS:
        raise KeyError(district)
    a = artifact()
    t, d = table(demand_change_pct)
    s = t[(t["district"] == district) & (t["grade"] == grade)].sort_values("week")
    mid, lo, hi = s["mid"].tolist(), s["lo"].tolist(), s["hi"].tolist()
    weeks = list(DISTRICT_WEEKS[district])
    win = [mid[w] for w in weeks]
    season_mkt = float(np.mean(mid))
    hist = pd.DataFrame(a["history"])
    hist = hist[(hist["district"] == district) & (hist["grade"] == grade)]
    base = table(0)[0]
    base_avg = float(base[(base["district"] == district) & (base["grade"] == grade)]["mid"].mean())
    best = int(np.argmax(win)) + weeks[0]
    return {
        "district": district, "grade": grade, "year": a["target_year"], "weeks": a["weeks"],
        "forecast": mid, "band_low": lo, "band_high": hi,
        "history": {str(y): g.sort_values("week")["price_inr_kg"].round(0).tolist() for y, g in hist.groupby("year")},
        "season_market_avg": round(season_mkt),
        "fair_offer": [round(m + EXPORT_COST_TOTAL) for m in mid],
        "market_net": [round(market_net(m)) for m in mid],
        "export_cost": {"total": EXPORT_COST_TOTAL, **EXPORT_COST},
        "mandi_cost": {"commission_pct": MANDI_COMMISSION_PCT, "transport_inr_kg": MANDI_TRANSPORT},
        "harvest_window": {"start": a["weeks"][weeks[0]], "end": a["weeks"][weeks[-1]], "avg_price": round(float(np.mean(win))),
                           "drop_pct": round((1 - win[-1] / win[0]) * 100), "best_week": a["weeks"][best],
                           "best_price": round(mid[best]), "fair_offer": round(float(np.mean(win)) + EXPORT_COST_TOTAL)},
        "scenario": {"demand_change_pct": round(demand_change_pct), **d,
                     "price_change_pct": round((season_mkt / base_avg - 1) * 100, 1)},
        # kept for older callers: season-level fair export offer and local-market net
        "season_avg": round(season_mkt + EXPORT_COST_TOTAL), "mandi_price": round(market_net(season_mkt)),
        "model": model_card(),
    }


def evaluate_offers(district: str, offers: list[dict], usd_inr: float = 88.0) -> list[dict]:
    t, _ = table(0)
    out = []
    for o in offers:
        g = o.get("grade", "A")
        w = week_of(date.fromisoformat(str(o["deliver_by"])[:10]))
        row = t[(t["district"] == district) & (t["grade"] == g) & (t["week"] == w)].iloc[0]
        mkt, mkt_lo, mkt_hi = float(row["mid"]), float(row["lo"]), float(row["hi"])
        offer_inr = float(o["price_usd_kg"]) * usd_inr
        fair = mkt + EXPORT_COST_TOTAL
        farmer_net = offer_inr - EXPORT_COST_TOTAL
        m_net = market_net(mkt)
        pct = (offer_inr - fair) / fair
        decision = "accept" if pct >= -0.03 else "negotiate" if farmer_net > m_net else "local_better"
        esc = float(o.get("escalation_pct") or 0)
        out.append({
            "id": o.get("id"), "grade": g, "week": w, "week_label": artifact()["weeks"][w],
            "offer_inr": round(offer_inr), "farmer_net_inr": round(farmer_net),
            "market_price_inr": round(mkt), "market_range_inr": [round(mkt_lo), round(mkt_hi)], "market_net_inr": round(m_net),
            "fair_offer_inr": round(fair), "fair_offer_usd": round(fair / usd_inr, 2),
            "verdict": {"status": "above" if pct >= 0.03 else "fair" if pct >= -0.07 else "below", "pct": round(pct * 100, 1)},
            "vs_mandi_pct": round((farmer_net - m_net) / m_net * 100, 1),
            "decision": decision,
            "counter_offer_usd": None if decision == "accept" else round(np.ceil(fair / usd_inr * 20) / 20, 2),
            "best_case_usd": round(float(o["price_usd_kg"]) * (1 + esc / 100), 2) if esc else None,
        })
    return out
