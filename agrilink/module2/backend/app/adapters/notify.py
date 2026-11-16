"""SMS / WhatsApp / in-app notification adapter.

Messages are written to the `notifications` collection (the outbox). The
simulated gateway marks them SENT_SIMULATED. A real SMS or WhatsApp Business
gateway would send each message and record its delivery status.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pymongo.database import Database

from ..util import new_id

GATEWAY = "SIMULATED gateway"


def send(db: Database, now: datetime, to_type: str, to_id: str, channel: str, subject: str,
         body: str, related: Optional[dict] = None) -> str:
    nid = new_id("MSG")
    db.notifications.insert_one({
        "_id": nid, "to_type": to_type, "to_id": to_id, "channel": channel,
        "subject": subject, "body": body, "related": related or {},
        "status": "SENT_SIMULATED", "gateway": GATEWAY, "created_at": now,
    })
    return nid


def to_farmer(db: Database, now: datetime, farmer: dict, subject: str, body: str,
              related: Optional[dict] = None, app_too: bool = False) -> None:
    """Farmers get SMS or WhatsApp per their preference; app prompts also appear in the farmer view."""
    send(db, now, "farmer", farmer["_id"], farmer.get("channel", "sms"), subject, body, related)
    if app_too:
        send(db, now, "farmer", farmer["_id"], "app", subject, body, related)
