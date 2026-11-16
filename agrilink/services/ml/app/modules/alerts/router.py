from fastapi import APIRouter
from pydantic import BaseModel, Field
from . import service

router = APIRouter(prefix="/alerts", tags=["alerts"])


class Weather(BaseModel):
    rain_mm_48h: float = Field(ge=0, default=0)
    wind_kmh: float = Field(ge=0, default=0)
    temp_c: float = 32
    hail: bool = False
    grade_a_tons_ready: float = Field(ge=0, default=0)
    committed_tons: float = Field(ge=0, default=0)


@router.post("/evaluate")
def evaluate(w: Weather):
    return {"alerts": service.evaluate(**w.model_dump())}
