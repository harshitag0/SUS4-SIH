"""Photo grading: measurements, photo-quality gate, multi-photo result, reference gallery and learned grader.
Uses generated images (tests/mango_images.py), so it checks behaviour, not accuracy on real fruit."""
import io
import os
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from mango_images import mango  # noqa: E402


@pytest.fixture(autouse=True)
def gallery_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("VISION_GALLERY_DIR", str(tmp_path))


from app.modules.vision import gallery, service  # noqa: E402
from app.modules.vision.analyze import analyze_photo  # noqa: E402


def test_colour_follows_ripeness():
    ripe, turning, green = (analyze_photo(mango(hue=h))["colour_score"] for h in (18, 30, 55))
    assert ripe > turning > green
    assert ripe >= 0.85 and green <= 0.4


def test_blemish_percentage_tracks_spots():
    clean = analyze_photo(mango(hue=18))["defect_pct"]
    few = analyze_photo(mango(hue=18, spots=8))["defect_pct"]
    many = analyze_photo(mango(hue=18, spots=30, spot_r=9))["defect_pct"]
    assert clean < 0.5 < few < many
    assert 5 < many < 15


def test_shading_is_not_counted_as_blemish():
    # the generated fruit is ~45% darker at its rim than its centre
    assert analyze_photo(mango(hue=22, seed=3))["defect_pct"] < 0.5


GATE = {"no_fruit_found": dict(size=0), "fruit_too_small": dict(hue=18, size=0.08), "blurry": dict(hue=18, blur=6)}


@pytest.mark.parametrize("issue", list(GATE))
def test_quality_gate(issue):
    m = analyze_photo(mango(**GATE[issue]))
    assert issue in m["issues"]
    assert m["confidence"] < 0.6          # Module 2 asks for a retake below 0.60


def test_flat_yellow_frame_is_not_a_fruit():
    buf = io.BytesIO()
    Image.fromarray(np.full((480, 640, 3), (230, 190, 40), np.uint8)).save(buf, "PNG")
    assert analyze_photo(buf.getvalue())["is_fruit"] is False


def test_not_an_image():
    r = service.analyze([b"hello"])
    assert r["photos"][0]["issues"] == ["not_an_image"] and r["confidence"] < 0.6


def test_multi_photo_result_and_grade_hint():
    good = service.analyze([mango(hue=18, seed=i) for i in range(3)])
    assert good["grade_hint"] == "A" and good["confidence"] >= 0.8 and good["simulated"] is False
    assert {"defect_pct", "colour_score", "est_weight_g", "confidence", "flags", "model"} <= good.keys()
    green = service.analyze([mango(hue=55, seed=i) for i in range(3)])
    assert green["grade_hint"] == "REJECT"
    spotted = service.analyze([mango(hue=18, spots=35, spot_r=10, seed=i) for i in range(3)])
    assert spotted["grade_hint"] in ("B", "REJECT") and "anthracnose" in spotted["flags"]


def test_blurry_photo_is_left_out_but_lowers_confidence():
    r = service.analyze([mango(hue=18, seed=1), mango(hue=18, seed=2), mango(hue=18, blur=6)])
    assert r["photos_used"] == 2
    assert r["confidence"] < service.analyze([mango(hue=18, seed=1), mango(hue=18, seed=2)])["confidence"]
    assert any("blurry" in n for n in r["notes"])


def test_gallery_neighbours_and_learned_grader():
    assert gallery.status()["photos"] == 0
    for i in range(12):
        service.learn([mango(hue=17 + i % 3, seed=100 + i)], "A", "farmer_doctor", f"V{i}")
        service.learn([mango(hue=52 + i % 4, seed=200 + i)], "REJECT", "farmer_doctor", f"W{i}")
    st = gallery.status()
    assert st["photos"] == 24 and st["learned_grader"] is True
    # same photo twice is not added again
    assert service.learn([mango(hue=17, seed=100)], "A", "farmer_doctor", "dup")["added"] == 0

    ripe = service.analyze([mango(hue=18, seed=7)])
    assert ripe["gallery"]["neighbour_grade"] == "A" and ripe["gallery"]["learned"]["grade"] == "A"
    green = service.analyze([mango(hue=54, seed=8)])
    assert green["gallery"]["neighbour_grade"] == "REJECT" and green["gallery"]["learned"]["grade"] == "REJECT"


def test_api(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    r = c.post("/vision/analyze", files=[("files", ("a.jpg", mango(hue=18), "image/jpeg")), ("files", ("b.jpg", mango(hue=19, seed=4), "image/jpeg"))])
    assert r.status_code == 200 and r.json()["grade_hint"] == "A"
    r = c.post("/vision/gallery", files=[("files", ("a.jpg", mango(hue=18), "image/jpeg"))], data={"grade": "A", "ref": "V1"})
    assert r.status_code == 200 and r.json()["added"] == 1
    assert c.get("/vision/status").json()["photos"] == 1
    assert c.post("/vision/analyze", files=[]).status_code == 422


def test_blurry_photo_is_not_learned():
    r = service.learn([mango(hue=18, blur=6, seed=5), mango(hue=18, seed=6)], "A", "farmer_doctor", "V9")
    assert r["added"] == 1 and r["photos"] == 1


def _leaves(blur=0, dark=False):
    rng = np.random.default_rng(1)
    img = np.zeros((480, 640, 3), np.uint8)
    img[:] = (40, 70, 30)
    import cv2
    for _ in range(400):   # leaf-like green blobs with texture
        c = (int(rng.integers(0, 640)), int(rng.integers(0, 480)))
        cv2.ellipse(img, c, (int(rng.integers(8, 30)), int(rng.integers(4, 12))), int(rng.integers(0, 180)), 0, 360,
                    (int(rng.integers(20, 90)), int(rng.integers(110, 200)), int(rng.integers(20, 80))), -1)
    if dark:
        img = (img * 0.15).astype(np.uint8)
    if blur:
        img = cv2.GaussianBlur(img, (0, 0), blur)
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, "JPEG", quality=90)
    return buf.getvalue()


def test_photo_quality_gate_for_non_fruit_stages():
    from app.modules.vision.analyze import photo_quality
    sharp = photo_quality(_leaves())
    assert sharp["usable"] and sharp["vegetation_pct"] > 50
    assert "blurry" in photo_quality(_leaves(blur=5))["issues"]
    assert "too_dark" in photo_quality(_leaves(dark=True))["issues"]
    from fastapi.testclient import TestClient
    from app.main import app
    r = TestClient(app).post("/vision/photo-quality", files=[("files", ("l.jpg", _leaves(), "image/jpeg")), ("files", ("x.jpg", b"nope", "image/jpeg"))])
    assert r.status_code == 200 and r.json()["photos"][1]["issues"] == ["not_an_image"]
