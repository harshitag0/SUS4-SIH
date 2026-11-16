import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.supply_demand import model, service


@pytest.fixture(scope="module")
def art(tmp_path_factory):
    # Train into a temp file so tests never depend on (or overwrite) the served model
    return model.train(out=tmp_path_factory.mktemp("m") / "sd.joblib")


def test_model_beats_last_year_baseline_on_holdout(art):
    m = art["metrics"]["demand"]
    assert m["holdout_year"] == 2025 and m["test_rows"] > 50
    assert m["mape_annual"] < m["baseline_last_year_mape_annual"]
    assert m["mape_annual"] < m["baseline_trend_mape_annual"]
    assert m["range_coverage_pct"] >= 70  # 80% range should cover most actuals
    s = art["metrics"]["supply"]
    assert s["mape_annual"] < s["baseline_trend_mape_annual"]


def test_forecast_covers_every_market_month_grade(art):
    d = pd.DataFrame(art["demand_fc"])
    assert len(d) == 9 * 4 * 3
    assert (d["lo"] <= d["mid"]).all() and (d["mid"] <= d["hi"]).all() and (d["mid"] > 0).all()
    assert art["target_year"] == 2026 and art["data_source"] == "sample"


def test_feature_history_has_no_leakage():
    ex, _, mk = model.load_data()
    h = model.add_history(ex)
    row = h[(h.destination == "Singapore") & (h.grade == "A") & (h.month == 4) & (h.year == 2025)].iloc[0]
    prev = ex[(ex.destination == "Singapore") & (ex.grade == "A") & (ex.month == 4) & (ex.year == 2024)].iloc[0]
    assert row["lag1"] == prev["tons"]  # lag uses only the previous year


def test_need_levels():
    assert service.need_level(20) == "high" and service.need_level(5) == "medium"
    assert service.need_level(-3) == "low" and service.need_level(None) == "unknown"


c = TestClient(app)


def test_outlook_singapore_answers_need_quantity_grade():
    o = c.get("/supply-demand/outlook", params={"destination": "Singapore"}).json()
    assert o["has_supply"] and o["need"] in {"high", "medium", "low"}
    assert abs(o["gap"] - (o["demand"] - o["supply"])) < 0.5
    assert abs(sum(g["demand"] for g in o["by_grade"]) - o["demand"]) < 1
    assert abs(sum(m["demand"] for m in o["by_month"]) - o["demand"]) < 1
    assert o["most_needed_grade"] in {"A", "B", "C"} and o["peak_month"] in {3, 4, 5, 6}
    assert o["demand_lo"] <= o["demand"] <= o["demand_hi"]
    assert o["model"]["metrics"]["demand"]["mape_annual"] > 0


def test_outlook_other_market_has_no_supply_and_404_for_unknown():
    o = c.get("/supply-demand/outlook", params={"destination": "UK"}).json()
    assert not o["has_supply"] and "need" not in o
    assert c.get("/supply-demand/outlook", params={"destination": "Mars"}).status_code == 404


def test_recommendation_respects_harvest_window_and_capacity():
    r = c.get("/supply-demand/recommend", params={"district": "Ratnagiri", "grade_a_tons": 8.8, "grade_b_tons": 4}).json()
    assert r["harvest_months"] == [4, 5]
    a = next(p for p in r["plan"] if p["grade"] == "A")
    assert a["best_month"] in (4, 5) and 0 <= a["suggested_tons"] <= 8.8
    assert len(r["top_markets"]) == 4 and all("reasons" in m for m in r["top_markets"])
    usa = next((m for m in c.get("/supply-demand/markets").json() if m["destination"] == "USA"), None)
    assert usa and usa["needs_treatment"] == 1
