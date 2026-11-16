"""Per-request context: database and the (possibly simulated) current time."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from pymongo.database import Database

from .. import clock
from ..db import get_db


@dataclass
class Ctx:
    db: Database
    now: datetime


def ctx() -> Ctx:
    db = get_db()
    return Ctx(db, clock.now(db))
