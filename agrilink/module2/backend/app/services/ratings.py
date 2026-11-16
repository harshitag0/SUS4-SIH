"""Monthly ratings (diagram: "Update Ratings (Monthly)").

Every input is counted from records Module 2 keeps; nothing is typed in by
hand. Ratings are recorded from day one and drive ranking only after the
6-month pilot (Module 1 and supply recovery read them).
"""
from __future__ import annotations

import calendar
from datetime import datetime, timezone

from pymongo.database import Database

from ..config import get_settings
from ..domain import ratings as rt
from ..errors import DomainError
from ..util import aware


def _bounds(period: str) -> tuple:
    try:
        y, m = (int(x) for x in period.split("-"))
        start = datetime(y, m, 1, tzinfo=timezone.utc)
        end = datetime(y, m, calendar.monthrange(y, m)[1], 23, 59, 59, 999000, tzinfo=timezone.utc)
    except (ValueError, TypeError):
        raise DomainError("period must look like 2027-04")
    return start, end


def _in(t, start, end) -> bool:
    return t is not None and start <= aware(t) <= end


def farmer_month(db: Database, fid: str, start: datetime, end: datetime) -> dict:
    m = {"committed_kg": 0.0, "delivered_kg": 0.0, "exempt_shortfall_kg": 0.0, "grades": [],
         "deliveries": 0, "deliveries_on_time": 0, "prompts": 0, "prompts_on_time": 0,
         "commitments_closed": 0, "commitments_honoured": 0, "buyer_stars": None}
    for chk in db.quality_checks.find({"farmer_id": fid, "due_at": {"$gte": start, "$lte": end},
                                       "status": {"$in": ["ANALYSED", "MISSED", "RETAKE_REQUESTED"]}}):
        m["prompts"] += 1
        m["prompts_on_time"] += 1 if chk.get("on_time") else 0
    for rv in db.quality_reviews.find({"farmer_id": fid, "created_at": {"$gte": start, "$lte": end},
                                       "status": {"$in": ["PASS", "FAIL"]}}):
        m["grades"].append(rv["final_grade"])
    for cm in db.commitments.find({"farmer_id": fid}):
        agr = db.agreements.find_one({"_id": cm["agreement_id"]}, {"dispatched_at": 1, "dispatch_deadline": 1})
        withdrawn_at = (cm.get("withdrawal") or {}).get("at")
        closed_at = withdrawn_at or (agr or {}).get("dispatched_at")
        if _in(closed_at, start, end):
            m["commitments_closed"] += 1
            m["committed_kg"] += cm["committed_kg"]
            m["delivered_kg"] += cm["delivered_kg"]
            if cm["status"] != "WITHDRAWN":
                m["commitments_honoured"] += 1
                m["exempt_shortfall_kg"] += cm.get("exempt_shortfall_kg", 0.0)
    for lot in db.lots.find({"contributions.farmer_id": fid, "collected_at": {"$gte": start, "$lte": end}}):
        agr = db.agreements.find_one({"_id": lot["agreement_id"]}, {"dispatch_deadline": 1})
        m["deliveries"] += 1
        m["deliveries_on_time"] += 1 if aware(lot["collected_at"]) <= aware(agr["dispatch_deadline"]) else 0
    stars = [f["stars"] for f in db.feedback.find({"direction": "buyer_to_supply", "farmer_ids": fid,
                                                   "created_at": {"$gte": start, "$lte": end}})]
    m["buyer_stars"] = round(sum(stars) / len(stars), 2) if stars else None
    return m


def buyer_month(db: Database, bid: str, start: datetime, end: datetime) -> dict:
    m = {"payments_due": 0, "payments_on_time": 0, "orders": 0, "orders_kept": 0, "receipts": 0,
         "responded_in_window": 0, "unfounded_disputes": 0, "farmer_stars": None}
    for a in db.agreements.find({"buyer_id": bid}):
        if _in(a.get("ready_at"), start, end) and a.get("funded_at"):
            m["payments_due"] += 1
            m["payments_on_time"] += 1 if a.get("funded_on_time") else 0
        if _in(a.get("closed_at"), start, end):
            m["orders"] += 1
            m["orders_kept"] += 1          # cancellation is a Module 1 event; none recorded here
        if _in(a.get("received_at"), start, end) and a.get("buyer_response"):
            m["receipts"] += 1
            m["responded_in_window"] += 1 if a["buyer_response"] in ("confirmed", "disputed") else 0
            if ((a.get("dispute") or {}).get("decision") or {}).get("cause") == "transit":
                m["unfounded_disputes"] += 1
    stars = [f["stars"] for f in db.feedback.find({"direction": "farmer_to_buyer", "buyer_id": bid,
                                                   "created_at": {"$gte": start, "$lte": end}})]
    m["farmer_stars"] = round(sum(stars) / len(stars), 2) if stars else None
    return m


def _previous(db: Database, stype: str, sid: str, period: str):
    return db.rating_snapshots.find_one({"subject_type": stype, "subject_id": sid, "period": {"$lt": period}},
                                        sort=[("period", -1)])


def _store(db, stype, sid, name, extra, period, metrics, comps, score, now, live):
    prev = _previous(db, stype, sid, period)
    rating, cycles = rt.smooth(prev["rating"] if prev else None, prev["cycles"] if prev else 0, score)
    if score is None and not prev:
        return None
    doc = {"subject_type": stype, "subject_id": sid, "name": name, "period": period, "metrics": metrics,
           "components": comps, "month_score": score, "rating": rating, "cycles": cycles,
           "is_new": cycles < rt.NEW_THRESHOLD_CYCLES, "used_for_ranking": live, "computed_at": now, **extra}
    db.rating_snapshots.update_one({"subject_type": stype, "subject_id": sid, "period": period},
                                   {"$set": doc}, upsert=True)
    return doc


def run_month(db: Database, period: str, now: datetime) -> dict:
    start, end = _bounds(period)
    if start > now:
        raise DomainError("cannot rate a month that has not started")
    live = rt.ranking_live(get_settings().pilot_start, now.date())
    farmers = buyers = 0
    for f in db.farmers.find({"_id": {"$in": db.commitments.distinct("farmer_id")}}):
        m = farmer_month(db, f["_id"], start, end)
        comps = rt.farmer_components(m)
        if _store(db, "farmer", f["_id"], f["name"], {"fpo_id": f["fpo_id"]}, period, m, comps,
                  rt.weighted(comps, rt.FARMER_WEIGHTS), now, live):
            farmers += 1
    for b in db.buyers.find({"_id": {"$in": db.agreements.distinct("buyer_id")}}):
        m = buyer_month(db, b["_id"], start, end)
        comps = rt.buyer_components(m)
        if _store(db, "buyer", b["_id"], b["name"], {}, period, m, comps,
                  rt.weighted(comps, rt.BUYER_WEIGHTS), now, live):
            buyers += 1
    return {"period": period, "farmers_rated": farmers, "buyers_rated": buyers, "ranking_live": live}


def current(db: Database, subject_type: str) -> list:
    rows = list(db.rating_snapshots.aggregate([
        {"$match": {"subject_type": subject_type}}, {"$sort": {"period": -1}},
        {"$group": {"_id": "$subject_id", "latest": {"$first": "$$ROOT"}}},
        {"$replaceRoot": {"newRoot": "$latest"}}, {"$sort": {"rating": -1}}]))
    for r in rows:
        r.pop("_id", None)
    return rows


def history(db: Database, subject_type: str, subject_id: str) -> list:
    rows = list(db.rating_snapshots.find({"subject_type": subject_type, "subject_id": subject_id},
                                         {"_id": 0}).sort("period", 1))
    return rows


def ranking_status(now: datetime) -> dict:
    s = get_settings()
    live = rt.ranking_live(s.pilot_start, now.date())
    return {"pilot_start": s.pilot_start, "switch_on": rt.add_months(s.pilot_start, rt.PILOT_MONTHS),
            "live": live, "mode": "rating" if live else "first_come_first_served",
            "reserve_new_share": s.reserve_new_share,
            "weights": {"farmer": rt.FARMER_WEIGHTS, "buyer": rt.BUYER_WEIGHTS}, "illustrative": True}
