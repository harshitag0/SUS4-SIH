import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.cost import model, service


@pytest.fixture(scope="module")
def art(tmp_path_factory):
    return model.train(out=tmp_path_factory.mktemp("c") / "cost.joblib")


def test_beats_baselines_and_learns_drivers(art):
    m = art["metrics"]
    assert m["holdout_year"] == 2025 and m["test_rows"] == 4
    assert m["mape_total_cost"] < m["baseline_last_year_mape"]
    assert m["mape_total_cost"] < m["baseline_last_change_mape"]
    ms = art["models"]
    assert ms["labour"]["coef"]["d_wage"] > 0.5            # wages drive labour cost
    assert ms["irrigation"]["coef"]["d_diesel"] > 0.3      # diesel drives irrigation cost
    assert ms["plant_protection"]["coef"]["shock"] > 0.1   # bad-weather years need more sprays
    assert ms["yield_kg_acre"]["coef"]["shock"] < 0        # and give less fruit


c = TestClient(app)
FARM = {"district": "Sindhudurg", "acres": 6, "trees": 300, "age": 15, "irrigation": "drip", "tons": 10.5, "grade_a_tons": 6.3}


def test_analysis_year_table_and_farm_cost():
    r = c.post("/cost/analysis", json=FARM).json()
    ys = r["years"]
    assert [y["year"] for y in ys] == list(range(2016, 2027)) and ys[-1]["forecast"] and not ys[-2]["forecast"]
    covid = next(y for y in ys if y["year"] == 2020)
    assert covid["margin_pct"] < min(y["margin_pct"] for y in ys if y["year"] in (2019, 2022))  # COVID price crash shows up
    f = r["farm"]
    assert f["cost_lo"] <= f["cost_total"] <= f["cost_hi"]
    assert f["cost_per_kg"] == round(f["cost_total"] / 10500, 1)
    assert set(f["components"]) == set(model.COMPONENTS)


def test_channels_agrilink_offer_beats_all_local():
    r = c.post("/cost/analysis", json={**FARM, "offer_net_a": 2000}).json()["channels"]
    assert r["plan"][0]["channel"] == "agrilink_export" and r["plan"][0]["net_kg"] == 2000
    assert r["extra_profit"] > 0 and r["profit_plan"] > r["profit_local"]
    assert sum(p["kg"] for p in r["plan"]) == 10500


def test_scenario_costlier_inputs_raise_cost():
    base = c.post("/cost/analysis", json=FARM).json()
    s = c.post("/cost/analysis", json={**FARM, "wage_pct": 20, "diesel_pct": 30}).json()["scenario"]
    assert s["cost_total"] > base["farm"]["cost_total"] and s["cost_change_pct"] > 0
    assert s["profit_plan"] < base["channels"]["profit_plan"]


def test_benchmark_flags_overspending():
    avg = service.analysis(**{**FARM, "actual": {"year": 2025, "components": {"labour": 1}}})["benchmark"]["items"][0]["district_avg"]
    r = c.post("/cost/analysis", json={**FARM, "actual": {"year": 2025, "components": {"labour": avg * 1.3, "fertilizer": 1}}}).json()
    items = {i["component"]: i for i in r["benchmark"]["items"]}
    assert items["labour"]["flag"] and round(items["labour"]["diff_pct"]) == 30
    assert not items["fertilizer"]["flag"]


def test_rain_fed_farm_spends_less_on_irrigation():
    drip = c.post("/cost/analysis", json=FARM).json()["farm"]["components"]["irrigation"]["mid"]
    rain = c.post("/cost/analysis", json={**FARM, "irrigation": "rain"}).json()["farm"]["components"]["irrigation"]["mid"]
    assert rain < drip


def test_offers_fill_only_what_buyers_need():
    r = c.post("/cost/analysis", json={**FARM, "offers_a": [{"net_kg": 2000, "tons": 1}, {"net_kg": 1500, "tons": 2}]}).json()["channels"]
    a = r["plan"][0]
    assert a["channel"] == "agrilink_export" and a["agrilink_kg"] == 3000
    market = r["local"][0]["net_kg"]
    assert market < a["net_kg"] < 2000  # blended: 3 t at offers, 3.3 t at the fair export price


def test_thresholds_and_local_vs_country_comparison():
    r = c.post("/cost/analysis", json={**FARM, "target_margin_pct": 25}).json()
    th, f = r["thresholds"], r["farm"]
    assert th["baseline_kg"] == f["breakeven_kg"]
    assert abs(th["target_kg"] - th["baseline_kg"] * 1.25) < 0.2  # computed from the unrounded break-even
    a = th["comparison"]["A"]
    assert a == sorted(a, key=lambda x: -x["net_kg"])  # best market first
    local = next(x for x in a if x["market"] == "local_mandi")
    assert local["vs_local_kg"] == 0 and local["type"] == "local"
    usa, sg = next(x for x in a if x["market"] == "USA"), next(x for x in a if x["market"] == "Singapore")
    assert "treatment" in usa["costs"] and "treatment" not in sg["costs"]
    assert usa["costs"]["freight"] > sg["costs"]["freight"]  # longer flight costs more
    for x in a:
        assert x["net_kg"] == x["price_inr"] - sum(x["costs"].values()) or abs(x["net_kg"] - (x["price_inr"] - sum(x["costs"].values()))) <= 1
        assert x["status"] == ("loss" if x["net_kg"] < th["baseline_kg"] else "thin" if x["net_kg"] < th["target_kg"] else "good")
        if x["type"] == "export":  # the minimum CIF price really gives the baseline
            assert abs(x["min_usd_baseline"] * 88 - sum(x["costs"].values()) - th["baseline_kg"]) < 1
    assert any(x["market"] == "processing" for x in th["comparison"]["C"])
    assert not any(x["market"] == "processing" for x in a)
