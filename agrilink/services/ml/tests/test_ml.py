from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)


def test_health():
    assert c.get("/health").json()["status"] == "ok"


def test_grading():
    r = c.post("/grading/assess", json={"weight_g": 320, "colour_idx": 0.8, "blemish_pct": 1, "target_grade": "A"}).json()
    assert r["grade"] == "A" and r["meets_target"] and not r["tips"]
    r = c.post("/grading/assess", json={"weight_g": 260, "colour_idx": 0.5, "blemish_pct": 1, "target_grade": "A"}).json()
    assert r["grade"] == "C" and not r["meets_target"] and "tip_size" in r["tips"] and r["needs_consultant_review"]
    assert c.post("/grading/assess", json={"weight_g": -1, "colour_idx": 2, "blemish_pct": 0}).status_code == 422


def test_alerts():
    a = c.post("/alerts/evaluate", json={"rain_mm_48h": 80, "grade_a_tons_ready": 10, "committed_tons": 10}).json()["alerts"]
    assert a[0]["code"] == "storm" and a[0]["severity"] == "high" and a[0]["params"]["tons_at_risk"] == 2.0
    assert c.post("/alerts/evaluate", json={}).json()["alerts"] == []
