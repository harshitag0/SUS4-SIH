"""Generate the SAMPLE training data for the Supply-Demand engine.

This is synthetic data with realistic structure, used until real APEDA / Agmarknet files are available.
Replace the CSVs in services/ml/data/ with real data in the same columns and retrain (POST /supply-demand/train).

Rules used to generate it (so the model has real patterns to learn):
- Annual demand per destination grows at a destination-specific rate (Singapore and Japan fastest).
- COVID: 2020 volumes x0.60, 2021 x0.85 (air-freight disruption), then recovery.
- Price elasticity: a year with higher export prices sells ~0.8% less per 1% price rise.
- Season: Mar 12% / Apr 38% / May 37% / Jun 13%, with early/late seasons shifting volume.
- Grade mix: premium markets (UK, USA, Japan, Singapore, Netherlands) buy more Grade A than Gulf markets;
  all markets shift slowly towards Grade A.
- Supply (registered FPOs, Singapore corridor): grows ~14%/yr, hit by Cyclone Tauktae (2021, x0.70)
  and unseasonal rain (2023, x0.85).
- Multiplicative noise ~7%.
Run: python scripts/make_sample_data.py
"""
from pathlib import Path
import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "data"
YEARS = list(range(2016, 2026))
MONTHS = [3, 4, 5, 6]
MONTH_SHARE = np.array([0.12, 0.38, 0.37, 0.13])
GRADES = ["A", "B", "C"]

# destination: indian_diaspora_pct (approx. share of population of Indian origin), premium market, air hours from Mumbai,
# needs irradiation/VHT treatment, 2016 base tons, annual growth
MARKETS = {
    "UAE":         dict(indian_diaspora_pct=35.0, premium=0, air_hours=3.0, needs_treatment=0, base=2500, growth=0.07),
    "Qatar":       dict(indian_diaspora_pct=25.0, premium=0, air_hours=3.5, needs_treatment=0, base=520, growth=0.06),
    "Kuwait":      dict(indian_diaspora_pct=21.0, premium=0, air_hours=3.5, needs_treatment=0, base=430, growth=0.05),
    "Oman":        dict(indian_diaspora_pct=20.0, premium=0, air_hours=2.5, needs_treatment=0, base=380, growth=0.05),
    "UK":          dict(indian_diaspora_pct=2.5, premium=1, air_hours=9.5, needs_treatment=0, base=600, growth=0.09),
    "Singapore":   dict(indian_diaspora_pct=9.0, premium=1, air_hours=5.5, needs_treatment=0, base=250, growth=0.15),
    "Netherlands": dict(indian_diaspora_pct=1.0, premium=1, air_hours=9.5, needs_treatment=0, base=400, growth=0.08),
    "USA":         dict(indian_diaspora_pct=1.4, premium=1, air_hours=16.0, needs_treatment=1, base=300, growth=0.12),
    "Japan":       dict(indian_diaspora_pct=0.03, premium=1, air_hours=8.5, needs_treatment=1, base=80, growth=0.13),
}
COVID = {2020: 0.60, 2021: 0.85}
SUPPLY_SHOCK = {2021: 0.70, 2023: 0.85}


def main(seed: int = 7):
    rng = np.random.default_rng(seed)
    price_index = {y: float(np.clip(rng.normal(1.0, 0.07), 0.85, 1.18)) for y in YEARS}
    season_shift = {y: int(rng.integers(-1, 2)) for y in YEARS}  # -1 early, 0 normal, +1 late

    def month_shares(y):
        s = MONTH_SHARE.copy()
        s[0] += -0.05 * season_shift[y]
        s[3] += 0.05 * season_shift[y]
        return s / s.sum()

    rows = []
    for dest, m in MARKETS.items():
        for i, y in enumerate(YEARS):
            annual = m["base"] * (1 + m["growth"]) ** i * COVID.get(y, 1.0) * price_index[y] ** -0.8
            a_share = (0.60 if m["premium"] else 0.45) + 0.005 * i
            gshare = {"A": a_share, "B": 0.30 if m["premium"] else 0.35}
            gshare["C"] = 1 - gshare["A"] - gshare["B"]
            base_price = (6.2 if m["premium"] else 4.0) * (1.03 ** i) * price_index[y]
            for mi, mon in enumerate(MONTHS):
                for g in GRADES:
                    tons = annual * month_shares(y)[mi] * gshare[g] * rng.lognormal(0, 0.07)
                    price = base_price * {"A": 1.0, "B": 0.8, "C": 0.6}[g] * (1.08 if mon == 3 else 1.0 if mon == 4 else 0.95 if mon == 5 else 0.9)
                    rows.append(dict(year=y, month=mon, destination=dest, grade=g, tons=round(tons, 2),
                                     avg_price_usd_kg=round(price, 2), source="sample"))
    exports = pd.DataFrame(rows)

    srows = []
    for i, y in enumerate(YEARS):
        annual = 230 * 1.14 ** i * SUPPLY_SHOCK.get(y, 1.0)
        for mi, mon in enumerate(MONTHS):
            for g, gs in {"A": 0.5 + 0.004 * i, "B": 0.3, "C": 0.2 - 0.004 * i}.items():
                srows.append(dict(year=y, month=mon, destination="Singapore", grade=g,
                                  tons=round(annual * month_shares(y)[mi] * gs * rng.lognormal(0, 0.06), 2),
                                  shock=int(y in SUPPLY_SHOCK), source="sample"))
    supply = pd.DataFrame(srows)

    markets = pd.DataFrame([{"destination": d, **{k: v for k, v in m.items() if k not in ("base", "growth")}} for d, m in MARKETS.items()])
    OUT.mkdir(parents=True, exist_ok=True)
    exports.to_csv(OUT / "exports_monthly.csv", index=False)
    supply.to_csv(OUT / "supply_monthly.csv", index=False)
    markets.to_csv(OUT / "markets.csv", index=False)
    print(f"wrote {len(exports)} export rows, {len(supply)} supply rows, {len(markets)} markets to {OUT}")


if __name__ == "__main__":
    main()
