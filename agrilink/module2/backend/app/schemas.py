"""Request bodies (validated by FastAPI/pydantic before any business rule runs)."""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

GradeT = Literal["A", "B", "REJECT"]
ContractGradeT = Literal["A", "B"]


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CommitmentIn(_M):
    farmer_id: str
    committed_kg: float = Field(gt=0, le=100000)
    signed_on: Optional[date] = None
    signed_in_person: bool = True


class AgreementIntake(_M):
    id: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9\-_]+$")
    buyer_id: str
    crop: str = "Alphonso mango"
    variety: str = "Alphonso (Hapus)"
    quantity_kg: float = Field(gt=0, le=1_000_000)
    required_grade: ContractGradeT
    harvest_window_start: date
    harvest_window_end: date
    dispatch_deadline: date
    contract_value: float = Field(gt=0)
    currency: str = Field(default="SGD", min_length=3, max_length=3)
    tranche1_released: bool = True
    source: str = "module1"
    commitments: List[CommitmentIn] = Field(min_length=1)


class WithdrawIn(_M):
    reason: str = Field(min_length=3, max_length=300)


class VisitIn(_M):
    farmer_id: str
    due_at: Optional[datetime] = None
    note: str = Field(default="", max_length=300)


class FindingIn(_M):
    grade: GradeT
    observed_defect_pct: Optional[float] = Field(default=None, ge=0, le=100)
    fruit_inspected: Optional[int] = Field(default=None, ge=1, le=10000)
    pest_signs: List[str] = []
    cleared_flags: List[str] = []
    observations: str = Field(default="", max_length=1000)
    recommendations: List[str] = []


class ActionIn(_M):
    note: str = Field(min_length=3, max_length=500)


class VerifyIn(_M):
    effective: bool
    note: str = Field(default="", max_length=500)


class RiskIn(_M):
    type: Literal["unseasonal_rain", "heatwave", "high_wind", "fruit_fly_outbreak", "anthracnose_risk"]
    severity: Literal["low", "medium", "high"]
    areas: List[str] = Field(min_length=1)
    starts_at: datetime
    ends_at: datetime
    summary: str = Field(default="", max_length=300)


class RecoveryIn(_M):
    agreement_id: str
    alert_id: Optional[str] = None
    reason: Literal["weather_or_pest", "withdrawal", "quality_failure", "other"] = "weather_or_pest"


class OfferIn(_M):
    fpo_id: str
    kg: float = Field(gt=0)


class AllocationIn(_M):
    farmer_id: str
    kg: float = Field(gt=0)


class OfferResponseIn(_M):
    accepted: bool
    signed_in_person: bool = False
    allocations: List[AllocationIn] = []
    note: str = Field(default="", max_length=300)


class ContributionIn(_M):
    farmer_id: str
    kg: float = Field(gt=0, le=100000)
    grade: GradeT


class LotIn(_M):
    fpo_id: str
    contributions: List[ContributionIn] = Field(min_length=1)


class HandoverIn(_M):
    port: str = Field(min_length=3, max_length=80)


class DisputeIn(_M):
    reason: str = Field(min_length=5, max_length=500)
    lot_ids: List[str] = []


class SurveyorIn(_M):
    cause: Literal["transit", "origin_quality"]
    surveyor: str = Field(min_length=2, max_length=120)
    note: str = Field(default="", max_length=500)


class FeedbackIn(_M):
    direction: Literal["buyer_to_supply", "farmer_to_buyer"]
    stars: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=500)
    farmer_id: Optional[str] = None
    channel: Literal["sms", "whatsapp", "in_person"] = "sms"


class RatingsRunIn(_M):
    period: str = Field(pattern=r"^\d{4}-\d{2}$")


class ClockAdvanceIn(_M):
    hours: float = Field(gt=0, le=24 * 60)
