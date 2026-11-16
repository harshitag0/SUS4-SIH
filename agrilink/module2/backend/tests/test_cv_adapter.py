"""CV adapter: AgriLink vision service when M2_CV_URL is set, scenario profiles stay repeatable, outages are explicit."""
import httpx
import pytest

from app.adapters import cv


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status_code = payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad", request=None, response=None)

    def json(self):
        return self.payload


def test_default_is_simulated(monkeypatch):
    monkeypatch.delenv("M2_CV_URL", raising=False)
    assert isinstance(cv.make_cv(), cv.SimulatedCV) and not isinstance(cv.make_cv(), cv.AgriLinkVisionCV)


def test_remote_analysis_sends_each_photo(monkeypatch):
    sent = {}

    def fake_post(url, files=None, data=None, timeout=None):
        sent["url"], sent["n"] = url, len(files)
        return FakeResponse({"defect_pct": 2.0, "colour_score": 0.9, "est_weight_g": 230.0, "confidence": 0.9,
                             "flags": [], "model": "agrilink-vision-v1", "simulated": False, "features": [0.1]})
    monkeypatch.setattr(cv.httpx, "post", fake_post)
    res = cv.AgriLinkVisionCV("http://ml:8000").analyze_many([b"a", b"b", b"c"])
    assert sent == {"url": "http://ml:8000/vision/analyze", "n": 3}
    assert res["simulated"] is False and "features" not in res


def test_scenario_profile_does_not_call_service(monkeypatch):
    monkeypatch.setattr(cv.httpx, "post", lambda *a, **k: pytest.fail("should not call the service"))
    assert cv.AgriLinkVisionCV("http://ml:8000").analyze_many([b"x"], "good")["defect_pct"] == 3.0


def test_outage_raises(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("down")
    monkeypatch.setattr(cv.httpx, "post", boom)
    with pytest.raises(cv.CVUnavailable):
        cv.AgriLinkVisionCV("http://ml:8000").analyze_many([b"x"])


def test_learn_posts_grade(monkeypatch):
    seen = {}

    def fake_post(url, files=None, data=None, timeout=None):
        seen.update(url=url, grade=data["grade"], n=len(files))
        return FakeResponse({"added": 2})
    monkeypatch.setattr(cv.httpx, "post", fake_post)
    assert cv.AgriLinkVisionCV("http://ml:8000").learn([b"a", b"b"], "B", ref="V1") == {"added": 2}
    assert seen == {"url": "http://ml:8000/vision/gallery", "grade": "B", "n": 2}
