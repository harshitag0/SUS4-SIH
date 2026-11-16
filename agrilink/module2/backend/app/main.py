"""Module 2 backend entry point.

    uvicorn app.main:app --reload --port 8000

All routes live under /api/m2 (see `M2_PREFIX`) so the router can be mounted
into a larger AgriLink backend unchanged: `parent.include_router(m2_router, prefix=M2_PREFIX)`.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError

from .config import get_settings
from .db import ensure_indexes, get_db
from .errors import DomainError
from .routers import agreements, quality, ratings, risks, system

M2_PREFIX = "/api/m2"

m2_router = APIRouter()
for r in (system.router, agreements.router, quality.router, risks.router, ratings.router):
    m2_router.include_router(r)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def domain_error(_: Request, e: DomainError):
        return JSONResponse(status_code=e.status, content={"error": {"code": e.code, "message": e.message}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        msgs = []
        for err in e.errors():
            loc = ".".join(str(x) for x in err["loc"] if x not in ("body", "query", "path"))
            msgs.append(f"{loc}: {err['msg']}" if loc else err["msg"])
        return JSONResponse(status_code=422, content={"error": {"code": "validation", "message": "; ".join(msgs),
                                                                "details": msgs}})

    @app.exception_handler(PyMongoError)
    async def db_error(_: Request, e: PyMongoError):
        return JSONResponse(status_code=503, content={"error": {"code": "database_unavailable",
                                                                "message": "database is unavailable"}})


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_indexes(get_db())
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="AgriLink Module 2: Farm Management & Supply Assurance", version="1.0.0",
                  lifespan=lifespan, docs_url=f"{M2_PREFIX}/docs", openapi_url=f"{M2_PREFIX}/openapi.json")
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=False,
                       allow_methods=["*"], allow_headers=["*"])
    install_error_handlers(app)
    app.include_router(m2_router, prefix=M2_PREFIX)
    return app


app = create_app()
