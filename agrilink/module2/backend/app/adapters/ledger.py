"""Tamper-evident trace record.

Each event stores the SHA-256 of (previous hash + canonical event content), so
editing any stored event breaks verification. This is a local stand-in for the
planned Ethereum anchoring: the chain head hash is what would be anchored.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Optional

from pymongo import DESCENDING
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from ..util import out


def _digest(prev: str, body: dict) -> str:
    payload = json.dumps(out(body), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256((prev + payload).encode()).hexdigest()


def append(db: Database, now: datetime, stage: str, summary: str, agreement_id: Optional[str] = None,
           farmer_id: Optional[str] = None, lot_ids: Optional[list] = None, data: Optional[dict] = None,
           actor: Optional[str] = None) -> dict:
    # Mongo keeps milliseconds only, and the stored data must hash the same when read back.
    now = now.replace(microsecond=(now.microsecond // 1000) * 1000)
    data = out(data or {})
    for _ in range(5):  # retry if two writers race for the same sequence number
        last = db.trace_events.find_one(sort=[("seq", DESCENDING)])
        seq = (last["seq"] + 1) if last else 1
        prev = last["hash"] if last else "0" * 64
        body = {"seq": seq, "at": now, "stage": stage, "summary": summary,
                "agreement_id": agreement_id, "farmer_id": farmer_id,
                "lot_ids": lot_ids or [], "data": data, "actor": actor}
        doc = dict(body, _id=f"TRC-{seq:06d}", prev_hash=prev, hash=_digest(prev, body))
        try:
            db.trace_events.insert_one(doc)
            return doc
        except DuplicateKeyError:
            continue
    raise RuntimeError("could not append trace event")


def verify(db: Database) -> dict:
    """Recompute the whole chain. Returns {ok, checked, broken_at}."""
    prev = "0" * 64
    n = 0
    for e in db.trace_events.find(sort=[("seq", 1)]):
        body = {k: e.get(k) for k in ("seq", "at", "stage", "summary", "agreement_id",
                                       "farmer_id", "lot_ids", "data", "actor")}
        if e["prev_hash"] != prev or _digest(prev, body) != e["hash"]:
            return {"ok": False, "checked": n, "broken_at": e["_id"], "head": None}
        prev = e["hash"]
        n += 1
    return {"ok": True, "checked": n, "broken_at": None, "head": prev}
