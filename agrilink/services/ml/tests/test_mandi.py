import httpx
from app.modules.mandi import service

SAMPLE = {"records": [
    {"state": "Maharashtra", "district": "Ratnagiri", "market": "Ratnagiri", "commodity": "Mango", "variety": "Alphonso",
     "arrival_date": "15/11/2026", "min_price": "30000", "max_price": "50000", "modal_price": "40000"},
    {"state": "Maharashtra", "district": "Thane", "market": "Vashi", "commodity": "Mango", "variety": "Alphonso",
     "arrival_date": "15/11/2026", "min_price": "25000", "max_price": "45000", "modal_price": "35000"},
    {"modal_price": "0"}, {"modal_price": "bad"},
]}


def test_parse_converts_quintal_to_kg_and_skips_bad_rows():
    out = service.parse_records(SAMPLE["records"])
    assert len(out["records"]) == 2
    assert out["records"][0]["modal_kg"] == 400.0 and out["records"][0]["min_kg"] == 300.0
    assert out["avg_modal_kg"] == 375.0


def test_no_key_is_reported_not_faked(monkeypatch):
    monkeypatch.delenv("DATA_GOV_IN_API_KEY", raising=False)
    out = service.latest()
    assert out["source"] == "unavailable" and out["reason"] == "no_api_key" and out["records"] == []


def test_live_fetch_with_key(monkeypatch):
    monkeypatch.setenv("DATA_GOV_IN_API_KEY", "test")
    service._cache.clear()
    seen = {}

    def handler(req: httpx.Request):
        seen["params"] = dict(req.url.params)
        return httpx.Response(200, json=SAMPLE)

    out = service.latest(client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert out["source"] == "agmarknet" and out["avg_modal_kg"] == 375.0
    assert seen["params"]["filters[commodity]"] == "Mango" and seen["params"]["api-key"] == "test"


def test_fetch_failure_falls_back(monkeypatch):
    monkeypatch.setenv("DATA_GOV_IN_API_KEY", "test")
    service._cache.clear()
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    out = service.latest(client=client)
    assert out["source"] == "unavailable" and out["reason"].startswith("fetch_failed")
