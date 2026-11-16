"""Diagram section 4: risk monitoring, scenario lab, recommendations, supply recovery."""
from __future__ import annotations

from datetime import datetime

from pymongo.database import Database

from ..adapters import ledger, notify
from ..adapters.risk_feed import risk_feed
from ..config import get_settings
from ..domain import ratings as rt
from ..domain import scenario as sc
from ..errors import Conflict, DomainError, Forbidden
from ..util import aware, ist, new_id
from . import common
from .agreements import add_commitment, supply_summary


# ---------------------------------------------------------------- alerts
def create_alert(db: Database, p: dict, now: datetime, source: str, actor_id) -> dict:
    if p["type"] not in sc.RISK_TYPES:
        raise DomainError("unknown risk type")
    if p["severity"] not in sc.SEVERITIES:
        raise DomainError("severity must be low, medium or high")
    known = set(db.farmers.distinct("taluka")) | set(db.fpos.distinct("taluka"))
    areas = sorted(set(p["areas"]))
    if not areas or not set(areas) <= known:
        raise DomainError("areas must be known talukas: " + ", ".join(sorted(known)))
    if aware(p["ends_at"]) < aware(p["starts_at"]):
        raise DomainError("risk period ends before it starts")
    a = {"_id": new_id("RSK"), "type": p["type"], "type_label": sc.RISK_TYPES[p["type"]]["label"],
         "weather": sc.RISK_TYPES[p["type"]]["weather"], "severity": p["severity"], "areas": areas,
         "starts_at": aware(p["starts_at"]), "ends_at": aware(p["ends_at"]),
         "summary": p.get("summary", ""), "source": source, "status": "OPEN", "scenario": None,
         "recommendations_sent_at": None, "created_at": now, "created_by": actor_id}
    db.risk_alerts.insert_one(a)
    return a


def ingest_feed(db: Database, now: datetime) -> list:
    """Pull from the (simulated) feed; skip alerts already open for the same type and area."""
    made = []
    for p in risk_feed.fetch(now):
        if db.risk_alerts.find_one({"type": p["type"], "areas": p["areas"], "status": {"$in": ["OPEN", "ASSESSED"]}}):
            continue
        made.append(create_alert(db, p, now, risk_feed.name, "feed"))
    return made


def run_scenario(db: Database, alert_id: str, now: datetime) -> dict:
    """Applied once per alert: exposed commitments get a lower projected quantity."""
    a = common.get(db, "risk_alerts", alert_id, "risk alert")
    if a["status"] != "OPEN":
        raise Conflict(f"scenario already run (alert is {a['status']})")
    agr_ids = [x["_id"] for x in db.agreements.find({"status": {"$in": list(common.MONITORED_AGREEMENT_STATUSES)}})]
    cms = list(db.commitments.find({"agreement_id": {"$in": agr_ids}, "status": "ACTIVE"}))
    orders = {x["_id"]: x["quantity_kg"] for x in db.agreements.find({"_id": {"$in": agr_ids}})}
    # Agreements are judged on all their live commitments, including delivered ones.
    for x in db.commitments.find({"agreement_id": {"$in": agr_ids}, "status": "DELIVERED"}):
        cms.append(dict(x, projected_kg=max(x["projected_kg"], x["delivered_kg"]), taluka="__delivered__"))
    res = sc.assess([{"id": c["_id"], "agreement_id": c["agreement_id"], "farmer_id": c["farmer_id"],
                      "taluka": c["taluka"], "committed_kg": c["committed_kg"], "projected_kg": c["projected_kg"]}
                     for c in cms], a["type"], a["severity"], a["areas"], orders,
                    get_settings().supply_risk_threshold)
    for e in res["exposed"]:
        lost = round(e["projected_before_kg"] - e["projected_after_kg"], 1)
        # Weather and pest shortfalls are exempt from the farmer's rating (diagram, ratings box).
        db.commitments.update_one({"_id": e["commitment_id"]}, {
            "$set": {"projected_kg": e["projected_after_kg"]},
            "$inc": {"exempt_shortfall_kg": lost},
            "$push": {"risk_exposure": {"alert_id": alert_id, "type": a["type"], "weather": a["weather"],
                                        "lost_kg": lost}}})
    names = common.names(db, "farmers", [e["farmer_id"] for e in res["exposed"]])
    for e in res["exposed"]:
        e["farmer_name"] = names.get(e["farmer_id"])
    res["supply_risk"] = any(x["supply_risk"] for x in res["agreements"])
    res["run_at"] = now
    db.risk_alerts.update_one({"_id": alert_id}, {"$set": {"scenario": res, "status": "ASSESSED"}})
    for x in res["agreements"]:
        ledger.append(db, now, "RISK_ASSESSED",
                      f"{a['type_label']} ({a['severity']}) in {', '.join(a['areas'])}: expected supply "
                      f"{x['expected_after_kg']:g} of {x['order_kg']:g} kg ({x['fill_pct']}%)",
                      agreement_id=x["agreement_id"], data={"alert_id": alert_id, "supply_risk": x["supply_risk"]})
    return db.risk_alerts.find_one({"_id": alert_id})


def send_recommendations(db: Database, alert_id: str, now: datetime) -> dict:
    a = common.get(db, "risk_alerts", alert_id, "risk alert")
    if a["status"] != "ASSESSED":
        raise Conflict("run the scenario lab before sending recommendations")
    if a.get("recommendations_sent_at"):
        raise Conflict("recommendations were already sent for this alert")
    advice = " ".join(sc.RISK_TYPES[a["type"]]["advice"])
    farmer_ids = sorted({e["farmer_id"] for e in a["scenario"]["exposed"]})
    fpo_ids = set()
    for f in db.farmers.find({"_id": {"$in": farmer_ids}}):
        notify.to_farmer(db, now, f, f"{a['type_label']} alert",
                         f"{a['type_label']} expected in {', '.join(a['areas'])} from "
                         f"{ist(a['starts_at'])}. {advice}", {"alert_id": alert_id})
        fpo_ids.add(f["fpo_id"])
    for fid in fpo_ids:
        notify.send(db, now, "fpo", fid, "whatsapp", f"{a['type_label']} alert: members affected",
                    f"Advice sent to your affected members. {advice}", {"alert_id": alert_id})
        d = db.farmer_doctors.find_one({"fpo_id": fid, "active": True})
        if d:
            notify.send(db, now, "doctor", d["_id"], "app", f"{a['type_label']} alert",
                        f"Check affected members after the event. {advice}", {"alert_id": alert_id})
    db.risk_alerts.update_one({"_id": alert_id}, {"$set": {
        "recommendations_sent_at": now, "recommendations_to": {"farmers": len(farmer_ids), "fpos": len(fpo_ids)}}})
    return db.risk_alerts.find_one({"_id": alert_id})


def close_alert(db: Database, alert_id: str, now: datetime) -> dict:
    a = common.get(db, "risk_alerts", alert_id, "risk alert")
    if a["status"] == "CLOSED":
        raise Conflict("alert is already closed")
    db.risk_alerts.update_one({"_id": alert_id}, {"$set": {"status": "CLOSED", "closed_at": now}})
    return db.risk_alerts.find_one({"_id": alert_id})


# ---------------------------------------------------------------- recovery
def _fpo_rating(db: Database, fpo_id: str) -> tuple:
    """FPO score = mean of its members' latest farmer ratings; 'new' if members lack history."""
    snaps = list(db.rating_snapshots.aggregate([
        {"$match": {"subject_type": "farmer", "fpo_id": fpo_id}},
        {"$sort": {"period": -1}},
        {"$group": {"_id": "$subject_id", "rating": {"$first": "$rating"}, "cycles": {"$first": "$cycles"}}}]))
    if not snaps:
        return rt.NEUTRAL_START, 0
    return (round(sum(s["rating"] for s in snaps) / len(snaps), 1),
            min(s["cycles"] for s in snaps))


def create_recovery(db: Database, agreement_id: str, alert_id, reason: str, now: datetime, actor_id) -> dict:
    agr = common.agreement(db, agreement_id)
    if agr["status"] not in common.MONITORED_AGREEMENT_STATUSES:
        raise Conflict(f"agreement is {agr['status']}; supply can no longer be recovered")
    if db.recovery_requests.find_one({"agreement_id": agreement_id, "status": {"$in": ["OPEN", "PARTIAL"]}}):
        raise Conflict("a recovery request is already open for this agreement")
    sup = supply_summary(db, agr)
    shortfall = round(agr["quantity_kg"] - sup["expected_kg"], 1)
    if shortfall <= 0:
        raise Conflict("expected supply already covers the order; nothing to recover")
    affected = []
    if alert_id:
        al = common.get(db, "risk_alerts", alert_id, "risk alert")
        affected = al["areas"]
    s = get_settings()
    live = rt.ranking_live(s.pilot_start, now.date())
    pool = []
    for f in db.fpos.find({"taluka": {"$nin": affected}, "spare_capacity_kg": {"$gt": 0}}):
        score, cycles = _fpo_rating(db, f["_id"])
        pool.append({"fpo_id": f["_id"], "name": f["name"], "taluka": f["taluka"],
                     "spare_capacity_kg": f["spare_capacity_kg"], "capacity_posted_at": f["capacity_posted_at"],
                     "rating": score, "rating_cycles": cycles,
                     "is_new": f.get("newly_formed", False) or cycles < rt.NEW_THRESHOLD_CYCLES})
    ordered = rt.order_candidates(pool, live, booked=lambda c: aware(c["capacity_posted_at"]),
                                  score=lambda c: c["rating"], is_new=lambda c: c["is_new"],
                                  reserve_share=s.reserve_new_share)
    cands = [dict(c, rank=i + 1, reason=why) for i, (c, why) in enumerate(ordered)]
    req = {"_id": new_id("REC"), "agreement_id": agreement_id, "alert_id": alert_id, "reason": reason,
           "affected_areas": affected, "shortfall_kg": shortfall, "filled_kg": 0.0,
           "ranking_mode": "rating" if live else "first_come_first_served",
           "candidates": cands, "offers": [], "status": "OPEN", "created_at": now, "created_by": actor_id}
    if not cands:
        req["status"] = "UNFILLED"
    db.recovery_requests.insert_one(req)
    ledger.append(db, now, "RECOVERY_OPENED", f"Supply recovery opened for {shortfall:g} kg shortfall",
                  agreement_id=agreement_id, data={"request_id": req["_id"], "candidates": len(cands)})
    return req


def make_offer(db: Database, req_id: str, fpo_id: str, kg: float, now: datetime) -> dict:
    r = common.get(db, "recovery_requests", req_id, "recovery request")
    if r["status"] not in ("OPEN", "PARTIAL"):
        raise Conflict(f"recovery request is {r['status']}")
    cand = next((c for c in r["candidates"] if c["fpo_id"] == fpo_id), None)
    if not cand:
        raise DomainError("FPO is not a candidate for this recovery")
    if any(o["fpo_id"] == fpo_id and o["status"] == "OFFERED" for o in r["offers"]):
        raise Conflict("an offer to this FPO is already waiting for a reply")
    remaining = round(r["shortfall_kg"] - r["filled_kg"] - sum(o["kg"] for o in r["offers"] if o["status"] == "OFFERED"), 1)
    if kg <= 0 or kg > remaining:
        raise DomainError(f"offer between 1 and {remaining:g} kg")
    f = common.fpo(db, fpo_id)
    if kg > f["spare_capacity_kg"]:
        raise DomainError(f"{f['name']} has only {f['spare_capacity_kg']:g} kg spare capacity")
    db.recovery_requests.update_one({"_id": req_id}, {"$push": {"offers": {
        "fpo_id": fpo_id, "fpo_name": f["name"], "kg": float(kg), "status": "OFFERED", "offered_at": now}}})
    agr = common.agreement(db, r["agreement_id"])
    notify.send(db, now, "fpo", fpo_id, "sms", "Supply offer",
                f"AgriLink offers {kg:g} kg of grade {agr['required_grade']}+ Alphonso for order {agr['_id']}. "
                "Brief your farmers and record paper signatures to accept.", {"request_id": req_id})
    return db.recovery_requests.find_one({"_id": req_id})


def respond_offer(db: Database, req_id: str, fpo_id: str, accepted: bool, signed_in_person: bool,
                  allocations: list, note: str, now: datetime, actor) -> dict:
    if actor.role == "fpo" and actor.id != fpo_id:
        raise Forbidden("an FPO can only answer its own offers")
    r = common.get(db, "recovery_requests", req_id, "recovery request")
    idx = next((i for i, o in enumerate(r["offers"]) if o["fpo_id"] == fpo_id and o["status"] == "OFFERED"), None)
    if idx is None:
        raise Conflict("no open offer for this FPO")
    offer = r["offers"][idx]
    key = f"offers.{idx}"
    if not accepted:
        db.recovery_requests.update_one({"_id": req_id}, {"$set": {
            f"{key}.status": "DECLINED", f"{key}.responded_at": now, f"{key}.note": note}})
        return db.recovery_requests.find_one({"_id": req_id})
    if not signed_in_person:
        raise DomainError("acceptance needs the farmers' paper signatures collected in person")
    total = round(sum(a["kg"] for a in allocations), 1)
    if not allocations or total != round(offer["kg"], 1):
        raise DomainError(f"farmer allocations must add up to the offered {offer['kg']:g} kg")
    agr = common.agreement(db, r["agreement_id"])
    farmers = []
    for a in allocations:
        f = common.farmer(db, a["farmer_id"])
        if f["fpo_id"] != fpo_id:
            raise DomainError(f"{f['name']} is not a member of this FPO")
        if a["kg"] <= 0:
            raise DomainError("each allocation must be positive")
        if db.commitments.find_one({"agreement_id": agr["_id"], "farmer_id": f["_id"], "status": "ACTIVE"}):
            raise DomainError(f"{f['name']} already has an active commitment on this agreement")
        farmers.append((f, a["kg"]))
    for f, kg in farmers:
        add_commitment(db, agr, f, kg, now, source="recovery", signed_on=now.date(), recovery_request_id=req_id)
    filled = round(r["filled_kg"] + offer["kg"], 1)
    status = "FILLED" if filled >= r["shortfall_kg"] else "PARTIAL"
    db.recovery_requests.update_one({"_id": req_id}, {"$set": {
        f"{key}.status": "ACCEPTED_SIGNED", f"{key}.responded_at": now, f"{key}.note": note,
        f"{key}.allocations": allocations, "filled_kg": filled, "status": status}})
    db.fpos.update_one({"_id": fpo_id}, {"$inc": {"spare_capacity_kg": -offer["kg"]}})
    db.agreements.update_one({"_id": agr["_id"]}, {
        "$addToSet": {"fpo_ids": fpo_id},
        "$push": {"revisions": {"at": now, "type": "supply_recovery", "request_id": req_id,
                                "fpo_id": fpo_id, "added_kg": offer["kg"], "farmers": len(farmers)}}})
    ledger.append(db, now, "AGREEMENT_REVISED",
                  f"{offer['fpo_name']} added {offer['kg']:g} kg from {len(farmers)} farmer(s), signed in person",
                  agreement_id=agr["_id"], actor=actor.id, data={"request_id": req_id, "fpo_id": fpo_id})
    notify.send(db, now, "buyer", agr["buyer_id"], "app", "Supply plan updated",
                f"Order {agr['_id']}: {offer['kg']:g} kg added from {offer['fpo_name']} to cover a forecast shortfall.",
                {"agreement_id": agr["_id"]})
    return db.recovery_requests.find_one({"_id": req_id})


def close_recovery(db: Database, req_id: str, now: datetime) -> dict:
    r = common.get(db, "recovery_requests", req_id, "recovery request")
    if r["status"] in ("FILLED", "CLOSED"):
        raise Conflict(f"recovery request is {r['status']}")
    db.recovery_requests.update_one({"_id": req_id}, {"$set": {"status": "CLOSED", "closed_at": now}})
    return db.recovery_requests.find_one({"_id": req_id})
