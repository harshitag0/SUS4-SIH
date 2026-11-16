"""Lookups shared by services."""
from __future__ import annotations

from pymongo.database import Database

from ..errors import NotFound


def get(db: Database, coll: str, _id: str, label: str) -> dict:
    doc = db[coll].find_one({"_id": _id})
    if not doc:
        raise NotFound(f"{label} '{_id}' not found")
    return doc


def farmer(db: Database, fid: str) -> dict:
    return get(db, "farmers", fid, "farmer")


def fpo(db: Database, fid: str) -> dict:
    return get(db, "fpos", fid, "FPO")


def agreement(db: Database, aid: str) -> dict:
    return get(db, "agreements", aid, "agreement")


def commitment(db: Database, cid: str) -> dict:
    return get(db, "commitments", cid, "commitment")


def names(db: Database, coll: str, ids) -> dict:
    return {d["_id"]: d.get("name", d["_id"]) for d in db[coll].find({"_id": {"$in": list(set(ids))}})}


MONITORED_AGREEMENT_STATUSES = ("ACTIVE", "HARVESTING")
