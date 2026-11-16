from typing import Literal, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from . import service

router = APIRouter(prefix="/price", tags=["price"])


@router.get("/outlook")
def outlook(district: str = "Sindhudurg", grade: Literal["A", "B", "C"] = "A",
            demand_change_pct: float = Query(0, ge=-50, le=50)):
    try:
        return service.outlook(district, grade, demand_change_pct)
    except KeyError:
        raise HTTPException(404, f"unknown district; choose from {list(service.DISTRICT_WEEKS)}")


class Offer(BaseModel):
    id: Optional[str] = None
    grade: Literal["A", "B", "C"] = "A"
    price_usd_kg: float = Field(gt=0)
    deliver_by: str
    escalation_pct: float = 0


class OffersIn(BaseModel):
    district: str = "Sindhudurg"
    usd_inr: float = 88.0
    offers: list[Offer]


@router.post("/evaluate")
def evaluate(body: OffersIn):
    if body.district not in service.DISTRICT_WEEKS:
        raise HTTPException(404, "unknown district")
    return service.evaluate_offers(body.district, [o.model_dump() for o in body.offers], body.usd_inr)


@router.get("/model")
def model():
    return service.model_card()


@router.post("/train")
def retrain():
    service.artifact(retrain=True)
    return service.model_card()
