"""
FLOODCAST FastAPI Backend Entry Point (`backend.app.main:app`).
Provides versioned `/api/v1` routes, `/health` endpoint, OpenAPI `/docs`,
CORS for `http://localhost:3000`, request size limit middleware, structured logging,
and consistent JSON error responses.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app import __version__
from backend.app.core.config import (
    API_V1_PREFIX,
    CORS_ORIGINS,
    MAX_REQUEST_SIZE_BYTES,
    PREDICTIONS_PATH,
    PROCESSED_DATA_DIR,
    duckdb_helper,
    get_cutoff_date,
)
from backend.app.routers.v1 import router as v1_router
from backend.app.schemas.api_schemas import HealthResponse
from backend.app.services.data_service import data_service

# Structured logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("floodcast.backend")

app = FastAPI(
    title="FLOODCAST Hydrological Intelligence API",
    description=(
        "Production FastAPI backend for the FLOODCAST River Discharge Prediction System. "
        "Enforces CUTOFF dates, backward-only features, Training Gate protocol, and submission validation."
    ),
    version=__version__,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# CORS Middleware for Next.js frontend (http://localhost:3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_size_and_logging_middleware(
    request: Request, call_next: Callable[[Request], Any]
) -> Any:
    """Enforce request body size limits and log structured request metrics."""
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > MAX_REQUEST_SIZE_BYTES:
                return JSONResponse(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    content={
                        "error": "payload_too_large",
                        "detail": f"Request exceeds maximum allowed size of {MAX_REQUEST_SIZE_BYTES} bytes.",
                        "status_code": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    },
                )
        except ValueError:
            pass

    start_time = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start_time) * 1000.0

    logger.info(
        "method=%s path=%s status=%s duration_ms=%.2f",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    response.headers["X-Process-Time-Ms"] = f"{duration_ms:.2f}"
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Consistent JSON error response for HTTPException."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "http_error",
            "detail": exc.detail,
            "status_code": exc.status_code,
            "path": request.url.path,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Consistent JSON error response for Pydantic validation errors."""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "validation_error",
            "detail": exc.errors(),
            "status_code": status.HTTP_422_UNPROCESSABLE_ENTITY,
            "path": request.url.path,
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Consistent JSON error response for unexpected server errors."""
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "internal_server_error",
            "detail": str(exc),
            "status_code": status.HTTP_500_INTERNAL_SERVER_ERROR,
            "path": request.url.path,
        },
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["System"],
    summary="Health check and data readiness probe",
)
@app.get(
    f"{API_V1_PREFIX}/health",
    response_model=HealthResponse,
    tags=["System"],
    include_in_schema=False,
)
def health_check() -> HealthResponse:
    train_exists = (PROCESSED_DATA_DIR / "train.csv").exists()
    test_exists = (PROCESSED_DATA_DIR / "test.csv").exists()
    return HealthResponse(
        status="ok",
        service="floodcast-backend",
        version=__version__,
        engine=duckdb_helper.engine_name,
        cutoff_date=get_cutoff_date(),
        data_ready=bool(train_exists and test_exists),
        predictions_ready=PREDICTIONS_PATH.exists(),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


app.include_router(v1_router, prefix=API_V1_PREFIX)


@app.on_event("startup")
def warm_ml_models_on_startup() -> None:
    """Pre-warm all trained ML models (LightGBM, XGBoost, CatBoost) on startup."""
    try:
        data_service.predict_rows(
            rows=[
                {
                    "station_id": "01646500",
                    "date": "2022-05-01",
                    "precipitation_mm": 4.2,
                    "temp_max_c": 19.5,
                    "temp_min_c": 8.4,
                    "soil_moisture": 0.34,
                }
            ],
            run_id="run_final_ensemble",
        )
        logger.info("Pre-warmed all 7 trained ML models in memory.")
    except Exception as exc:
        logger.warning("Startup ML model pre-warm warning: %s", exc)

    try:
        data_service.get_stations_list()
        data_service.get_runs_list()
        from backend.app.services.rag_service import rag_service
        rag_service._ensure_initialized()
        logger.info("Pre-warmed FAISS Vector DB, Station Telemetry, and Hydrological Transformer Embedder.")
    except Exception as exc:
        logger.warning("Startup RAG service pre-warm warning: %s", exc)

    try:
        from backend.app.services.chat_service import chat_service
        chat_service.warm_up_async()
    except Exception as exc:
        logger.warning("Startup chat service warm-up warning: %s", exc)

