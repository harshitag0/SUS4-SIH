"""MongoDB access and index definitions for Module 2."""
from __future__ import annotations

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database

from .config import get_settings

_client: MongoClient | None = None

COLLECTIONS = [
    "fpos", "farmers", "farmer_doctors", "buyers",
    "agreements", "commitments", "quality_checks", "doctor_visits",
    "quality_reviews", "interventions", "risk_alerts", "recovery_requests",
    "lots", "escrow_accounts", "feedback", "rating_snapshots",
    "trace_events", "notifications", "system",
]


def get_client() -> MongoClient:
    global _client
    if _client is None:
        s = get_settings()
        _client = MongoClient(s.mongo_uri, serverSelectionTimeoutMS=3000, tz_aware=True)
    return _client


def get_db() -> Database:
    return get_client()[get_settings().db_name]


def ensure_indexes(db: Database) -> None:
    db.farmers.create_index([("fpo_id", ASCENDING)])
    db.farmers.create_index([("taluka", ASCENDING)])
    db.farmer_doctors.create_index([("fpo_id", ASCENDING)])
    db.commitments.create_index([("agreement_id", ASCENDING), ("status", ASCENDING)])
    db.commitments.create_index([("farmer_id", ASCENDING)])
    db.quality_checks.create_index([("commitment_id", ASCENDING), ("due_at", DESCENDING)])
    db.quality_checks.create_index([("status", ASCENDING), ("deadline", ASCENDING)])
    db.quality_checks.create_index([("farmer_id", ASCENDING)])
    db.doctor_visits.create_index([("farmer_id", ASCENDING), ("status", ASCENDING)])
    db.doctor_visits.create_index([("doctor_id", ASCENDING), ("status", ASCENDING)])
    db.quality_reviews.create_index([("commitment_id", ASCENDING), ("created_at", DESCENDING)])
    db.quality_reviews.create_index([("farmer_id", ASCENDING), ("created_at", DESCENDING)])
    db.interventions.create_index([("commitment_id", ASCENDING), ("status", ASCENDING)])
    db.risk_alerts.create_index([("status", ASCENDING)])
    db.recovery_requests.create_index([("agreement_id", ASCENDING)])
    db.lots.create_index([("agreement_id", ASCENDING)])
    db.feedback.create_index([("agreement_id", ASCENDING)])
    db.rating_snapshots.create_index(
        [("subject_type", ASCENDING), ("subject_id", ASCENDING), ("period", ASCENDING)], unique=True)
    db.trace_events.create_index([("agreement_id", ASCENDING), ("seq", ASCENDING)])
    db.trace_events.create_index([("lot_ids", ASCENDING)])
    db.trace_events.create_index([("seq", ASCENDING)], unique=True)
    db.notifications.create_index([("created_at", DESCENDING)])
    db.notifications.create_index([("to_type", ASCENDING), ("to_id", ASCENDING)])
