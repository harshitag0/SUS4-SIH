from fastapi import APIRouter
from . import service

router = APIRouter(prefix="/mandi", tags=["mandi"])


@router.get("/latest")
def latest(commodity: str = "Mango", state: str = "Maharashtra"):
    return service.latest(commodity, state)
