from typing import Literal, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field
from . import service

router = APIRouter(prefix="/grading", tags=["grading"])


class Sample(BaseModel):
    weight_g: float = Field(gt=0, le=1500)
    colour_idx: float = Field(ge=0, le=1)
    blemish_pct: float = Field(ge=0, le=100)
    target_grade: Optional[Literal["A", "B", "C"]] = None


@router.post("/assess")
def assess(s: Sample):
    return service.assess(s.weight_g, s.colour_idx, s.blemish_pct, s.target_grade)


@router.get("/spec")
def spec():
    return service.SPEC
