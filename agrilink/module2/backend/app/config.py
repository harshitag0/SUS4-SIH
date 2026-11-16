"""Environment-based configuration for Module 2. All variables use the M2_ prefix
so they cannot collide with Module 1 settings when the apps are combined."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache


def _bool(v: str) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    mongo_uri: str
    db_name: str
    cors_origins: list = field(default_factory=list)
    pilot_start: date = date(2026, 11, 1)
    dispute_window_hours: float = 72.0
    funding_due_hours: float = 24.0
    upload_dir: str = "uploads"
    max_upload_mb: float = 8.0
    allow_demo_controls: bool = True
    check_interval_days: int = 7
    upload_grace_hours: int = 48
    cv_valid_days: int = 10
    finding_valid_days: int = 14
    supply_risk_threshold: float = 0.95
    reserve_new_share: float = 0.20
    public_trace_base: str = "http://localhost:5173/m2/trace"


@lru_cache
def get_settings() -> Settings:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return Settings(
        mongo_uri=os.getenv("M2_MONGO_URI", "mongodb://localhost:27017"),
        db_name=os.getenv("M2_DB_NAME", "agrilink_m2"),
        cors_origins=[o.strip() for o in os.getenv(
            "M2_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()],
        pilot_start=date.fromisoformat(os.getenv("M2_PILOT_START", "2026-11-01")),
        dispute_window_hours=float(os.getenv("M2_DISPUTE_WINDOW_HOURS", "72")),
        funding_due_hours=float(os.getenv("M2_FUNDING_DUE_HOURS", "24")),
        upload_dir=os.getenv("M2_UPLOAD_DIR", os.path.join(here, "uploads")),
        max_upload_mb=float(os.getenv("M2_MAX_UPLOAD_MB", "8")),
        allow_demo_controls=_bool(os.getenv("M2_ALLOW_DEMO_CONTROLS", "true")),
        check_interval_days=int(os.getenv("M2_CHECK_INTERVAL_DAYS", "7")),
        upload_grace_hours=int(os.getenv("M2_UPLOAD_GRACE_HOURS", "48")),
        cv_valid_days=int(os.getenv("M2_CV_VALID_DAYS", "10")),
        finding_valid_days=int(os.getenv("M2_FINDING_VALID_DAYS", "14")),
        supply_risk_threshold=float(os.getenv("M2_SUPPLY_RISK_THRESHOLD", "0.95")),
        reserve_new_share=float(os.getenv("M2_RESERVE_NEW_SHARE", "0.20")),
        public_trace_base=os.getenv("M2_PUBLIC_TRACE_BASE", "http://localhost:5173/m2/trace"),
    )
