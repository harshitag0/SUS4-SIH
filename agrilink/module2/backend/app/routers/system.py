"""Health, metadata, reference directory, notifications, trace, and demo controls."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from .. import clock
from ..adapters import ledger
from ..adapters.cv import PROFILES, cv_service
from ..adapters.escrow_bank import escrow_bank
from ..adapters.notify import GATEWAY
from ..adapters.risk_feed import risk_feed
from ..auth import Actor, current_actor, require
from ..config import get_settings
from ..db import get_db
from ..domain import scenario as sc
from ..domain.quality import FLAG_LABELS, SPEC
from ..errors import Forbidden, NotFound
from ..schemas import ClockAdvanceIn
from ..services import common
from ..services.scheduler import run_due_jobs
from ..util import out
from .deps import Ctx, ctx

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    db = get_db()
    db.command("ping")
    return {"status": "ok", "module": "agrilink-module2", "db": get_settings().db_name}


@router.get("/meta")
def meta(c: Ctx = Depends(ctx)):
    """Reference data for any client. No auth: contains no personal data beyond display names."""
    s = get_settings()
    return out({
        "now": c.now, "clock_simulated": clock.is_simulated(c.db), "demo_controls": s.allow_demo_controls,
        "quality_spec": SPEC.as_dict(), "flags": FLAG_LABELS,
        "risk_types": {k: {"label": v["label"], "loss": v["loss"]} for k, v in sc.RISK_TYPES.items()},
        "talukas": sorted(c.db.farmers.distinct("taluka")),
        "cv_profiles": sorted(PROFILES), "dispute_window_hours": s.dispute_window_hours,
        "adapters": {"computer_vision": cv_service.name, "risk_feed": risk_feed.name,
                     "messaging": GATEWAY, "escrow": escrow_bank.name, "trace": "local SHA-256 hash chain"},
        "actors": {
            "admin": [{"id": "OPS-1", "name": "AgriLink operations"}],
            "fpo": [{"id": f["_id"], "name": f["name"]} for f in c.db.fpos.find().sort("name")],
            "doctor": [{"id": d["_id"], "name": f"{d['name']} ({d['fpo_id']})"} for d in c.db.farmer_doctors.find().sort("name")],
            "farmer": [{"id": f["_id"], "name": f"{f['name']} · {f['village']}"} for f in c.db.farmers.find().sort("name")],
            "buyer": [{"id": b["_id"], "name": b["name"]} for b in c.db.buyers.find().sort("name")],
        },
    })


@router.get("/fpos")
def fpos(c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    rows = list(c.db.fpos.find().sort("name"))
    for f in rows:
        f["members"] = c.db.farmers.count_documents({"fpo_id": f["_id"]})
    return out(rows)


@router.get("/farmers")
def farmers(fpo_id: Optional[str] = None, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    if a.role in ("farmer", "buyer"):
        raise Forbidden("not available for this role")
    q = {"fpo_id": fpo_id} if fpo_id else {}
    if a.role == "fpo":
        q["fpo_id"] = a.id
    return out(list(c.db.farmers.find(q, {"phone": 0}).sort("name")))


@router.get("/farmers/{fid}")
def farmer_profile(fid: str, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    f = common.farmer(c.db, fid)
    if a.role == "farmer" and a.id != fid:
        raise Forbidden("you can only see your own profile")
    if a.role == "fpo" and f["fpo_id"] != a.id:
        raise Forbidden("farmer is not in your FPO")
    if a.role == "buyer":
        raise Forbidden("not available for this role")
    f.pop("phone", None)
    return out(dict(
        f, fpo=common.fpo(c.db, f["fpo_id"]),
        commitments=list(c.db.commitments.find({"farmer_id": fid}).sort("created_at", -1)),
        checks=list(c.db.quality_checks.find({"farmer_id": fid}).sort("due_at", -1).limit(10)),
        visits=list(c.db.doctor_visits.find({"farmer_id": fid}).sort("due_at", -1).limit(10)),
        reviews=list(c.db.quality_reviews.find({"farmer_id": fid}).sort("created_at", -1).limit(10)),
        interventions=list(c.db.interventions.find({"farmer_id": fid}).sort("created_at", -1)),
        ratings=list(c.db.rating_snapshots.find({"subject_type": "farmer", "subject_id": fid}, {"_id": 0}).sort("period", 1)),
    ))


@router.get("/notifications")
def notifications(to_type: Optional[str] = None, to_id: Optional[str] = None, channel: Optional[str] = None,
                  limit: int = 200, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    q = {k: v for k, v in {"to_type": to_type, "to_id": to_id, "channel": channel}.items() if v}
    if a.role != "admin":
        q.update({"to_type": a.role, "to_id": a.id})
    return out(list(c.db.notifications.find(q).sort("created_at", -1).limit(min(limit, 500))))


@router.get("/trace/lots/{lot_id}")
def trace_lot(lot_id: str, c: Ctx = Depends(ctx)):
    """Public page behind the lot QR code (buyer scan). No personal data: farmer names only."""
    lot = c.db.lots.find_one({"_id": lot_id})
    if not lot:
        raise NotFound("lot not found")
    agr = common.agreement(c.db, lot["agreement_id"])
    farmer_ids = [x["farmer_id"] for x in lot["contributions"]]
    events = list(c.db.trace_events.find({"$or": [
        {"lot_ids": lot_id},
        {"farmer_id": {"$in": farmer_ids}, "stage": {"$in": ["PHOTOS_ANALYSED", "DOCTOR_INSPECTION", "QUALITY_PASS",
                                                              "QUALITY_FAIL", "INTERVENTION_VERIFIED"]}},
        {"agreement_id": lot["agreement_id"], "stage": {"$in": ["AGREEMENT_ACTIVATED", "HANDOVER_AT_PORT",
                                                                 "RECEIVED_IN_SINGAPORE"]}}]}).sort("seq", 1))
    for e in events:
        e.pop("actor", None)
    return out({"lot": lot, "agreement": {"id": agr["_id"], "buyer": agr["buyer_name"], "crop": agr["crop"],
                                          "variety": agr["variety"], "required_grade": agr["required_grade"],
                                          "status": agr["status"]},
                "fpo": common.fpo(c.db, lot["fpo_id"])["name"], "events": events,
                "chain": ledger.verify(c.db)})


@router.get("/trace/verify")
def trace_verify(c: Ctx = Depends(ctx)):
    return ledger.verify(c.db)


# ------------------------------------------------------------- demo controls
def _demo_allowed():
    if not get_settings().allow_demo_controls:
        raise Forbidden("demo controls are disabled (M2_ALLOW_DEMO_CONTROLS=false)")


@router.get("/system/clock")
def get_clock(c: Ctx = Depends(ctx)):
    return out({"now": c.now, "simulated": clock.is_simulated(c.db)})


@router.post("/system/clock/advance")
def advance(body: ClockAdvanceIn, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    _demo_allowed()
    t = clock.advance(c.db, body.hours)
    return out({"now": t, "jobs": run_due_jobs(c.db, t)})


@router.post("/system/run-due-jobs")
def run_jobs(c: Ctx = Depends(ctx), a: Actor = Depends(require("system"))):
    return out(run_due_jobs(c.db, c.now))


@router.post("/system/reset-demo")
def reset(a: Actor = Depends(require())):
    _demo_allowed()
    from ..seed import seed
    return out(seed(get_db()))
