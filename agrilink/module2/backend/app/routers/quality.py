"""Quality checks & photos, farmer view, farmer doctor visits, reviews, interventions."""
from __future__ import annotations

import os
from datetime import timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse

from ..auth import Actor, current_actor, require
from ..config import get_settings
from ..errors import DomainError, Forbidden, NotFound
from ..schemas import ActionIn, FindingIn, VerifyIn, VisitIn
from ..services import common
from ..services import quality as svc
from ..util import aware, out
from .deps import Ctx, ctx

router = APIRouter(tags=["quality"])


def _scope(a: Actor, q: dict, db) -> dict:
    """Restrict a query to what the caller may see."""
    if a.role == "farmer":
        q["farmer_id"] = a.id
    elif a.role == "fpo":
        q["fpo_id"] = a.id
    elif a.role == "doctor":
        d = common.get(db, "farmer_doctors", a.id, "farmer doctor")
        q["fpo_id"] = d["fpo_id"]
    elif a.role == "buyer":
        raise Forbidden("buyers see quality through the agreement record")
    return q


@router.get("/quality-checks")
def list_checks(status: Optional[str] = None, fpo_id: Optional[str] = None, agreement_id: Optional[str] = None,
                farmer_id: Optional[str] = None, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    q = {k: v for k, v in {"status": status, "fpo_id": fpo_id, "agreement_id": agreement_id,
                           "farmer_id": farmer_id}.items() if v}
    return out(list(c.db.quality_checks.find(_scope(a, q, c.db)).sort("due_at", -1).limit(500)))


@router.post("/quality-checks/{check_id}/photos")
async def upload(check_id: str, photos: List[UploadFile] = File(...),
                 simulation_profile: Optional[str] = Form(default=None),
                 c: Ctx = Depends(ctx), a: Actor = Depends(require("farmer"))):
    data = [await p.read() for p in photos]
    res = svc.upload_photos(c.db, check_id, data, simulation_profile or None, c.now, a)
    return out(res)


@router.get("/photos/{name}")
def photo(name: str):
    if "/" in name or ".." in name:
        raise DomainError("bad file name")
    path = os.path.join(get_settings().upload_dir, name)
    if not os.path.isfile(path):
        raise NotFound("photo not found")
    return FileResponse(path)


@router.get("/farmer-view")
def farmer_view(c: Ctx = Depends(ctx), a: Actor = Depends(require("farmer"))):
    """What a farmer sees: only photo prompts and the outcome of their own uploads."""
    if a.role != "farmer":
        raise Forbidden("farmer view is for farmers")
    f = common.farmer(c.db, a.id)
    open_checks = list(c.db.quality_checks.find({"farmer_id": a.id, "status": {"$in": svc.OPEN_CHECK}}).sort("due_at", 1))
    recent = list(c.db.quality_checks.find({"farmer_id": a.id, "status": {"$nin": svc.OPEN_CHECK}}).sort("due_at", -1).limit(5))
    msgs = list(c.db.notifications.find({"to_type": "farmer", "to_id": a.id, "channel": {"$ne": "app"}}).sort("created_at", -1).limit(8))
    return out({
        "farmer": {"id": f["_id"], "name": f["name"], "village": f.get("village"), "language": f.get("language")},
        "prompts": [{"check_id": x["_id"], "due_at": x["due_at"], "deadline": x["deadline"], "status": x["status"],
                     "is_retake": x["status"] == "RETAKE_REQUESTED", "reminders": len(x["reminders"])} for x in open_checks],
        "recent": [{"check_id": x["_id"], "status": x["status"], "uploaded_at": x.get("uploaded_at"),
                    "photos": len(x["photos"])} for x in recent],
        "messages": [{"at": m["created_at"], "channel": m["channel"], "subject": m["subject"], "body": m["body"]} for m in msgs],
    })


@router.get("/doctor-visits")
def list_visits(status: Optional[str] = None, doctor_id: Optional[str] = None, farmer_id: Optional[str] = None,
                c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    q = {k: v for k, v in {"status": status, "doctor_id": doctor_id, "farmer_id": farmer_id}.items() if v}
    if a.role == "doctor":
        q["doctor_id"] = a.id
    elif a.role != "admin":
        _scope(a, q, c.db)
    return out(list(c.db.doctor_visits.find(q).sort([("status", -1), ("priority", -1), ("due_at", 1)]).limit(500)))


@router.post("/doctor-visits", status_code=201)
def schedule(body: VisitIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("fpo", "doctor"))):
    f = common.farmer(c.db, body.farmer_id)
    if a.role == "fpo" and f["fpo_id"] != a.id:
        raise Forbidden("farmer is not a member of your FPO")
    if a.role == "doctor" and common.get(c.db, "farmer_doctors", a.id, "farmer doctor")["fpo_id"] != f["fpo_id"]:
        raise Forbidden("farmer is not in your FPO")
    due = aware(body.due_at) if body.due_at else c.now
    if due < c.now - timedelta(hours=1):
        raise DomainError("a visit cannot be scheduled in the past")
    return out(svc.schedule_visit(c.db, f, due, c.now, trigger="manual", note=body.note, priority=False))


@router.post("/doctor-visits/{vid}/complete")
def complete(vid: str, body: FindingIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("doctor"))):
    return out(svc.complete_visit(c.db, vid, body.model_dump(), c.now, a))


@router.get("/quality-reviews")
def list_reviews(status: Optional[str] = None, farmer_id: Optional[str] = None, agreement_id: Optional[str] = None,
                 disagree: Optional[bool] = None, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    q = {k: v for k, v in {"status": status, "farmer_id": farmer_id, "agreement_id": agreement_id}.items() if v}
    if disagree is not None:
        q["disagree"] = disagree
    return out(list(c.db.quality_reviews.find(_scope(a, q, c.db)).sort("created_at", -1).limit(300)))


@router.get("/interventions")
def list_interventions(status: Optional[str] = None, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    q = {"status": status} if status else {}
    return out(list(c.db.interventions.find(_scope(a, q, c.db)).sort("created_at", -1)))


@router.post("/interventions/{iid}/actions")
def add_action(iid: str, body: ActionIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("fpo", "doctor"))):
    return out(svc.add_action(c.db, iid, body.note, c.now, a))


@router.post("/interventions/{iid}/verify")
def verify(iid: str, body: VerifyIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("doctor"))):
    return out(svc.verify_intervention(c.db, iid, body.effective, body.note, c.now, a))
