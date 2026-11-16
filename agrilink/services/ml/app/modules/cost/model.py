"""Cost & Profit engine: training.

Learns how each cost component of an Alphonso orchard changes from year to year, from its drivers:
  labour            <- rural wages
  fertilizer        <- fertilizer price index
  plant_protection  <- bad-weather year / year after (pest & disease pressure)
  irrigation        <- diesel price
  bagging_materials <- general inflation (intercept)
  harvest_transport <- diesel + wages
  yield             <- bad-weather year / year after
Model per component: linear regression on log change vs last year (pooled over districts). The coefficients are
elasticities a farmer can read ("wages +10% -> labour cost +9%"), the intercept is underlying inflation.
Validated on the last year against "same as last year" and "last year x last change".
"""
from __future__ import annotations

import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "data"
ARTIFACT = ROOT / "models" / "cost.joblib"
COMPONENTS = ["labour", "fertilizer", "plant_protection", "irrigation", "bagging_materials", "harvest_transport"]
DRIVERS = {
    "labour": ["d_wage"], "fertilizer": ["d_fert"], "plant_protection": ["shock", "shock_prev"],
    "irrigation": ["d_diesel"], "bagging_materials": [], "harvest_transport": ["d_diesel", "d_wage"],
    "yield_kg_acre": ["shock", "shock_prev"],
}
DRIVER_COLS = {"d_wage": "wage_index", "d_diesel": "diesel_inr_l", "d_fert": "fertilizer_index"}


def load(data_dir: Path = DATA) -> pd.DataFrame:
    return pd.read_csv(data_dir / "costs_yearly.csv")


def changes(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["district", "year"]).copy()
    g = df.groupby("district")
    for d, col in DRIVER_COLS.items():
        df[d] = np.log(df[col] / g[col].shift(1))
    df["shock_prev"] = g["shock"].shift(1)
    for c in COMPONENTS + ["yield_kg_acre"]:
        df[f"y_{c}"] = np.log(df[c] / g[c].shift(1))
        df[f"lag_{c}"] = g[c].shift(1)
    return df.dropna(subset=["d_wage"]).reset_index(drop=True)


def _X(df, cols):
    return df[cols].to_numpy(float) if cols else np.zeros((len(df), 0))


def fit(ch: pd.DataFrame) -> dict:
    models = {}
    for c, cols in DRIVERS.items():
        X = _X(ch, cols)
        y = ch[f"y_{c}"].to_numpy()
        m = LinearRegression().fit(X, y) if cols else None
        pred = m.predict(X) if m else np.full(len(y), y.mean())
        models[c] = {"cols": cols, "coef": dict(zip(cols, m.coef_.round(3).tolist())) if m else {},
                     "intercept": float(m.intercept_ if m else y.mean()), "resid_std": float(np.std(y - pred, ddof=1))}
    return models


def predict_change(models: dict, comp: str, x: dict) -> float:
    m = models[comp]
    return m["intercept"] + sum(m["coef"][k] * x[k] for k in m["cols"])


def _mape(p, a):
    return round(float(np.mean(np.abs(np.asarray(p) - np.asarray(a)) / np.asarray(a)) * 100), 1)


def evaluate(df: pd.DataFrame, holdout: int) -> dict:
    ch = changes(df)
    tr, te = ch[ch["year"] < holdout], ch[ch["year"] == holdout]
    models = fit(tr)
    pred_tot, act_tot, naive_tot, trend_tot = [], [], [], []
    prev = ch[ch["year"] == holdout - 1].set_index("district")
    for _, r in te.iterrows():
        x = {k: r[k] for k in ["d_wage", "d_diesel", "d_fert", "shock", "shock_prev"]}
        pred_tot.append(sum(r[f"lag_{c}"] * np.exp(predict_change(models, c, x)) for c in COMPONENTS))
        act_tot.append(sum(r[c] for c in COMPONENTS))
        naive_tot.append(sum(r[f"lag_{c}"] for c in COMPONENTS))
        trend_tot.append(sum(r[f"lag_{c}"] * np.exp(prev.loc[r["district"], f"y_{c}"]) for c in COMPONENTS))
    return {"holdout_year": int(holdout), "test_rows": int(len(te)), "train_rows": int(len(tr)),
            "mape_total_cost": _mape(pred_tot, act_tot), "baseline_last_year_mape": _mape(naive_tot, act_tot),
            "baseline_last_change_mape": _mape(trend_tot, act_tot)}


def next_drivers(df: pd.DataFrame) -> dict:
    """Default next-season driver changes: average of the last 3 years (no weather shock assumed)."""
    ch = changes(df)
    recent = ch[ch["year"] >= ch["year"].max() - 2]
    last = int(df["year"].max())
    return {"d_wage": float(recent["d_wage"].mean()), "d_diesel": float(recent["d_diesel"].mean()),
            "d_fert": float(recent["d_fert"].mean()), "shock": 0,
            "shock_prev": int(df[df["year"] == last]["shock"].max())}


def train(data_dir: Path = DATA, out: Path | None = ARTIFACT) -> dict:
    df = load(data_dir)
    last = int(df["year"].max())
    art = {
        "target_year": last + 1, "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "data_source": "sample" if (df["source"] == "sample").all() else "real",
        "years": [int(df["year"].min()), last], "rows": int(len(df)),
        "model": "Linear regression per cost component on log change vs last year (drivers: wages, diesel, fertilizer, weather)",
        "metrics": evaluate(df, last), "models": fit(changes(df)), "drivers_next": next_drivers(df),
        "history": df.to_dict("records"),
    }
    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(art, out)
    return art
