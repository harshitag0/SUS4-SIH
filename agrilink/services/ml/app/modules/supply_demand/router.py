from fastapi import APIRouter, HTTPException, Query
from . import service

router = APIRouter(prefix="/supply-demand", tags=["supply-demand"])


@router.get("/outlook")
def outlook(destination: str = "Singapore"):
    try:
        return service.outlook(destination)
    except KeyError:
        raise HTTPException(404, f"unknown destination; choose from {[m['destination'] for m in service.markets()]}")


@router.get("/markets")
def markets():
    return service.markets()


@router.get("/recommend")
def recommend(district: str = "Sindhudurg", grade_a_tons: float = Query(0, ge=0), grade_b_tons: float = Query(0, ge=0)):
    return service.recommend(district, grade_a_tons, grade_b_tons)


@router.get("/model")
def model():
    return service.model_card()


@router.post("/train")
def retrain():
    """Retrain from the CSVs in services/ml/data (e.g. after dropping in real APEDA data)."""
    service.artifact(retrain=True)
    return service.model_card()
