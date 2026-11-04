"""
Pydantic v2 Schemas for the FLOODCAST API (`/api/v1`).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    """Health check response."""

    model_config = ConfigDict(extra="allow")

    status: str = "ok"
    service: str = "floodcast-backend"
    version: str = "1.0.0"
    engine: str = "pandas"
    cutoff_date: str = "2022-12-31"
    data_ready: bool = True
    predictions_ready: bool = False
    timestamp: str


class StationSummary(BaseModel):
    """Summary metadata and statistics for a single USGS gauge station."""

    model_config = ConfigDict(extra="allow")

    station_id: str
    station_name: str
    latitude: float
    longitude: float
    state: str
    river_name: str
    drainage_area_sqmi: Optional[float] = None
    mean_elevation_ft: Optional[float] = None
    slope_pct: Optional[float] = None
    forest_cover_pct: Optional[float] = None
    train_rows: int = 0
    test_rows: int = 0
    mean_discharge_cfs: Optional[float] = None
    median_discharge_cfs: Optional[float] = None
    p90_discharge_cfs: Optional[float] = None
    p99_discharge_cfs: Optional[float] = None
    max_discharge_cfs: Optional[float] = None
    completeness_pct: float = 100.0


class StationTimeSeriesPoint(BaseModel):
    """Daily hydrograph and weather observation for a station."""

    model_config = ConfigDict(extra="allow")

    date: str
    discharge_cfs: Optional[float] = None
    predicted_discharge_cfs: Optional[float] = None
    precipitation_mm: Optional[float] = None
    temp_max_c: Optional[float] = None
    temp_min_c: Optional[float] = None
    soil_moisture: Optional[float] = None
    split: str = "train"


class StationDetailResponse(BaseModel):
    """Full station detail: metadata, sanity stats, and recent hydrograph + weather series."""

    model_config = ConfigDict(extra="allow")

    station: StationSummary
    sanity_stats: Dict[str, Any]
    series: List[StationTimeSeriesPoint]
    total_rows: int


class FeatureCatalogItem(BaseModel):
    """Single engineered feature entry in the feature catalog."""

    model_config = ConfigDict(extra="allow")

    name: str
    family: str
    formula_or_description: str
    hydrological_rationale: str
    lookback_window: str = "backward-only"
    importance: float = 0.0
    importance_rank: Optional[int] = None


class AblationItem(BaseModel):
    """Single feature family ablation experiment result."""

    model_config = ConfigDict(extra="allow")

    experiment_id: str
    feature_family: str
    baseline_rmse: float
    with_family_rmse: float
    delta_rmse: float
    extreme_rmse: Optional[float] = None
    mae: Optional[float] = None
    r2: Optional[float] = None
    kept: bool = True
    notes: str = ""


class FeaturesResponse(BaseModel):
    """Feature catalog, feature importances, and ablation study results."""

    model_config = ConfigDict(extra="allow")

    total_features: int
    families: List[str]
    catalog: List[FeatureCatalogItem]
    importances: List[Dict[str, Any]]
    ablations: List[AblationItem]


class RunSummary(BaseModel):
    """Summary of an experiment run from `experiments/runs.jsonl`."""

    model_config = ConfigDict(extra="allow")

    run_id: str
    timestamp: str
    model_family: str = "lightgbm"
    model_type: str = "lightgbm"
    target_strategy: str = "raw"
    validation_scheme: str = "forward_time"
    n_features: int = 0
    rmse: float
    extreme_rmse: float
    mae: float
    r2: float
    composite_score: float
    train_time_seconds: float = 0.0
    submission_passed: bool = True
    description: str = ""


class RunDetail(BaseModel):
    """Detailed experiment run record with per-station metrics, worst errors, and artifacts."""

    model_config = ConfigDict(extra="allow")

    run_id: str
    timestamp: str
    model_family: str = "lightgbm"
    model_type: str = "lightgbm"
    target_strategy: str = "raw"
    validation_scheme: str = "forward_time"
    n_features: int = 0
    feature_names: List[str] = Field(default_factory=list)
    train_rows: int = 0
    val_rows: int = 0
    test_rows: int = 0
    train_time_seconds: float = 0.0
    best_iteration: Optional[int] = None
    val_metrics: Dict[str, float]
    test_metrics: Optional[Dict[str, float]] = None
    composite_score: float = 0.0
    per_station_metrics: List[Dict[str, Any]] = Field(default_factory=list)
    worst_errors: List[Dict[str, Any]] = Field(default_factory=list)
    artifact_paths: Dict[str, str] = Field(default_factory=dict)
    submission_check: Dict[str, Any] = Field(default_factory=dict)
    description: str = ""


class TrainStartRequest(BaseModel):
    """
    Training request schema enforcing the Training Gate protocol.
    If `confirm_training_gate` is not True, the endpoint blocks training
    and returns HTTP 400 with the full pre-run Training Start Notice preview.
    """

    model_config = ConfigDict(extra="allow")

    confirm_training_gate: bool = False
    run_id: str = "exp_manual_run"
    model_family: str = "lightgbm"
    target_strategy: str = "raw"
    validation_scheme: str = "forward_time"
    seed: int = 42
    notes: str = ""


class TrainStartNoticeResponse(BaseModel):
    """Response returned when previewing or launching a gated training job."""

    model_config = ConfigDict(extra="allow")

    job_id: Optional[str] = None
    run_id: str
    status: str
    gate_confirmed: bool
    message: str
    notice: Dict[str, Any]
    created_at: str


class PredictRequest(BaseModel):
    """JSON request payload for batch or interactive model inference."""

    model_config = ConfigDict(extra="allow")

    rows: List[Dict[str, Any]]
    run_id: Optional[str] = None


class PredictResponse(BaseModel):
    """Predictions returned by `/api/v1/predict` (clipped at 0.0 cfs)."""

    model_config = ConfigDict(extra="allow")

    run_id: str
    model_used: str
    row_count: int
    clipped_negatives_count: int = 0
    predictions: List[Dict[str, Any]]


class ValidationReportResponse(BaseModel):
    """Submission validation report from `floodcast.check_submission`."""

    model_config = ConfigDict(extra="allow")

    passed: bool
    row_count: int
    stations_count: int
    reasons: List[str]
    summary: Dict[str, Any]


class SubmissionStatusResponse(BaseModel):
    """Overall submission readiness status and deliverables checklist."""

    model_config = ConfigDict(extra="allow")

    ready_for_submission: bool
    deliverables: Dict[str, bool]
    checklist: List[Dict[str, Any]]
    checker_passed: bool
    checker_reasons: List[str]
    cutoff_date: str
    no_leakage_verified: bool
    no_hand_edits_verified: bool = True
    prediction_stats: Dict[str, Any] = Field(default_factory=dict)


class DocItem(BaseModel):
    """Metadata for a single Markdown documentation file."""

    model_config = ConfigDict(extra="allow")

    name: str
    title: str
    path: str
    category: str = "docs"
    size_bytes: int = 0
    updated_at: str = ""


class DocContentResponse(BaseModel):
    """Full Markdown content for a documentation file."""

    model_config = ConfigDict(extra="allow")

    name: str
    title: str
    path: str
    content: str
    updated_at: str = ""
