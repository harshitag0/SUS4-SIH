"""Monthly ratings: run, read, and the ranking status consumed by Module 1."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends

from ..auth import Actor, current_actor, require
from ..errors import Forbidden
from ..schemas import RatingsRunIn
from ..services import ratings as svc
from ..util import out
from .deps import Ctx, ctx

router = APIRouter(tags=["ratings"])


@router.post("/ratings/run")
def run(body: RatingsRunIn, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(svc.run_month(c.db, body.period, c.now))


@router.get("/ratings/status")
def status(c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    return out(svc.ranking_status(c.now))


@router.get("/ratings/{subject_type}")
def current(subject_type: Literal["farmer", "buyer"], c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    rows = svc.current(c.db, subject_type)
    if a.role == "farmer":                       # a farmer sees only their own rating
        rows = [r for r in rows if r["subject_id"] == a.id]
    elif a.role == "buyer":                      # a buyer sees only its own rating
        if subject_type == "farmer":
            raise Forbidden("buyers see supply ratings through Module 1 ranking")
        rows = [r for r in rows if r["subject_id"] == a.id]
    elif a.role in ("fpo", "doctor") and subject_type == "farmer":   # own FPO's members
        fpo_id = a.id if a.role == "fpo" else c.db.farmer_doctors.find_one({"_id": a.id}, {"fpo_id": 1})["fpo_id"]
        rows = [r for r in rows if r.get("fpo_id") == fpo_id]
    return out(rows)


@router.get("/ratings/{subject_type}/{subject_id}/history")
def history(subject_type: Literal["farmer", "buyer"], subject_id: str, c: Ctx = Depends(ctx),
            a: Actor = Depends(current_actor)):
    if a.role in ("farmer", "buyer") and a.id != subject_id:
        raise Forbidden("you can only see your own rating history")
    return out(svc.history(c.db, subject_type, subject_id))
