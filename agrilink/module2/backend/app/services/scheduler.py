"""Time-based jobs. In production run `run_due_jobs` on a timer (e.g. every 15
minutes); in the demo it runs whenever the simulated clock is advanced, or on
request."""
from __future__ import annotations

from datetime import datetime

from pymongo.database import Database

from . import delivery, quality


def run_due_jobs(db: Database, now: datetime) -> dict:
    return {
        "checks_created": quality.generate_due_checks(db, now),
        **quality.process_deadlines(db, now),
        "visits_scheduled": quality.generate_due_visits(db, now),
        "auto_released": delivery.auto_release_due(db, now),
        "ran_at": now,
    }
