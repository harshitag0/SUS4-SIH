"""Diagram section 5: harvest & collection, handover at the Indian port, escrow
tranche 2 (fund, receipt, confirm, dispute, surveyor, automatic release) and
two-way reviews."""
from __future__ import annotations

from datetime import datetime, timedelta

import segno
from pymongo.database import Database

from ..adapters import ledger, notify
from ..adapters.escrow_bank import escrow_bank
from ..config import get_settings
from ..domain import escrow as esc
from ..domain.quality import GRADE_RANK, Grade, meets
from ..errors import Conflict, DomainError, Forbidden
from ..util import aware, new_id
from . import common


def _agr_for(db: Database, aid: str, *statuses: str, action: str) -> dict:
    a = common.agreement(db, aid)
    if statuses and a["status"] not in statuses:
        raise Conflict(f"cannot {action}: agreement is {a['status']}")
    return a


def _escrow(db: Database, aid: str) -> dict:
    return common.get(db, "escrow_accounts", aid, "escrow account")


def _save_escrow(db: Database, aid: str, st: dict) -> dict:
    db.escrow_accounts.update_one({"_id": aid}, {"$set": {k: v for k, v in st.items() if k != "_id"}})
    return db.escrow_accounts.find_one({"_id": aid})


def _buyer_check(actor, agr: dict) -> None:
    if actor.role == "buyer" and actor.id != agr["buyer_id"]:
        raise Forbidden("only the buyer on this agreement can do this")


# ---------------------------------------------------------------- harvest
def harvest_plan(db: Database, aid: str) -> dict:
    a = common.agreement(db, aid)
    start, end = aware(a["harvest_window"]["start"]), aware(a["harvest_window"]["end"])
    span = max((end - start).days, 0)
    cms = list(db.commitments.find({"agreement_id": aid, "status": {"$ne": "WITHDRAWN"}}).sort([("taluka", 1), ("farmer_name", 1)]))
    rows = []
    for i, c in enumerate(cms):
        eligible = c["quality_status"] == "PASS" and meets(Grade(c["final_grade"]), Grade(a["required_grade"]))
        offset = (i * 2) % (span + 1) if span else 0      # stagger pickings across the window
        rows.append({"commitment_id": c["_id"], "farmer_id": c["farmer_id"], "farmer_name": c["farmer_name"],
                     "fpo_id": c["fpo_id"], "taluka": c["taluka"], "committed_kg": c["committed_kg"],
                     "expected_kg": c["projected_kg"], "delivered_kg": c["delivered_kg"],
                     "remaining_kg": round(max(c["committed_kg"] - c["delivered_kg"], 0), 1),
                     "quality_status": c["quality_status"], "final_grade": c["final_grade"],
                     "eligible": eligible, "status": c["status"],
                     "suggested_pick_date": (start + timedelta(days=offset)).date().isoformat(),
                     "blocker": None if eligible else (
                         "No quality review yet" if not c["quality_status"] else
                         f"Latest review {c['quality_status']}: must PASS before collection")})
    return {"agreement_id": aid, "window": {"start": start, "end": end},
            "dispatch_deadline": a["dispatch_deadline"], "rows": rows,
            "eligible_kg": round(sum(r["remaining_kg"] for r in rows if r["eligible"]), 1)}


def notify_harvest(db: Database, aid: str, now: datetime, actor_id) -> dict:
    a = _agr_for(db, aid, "ACTIVE", "HARVESTING", action="send the harvest notice")
    plan = harvest_plan(db, aid)
    sent = 0
    for r in plan["rows"]:
        if r["eligible"] and r["remaining_kg"] > 0:
            f = common.farmer(db, r["farmer_id"])
            notify.to_farmer(db, now, f, "Harvest notice",
                             f"Pick {r['remaining_kg']:g} kg around {r['suggested_pick_date']} (early morning) "
                             "and bring it to your FPO collection point in crates, kept in shade.",
                             {"agreement_id": aid})
            sent += 1
    for fid in a["fpo_ids"]:
        notify.send(db, now, "fpo", fid, "app", "Harvest window open",
                    f"Order {aid}: {plan['eligible_kg']:g} kg eligible for collection.", {"agreement_id": aid})
    db.agreements.update_one({"_id": aid}, {"$set": {"status": "HARVESTING", "harvest_notified_at": now}})
    ledger.append(db, now, "HARVEST_NOTIFIED", f"Harvest notice sent to {sent} eligible farmer(s)",
                  agreement_id=aid, actor=actor_id)
    return {"sent": sent, "plan": harvest_plan(db, aid)}


def _qr_svg(lot_id: str) -> str:
    url = f"{get_settings().public_trace_base.rstrip('/')}/{lot_id}"
    return segno.make(url, error="m").svg_inline(scale=4, dark="#14203a", light="#ffffff")


def record_lot(db: Database, aid: str, fpo_id: str, contributions: list, now: datetime, actor) -> dict:
    """Record delivered quantity & quality vs contract at the FPO collection point."""
    if actor.role == "fpo" and actor.id != fpo_id:
        raise Forbidden("an FPO can only record its own lots")
    a = _agr_for(db, aid, "HARVESTING", action="record a lot (send the harvest notice first)")
    if not contributions:
        raise DomainError("a lot needs at least one farmer contribution")
    required = Grade(a["required_grade"])
    accepted, diverted, seen = [], [], set()
    for c in contributions:
        cm = db.commitments.find_one({"agreement_id": aid, "farmer_id": c["farmer_id"], "status": "ACTIVE"})
        if not cm:
            raise DomainError(f"farmer '{c['farmer_id']}' has no active commitment on {aid}")
        if cm["fpo_id"] != fpo_id:
            raise DomainError(f"{cm['farmer_name']} belongs to another FPO")
        if c["farmer_id"] in seen:
            raise DomainError(f"{cm['farmer_name']} appears twice in this lot")
        seen.add(c["farmer_id"])
        if c["kg"] <= 0:
            raise DomainError("quantities must be positive")
        if cm["quality_status"] != "PASS":
            raise DomainError(f"{cm['farmer_name']} has no passing quality review; collection is blocked")
        grade = Grade(c["grade"])
        remaining = cm["committed_kg"] - cm["delivered_kg"]
        if meets(grade, required):
            if c["kg"] > remaining * 1.1 + 0.01:
                raise DomainError(f"{cm['farmer_name']}: {c['kg']:g} kg exceeds the remaining {remaining:g} kg (+10%)")
            accepted.append({"farmer_id": cm["farmer_id"], "farmer_name": cm["farmer_name"],
                             "commitment_id": cm["_id"], "kg": float(c["kg"]), "grade": grade.value})
        else:
            diverted.append({"farmer_id": cm["farmer_id"], "farmer_name": cm["farmer_name"],
                             "commitment_id": cm["_id"], "kg": float(c["kg"]), "grade": grade.value,
                             "note": "Below contract grade: returned to the farmer for the local market"})
    if not accepted:
        raise DomainError("every contribution is below the contract grade; nothing to put in a lot")
    lot_id = new_id("LOT")
    total = round(sum(x["kg"] for x in accepted), 1)
    grade_mix = {}
    for x in accepted:
        grade_mix[x["grade"]] = round(grade_mix.get(x["grade"], 0) + x["kg"], 1)
    lot = {"_id": lot_id, "agreement_id": aid, "fpo_id": fpo_id, "contributions": accepted,
           "diverted": diverted, "total_kg": total, "grade_mix": grade_mix, "status": "COLLECTED",
           "collected_at": now, "recorded_by": actor.id, "qr_svg": _qr_svg(lot_id)}
    db.lots.insert_one(lot)
    for x in accepted:
        cm = db.commitments.find_one({"_id": x["commitment_id"]})
        delivered = round(cm["delivered_kg"] + x["kg"], 1)
        upd = {"delivered_kg": delivered, "last_delivery_at": now,
               "deliveries": cm.get("deliveries", 0) + 1,
               "deliveries_on_time": cm.get("deliveries_on_time", 0) + (1 if now <= aware(a["dispatch_deadline"]) else 0)}
        if delivered >= cm["committed_kg"] - 0.01:
            upd["status"] = "DELIVERED"
        db.commitments.update_one({"_id": cm["_id"]}, {"$set": upd})
    for x in diverted:
        db.commitments.update_one({"_id": x["commitment_id"]}, {"$inc": {"diverted_kg": x["kg"]}})
    ledger.append(db, now, "LOT_COLLECTED",
                  f"Lot {lot_id}: {total:g} kg from {len(accepted)} farmer(s) at {fpo_id}"
                  + (f"; {sum(d['kg'] for d in diverted):g} kg below grade returned" if diverted else ""),
                  agreement_id=aid, lot_ids=[lot_id], actor=actor.id,
                  data={"grade_mix": grade_mix, "contributions": [{k: x[k] for k in ("farmer_id", "kg", "grade")} for x in accepted]})
    return db.lots.find_one({"_id": lot_id})


# ---------------------------------------------------------------- dispatch & escrow
def mark_ready(db: Database, aid: str, now: datetime, actor_id) -> dict:
    a = _agr_for(db, aid, "HARVESTING", action="mark ready for dispatch")
    lots = list(db.lots.find({"agreement_id": aid, "status": "COLLECTED"}))
    if not lots:
        raise Conflict("record at least one collected lot first")
    total = round(sum(l["total_kg"] for l in lots), 1)
    e = _escrow(db, aid)
    stl = esc.settlement(a["contract_value"], a["quantity_kg"], total, e["paid_to_fpo"])
    db.agreements.update_one({"_id": aid}, {"$set": {"status": "READY_FOR_DISPATCH", "ready_at": now,
                                                     "ready_kg": total, "settlement": stl}})
    msg = (f"Order {aid}: {total:g} kg ready for export ({stl['share'] * 100:.1f}% of the order). "
           f"Payable {stl['payable_value']:,.2f} {a['currency']}; please fund {stl['tranche2_due']:,.2f} "
           f"{a['currency']} into escrow within {get_settings().funding_due_hours:g} hours.")
    if stl["advance_excess"] > 0:
        msg += f" The advance exceeds the shipped value by {stl['advance_excess']:,.2f}; it is owed back by the FPO."
    notify.send(db, now, "buyer", a["buyer_id"], "app", "Fund tranche 2 to release dispatch", msg, {"agreement_id": aid})
    ledger.append(db, now, "READY_FOR_DISPATCH", f"{total:g} kg in {len(lots)} lot(s) ready for export",
                  agreement_id=aid, lot_ids=[l["_id"] for l in lots], actor=actor_id)
    return common.agreement(db, aid)


def fund_tranche2(db: Database, aid: str, now: datetime, actor) -> dict:
    a = _agr_for(db, aid, "READY_FOR_DISPATCH", action="fund tranche 2")
    _buyer_check(actor, a)
    e = _escrow(db, aid)
    due = a["settlement"]["tranche2_due"]
    ref = escrow_bank.instruct("fund", aid, due)
    st = esc.fund_tranche2(e, now, ref, due)
    st["settlement"] = a["settlement"]
    on_time = now <= aware(a["ready_at"]) + timedelta(hours=get_settings().funding_due_hours)
    _save_escrow(db, aid, st)
    db.agreements.update_one({"_id": aid}, {"$set": {"status": "FUNDED", "funded_at": now,
                                                     "funded_on_time": on_time}})
    ledger.append(db, now, "TRANCHE2_FUNDED", f"Buyer funded tranche 2 ({due:,.2f} {a['currency']} for "
                  f"{a['settlement']['shipped_kg']:g} kg shipped)",
                  agreement_id=aid, actor=actor.id, data={"ref": ref, "on_time": on_time})
    return common.agreement(db, aid)


def handover(db: Database, aid: str, port: str, now: datetime, actor_id) -> dict:
    """Dispatch: lots handed over at the Indian port. Quality responsibility ends here."""
    a = _agr_for(db, aid, "FUNDED", action="hand over (tranche 2 must be funded first)")
    if not port.strip():
        raise DomainError("name the Indian port or airport of handover")
    lots = list(db.lots.find({"agreement_id": aid, "status": "COLLECTED"}))
    ids = [l["_id"] for l in lots]
    db.lots.update_many({"_id": {"$in": ids}}, {"$set": {"status": "HANDED_OVER", "handed_over_at": now,
                                                         "handover_port": port.strip()}})
    # Commitments not fully delivered become SHORT once the fruit has left.
    for cm in db.commitments.find({"agreement_id": aid, "status": "ACTIVE"}):
        db.commitments.update_one({"_id": cm["_id"]}, {"$set": {"status": "SHORT"}})
    db.quality_checks.update_many({"agreement_id": aid, "status": {"$in": ["DUE", "REMINDED", "RETAKE_REQUESTED"]}},
                                  {"$set": {"status": "CANCELLED", "closed_at": now}})
    db.doctor_visits.update_many({"farmer_id": {"$in": db.commitments.distinct("farmer_id", {"agreement_id": aid})},
                                  "status": "SCHEDULED", "trigger": "schedule"},
                                 {"$set": {"status": "CANCELLED", "closed_at": now}})
    total = round(sum(l["total_kg"] for l in lots), 1)
    db.agreements.update_one({"_id": aid}, {"$set": {"status": "DISPATCHED", "dispatched_at": now,
                                                     "dispatched_kg": total, "handover_port": port.strip()}})
    ledger.append(db, now, "HANDOVER_AT_PORT",
                  f"{total:g} kg handed over at {port.strip()}; AgriLink quality responsibility ends",
                  agreement_id=aid, lot_ids=ids, actor=actor_id, data={"port": port.strip()})
    notify.send(db, now, "buyer", a["buyer_id"], "app", "Goods handed over at port",
                f"Order {aid}: {total:g} kg handed over at {port.strip()}. Record receipt when it arrives.",
                {"agreement_id": aid})
    return common.agreement(db, aid)


def receive(db: Database, aid: str, now: datetime, actor) -> dict:
    a = _agr_for(db, aid, "DISPATCHED", action="record receipt")
    _buyer_check(actor, a)
    w = get_settings().dispute_window_hours
    st = esc.receive(_escrow(db, aid), now, w)
    _save_escrow(db, aid, st)
    db.lots.update_many({"agreement_id": aid, "status": "HANDED_OVER"}, {"$set": {"status": "RECEIVED", "received_at": now}})
    db.agreements.update_one({"_id": aid}, {"$set": {"status": "RECEIVED", "received_at": now}})
    ledger.append(db, now, "RECEIVED_IN_SINGAPORE", f"Buyer recorded receipt; {w:g} h dispute window open",
                  agreement_id=aid, lot_ids=db.lots.distinct("_id", {"agreement_id": aid}), actor=actor.id)
    return common.agreement(db, aid)


def _close(db: Database, aid: str, status: str, now: datetime, how: str) -> None:
    db.agreements.update_one({"_id": aid}, {"$set": {"status": status, "closed_at": now, "closed_how": how}})
    a = common.agreement(db, aid)
    for fid in a["fpo_ids"]:
        notify.send(db, now, "fpo", fid, "app", "Order closed",
                    f"Order {aid} closed ({how}). Pay your farmers by delivered quantity and grade.",
                    {"agreement_id": aid})


def confirm(db: Database, aid: str, now: datetime, actor) -> dict:
    a = _agr_for(db, aid, "RECEIVED", action="confirm")
    _buyer_check(actor, a)
    ref = escrow_bank.instruct("release", aid, 0)
    _save_escrow(db, aid, esc.confirm(_escrow(db, aid), now, ref))
    db.agreements.update_one({"_id": aid}, {"$set": {"buyer_response": "confirmed"}})
    _close(db, aid, "COMPLETE", now, "buyer confirmed origin quality")
    ledger.append(db, now, "TRANCHE2_RELEASED", "Buyer confirmed origin quality; tranche 2 released to FPO",
                  agreement_id=aid, actor=actor.id, data={"ref": ref})
    return common.agreement(db, aid)


def dispute(db: Database, aid: str, reason: str, lot_ids: list, now: datetime, actor) -> dict:
    a = _agr_for(db, aid, "RECEIVED", action="dispute")
    _buyer_check(actor, a)
    valid = set(db.lots.distinct("_id", {"agreement_id": aid}))
    if lot_ids and not set(lot_ids) <= valid:
        raise DomainError("dispute names lots that are not on this agreement")
    _save_escrow(db, aid, esc.dispute(_escrow(db, aid), now, reason))
    db.agreements.update_one({"_id": aid}, {"$set": {
        "status": "DISPUTED", "buyer_response": "disputed",
        "dispute": {"at": now, "reason": reason.strip(), "lot_ids": lot_ids or sorted(valid)}}})
    ledger.append(db, now, "DISPUTE_RAISED", f"Buyer disputed origin quality: {reason.strip()}",
                  agreement_id=aid, lot_ids=lot_ids or sorted(valid), actor=actor.id)
    notify.send(db, now, "admin", "AGRILINK-OPS", "app", "Dispute: appoint surveyor",
                f"Order {aid} disputed: {reason.strip()}", {"agreement_id": aid})
    return common.agreement(db, aid)


def surveyor(db: Database, aid: str, cause: str, surveyor_name: str, note: str, now: datetime, actor_id) -> dict:
    a = _agr_for(db, aid, "DISPUTED", action="record the surveyor decision")
    if not surveyor_name.strip():
        raise DomainError("name the surveyor")
    ref = escrow_bank.instruct("release" if cause == "transit" else "refund", aid, 0)
    st = esc.surveyor(_escrow(db, aid), now, cause, ref)
    _save_escrow(db, aid, st)
    db.agreements.update_one({"_id": aid}, {"$set": {"dispute.decision": {
        "cause": cause, "surveyor": surveyor_name.strip(), "note": note.strip(), "at": now}}})
    status = "COMPLETE" if st["status"] == "RELEASED" else "REFUNDED"
    _close(db, aid, status, now, f"surveyor: {cause.replace('_', ' ')}")
    ledger.append(db, now, "SURVEYOR_DECISION",
                  f"Surveyor {surveyor_name.strip()}: {cause.replace('_', ' ')} -> tranche 2 "
                  + ("released to FPO" if status == "COMPLETE" else "refunded to buyer"),
                  agreement_id=aid, actor=actor_id, data={"cause": cause, "ref": ref})
    return common.agreement(db, aid)


def auto_release_due(db: Database, now: datetime) -> int:
    n = 0
    for e in db.escrow_accounts.find({"status": "RECEIVED"}):
        if esc.auto_release_due(dict(e, window_ends_at=aware(e["window_ends_at"])), now):
            ref = escrow_bank.instruct("release", e["_id"], 0)
            st = esc.auto_release(dict(e, window_ends_at=aware(e["window_ends_at"])), now, ref)
            _save_escrow(db, e["_id"], st)
            db.agreements.update_one({"_id": e["_id"]}, {"$set": {"buyer_response": "none_in_window"}})
            _close(db, e["_id"], "COMPLETE", now, "no dispute within the window")
            ledger.append(db, now, "TRANCHE2_RELEASED", "No dispute within the window; tranche 2 released automatically",
                          agreement_id=e["_id"], data={"ref": ref})
            n += 1
    return n


# ---------------------------------------------------------------- reviews
def add_feedback(db: Database, aid: str, p: dict, now: datetime, actor) -> dict:
    a = _agr_for(db, aid, "COMPLETE", "REFUNDED", action="leave a review (order not closed yet)")
    stars = p["stars"]
    if not 1 <= stars <= 5:
        raise DomainError("stars must be between 1 and 5")
    if p["direction"] == "buyer_to_supply":
        _buyer_check(actor, a)
        if actor.role not in ("buyer", "admin"):
            raise Forbidden("only the buyer rates the supply")
        if db.feedback.find_one({"agreement_id": aid, "direction": "buyer_to_supply"}):
            raise Conflict("the buyer has already rated this order")
        farmer_ids = sorted({c["farmer_id"] for l in db.lots.find({"agreement_id": aid}) for c in l["contributions"]})
        doc = {"_id": new_id("FB"), "agreement_id": aid, "direction": "buyer_to_supply", "from_id": a["buyer_id"],
               "to_type": "farmers", "farmer_ids": farmer_ids, "stars": stars,
               "comment": (p.get("comment") or "").strip(), "created_at": now}
    elif p["direction"] == "farmer_to_buyer":
        if actor.role not in ("fpo", "admin"):
            raise Forbidden("farmer replies are recorded by their FPO")
        fid = p.get("farmer_id")
        cm = db.commitments.find_one({"agreement_id": aid, "farmer_id": fid})
        if not cm:
            raise DomainError("farmer was not part of this order")
        if actor.role == "fpo" and cm["fpo_id"] != actor.id:
            raise Forbidden("an FPO can only record replies from its own members")
        if db.feedback.find_one({"agreement_id": aid, "direction": "farmer_to_buyer", "from_id": fid}):
            raise Conflict("this farmer's review is already recorded")
        doc = {"_id": new_id("FB"), "agreement_id": aid, "direction": "farmer_to_buyer", "from_id": fid,
               "to_type": "buyer", "buyer_id": a["buyer_id"], "stars": stars,
               "comment": (p.get("comment") or "").strip(), "channel": p.get("channel", "sms"),
               "recorded_by": actor.id, "created_at": now}
    else:
        raise DomainError("direction must be buyer_to_supply or farmer_to_buyer")
    db.feedback.insert_one(doc)
    return doc
