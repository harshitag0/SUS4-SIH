"""Clock used by every business rule.

Module 2's rules are time-based (deadlines, visit intervals, dispute window,
the 6-month ranking switch). For demonstrations the clock can be simulated:
`system.clock.sim_now` holds the current simulated time and is only moved by
the demo control. Without it, real UTC time is used.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pymongo.database import Database


def now(db: Database) -> datetime:
    doc = db.system.find_one({"_id": "clock"})
    if doc and doc.get("sim_now"):
        t = doc["sim_now"]
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def is_simulated(db: Database) -> bool:
    doc = db.system.find_one({"_id": "clock"})
    return bool(doc and doc.get("sim_now"))


def set_now(db: Database, t: datetime) -> None:
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    db.system.update_one({"_id": "clock"}, {"$set": {"sim_now": t}}, upsert=True)


def advance(db: Database, hours: float) -> datetime:
    t = now(db) + timedelta(hours=hours)
    set_now(db, t)
    return t
