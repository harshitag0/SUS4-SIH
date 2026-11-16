"""Supply-Demand engine: training.

What it learns
- DEMAND: monthly export tons per destination x grade (Mar-Jun season).
- SUPPLY: monthly export-grade tons from registered FPOs on the Singapore corridor, per grade.

How
- Target = log growth vs the same month last year (log(tons / lag1)). Trees can't extrapolate raw volumes
  beyond the training years, but they can learn growth rates, so forecast = last year x exp(predicted growth).
- Features: last year's volume, last year's market growth, COVID shock/rebound flags, weather-shock flag (supply),
  month, grade, and market factors (Indian-diaspora share, premium market, air hours, irradiation/VHT need).
  Market factors instead of country IDs let the model reason about new markets.
- Gradient boosting (mid) + quantile models (10% / 90%) for an 80% range.
- Validation: train on years < holdout, test on the holdout year, compare with two baselines
  ("same as last year" and "last year x last growth").
"""
from __future__ import annotations

import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[3]  # services/ml
DATA = ROOT / "data"
ARTIFACT = ROOT / "models" / "supply_demand.joblib"
MONTHS = [3, 4, 5, 6]
GRADES = ["A", "B", "C"]
COVID_SHOCK, COVID_REBOUND = {2020}, {2021, 2022}
MARKET_COLS = ["indian_diaspora_pct", "premium", "air_hours", "needs_treatment"]
GROUPS = {
    "history": ["log_lag1"], "growth": ["last_growth"], "covid": ["covid_shock", "covid_rebound"], "weather": ["shock", "shock_prev", "shock_prev2"],
    "season": [f"month_{m}" for m in MONTHS], "grade": [f"grade_{g}" for g in GRADES], "market": MARKET_COLS,
}


def load_data(data_dir: Path = DATA):
    return (pd.read_csv(data_dir / "exports_monthly.csv"), pd.read_csv(data_dir / "supply_monthly.csv"),
            pd.read_csv(data_dir / "markets.csv"))


def add_history(df: pd.DataFrame) -> pd.DataFrame:
    """lag1 = same destination/grade/month last year; last_growth = destination's annual growth y-2 -> y-1."""
    df = df.sort_values(["destination", "grade", "month", "year"]).copy()
    df["lag1"] = df.groupby(["destination", "grade", "month"])["tons"].shift(1)
    if "shock" in df:  # a bad-weather year depresses lag1 and last_growth; flag it so the rebound isn't read as trend
        g = df.groupby(["destination", "grade", "month"])["shock"]
        df["shock_prev"], df["shock_prev2"] = g.shift(1).fillna(0), g.shift(2).fillna(0)
    annual = df.groupby(["destination", "year"])["tons"].sum().rename("annual").reset_index()
    annual["last_growth"] = np.log(annual.groupby("destination")["annual"].shift(1) / annual.groupby("destination")["annual"].shift(2))
    return df.merge(annual[["destination", "year", "last_growth"]], on=["destination", "year"], how="left")


def features(df: pd.DataFrame, markets: pd.DataFrame) -> pd.DataFrame:
    X = pd.DataFrame(index=df.index)
    X["log_lag1"] = np.log(df["lag1"].astype(float))
    X["last_growth"] = df["last_growth"].astype(float)
    X["covid_shock"] = df["year"].isin(COVID_SHOCK).astype(int)
    X["covid_rebound"] = df["year"].isin(COVID_REBOUND).astype(int)
    for c in ("shock", "shock_prev", "shock_prev2"):
        X[c] = df[c].astype(int) if c in df else 0
    for m in MONTHS:
        X[f"month_{m}"] = (df["month"] == m).astype(int)
    for g in GRADES:
        X[f"grade_{g}"] = (df["grade"] == g).astype(int)
    mk = df[["destination"]].merge(markets, on="destination", how="left")
    for c in MARKET_COLS:
        X[c] = mk[c].to_numpy()
    return X


def prepare(df, markets):
    h = add_history(df).dropna(subset=["lag1", "last_growth"]).reset_index(drop=True)
    return h, features(h, markets), np.log(h["tons"]) - np.log(h["lag1"])


def fit(X, y, seed=0):
    p = dict(n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.9, random_state=seed)
    return {"mid": GradientBoostingRegressor(**p).fit(X, y),
            "lo": GradientBoostingRegressor(loss="quantile", alpha=0.1, **p).fit(X, y),
            "hi": GradientBoostingRegressor(loss="quantile", alpha=0.9, **p).fit(X, y)}


def predict(models, X, lag1):
    base = np.log(np.asarray(lag1, float))
    out = {k: np.exp(base + m.predict(X)) for k, m in models.items()}
    stacked = np.sort(np.vstack([out["lo"], out["mid"], out["hi"]]), axis=0)  # keep lo <= mid <= hi
    return {"lo": stacked[0], "mid": out["mid"], "hi": stacked[2]}


def _mape(pred, actual):
    return round(float(np.mean(np.abs(pred - actual) / actual) * 100), 1)


def evaluate(df, markets, holdout_year):
    h, X, y = prepare(df, markets)
    tr, te = h["year"] < holdout_year, h["year"] == holdout_year
    p = predict(fit(X[tr], y[tr]), X[te], h.loc[te, "lag1"])
    t = h.loc[te].assign(pred=p["mid"], lo=p["lo"], hi=p["hi"], naive=h.loc[te, "lag1"],
                         trend=h.loc[te, "lag1"] * np.exp(h.loc[te, "last_growth"]))
    annual = t.groupby("destination")[["tons", "pred", "naive", "trend"]].sum()
    return {
        "holdout_year": int(holdout_year), "test_rows": int(te.sum()), "train_rows": int(tr.sum()),
        "mape_monthly": _mape(t["pred"], t["tons"]),
        "mape_annual": _mape(annual["pred"], annual["tons"]),
        "baseline_last_year_mape_annual": _mape(annual["naive"], annual["tons"]),
        "baseline_trend_mape_annual": _mape(annual["trend"], annual["tons"]),
        "range_coverage_pct": round(float(((t["tons"] >= t["lo"]) & (t["tons"] <= t["hi"])).mean() * 100), 1),
    }


def future_rows(df, year):
    rows = df[df["year"] == year - 1][["month", "destination", "grade", "tons"]].rename(columns={"tons": "lag1"}).copy()
    rows["year"] = year
    annual = df.groupby(["destination", "year"])["tons"].sum()
    rows["last_growth"] = rows["destination"].map(lambda d: float(np.log(annual[(d, year - 1)] / annual[(d, year - 2)])))
    if "shock" in df:
        shock_by_year = df.groupby("year")["shock"].max()
        rows["shock"] = 0  # forecast assumes a normal season; weather risk shows up in the range
        rows["shock_prev"] = int(shock_by_year.get(year - 1, 0))
        rows["shock_prev2"] = int(shock_by_year.get(year - 2, 0))
    return rows.reset_index(drop=True)


def _forecast(df, markets, models, year):
    fr = future_rows(df, year)
    p = predict(models, features(fr, markets), fr["lag1"])
    return fr.assign(lo=p["lo"].round(1), mid=p["mid"].round(1), hi=p["hi"].round(1))[
        ["destination", "month", "grade", "lag1", "lo", "mid", "hi"]]


def importance(model, columns):
    imp = dict(zip(columns, model.feature_importances_))
    g = {k: float(sum(imp.get(c, 0) for c in cols)) for k, cols in GROUPS.items()}
    total = sum(g.values()) or 1
    return dict(sorted(((k, round(v / total * 100, 1)) for k, v in g.items() if v > 0), key=lambda kv: -kv[1]))


def train(data_dir: Path = DATA, out: Path | None = ARTIFACT) -> dict:
    ex, sup, mk = load_data(data_dir)
    target = int(ex["year"].max()) + 1
    metrics = {"demand": evaluate(ex, mk, target - 1), "supply": evaluate(sup, mk, target - 1)}
    _, Xd, yd = prepare(ex, mk)
    _, Xs, ys = prepare(sup, mk)
    dm, sm = fit(Xd, yd), fit(Xs, ys)
    last = ex[ex["year"] == target - 1]
    art = {
        "target_year": target,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "data_source": "sample" if (ex.get("source", pd.Series(["real"])) == "sample").all() else "real",
        "years": [int(ex["year"].min()), int(ex["year"].max())],
        "rows": {"demand": int(len(ex)), "supply": int(len(sup))},
        "model": "GradientBoostingRegressor on log growth vs last year + 10%/90% quantile models",
        "metrics": metrics,
        "importance": importance(dm["mid"], Xd.columns),
        "demand_fc": _forecast(ex, mk, dm, target).to_dict("records"),
        "supply_fc": _forecast(sup, mk, sm, target).to_dict("records"),
        "history_demand": ex.groupby(["destination", "year"])["tons"].sum().round(1).reset_index().to_dict("records"),
        "history_supply": sup.groupby(["destination", "year"])["tons"].sum().round(1).reset_index().to_dict("records"),
        "prices": last.groupby(["destination", "grade"])["avg_price_usd_kg"].mean().round(2).reset_index().to_dict("records"),
        "markets": mk.to_dict("records"),
    }
    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({**art, "models": {"demand": dm, "supply": sm}}, out)
    return art
