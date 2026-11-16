"""Agreement intake from Module 1, supply view, and commitment withdrawal."""
from __future__ import annotations

from datetime import datetime, time, timezone

from pymongo.database import Database

from ..adapters import ledger, notify
from ..domain import escrow as esc
from ..domain.quality import Grade
from ..errors import Conflict, DomainError
from ..util import new_id
from . import common
from .quality import create_check


def _dt(d) -> datetime:
    return datetime.combine(d, time(0, 0), tzinfo=timezone.utc)


def intake(db: Database, p: dict, now: datetime, actor: str) -> dict:
    """Receive an activated agreement from Module 1 (Section entry of the diagram)."""
    if db.agreements.find_one({"_id": p["id"]}):
        raise Conflict(f"agreement '{p['id']}' was already received")
    buyer = common.get(db, "buyers", p["buyer_id"], "buyer")
    if p["harvest_window_start"] > p["harvest_window_end"]:
        raise DomainError("harvest window start must be on or before its end")
    if p["dispatch_deadline"] < p["harvest_window_start"]:
        raise DomainError("dispatch deadline cannot be before the harvest window starts")
    if not p["commitments"]:
        raise DomainError("an agreement needs at least one signed farmer commitment")
    seen = set()
    farmers = {}
    for c in p["commitments"]:
        if c["farmer_id"] in seen:
            raise DomainError(f"farmer '{c['farmer_id']}' appears twice")
        seen.add(c["farmer_id"])
        f = common.farmer(db, c["farmer_id"])
        if not c.get("signed_in_person", True):
            raise DomainError(f"commitment for '{f['_id']}' is not signed; FPO-led paper signing is required")
        farmers[f["_id"]] = f
    total = sum(c["committed_kg"] for c in p["commitments"])

    agr = {
        "_id": p["id"], "buyer_id": buyer["_id"], "buyer_name": buyer["name"],
        "crop": p.get("crop", "Alphonso mango"), "variety": p.get("variety", "Alphonso (Hapus)"),
        "quantity_kg": p["quantity_kg"], "required_grade": Grade(p["required_grade"]).value,
        "harvest_window": {"start": _dt(p["harvest_window_start"]), "end": _dt(p["harvest_window_end"])},
        "dispatch_deadline": _dt(p["dispatch_deadline"]),
        "contract_value": p["contract_value"], "currency": p.get("currency", "SGD"),
        "status": "ACTIVE", "fpo_ids": sorted({f["fpo_id"] for f in farmers.values()}),
        "revisions": [], "source": p.get("source", "module1"),
        "committed_at_intake_kg": total, "activated_at": now,
    }
    db.agreements.insert_one(agr)
    db.escrow_accounts.insert_one(dict(esc.initial(p["contract_value"], p.get("tranche1_released", True), now),
                                       _id=agr["_id"], currency=agr["currency"],
                                       provider="SIMULATED escrow (CIMB terms not confirmed)"))
    for c in p["commitments"]:
        f = farmers[c["farmer_id"]]
        cm = add_commitment(db, agr, f, c["committed_kg"], now, source=agr["source"],
                            signed_on=c.get("signed_on"))
        notify.to_farmer(db, now, f, "Agreement active",
                         f"Your signed commitment of {c['committed_kg']:g} kg Alphonso for order {agr['_id']} is active. "
                         "You will get photo prompts in the AgriLink app.", {"agreement_id": agr["_id"],
                                                                              "commitment_id": cm["_id"]})
    for fid in agr["fpo_ids"]:
        notify.send(db, now, "fpo", fid, "app", "Agreement handed to Module 2",
                    f"Order {agr['_id']} ({agr['quantity_kg']:g} kg, grade {agr['required_grade']}+) is now monitored.",
                    {"agreement_id": agr["_id"]})
    ledger.append(db, now, "AGREEMENT_ACTIVATED",
                  f"Agreement {agr['_id']} received from Module 1: {agr['quantity_kg']:g} kg, "
                  f"{len(p['commitments'])} signed farmer commitments",
                  agreement_id=agr["_id"], actor=actor,
                  data={"buyer_id": buyer["_id"], "quantity_kg": agr["quantity_kg"],
                        "required_grade": agr["required_grade"], "committed_kg": total})
    return agr


def add_commitment(db: Database, agr: dict, farmer: dict, kg: float, now: datetime, source: str,
                   signed_on=None, recovery_request_id=None) -> dict:
    cm = {
        "_id": new_id("CMT"), "agreement_id": agr["_id"], "farmer_id": farmer["_id"],
        "farmer_name": farmer["name"], "fpo_id": farmer["fpo_id"], "taluka": farmer["taluka"],
        "committed_kg": float(kg), "projected_kg": float(kg), "delivered_kg": 0.0, "diverted_kg": 0.0,
        "exempt_shortfall_kg": 0.0, "status": "ACTIVE", "quality_status": None, "final_grade": None,
        "provisional_grade": None, "source": source, "recovery_request_id": recovery_request_id,
        "signed_on": str(signed_on) if signed_on else None, "created_at": now,
    }
    db.commitments.insert_one(cm)
    create_check(db, cm, now, now, trigger="agreement_start")
    return cm


def supply_summary(db: Database, agr: dict) -> dict:
    cms = list(db.commitments.find({"agreement_id": agr["_id"]}))
    live = [c for c in cms if c["status"] != "WITHDRAWN"]
    q = {"PASS": 0, "FAIL": 0, "PENDING_DOCTOR": 0, "RETAKE_PHOTO": 0, "NONE": 0}
    for c in live:
        q[c.get("quality_status") or "NONE"] += 1
    delivered = sum(c["delivered_kg"] for c in cms)
    # Once fruit has left (DELIVERED / SHORT) the expectation is what was actually delivered.
    expected = sum(c["delivered_kg"] if c["status"] in ("DELIVERED", "SHORT") else max(c["projected_kg"], c["delivered_kg"])
                   for c in live)
    return {
        "order_kg": agr["quantity_kg"],
        "committed_kg": round(sum(c["committed_kg"] for c in live), 1),
        "expected_kg": round(expected, 1),
        "delivered_kg": round(delivered, 1),
        "fill_expected_pct": round(100 * expected / agr["quantity_kg"], 1) if agr["quantity_kg"] else 0,
        "fill_delivered_pct": round(100 * delivered / agr["quantity_kg"], 1) if agr["quantity_kg"] else 0,
        "farmers": len(live), "withdrawn": len(cms) - len(live), "quality": q,
        "open_checks": db.quality_checks.count_documents(
            {"agreement_id": agr["_id"], "status": {"$in": ["DUE", "REMINDED", "RETAKE_REQUESTED"]}}),
        "missed_checks": db.quality_checks.count_documents({"agreement_id": agr["_id"], "status": "MISSED"}),
        "open_interventions": db.interventions.count_documents(
            {"agreement_id": agr["_id"], "status": {"$in": ["OPEN", "IN_PROGRESS"]}}),
    }


def list_agreements(db: Database, status: str | None = None) -> list:
    q = {"status": status} if status else {}
    res = []
    for a in db.agreements.find(q).sort("harvest_window.start", 1):
        e = db.escrow_accounts.find_one({"_id": a["_id"]}, {"status": 1, "paid_to_fpo": 1, "held": 1})
        res.append(dict(a, supply=supply_summary(db, a), escrow_status=(e or {}).get("status")))
    return res


def detail(db: Database, aid: str) -> dict:
    a = common.agreement(db, aid)
    cms = list(db.commitments.find({"agreement_id": aid}).sort("farmer_name", 1))
    fpo_names = common.names(db, "fpos", [c["fpo_id"] for c in cms] + a["fpo_ids"])
    for c in cms:
        c["fpo_name"] = fpo_names.get(c["fpo_id"])
        last = db.quality_reviews.find_one({"commitment_id": c["_id"]}, sort=[("created_at", -1)])
        c["last_review"] = {"status": last["status"], "final_grade": last.get("final_grade"),
                            "provisional_grade": last.get("provisional_grade"), "at": last["created_at"]} if last else None
    return dict(a, supply=supply_summary(db, a), commitments=cms,
                fpos=[{"id": k, "name": v} for k, v in fpo_names.items() if k in a["fpo_ids"]],
                escrow=db.escrow_accounts.find_one({"_id": aid}),
                lots=list(db.lots.find({"agreement_id": aid}).sort("collected_at", 1)),
                recovery_requests=list(db.recovery_requests.find({"agreement_id": aid}).sort("created_at", -1)),
                feedback=list(db.feedback.find({"agreement_id": aid}).sort("created_at", 1)))


def withdraw_commitment(db: Database, cid: str, reason: str, now: datetime, actor) -> dict:
    """A signed farmer backs out (e.g. sells locally). Not weather-exempt."""
    c = common.commitment(db, cid)
    if actor.role == "fpo" and actor.id != c["fpo_id"]:
        from ..errors import Forbidden
        raise Forbidden("an FPO can only withdraw its own members' commitments")
    if c["status"] != "ACTIVE":
        raise Conflict(f"commitment is {c['status']}, not ACTIVE")
    if c["delivered_kg"] > 0:
        raise Conflict("fruit was already delivered against this commitment")
    if not reason.strip():
        raise DomainError("a withdrawal needs a reason")
    db.commitments.update_one({"_id": cid}, {"$set": {
        "status": "WITHDRAWN", "projected_kg": 0.0,
        "withdrawal": {"reason": reason.strip(), "at": now, "recorded_by": actor.id}}})
    db.quality_checks.update_many({"commitment_id": cid, "status": {"$in": ["DUE", "REMINDED", "RETAKE_REQUESTED"]}},
                                  {"$set": {"status": "CANCELLED", "closed_at": now}})
    ledger.append(db, now, "COMMITMENT_WITHDRAWN",
                  f"{c['farmer_name']} withdrew {c['committed_kg']:g} kg: {reason.strip()}",
                  agreement_id=c["agreement_id"], farmer_id=c["farmer_id"], actor=actor.id)
    agr = common.agreement(db, c["agreement_id"])
    return {"commitment_id": cid, "supply": supply_summary(db, agr)}
