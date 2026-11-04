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


class SimulationSaveRequest(BaseModel):
    """Request payload to store a simulation & its predictions into the SQLite Vault & FAISS Vector DB."""

    model_config = ConfigDict(extra="allow")

    title: str
    source: str = "predict"  # "predict" or "map"
    run_id: str = "run_final_ensemble"
    model_used: str = ""
    station_id: str = "01646500"
    station_name: str = ""
    storm_peak_mm: float = 0.0
    soil_moisture: float = 0.35
    storm_radius_km: Optional[float] = None
    notes: str = ""
    predictions: List[Dict[str, Any]] = Field(default_factory=list)


class SimulationRecord(BaseModel):
    """Stored simulation & prediction record from SQLite Vault."""

    model_config = ConfigDict(extra="allow")

    sim_id: str
    created_at: str
    title: str
    source: str
    run_id: str
    model_used: str
    station_id: str
    station_name: str
    storm_peak_mm: float
    soil_moisture: float
    storm_radius_km: Optional[float] = None
    peak_discharge_cfs: float
    mean_discharge_cfs: float
    min_discharge_cfs: float
    p90_exceedance_count: int
    row_count: int
    notes: str = ""
    predictions: List[Dict[str, Any]] = Field(default_factory=list)


class RagDocumentIngestRequest(BaseModel):
    """Request to ingest custom hydrological data/notes into the FAISS Vector Database."""

    model_config = ConfigDict(extra="allow")

    title: str
    category: str = "custom_note"
    station_id: Optional[str] = None
    content: str


class RagChunkMatch(BaseModel):
    """Single retrieved vector chunk from FAISS IndexFlatIP."""

    model_config = ConfigDict(extra="allow")

    doc_id: str
    title: str
    category: str
    similarity_score: float
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RagQueryRequest(BaseModel):
    """Query request against the FAISS Vector Database + RAG synthesis engine."""

    model_config = ConfigDict(extra="allow")

    query: str
    top_k: int = 5
    category_filter: Optional[str] = None


class RagQueryResponse(BaseModel):
    """Grounded RAG answer with retrieved FAISS vector chunks and similarity scores."""

    model_config = ConfigDict(extra="allow")

    query: str
    answer: str
    embedding_engine: str
    vector_index_type: str
    total_vectors_searched: int
    retrieved_chunks: List[RagChunkMatch]


class RagStatsResponse(BaseModel):
    """Statistics for the FAISS Vector Database and Stored Simulations Vault."""

    model_config = ConfigDict(extra="allow")

    vector_db_engine: str
    embedding_model: str
    vector_dimension: int
    total_vectors: int
    saved_simulations_count: int
    categories_breakdown: Dict[str, int]
    index_path: str


class ChatMessage(BaseModel):
    """Single chat turn in conversation history."""

    model_config = ConfigDict(extra="allow")

    role: str = Field(..., description="user, assistant, or system")
    content: str


class ChatRequest(BaseModel):
    """User prompt and context settings for the local RAG chatbot."""

    model_config = ConfigDict(extra="allow")

    message: str
    history: List[ChatMessage] = Field(default_factory=list)
    model: Optional[str] = "qwen2.5:1.5b"
    use_rag: bool = True
    temperature: float = 0.7


class ChatResponse(BaseModel):
    """Complete assistant answer with RAG citations and metadata."""

    model_config = ConfigDict(extra="allow")

    reply: str
    citations: List[RagChunkMatch] = Field(default_factory=list)
    model: str
    sources_used: bool = False


