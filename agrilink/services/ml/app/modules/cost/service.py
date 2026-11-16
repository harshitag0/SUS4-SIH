"""Cost & Profit engine: comparative study for one farmer.

analysis() answers:
1. Year by year (district, per acre): cost, yield, cost per kg, price per kg, profit, margin — history + next season.
2. This season for MY farm: cost by component (with range), break-even price, profit.
3. Selling channels: AgriLink plan (export Grade A/B, processing for C) vs selling everything at the local market.
4. What-if: wages / diesel / fertilizer change -> cost and profit change.
5. My actual costs vs district average (if the farmer entered them) -> where I overspend.
"""
from __future__ import annotations

import math

import joblib
import numpy as np
import pandas as pd

from .model import ARTIFACT, COMPONENTS, predict_change, train
from ..price import service as price
from ..supply_demand import service as sd

TREES_PER_ACRE = 40          # standard spacing behind the per-acre cost data
GRADE_MIX_C = 0.15           # share of fruit that is Grade C (local / processing)
PROCESSING_FACTOR = 0.60     # pulp / processing units pay ~60% of the Grade C market price
OVERSPEND_PCT = 15           # flag a component when the farmer spends this much more than the district
TARGET_MARGIN_PCT = 20       # target price = break-even + this margin
# Export prices are treated as delivered (CIF) prices paid by the importer; the farmer/FPO side pays:
FREIGHT_BASE, FREIGHT_PER_AIR_HOUR = 20, 13           # assumed air freight Rs/kg = 20 + 13 x flight hours
TREATMENT = {"USA": 30, "Japan": 40}                  # irradiation (USA) / vapour-heat treatment (Japan), Rs/kg
_cache: dict = {}


def artifact(retrain: bool = False) -> dict:
    if retrain or "art" not in _cache:
        _cache["art"] = train() if (retrain or not ARTIFACT.exists()) else joblib.load(ARTIFACT)
    return _cache["art"]


def model_card() -> dict:
    a = artifact()
    return {"model": a["model"], "trained_at": a["trained_at"], "data_source": a["data_source"], "years": a["years"],
            "rows": a["rows"], "metrics": a["metrics"], "target_year": a["target_year"],
            "elasticities": {c: m["coef"] for c, m in a["models"].items() if m["coef"]},
            "inflation_pct": {c: round(math.expm1(m["intercept"]) * 100, 1) for c, m in a["models"].items()}}


def age_factor(age: float) -> float:
    return 0.55 if age < 5 else 0.8 if age < 10 else 1.0


def irrigation_adj(kind: str) -> dict:
    return {"drip": {"irrigation": 1.25, "labour": 0.92}, "rain": {"irrigation": 0.25}}.get(kind, {})


def next_season_per_acre(district: str, wage_pct=None, diesel_pct=None, fert_pct=None) -> dict:
    """District cost per acre for next season, per component (mid / lo / hi), and expected yield."""
    a = artifact()
    hist = pd.DataFrame(a["history"])
    last = hist[(hist["district"] == district) & (hist["year"] == a["years"][1])].iloc[0]
    x = dict(a["drivers_next"])
    if wage_pct is not None:
        x["d_wage"] = math.log1p(wage_pct / 100)
    if diesel_pct is not None:
        x["d_diesel"] = math.log1p(diesel_pct / 100)
    if fert_pct is not None:
        x["d_fert"] = math.log1p(fert_pct / 100)
    comps = {}
    for c in COMPONENTS:
        ch, sd = predict_change(a["models"], c, x), a["models"][c]["resid_std"]
        comps[c] = {"last": float(last[c]), "mid": float(last[c] * math.exp(ch)),
                    "lo": float(last[c] * math.exp(ch - 1.28 * sd)), "hi": float(last[c] * math.exp(ch + 1.28 * sd))}
    yld = float(last["yield_kg_acre"] * math.exp(predict_change(a["models"], "yield_kg_acre", x)))
    return {"components": comps, "yield_kg_acre": yld, "drivers": {k: round(math.expm1(v) * 100, 1) if k.startswith("d_") else v for k, v in x.items()}}


def _season_price(district: str) -> dict:
    """Next-season market prices from the Price engine (harvest-window average, Rs/kg) and the season-level change
    vs last year (used to roll the year-by-year table forward on the same basis as history)."""
    out = {}
    for g in ("A", "B", "C"):
        o = price.outlook(district, g)
        last = o["history"].get(str(o["year"] - 1))
        out[g] = {"market": o["harvest_window"]["avg_price"], "net": round(price.market_net(o["harvest_window"]["avg_price"])),
                  "season_ratio": float(np.mean(o["forecast"]) / np.mean(last)) if last else 1.0}
    return out


def thresholds(district: str, breakeven: float, prices: dict, target_margin_pct: float = TARGET_MARGIN_PCT,
               usd_inr: float = 88.0) -> dict:
    """Baseline (break-even) and target price per kg, and what the farmer keeps in each local market and each country."""
    a = sd.artifact()
    mk = {m["destination"]: m for m in a["markets"]}
    usd = {(p["destination"], p["grade"]): p["avg_price_usd_kg"] for p in a["prices"]}
    target = breakeven * (1 + target_margin_pct / 100)
    handling = price.EXPORT_COST_TOTAL

    def row(market, kind, price_inr, costs, price_usd=None, extra=None):
        net = price_inr - sum(costs.values())
        status = "loss" if net < breakeven else "thin" if net < target else "good"
        return {"market": market, "type": kind, "price_inr": round(price_inr), "price_usd": price_usd,
                "costs": {k: round(v) for k, v in costs.items()}, "net_kg": round(net),
                "margin_kg": round(net - breakeven), "margin_pct": round((net - breakeven) / net * 100, 1) if net > 0 else None,
                "status": status, **(extra or {})}

    out = {}
    for g in ("A", "B", "C"):
        m = prices[g]["market"]
        rows = [row("local_mandi", "local", m, {"commission": m * price.MANDI_COMMISSION_PCT / 100, "transport": price.MANDI_TRANSPORT})]
        if g != "A":
            rows.append(row("processing", "local", m * PROCESSING_FACTOR, {"transport": price.MANDI_TRANSPORT}))
        for dest, info in mk.items():
            if (dest, g) not in usd:
                continue
            p_usd = usd[(dest, g)] * prices[g]["season_ratio"]  # roll last season's export price forward like the local market
            fixed = {"handling": handling, "freight": FREIGHT_BASE + FREIGHT_PER_AIR_HOUR * float(info["air_hours"])}
            if dest in TREATMENT:
                fixed["treatment"] = TREATMENT[dest]
            rows.append(row(dest, "export", p_usd * usd_inr, fixed, round(p_usd, 2), {
                "min_usd_baseline": round((breakeven + sum(fixed.values())) / usd_inr, 2),
                "min_usd_target": round((target + sum(fixed.values())) / usd_inr, 2)}))
        local_net = rows[0]["net_kg"]
        for r in rows:
            r["vs_local_kg"] = r["net_kg"] - local_net
        out[g] = sorted(rows, key=lambda r: -r["net_kg"])
    return {
        "baseline_kg": round(breakeven, 1), "target_kg": round(target, 1), "target_margin_pct": target_margin_pct,
        "min_offer_usd": round((breakeven + handling) / usd_inr, 2), "target_offer_usd": round((target + handling) / usd_inr, 2),
        "comparison": out,
        "assumptions": {"handling_inr_kg": handling, "freight_formula": f"{FREIGHT_BASE} + {FREIGHT_PER_AIR_HOUR} x flight hours",
                        "treatment_inr_kg": TREATMENT, "export_price_basis": "CIF (delivered) USD/kg", "usd_inr": usd_inr},
    }


def history_table(district: str) -> list[dict]:
    a = artifact()
    h = pd.DataFrame(a["history"])
    h = h[h["district"] == district].sort_values("year")
    rows = []
    for _, r in h.iterrows():
        total = float(sum(r[c] for c in COMPONENTS))
        rev = r["yield_kg_acre"] * r["price_inr_kg"]
        rows.append({"year": int(r["year"]), "cost_acre": round(total), "yield_kg_acre": int(r["yield_kg_acre"]),
                     "cost_kg": round(total / r["yield_kg_acre"], 1), "price_kg": float(r["price_inr_kg"]),
                     "profit_acre": round(rev - total), "margin_pct": round((rev - total) / rev * 100, 1),
                     "shock": int(r["shock"]), "forecast": False})
    return rows


def analysis(district: str, acres: float, trees: int, age: float, irrigation: str, tons: float, grade_a_tons: float,
             offer_net_a: float | None = None, offer_net_b: float | None = None,
             offers_a: list | None = None, offers_b: list | None = None,
             wage_pct=None, diesel_pct=None, fert_pct=None, actual: dict | None = None,
             target_margin_pct: float = TARGET_MARGIN_PCT, usd_inr: float = 88.0) -> dict:
    a = artifact()
    base = next_season_per_acre(district)
    scen = next_season_per_acre(district, wage_pct, diesel_pct, fert_pct)
    prices = _season_price(district)

    # ---- 1. year-by-year comparative table (district, per acre) incl. next season
    years = history_table(district)
    tot = sum(v["mid"] for v in base["components"].values())
    ratio = 0.55 * prices["A"]["season_ratio"] + 0.30 * prices["B"]["season_ratio"] + 0.15 * prices["C"]["season_ratio"]
    mix_price = years[-1]["price_kg"] * ratio  # same arrival-weighted season basis as the history rows
    rev = base["yield_kg_acre"] * mix_price
    years.append({"year": a["target_year"], "cost_acre": round(tot), "yield_kg_acre": round(base["yield_kg_acre"]),
                  "cost_kg": round(tot / base["yield_kg_acre"], 1), "price_kg": round(mix_price, 1),
                  "profit_acre": round(rev - tot), "margin_pct": round((rev - tot) / rev * 100, 1), "shock": 0, "forecast": True})

    # ---- 2. my farm's cost (scaled from per-acre to my trees, tree age, irrigation)
    scale = trees / TREES_PER_ACRE * age_factor(age)
    adj = irrigation_adj(irrigation)

    def farm_cost(per_acre: dict) -> dict:
        return {c: {k: round(v[k] * scale * adj.get(c, 1.0)) for k in ("last", "mid", "lo", "hi")} for c, v in per_acre["components"].items()}

    mine, mine_scen = farm_cost(base), farm_cost(scen)
    cost_total = sum(v["mid"] for v in mine.values())
    cost_lo, cost_hi = sum(v["lo"] for v in mine.values()), sum(v["hi"] for v in mine.values())
    scen_total = sum(v["mid"] for v in mine_scen.values())
    kg = tons * 1000

    # ---- 3. selling channels
    a_kg, c_kg = grade_a_tons * 1000, tons * 1000 * GRADE_MIX_C
    b_kg = max(0.0, kg - a_kg - c_kg)
    processing_c = prices["C"]["market"] * PROCESSING_FACTOR
    def fill(kg_have, offers, single, fallback, fallback_channel):
        """Fill my tons from the best open offers (each limited to what that buyer still needs), rest at fallback."""
        offers = sorted([o for o in (offers or []) if o["net_kg"] > fallback], key=lambda o: -o["net_kg"])
        if single and single > fallback and not offers:
            offers = [{"net_kg": single, "tons": float("inf")}]
        left, rev, used = kg_have, 0.0, 0.0
        for o in offers:
            take = min(left, o["tons"] * 1000)
            rev, left, used = rev + take * o["net_kg"], left - take, used + take
        rev += left * fallback
        return {"net_kg": round(rev / kg_have) if kg_have else round(fallback),
                "channel": "agrilink_export" if used > 0 else fallback_channel, "agrilink_kg": round(used)}

    fa = fill(a_kg, offers_a, offer_net_a, prices["A"]["market"], "export_fair")
    fb = fill(b_kg, offers_b, offer_net_b, prices["B"]["net"], "local_market")
    plan = [
        {"grade": "A", "kg": round(a_kg), **fa},
        {"grade": "B", "kg": round(b_kg), **fb},
        {"grade": "C", "kg": round(c_kg), "channel": "processing" if processing_c > prices["C"]["net"] else "local_market",
         "net_kg": round(max(processing_c, prices["C"]["net"])), "agrilink_kg": 0},
    ]
    local = [{"grade": g, "kg": p["kg"], "channel": "local_market", "net_kg": prices[g]["net"]} for g, p in zip("ABC", plan)]
    for rows in (plan, local):
        for p in rows:
            p["revenue"] = round(p["kg"] * p["net_kg"])
    rev_plan, rev_local = sum(p["revenue"] for p in plan), sum(p["revenue"] for p in local)

    # ---- 5. my actual costs vs district average (same year), per tree
    benchmark = None
    if actual and actual.get("components"):
        yr = int(actual.get("year", a["years"][1]))
        h = pd.DataFrame(a["history"])
        row = h[(h["district"] == district) & (h["year"] == yr)]
        if not row.empty:
            row = row.iloc[0]
            items = []
            for c in COMPONENTS:
                if c not in actual["components"]:
                    continue
                avg = float(row[c]) * scale * adj.get(c, 1.0)
                mine_c = float(actual["components"][c])
                diff = (mine_c - avg) / avg * 100
                items.append({"component": c, "mine": round(mine_c), "district_avg": round(avg), "diff_pct": round(diff, 1),
                              "flag": bool(diff >= OVERSPEND_PCT)})
            benchmark = {"year": yr, "items": items,
                         "mine_total": round(sum(i["mine"] for i in items)), "avg_total": round(sum(i["district_avg"] for i in items))}

    return {
        "district": district, "year": a["target_year"],
        "years": years,
        "farm": {
            "trees": trees, "acres": acres, "tons": tons,
            "components": mine, "cost_total": cost_total, "cost_lo": cost_lo, "cost_hi": cost_hi,
            "cost_last_year": sum(v["last"] for v in mine.values()),
            "cost_per_kg": round(cost_total / kg, 1) if kg else None,
            "breakeven_kg": round(cost_total / kg, 1) if kg else None,
        },
        "channels": {"plan": plan, "local": local, "revenue_plan": rev_plan, "revenue_local": rev_local,
                     "profit_plan": rev_plan - cost_total, "profit_local": rev_local - cost_total,
                     "extra_profit": rev_plan - rev_local,
                     "margin_plan_pct": round((rev_plan - cost_total) / rev_plan * 100, 1) if rev_plan else None},
        "scenario": {"wage_pct": wage_pct, "diesel_pct": diesel_pct, "fertilizer_pct": fert_pct,
                     "drivers_used": scen["drivers"], "default_drivers": base["drivers"],
                     "cost_total": scen_total, "cost_change": scen_total - cost_total,
                     "cost_change_pct": round((scen_total / cost_total - 1) * 100, 1) if cost_total else 0,
                     "profit_plan": rev_plan - scen_total},
        "benchmark": benchmark,
        "thresholds": thresholds(district, cost_total / kg if kg else 0, prices, target_margin_pct, usd_inr),
        "model": model_card(),
    }
