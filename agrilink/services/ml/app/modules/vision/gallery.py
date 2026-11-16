"""Reference gallery of photos graded by farmer doctors, and a grader learned from it.

Every photo a farmer doctor confirms (grade A / B / REJECT) is stored as a feature vector. New photos are
compared with it (cosine similarity, k nearest neighbours): if the closest graded photos disagree with the
measured grade, or nothing similar has been seen, the result is marked for the doctor. Once there are enough
confirmed photos for at least two grades, a logistic-regression grader is trained on them and used as a
second opinion. Stored in models/ (runtime state, not committed).
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

GRADES = ("A", "B", "REJECT")
MIN_TO_TRAIN = 20          # confirmed photos before the learned grader is used
K = 5
SIMILAR = 0.90             # cosine similarity: "seen something like this before"
_lock = threading.Lock()


def _dir() -> str:
    d = os.getenv("VISION_GALLERY_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "..", "models")
    os.makedirs(d, exist_ok=True)
    return d


def _path(name: str) -> str:
    return os.path.join(_dir(), name)


def entries() -> list[dict]:
    p = _path("vision_gallery.jsonl")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf8") as f:
        return [json.loads(line) for line in f if line.strip()]


def status() -> dict:
    es = entries()
    counts = {g: sum(1 for e in es if e["grade"] == g) for g in GRADES}
    return {"photos": len(es), "by_grade": counts, "learned_grader": os.path.exists(_path("vision_grader.joblib")),
            "min_to_train": MIN_TO_TRAIN}


def add(image_sha: str, feats: list[float], grade: str, source: str, ref: str | None, measures: dict) -> dict:
    if grade not in GRADES:
        raise ValueError(f"grade must be one of {GRADES}")
    with _lock:
        es = entries()
        if any(e["sha"] == image_sha for e in es):
            return {"added": False, "reason": "already_in_gallery", **status()}
        rec = {"id": f"G{len(es) + 1:05d}", "sha": image_sha, "grade": grade, "source": source, "ref": ref,
               "features": feats, "measures": measures, "added_at": datetime.now(timezone.utc).isoformat()}
        with open(_path("vision_gallery.jsonl"), "a", encoding="utf8") as f:
            f.write(json.dumps(rec) + "\n")
        _retrain(es + [rec])
    return {"added": True, "id": rec["id"], **status()}


def _retrain(es: list[dict]) -> None:
    labels = [e["grade"] for e in es]
    if len(es) < MIN_TO_TRAIN or len(set(labels)) < 2:
        return
    X = np.array([e["features"] for e in es])
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, class_weight="balanced"))
    model.fit(X, labels)
    joblib.dump({"model": model, "trained_on": len(es), "at": datetime.now(timezone.utc).isoformat()},
                _path("vision_grader.joblib"))


def compare(feats: list[float]) -> dict:
    """Nearest confirmed photos and the learned grader's opinion for one feature vector."""
    es = entries()
    out: dict = {"gallery_size": len(es), "neighbours": [], "neighbour_grade": None, "seen_similar": None, "learned": None}
    if es:
        X = np.array([e["features"] for e in es], dtype=np.float32)
        q = np.array(feats, dtype=np.float32)
        sims = (X @ q) / (np.linalg.norm(X, axis=1) * np.linalg.norm(q) + 1e-9)
        top = np.argsort(-sims)[:K]
        out["neighbours"] = [{"id": es[i]["id"], "grade": es[i]["grade"], "similarity": round(float(sims[i]), 3)} for i in top]
        votes: dict = {}
        for i in top:
            votes[es[i]["grade"]] = votes.get(es[i]["grade"], 0) + float(sims[i])
        out["neighbour_grade"] = max(votes, key=votes.get)
        out["seen_similar"] = bool(sims[top[0]] >= SIMILAR)
    p = _path("vision_grader.joblib")
    if os.path.exists(p):
        art = joblib.load(p)
        probs = art["model"].predict_proba([feats])[0]
        classes = list(art["model"].classes_)
        best = int(np.argmax(probs))
        out["learned"] = {"grade": classes[best], "probability": round(float(probs[best]), 2), "trained_on": art["trained_on"]}
    return out


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
