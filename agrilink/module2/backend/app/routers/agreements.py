"""Agreements (intake from Module 1), supply view, harvest, lots, dispatch, escrow, reviews."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from ..auth import Actor, current_actor, require
from ..errors import Forbidden
from ..schemas import (AgreementIntake, DisputeIn, FeedbackIn, HandoverIn, LotIn, SurveyorIn,
                       WithdrawIn)
from ..services import agreements as svc
from ..services import common, delivery
from ..util import out
from .deps import Ctx, ctx

router = APIRouter(tags=["agreements"])


def _can_see(actor: Actor, agr: dict) -> None:
    if actor.role == "buyer" and agr["buyer_id"] != actor.id:
        raise Forbidden("buyers can only see their own agreements")
    if actor.role == "fpo" and actor.id not in agr["fpo_ids"]:
        raise Forbidden("this agreement does not involve your FPO")
    if actor.role == "farmer":
        raise Forbidden("farmers use the farmer view")


@router.post("/agreements", status_code=201, summary="Receive an activated agreement from Module 1")
def intake(body: AgreementIntake, c: Ctx = Depends(ctx), a: Actor = Depends(require("system"))):
    return out(svc.intake(c.db, body.model_dump(), c.now, a.id or a.role))


@router.get("/agreements")
def list_agreements(status: Optional[str] = None, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    rows = svc.list_agreements(c.db, status)
    if a.role == "buyer":
        rows = [r for r in rows if r["buyer_id"] == a.id]
    elif a.role == "fpo":
        rows = [r for r in rows if a.id in r["fpo_ids"]]
    elif a.role == "farmer":
        raise Forbidden("farmers use the farmer view")
    return out(rows)


@router.get("/agreements/{aid}")
def get_agreement(aid: str, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    d = svc.detail(c.db, aid)
    _can_see(a, d)
    return out(d)


@router.get("/agreements/{aid}/timeline")
def timeline(aid: str, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    agr = common.agreement(c.db, aid)
    _can_see(a, agr)
    farmer_ids = c.db.commitments.distinct("farmer_id", {"agreement_id": aid})
    ev = c.db.trace_events.find({"$or": [{"agreement_id": aid},
                                         {"agreement_id": None, "farmer_id": {"$in": farmer_ids}}]}).sort("seq", -1)
    return out(list(ev))


@router.post("/commitments/{cid}/withdraw")
def withdraw(cid: str, body: WithdrawIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("fpo"))):
    return out(svc.withdraw_commitment(c.db, cid, body.reason, c.now, a))


@router.get("/agreements/{aid}/harvest-plan")
def harvest_plan(aid: str, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    _can_see(a, common.agreement(c.db, aid))
    return out(delivery.harvest_plan(c.db, aid))


@router.post("/agreements/{aid}/harvest-notice")
def harvest_notice(aid: str, c: Ctx = Depends(ctx), a: Actor = Depends(require("fpo"))):
    _can_see(a, common.agreement(c.db, aid))
    return out(delivery.notify_harvest(c.db, aid, c.now, a.id))


@router.post("/agreements/{aid}/lots", status_code=201)
def record_lot(aid: str, body: LotIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("fpo"))):
    return out(delivery.record_lot(c.db, aid, body.fpo_id, [x.model_dump() for x in body.contributions], c.now, a))


@router.post("/agreements/{aid}/ready-for-dispatch")
def ready(aid: str, c: Ctx = Depends(ctx), a: Actor = Depends(require("fpo"))):
    _can_see(a, common.agreement(c.db, aid))
    return out(delivery.mark_ready(c.db, aid, c.now, a.id))


@router.post("/agreements/{aid}/escrow/fund")
def fund(aid: str, c: Ctx = Depends(ctx), a: Actor = Depends(require("buyer"))):
    return out(delivery.fund_tranche2(c.db, aid, c.now, a))


@router.post("/agreements/{aid}/handover")
def handover(aid: str, body: HandoverIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("fpo"))):
    _can_see(a, common.agreement(c.db, aid))
    return out(delivery.handover(c.db, aid, body.port, c.now, a.id))


@router.post("/agreements/{aid}/receipt")
def receipt(aid: str, c: Ctx = Depends(ctx), a: Actor = Depends(require("buyer"))):
    return out(delivery.receive(c.db, aid, c.now, a))


@router.post("/agreements/{aid}/confirm")
def confirm(aid: str, c: Ctx = Depends(ctx), a: Actor = Depends(require("buyer"))):
    return out(delivery.confirm(c.db, aid, c.now, a))


@router.post("/agreements/{aid}/dispute")
def dispute(aid: str, body: DisputeIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("buyer"))):
    return out(delivery.dispute(c.db, aid, body.reason, body.lot_ids, c.now, a))


@router.post("/agreements/{aid}/surveyor-decision")
def surveyor(aid: str, body: SurveyorIn, c: Ctx = Depends(ctx), a: Actor = Depends(require())):
    return out(delivery.surveyor(c.db, aid, body.cause, body.surveyor, body.note, c.now, a.id or "ops"))


@router.get("/agreements/{aid}/escrow")
def escrow(aid: str, c: Ctx = Depends(ctx), a: Actor = Depends(current_actor)):
    _can_see(a, common.agreement(c.db, aid))
    return out(common.get(c.db, "escrow_accounts", aid, "escrow account"))


@router.post("/agreements/{aid}/feedback", status_code=201)
def feedback(aid: str, body: FeedbackIn, c: Ctx = Depends(ctx), a: Actor = Depends(require("buyer", "fpo"))):
    return out(delivery.add_feedback(c.db, aid, body.model_dump(), c.now, a))
