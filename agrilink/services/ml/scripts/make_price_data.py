"""Generate SAMPLE weekly market-price data (APMC-style, Rs/kg) for the price model.

Synthetic but structured, until real Agmarknet / APMC history is loaded (same columns, see docs/DATA.md).
Rules:
- 12 season weeks (Mar W4 .. Jun W3). Each district's arrivals follow a bell curve; northern districts harvest later.
- Arrivals grow ~6%/yr; Cyclone Tauktae (2021, x0.70) and unseasonal rain (2023, x0.85) cut arrivals.
- Price falls as market-wide arrivals rise (smoothed elasticity -0.45), early-season premium (Mar W4 +25%, Apr W1 +12%),
  late-season decline of 9%/week after May W1 (monsoon onset, softer fruit, other varieties).
- Export demand pull: price x (1 + 0.8 x Singapore demand-supply gap), gap taken from the supply-demand CSVs.
- General inflation 6%/yr, Devgad/Sindhudurg brand premium +5%, grade factors A 1.00 / B 0.78 / C 0.55, noise ~5%.
- Prices are rescaled so the 2025 Grade A Sindhudurg season average is ~Rs 360/kg.
Run after make_sample_data.py:  python scripts/make_price_data.py
"""
from pathlib import Path
import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data"
WEEKS = ["Mar W4", "Apr W1", "Apr W2", "Apr W3", "Apr W4", "May W1", "May W2", "May W3", "May W4", "Jun W1", "Jun W2", "Jun W3"]
DISTRICTS = {"Sindhudurg": (0, 900), "Ratnagiri": (1, 1400), "Raigad": (2, 500), "Palghar": (3, 350)}  # offset, 2016 season tons
SHOCK = {2021: 0.70, 2023: 0.85}
GRADE = {"A": 1.0, "B": 0.78, "C": 0.55}


def sg_gap_by_year():
    ex = pd.read_csv(DATA / "exports_monthly.csv")
    sup = pd.read_csv(DATA / "supply_monthly.csv")
    d = ex[ex.destination == "Singapore"].groupby("year")["tons"].sum()
    s = sup.groupby("year")["tons"].sum()
    return ((d - s) / d).to_dict()


def main(seed: int = 11):
    rng = np.random.default_rng(seed)
    gap = sg_gap_by_year()
    years = sorted(gap)
    wk = np.arange(len(WEEKS))
    rows = []
    for i, y in enumerate(years):
        arrivals = {}
        for d, (off, base) in DISTRICTS.items():
            curve = np.exp(-0.5 * ((wk - (off + 4.5)) / 2.2) ** 2)
            arrivals[d] = base * 1.06 ** i * SHOCK.get(y, 1.0) * curve / curve.sum() * rng.lognormal(0, 0.05, len(wk))
        market = sum(arrivals.values())
        ref = market.mean()
        for d in DISTRICTS:
            for w in wk:
                early = 1.25 if w == 0 else 1.12 if w == 1 else 1.0
                late = 1 - 0.09 * max(0, w - 5)  # monsoon onset, softer fruit, other varieties arrive
                supply_effect = ((market[w] + ref) / (2 * ref)) ** -0.45  # smoothed: thin early/late weeks don't explode
                p = (1.06 ** i) * supply_effect * (1 + 0.8 * gap[y]) * early * late * (1.05 if d == "Sindhudurg" else 1.0)
                for g, f in GRADE.items():
                    rows.append(dict(year=y, week=int(w), week_label=WEEKS[w], district=d, grade=g,
                                     price_inr_kg=p * f * rng.lognormal(0, 0.05), arrivals_tons=round(float(arrivals[d][w]), 1),
                                     market_arrivals_tons=round(float(market[w]), 1), sg_gap_pct=round(gap[y] * 100, 2),
                                     shock=int(y in SHOCK), source="sample"))
    df = pd.DataFrame(rows)
    ref25 = df[(df.year == years[-1]) & (df.grade == "A") & (df.district == "Sindhudurg")]["price_inr_kg"].mean()
    df["price_inr_kg"] = (df["price_inr_kg"] * 360 / ref25).round(1)
    df.to_csv(DATA / "prices_weekly.csv", index=False)
    print(f"wrote {len(df)} weekly price rows for {years[0]}-{years[-1]} to {DATA / 'prices_weekly.csv'}")


if __name__ == "__main__":
    main()
