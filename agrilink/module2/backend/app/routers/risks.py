"""Risk alerts, scenario lab, recommendations, supply recovery."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from ..auth import Actor, current_actor, require
from ..errors import Forbidden
from ..schemas import OfferIn, OfferResponseIn, RecoveryIn, RiskIn
from ..services import risks as svc
from ..util import out
from .deps import Ctx, ctx

router = APIRouter(tags=["risks"])


@router.get("/risks")
def list_risks(status: Optional[str] = None, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    if a.role in ("farmer", "buyer"):
        raise Forbidden("risk monitoring is for AgriLink operations and FPOs")
    q = {"status": status} if status else {}
    return out(list(c.db.risk_alerts.find(q).sort("created_at", -1)))


@router.post("/risks", status_code=201)
def create(body: RiskIn, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(svc.create_alert(c.db, body.model_dump(), c.now, "entered by AgriLink operations", a.id or "ops"))


@router.post("/risks/ingest-feed")
def ingest(c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(svc.ingest_feed(c.db, c.now))


@router.post("/risks/{rid}/scenario")
def scenario(rid: str, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(svc.run_scenario(c.db, rid, c.now))


@router.post("/risks/{rid}/recommendations")
def recommendations(rid: str, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(svc.send_recommendations(c.db, rid, c.now))


@router.post("/risks/{rid}/close")
def close(rid: str, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(svc.close_alert(c.db, rid, c.now))


@router.get("/recovery-requests")
def list_recovery(agreement_id: Optional[str] = None, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    if a.role in ("farmer", "doctor"):
        raise Forbidden("not available for this role")
    q = {"agreement_id": agreement_id} if agreement_id else {}
    rows = list(c.db.recovery_requests.find(q).sort("created_at", -1))
    if a.role == "fpo":   # an FPO sees requests where it is a candidate
        rows = [r for r in rows if any(x["fpo_id"] == a.id for x in r["candidates"])]
    if a.role == "buyer":
        own = set(c.db.agreements.distinct("_id", {"buyer_id": a.id}))
        rows = [r for r in rows if r["agreement_id"] in own]
    return out(rows)


@router.post("/recovery-requests", status_code=201)
def create_recovery(body: RecoveryIn, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(svc.create_recovery(c.db, body.agreement_id, body.alert_id, body.reason, c.now, a.id or "ops"))


@router.post("/recovery-requests/{rid}/offers")
def offer(rid: str, body: OfferIn, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(svc.make_offer(c.db, rid, body.fpo_id, body.kg, c.now))


@router.post("/recovery-requests/{rid}/offers/{fpo_id}/response")
def respond(rid: str, fpo_id: str, body: OfferResponseIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("fpo"))):
    return out(svc.respond_offer(c.db, rid, fpo_id, body.accepted, body.signed_in_person,
                                 [x.model_dump() for x in body.allocations], body.note, c.now, a))


@router.post("/recovery-requests/{rid}/close")
def close_recovery(rid: str, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(svc.close_recovery(c.db, rid, c.now))
