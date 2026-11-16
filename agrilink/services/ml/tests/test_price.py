from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.price import model, service


@pytest.fixture(scope="module")
def art(tmp_path_factory):
    return model.train(out=tmp_path_factory.mktemp("p") / "price.joblib")


def test_beats_baselines_on_holdout(art):
    m = art["metrics"]
    assert m["holdout_year"] == 2025 and m["test_rows"] == 144
    assert m["mape_weekly"] < m["baseline_last_year_mape"]
    assert m["mape_weekly"] < m["baseline_inflation_mape"]
    assert m["range_coverage_pct"] >= 60


def test_higher_demand_means_higher_price(art):
    low = model.forecast(art, 1.08, 5)["mid"].mean()
    high = model.forecast(art, 1.08, 30)["mid"].mean()
    assert high > low


def test_more_supply_means_lower_price(art):
    assert model.forecast(art, 1.30, 18)["mid"].mean() < model.forecast(art, 0.80, 18)["mid"].mean()


def test_week_of_season():
    assert service.week_of(date(2026, 3, 22)) == 0
    assert service.week_of(date(2026, 4, 5)) == 2
    assert service.week_of(date(2026, 1, 1)) == 0 and service.week_of(date(2026, 8, 1)) == 11


c = TestClient(app)


def test_outlook_shape_and_scenario():
    base = c.get("/price/outlook", params={"district": "Sindhudurg", "grade": "A"}).json()
    assert len(base["forecast"]) == 12 and all(l <= m <= h for l, m, h in zip(base["band_low"], base["forecast"], base["band_high"]))
    assert base["forecast"][0] > base["forecast"][-1]  # early season pays more
    assert base["fair_offer"][0] == base["forecast"][0] + base["export_cost"]["total"]
    up = c.get("/price/outlook", params={"district": "Sindhudurg", "grade": "A", "demand_change_pct": 20}).json()
    down = c.get("/price/outlook", params={"district": "Sindhudurg", "grade": "A", "demand_change_pct": -20}).json()
    assert up["season_market_avg"] > base["season_market_avg"] > down["season_market_avg"]
    assert up["scenario"]["gap_pct"] > base["scenario"]["gap_pct"]
    b = c.get("/price/outlook", params={"district": "Sindhudurg", "grade": "B"}).json()
    assert b["season_market_avg"] < base["season_market_avg"]
    assert c.get("/price/outlook", params={"district": "Mars"}).status_code == 404


def test_later_district_gets_lower_window_price():
    s = c.get("/price/outlook", params={"district": "Sindhudurg"}).json()["harvest_window"]
    p = c.get("/price/outlook", params={"district": "Palghar"}).json()["harvest_window"]
    assert s["avg_price"] > p["avg_price"]


def test_offer_decisions():
    o = c.post("/price/evaluate", json={"district": "Sindhudurg", "offers": [
        {"id": "rich", "grade": "A", "price_usd_kg": 12, "deliver_by": "2026-05-05"},
        {"id": "cheap", "grade": "A", "price_usd_kg": 2, "deliver_by": "2026-05-05", "escalation_pct": 10},
    ]}).json()
    rich, cheap = o
    assert rich["decision"] == "accept" and rich["counter_offer_usd"] is None and rich["verdict"]["status"] == "above"
    assert cheap["decision"] in {"negotiate", "local_better"} and cheap["counter_offer_usd"] >= cheap["fair_offer_usd"]
    assert cheap["best_case_usd"] == 2.2
    assert rich["farmer_net_inr"] == rich["offer_inr"] - 45
    assert rich["week"] == 6 and rich["week_label"] == "May W2"  # 5 May = 44 days after 22 Mar
