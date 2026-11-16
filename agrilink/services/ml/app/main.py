from contextlib import asynccontextmanager
from fastapi import FastAPI
from .modules.grading.router import router as grading_router
from .modules.alerts.router import router as alerts_router
from .modules.mandi.router import router as mandi_router
from .modules.supply_demand.router import router as supply_demand_router
from .modules.supply_demand import service as supply_demand
from .modules.price.router import router as price_router
from .modules.price import service as price
from .modules.cost.router import router as cost_router
from .modules.cost import service as cost
from .modules.vision.router import router as vision_router


@asynccontextmanager
async def lifespan(_app):
    supply_demand.artifact()  # load trained models, or train them on first start
    price.artifact()
    cost.artifact()
    yield


app = FastAPI(title="AgriLink ML service", version="0.6.0", lifespan=lifespan)

# To add a module: create app/modules/<name>/{service,router}.py and register it here.
for r in (supply_demand_router, price_router, cost_router, grading_router, alerts_router, mandi_router, vision_router):
    app.include_router(r)


@app.get("/health")
def health():
    return {"status": "ok", "service": "ml"}
