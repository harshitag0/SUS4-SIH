"""Price (cost) prediction engine: training.

Predicts the weekly market price (Rs/kg, APMC-style farm-gate) per district x grade for next season.
- Target: log(price / same district-week-grade last year)  -> extrapolates beyond training years.
- Features: last year's price, week of season, grade, district, change in market arrivals (supply),
  Singapore demand-supply gap and its change (DEMAND PULL — fed by the Supply-Demand engine),
  weather shock this/last year.
- Next-season inputs come from the Supply-Demand engine: supply growth -> arrivals change, forecast gap -> demand pull.
  A demand scenario (e.g. demand +10%) re-computes the gap, so the farmer sees how price reacts to demand.
- Gradient boosting + 10%/90% quantile models; validated on the last year vs naive baselines.
"""
from __future__ import annotations

import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "data"
ARTIFACT = ROOT / "models" / "price.joblib"
GRADES = ["A", "B", "C"]
DISTRICTS = ["Sindhudurg", "Ratnagiri", "Raigad", "Palghar"]
GROUPS = {
    "history": ["log_lag_price"], "season": ["week"], "grade": [f"grade_{g}" for g in GRADES],
    "district": [f"dist_{d}" for d in DISTRICTS], "supply": ["log_arrivals_change"],
    "demand": ["gap_pct", "gap_change"], "weather": ["shock", "shock_prev"],
}


def load(data_dir: Path = DATA) -> pd.DataFrame:
    return pd.read_csv(data_dir / "prices_weekly.csv")


def add_history(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["district", "grade", "week", "year"]).copy()
    g = df.groupby(["district", "grade", "week"])
    df["lag_price"] = g["price_inr_kg"].shift(1)
    df["lag_arrivals"] = g["market_arrivals_tons"].shift(1)
    df["lag_gap"] = g["sg_gap_pct"].shift(1)
    df["shock_prev"] = g["shock"].shift(1).fillna(0)
    return df


def features(df: pd.DataFrame) -> pd.DataFrame:
    X = pd.DataFrame(index=df.index)
    X["log_lag_price"] = np.log(df["lag_price"].astype(float))
    X["week"] = df["week"].astype(int)
    for g in GRADES:
        X[f"grade_{g}"] = (df["grade"] == g).astype(int)
    for d in DISTRICTS:
        X[f"dist_{d}"] = (df["district"] == d).astype(int)
    X["log_arrivals_change"] = np.log(df["market_arrivals_tons"].astype(float) / df["lag_arrivals"].astype(float))
    X["gap_pct"] = df["sg_gap_pct"].astype(float)
    X["gap_change"] = (df["sg_gap_pct"] - df["lag_gap"]).astype(float)
    X["shock"] = df["shock"].astype(int)
    X["shock_prev"] = df["shock_prev"].astype(int)
    return X


def prepare(df):
    h = add_history(df).dropna(subset=["lag_price"]).reset_index(drop=True)
    return h, features(h), np.log(h["price_inr_kg"] / h["lag_price"])


def fit(X, y, seed=0):
    p = dict(n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.9, random_state=seed)
    return {"mid": GradientBoostingRegressor(**p).fit(X, y),
            "lo": GradientBoostingRegressor(loss="quantile", alpha=0.1, **p).fit(X, y),
            "hi": GradientBoostingRegressor(loss="quantile", alpha=0.9, **p).fit(X, y)}


def predict(models, X, lag_price):
    base = np.log(np.asarray(lag_price, float))
    out = {k: np.exp(base + m.predict(X)) for k, m in models.items()}
    s = np.sort(np.vstack([out["lo"], out["mid"], out["hi"]]), axis=0)
    return {"lo": s[0], "mid": out["mid"], "hi": s[2]}


def _mape(p, a):
    return round(float(np.mean(np.abs(p - a) / a) * 100), 1)


def evaluate(df, holdout):
    h, X, y = prepare(df)
    tr, te = h["year"] < holdout, h["year"] == holdout
    p = predict(fit(X[tr], y[tr]), X[te], h.loc[te, "lag_price"])
    act = h.loc[te, "price_inr_kg"].to_numpy()
    lag = h.loc[te, "lag_price"].to_numpy()
    infl = float(np.exp(np.mean(y[tr][h.loc[tr, "year"] >= holdout - 3])))  # recent average yearly change
    return {"holdout_year": int(holdout), "test_rows": int(te.sum()), "train_rows": int(tr.sum()),
            "mape_weekly": _mape(p["mid"], act),
            "baseline_last_year_mape": _mape(lag, act),
            "baseline_inflation_mape": _mape(lag * infl, act),
            "range_coverage_pct": round(float(((act >= p["lo"]) & (act <= p["hi"])).mean() * 100), 1)}


def future_rows(df, year, arrivals_ratio: float, gap_pct: float):
    last = df[df["year"] == year - 1].copy()
    return pd.DataFrame({
        "year": year, "week": last["week"].to_numpy(), "week_label": last["week_label"].to_numpy(),
        "district": last["district"].to_numpy(), "grade": last["grade"].to_numpy(),
        "lag_price": last["price_inr_kg"].to_numpy(), "lag_arrivals": last["market_arrivals_tons"].to_numpy(),
        "market_arrivals_tons": last["market_arrivals_tons"].to_numpy() * arrivals_ratio,
        "lag_gap": last["sg_gap_pct"].to_numpy(), "sg_gap_pct": gap_pct, "shock": 0,
        "shock_prev": last["shock"].to_numpy(),
    })


def importance(model, columns):
    imp = dict(zip(columns, model.feature_importances_))
    g = {k: float(sum(imp.get(c, 0) for c in cols)) for k, cols in GROUPS.items()}
    tot = sum(g.values()) or 1
    return dict(sorted(((k, round(v / tot * 100, 1)) for k, v in g.items() if v > 0), key=lambda kv: -kv[1]))


def train(data_dir: Path = DATA, out: Path | None = ARTIFACT) -> dict:
    df = load(data_dir)
    target = int(df["year"].max()) + 1
    metrics = evaluate(df, target - 1)
    _, X, y = prepare(df)
    models = fit(X, y)
    art = {
        "target_year": target, "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "data_source": "sample" if (df["source"] == "sample").all() else "real",
        "years": [int(df["year"].min()), int(df["year"].max())], "rows": int(len(df)),
        "model": "GradientBoostingRegressor on log price change vs last year + 10%/90% quantile models",
        "metrics": metrics, "importance": importance(models["mid"], X.columns),
        "weeks": df.drop_duplicates("week").sort_values("week")["week_label"].tolist(),
        "history": df[df["year"] >= target - 3][["year", "week", "district", "grade", "price_inr_kg"]].to_dict("records"),
        "last_gap_pct": float(df[df["year"] == target - 1]["sg_gap_pct"].iloc[0]),
        "columns": list(X.columns), "models": models, "last_year": df[df["year"] == target - 1].to_dict("records"),
    }
    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(art, out)
    return art


def forecast(art: dict, arrivals_ratio: float, gap_pct: float) -> pd.DataFrame:
    """Next-season weekly forecast for every district x grade, given supply growth and demand gap."""
    last = pd.DataFrame(art["last_year"])
    fr = future_rows(last, art["target_year"], arrivals_ratio, gap_pct)
    p = predict(art["models"], features(fr)[art["columns"]], fr["lag_price"])
    return fr.assign(lo=p["lo"].round(0), mid=p["mid"].round(0), hi=p["hi"].round(0))
