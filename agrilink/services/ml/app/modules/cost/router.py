from typing import Literal, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from . import service
from ..price.service import DISTRICT_WEEKS


class Actual(BaseModel):
    year: int
    components: dict[str, float]


class OfferFill(BaseModel):
    net_kg: float = Field(gt=0)
    tons: float = Field(gt=0)


class FarmIn(BaseModel):
    district: str = "Sindhudurg"
    acres: float = Field(gt=0)
    trees: int = Field(gt=0)
    age: float = Field(gt=0)
    irrigation: Literal["drip", "well", "rain"] = "well"
    tons: float = Field(ge=0)
    grade_a_tons: float = Field(ge=0)
    offer_net_a: Optional[float] = None
    offer_net_b: Optional[float] = None
    offers_a: Optional[list[OfferFill]] = None  # open offers: farmer net Rs/kg + tons the buyer still needs
    offers_b: Optional[list[OfferFill]] = None
    wage_pct: Optional[float] = Field(None, ge=-50, le=100)
    diesel_pct: Optional[float] = Field(None, ge=-50, le=100)
    fertilizer_pct: Optional[float] = Field(None, ge=-50, le=100)
    actual: Optional[Actual] = None
    target_margin_pct: float = Field(20, ge=0, le=200)
    usd_inr: float = Field(88, gt=0)


router = APIRouter(prefix="/cost", tags=["cost"])


@router.post("/analysis")
def analysis(f: FarmIn):
    if f.district not in DISTRICT_WEEKS:
        raise HTTPException(404, "unknown district")
    d = f.model_dump()
    d["fert_pct"] = d.pop("fertilizer_pct")
    return service.analysis(**d)


@router.get("/model")
def model():
    return service.model_card()


@router.post("/train")
def retrain():
    service.artifact(retrain=True)
    return service.model_card()
