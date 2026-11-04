"""
FLOODCAST API v1 Router (`/api/v1`).
Implements all endpoints for stations, features, experiment runs, gated training,
SSE log streaming, inference, submission validation, submission checklist, and docs.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from backend.app.core.config import PROJECT_ROOT
from backend.app.schemas.api_schemas import (
    DocContentResponse,
    DocItem,
    FeaturesResponse,
    PredictRequest,
    PredictResponse,
    RunDetail,
    RunSummary,
    StationDetailResponse,
    StationSummary,
    SubmissionStatusResponse,
    TrainStartNoticeResponse,
    TrainStartRequest,
    ValidationReportResponse,
)
from backend.app.services.data_service import data_service
from backend.app.services.job_manager import job_manager

logger = logging.getLogger("floodcast.backend.router.v1")

router = APIRouter(tags=["FLOODCAST API v1"])


@router.get(
    "/stations",
    response_model=List[StationSummary],
    summary="List all USGS stations with metadata and discharge statistics",
)
def list_stations() -> List[StationSummary]:
    return data_service.get_stations_list()


@router.get(
    "/stations/{station_id}",
    response_model=StationDetailResponse,
    summary="Get station metadata, sanity stats, and recent hydrograph + weather series",
)
def get_station_detail(
    station_id: str,
    limit: int = Query(default=365, ge=1, le=20000, description="Max time-series points to return"),
    start_date: Optional[str] = Query(default=None, description="Filter start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(default=None, description="Filter end date (YYYY-MM-DD)"),
) -> StationDetailResponse:
    detail = data_service.get_station_detail(
        station_id=station_id,
        limit=limit,
        start_date=start_date,
        end_date=end_date,
    )
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Station '{station_id}' not found",
        )
    return detail


@router.get(
    "/features",
    response_model=FeaturesResponse,
    summary="Get feature catalog, feature importances, and ablation results",
)
def get_features() -> FeaturesResponse:
    return data_service.get_features_info()


@router.get(
    "/runs",
    response_model=List[RunSummary],
    summary="List all experiment runs with normalized composite scores",
)
def list_runs() -> List[RunSummary]:
    return data_service.get_runs_list()


@router.get(
    "/runs/{run_id}",
    response_model=RunDetail,
    summary="Get full experiment run details, per-station metrics, worst errors, and artifact paths",
)
def get_run_detail(run_id: str) -> RunDetail:
    detail = data_service.get_run_detail(run_id)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Experiment run '{run_id}' not found",
        )
    return detail


@router.post(
    "/train",
    response_model=TrainStartNoticeResponse,
    summary="Start a gated training job (requires confirm_training_gate=True)",
)
def start_training(req: TrainStartRequest) -> Any:
    gate_passed, response_obj = job_manager.start_training_job(req)
    if not gate_passed:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=response_obj.model_dump(),
        )
    return response_obj


@router.get(
    "/train/jobs",
    summary="List all training jobs stored in SQLite",
)
def list_training_jobs() -> List[Dict[str, Any]]:
    return job_manager.list_jobs()


@router.get(
    "/train/{job_id}",
    summary="Get status and metadata for a training job",
)
def get_training_job(job_id: str) -> Dict[str, Any]:
    job = job_manager.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Training job '{job_id}' not found",
        )
    return job


@router.get(
    "/train/{job_id}/logs",
    summary="Stream live training job logs via Server-Sent Events (SSE)",
)
async def stream_training_logs(
    job_id: str,
    timeout: float = Query(default=15.0, ge=0.5, le=120.0),
) -> StreamingResponse:
    job = job_manager.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Training job '{job_id}' not found",
        )
    return StreamingResponse(
        job_manager.stream_job_logs(job_id, max_wait_seconds=timeout),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/predict",
    response_model=PredictResponse,
    summary="Run inference on JSON rows or uploaded CSV file (predictions clipped at 0)",
)
async def predict_discharge(request: Request) -> PredictResponse:
    content_type = request.headers.get("content-type", "").lower()
    rows: List[Dict[str, Any]] = []
    run_id: Optional[str] = None

    if "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Multipart request to /api/v1/predict must include a 'file' CSV upload.",
            )
        raw_bytes = await upload.read()  # type: ignore
        try:
            df = pd.read_csv(io.BytesIO(raw_bytes), dtype={"station_id": str})
            rows = df.to_dict("records")
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to parse uploaded CSV: {exc}",
            ) from exc
        if "run_id" in form and form["run_id"]:
            run_id = str(form["run_id"])
    else:
        try:
            body = await request.json()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON payload: {exc}",
            ) from exc

        if isinstance(body, dict):
            parsed = PredictRequest(**body)
            rows = parsed.rows
            run_id = parsed.run_id
        elif isinstance(body, list):
            rows = body
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Expected JSON object with 'rows' list or a JSON array of row objects.",
            )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No input rows provided for prediction.",
        )

    return data_service.predict_rows(rows=rows, run_id=run_id)


@router.post(
    "/validate",
    response_model=ValidationReportResponse,
    summary="Validate an uploaded predictions CSV or the current predictions.csv against test.csv",
)
async def validate_submission(request: Request) -> ValidationReportResponse:
    content_type = request.headers.get("content-type", "").lower()

    if "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        if upload is not None and hasattr(upload, "read"):
            raw_bytes = await upload.read()  # type: ignore
            return data_service.validate_submission_file(csv_bytes=raw_bytes)

    # Check if optional JSON body specifies a path or inline csv_content
    body_bytes = await request.body()
    if body_bytes and "application/json" in content_type:
        try:
            payload = await request.json()
            if isinstance(payload, dict):
                if "csv_content" in payload and payload["csv_content"]:
                    return data_service.validate_submission_file(
                        csv_bytes=str(payload["csv_content"]).encode("utf-8")
                    )
                if "predictions_path" in payload and payload["predictions_path"]:
                    cand_path = Path(str(payload["predictions_path"]))
                    if not cand_path.is_absolute():
                        cand_path = (PROJECT_ROOT / cand_path).resolve()
                    return data_service.validate_submission_file(predictions_path=cand_path)
        except Exception:
            pass

    return data_service.validate_submission_file()


@router.get(
    "/submission/status",
    response_model=SubmissionStatusResponse,
    summary="Get deliverables checklist and live submission validation status",
)
def get_submission_status() -> SubmissionStatusResponse:
    return data_service.get_submission_status()


@router.get(
    "/docs-index",
    response_model=List[DocItem],
    summary="List all available project Markdown documentation files",
)
def list_docs_index() -> List[DocItem]:
    return data_service.get_docs_index()


@router.get(
    "/docs/{doc_name}",
    response_model=DocContentResponse,
    summary="Get Markdown content of a specific documentation file",
)
def get_doc_content(doc_name: str) -> DocContentResponse:
    doc = data_service.get_doc_content(doc_name)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Documentation file '{doc_name}' not found",
        )
    return doc
