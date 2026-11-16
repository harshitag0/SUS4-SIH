"""Small helpers shared by services and routers."""
from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(4).upper()}"


def out(doc: Any) -> Any:
    """Make a Mongo document JSON-friendly: _id -> id, datetimes -> ISO strings."""
    if isinstance(doc, list):
        return [out(d) for d in doc]
    if isinstance(doc, dict):
        res = {}
        for k, v in doc.items():
            res["id" if k == "_id" else k] = out(v)
        return res
    if isinstance(doc, datetime):
        if doc.tzinfo is None:
            doc = doc.replace(tzinfo=timezone.utc)
        return doc.isoformat()
    if isinstance(doc, date):
        return doc.isoformat()
    return doc


def aware(t: datetime) -> datetime:
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


IST = timezone(timedelta(hours=5, minutes=30))


def ist(t: datetime) -> str:
    """Human time for messages to farmers, FPOs and doctors (India)."""
    return aware(t).astimezone(IST).strftime('%d %b %H:%M IST')


def period_of(t: datetime) -> str:
    return f"{t.year:04d}-{t.month:02d}"
