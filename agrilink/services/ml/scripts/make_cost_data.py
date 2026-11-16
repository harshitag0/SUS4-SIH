"""Generate SAMPLE cost-of-cultivation history for the Cost & Profit engine (Rs per acre, mature Alphonso orchard).

Synthetic but structured, until real data (state agriculture dept / CACP cost-of-cultivation studies, FPO member
records) is loaded with the same columns (see docs/DATA.md).
Rules:
- Components (2016, Ratnagiri, ~40 trees/acre): labour 39k, fertilizer & manure 15.6k, plant protection 13k,
  irrigation 7.8k, bagging & materials 6.5k, harvest & transport 11.7k  (~Rs 94k/acre). District factor: Sindhudurg 1.05, Ratnagiri 1.00,
  Raigad 0.95, Palghar 0.90.
- Drivers (approximate public trends, rounded): rural wage index (+6-9%/yr), diesel Rs/L, fertilizer price index
  (2021-22 spike).
- labour ~ wage^0.9 | fertilizer ~ fert_index^0.8 | plant protection ~ 4%/yr inflation, x1.35 in a bad-weather year
  (thrips / anthracnose), x1.10 the year after | irrigation ~ diesel^0.7 | bagging ~ 5%/yr |
  harvest & transport ~ diesel^0.5 x wage^0.4.  Noise ~4%.
- Marketable yield kg/acre (~35 kg/tree): 1150 in 2016, +2%/yr, x0.70 in 2021 (Cyclone Tauktae), x0.85 in 2023 (unseasonal rain).
- Price Rs/kg: arrival-weighted season price from prices_weekly.csv, grade mix A 55% / B 30% / C 15%.
Run after make_price_data.py:  python scripts/make_cost_data.py
"""
from pathlib import Path
import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data"
BASE = {"labour": 39000, "fertilizer": 15600, "plant_protection": 13000, "irrigation": 7800,
        "bagging_materials": 6500, "harvest_transport": 11700}
DISTRICT = {"Sindhudurg": 1.05, "Ratnagiri": 1.00, "Raigad": 0.95, "Palghar": 0.90}
YEARS = list(range(2016, 2026))
WAGE = [100, 107, 114, 122, 128, 136, 147, 158, 170, 182]          # rural wage index
DIESEL = [59, 62, 70, 68, 72, 92, 95, 94, 92, 90]                  # Rs/litre (approx.)
FERT = [100, 102, 105, 108, 110, 125, 150, 140, 135, 138]          # fertilizer price index
SHOCK = {2021: 0.70, 2023: 0.85}
MIX = {"A": 0.55, "B": 0.30, "C": 0.15}


def season_prices():
    p = pd.read_csv(DATA / "prices_weekly.csv")
    p["w"] = p["arrivals_tons"]
    g = p.groupby(["year", "district", "grade"]).apply(lambda x: np.average(x["price_inr_kg"], weights=x["w"]), include_groups=False)
    g = g.rename("price").reset_index()
    g["mix"] = g["grade"].map(MIX)
    return g.groupby(["year", "district"]).apply(lambda x: float((x["price"] * x["mix"]).sum()), include_groups=False).to_dict()


def main(seed: int = 5):
    rng = np.random.default_rng(seed)
    price = season_prices()
    rows = []
    for d, f in DISTRICT.items():
        for i, y in enumerate(YEARS):
            shock, prev = y in SHOCK, (y - 1) in SHOCK
            c = {
                "labour": BASE["labour"] * (WAGE[i] / 100) ** 0.9,
                "fertilizer": BASE["fertilizer"] * (FERT[i] / 100) ** 0.8,
                "plant_protection": BASE["plant_protection"] * 1.04 ** i * (1.35 if shock else 1) * (1.10 if prev else 1),
                "irrigation": BASE["irrigation"] * (DIESEL[i] / DIESEL[0]) ** 0.7,
                "bagging_materials": BASE["bagging_materials"] * 1.05 ** i,
                "harvest_transport": BASE["harvest_transport"] * (DIESEL[i] / DIESEL[0]) ** 0.5 * (WAGE[i] / 100) ** 0.4,
            }
            yld = 1150 * 1.02 ** i * SHOCK.get(y, 1.0) * rng.lognormal(0, 0.05)
            row = {"year": y, "district": d, **{k: round(v * f * rng.lognormal(0, 0.04)) for k, v in c.items()},
                   "yield_kg_acre": round(yld), "price_inr_kg": round(price[(y, d)], 1),
                   "wage_index": WAGE[i], "diesel_inr_l": DIESEL[i], "fertilizer_index": FERT[i],
                   "shock": int(shock), "source": "sample"}
            rows.append(row)
    df = pd.DataFrame(rows)
    df.to_csv(DATA / "costs_yearly.csv", index=False)
    print(f"wrote {len(df)} rows to {DATA / 'costs_yearly.csv'}")


if __name__ == "__main__":
    main()
