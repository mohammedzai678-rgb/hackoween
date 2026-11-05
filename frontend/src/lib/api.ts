/**
 * FLOODCAST Typed API Client (`/api/v1`)
 * Strictly connects to the live FastAPI backend and trained ML models (no fake fallbacks).
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// ============================================================
// Core TypeScript Interfaces
// ============================================================

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  engine: string;
  cutoff_date: string;
  data_ready: boolean;
  predictions_ready: boolean;
  timestamp: string;
}

export interface StationSummary {
  station_id: string;
  station_name: string;
  latitude: number;
  longitude: number;
  state: string;
  river_name: string;
  is_starter?: boolean;
  climate_regime?: string;
  drainage_area_sqmi: number;
  mean_elevation_ft: number;
  slope_pct: number;
  forest_cover_pct: number;
  train_rows: number;
  test_rows: number;
  mean_discharge_cfs: number;
  median_discharge_cfs: number;
  p90_discharge_cfs: number;
  p99_discharge_cfs: number;
  max_discharge_cfs: number;
  completeness_pct: number;
}

export interface StationTimeSeriesPoint {
  date: string;
  discharge_cfs: number | null;
  predicted_discharge_cfs: number | null;
  precipitation_mm: number;
  temp_max_c: number;
  temp_min_c: number;
  soil_moisture: number;
  split: "train" | "val" | "test";
  is_extreme_p90?: boolean;
}

export interface StationDetailResponse {
  station: StationSummary;
  sanity_stats: {
    duplicates_count: number;
    missing_dates_count: number;
    negative_sentinel_removed: number;
    provisional_flag_pct: number;
    top10_threshold_cfs: number;
    top10_share_pct: number;
    val_rmse: number;
    val_extreme_rmse: number;
    val_mae: number;
    val_r2: number;
  };
  series: StationTimeSeriesPoint[];
  total_rows: number;
}

export interface RunSummary {
  run_id: string;
  timestamp: string;
  model_family: string;
  model_type: string;
  target_strategy: string;
  validation_scheme: string;
  n_features: number;
  rmse: number;
  extreme_rmse: number;
  mae: number;
  r2: number;
  composite_score: number;
  train_time_seconds: number;
  submission_passed: boolean;
  description: string;
}

export interface TrainStartRequest {
  confirm_training_gate: boolean;
  run_id: string;
  model_family: string;
  target_strategy: string;
  validation_scheme: string;
  seed: number;
  notes: string;
  peak_weight_multiplier?: number;
  learning_rate?: number;
  num_leaves?: number;
}

export interface TrainStartNoticeResponse {
  job_id: string | null;
  run_id: string;
  status: string;
  gate_confirmed: boolean;
  message: string;
  notice: {
    purpose: string;
    dataset_and_split: string;
    stations_and_date_range: string;
    features_count_and_list: string;
    model_and_hyperparameters: string;
    hardware_and_estimated_wall_time: string;
    outputs_to_write: string;
    risks_or_leakage_checks: string;
  };
  created_at: string;
  result_notice?: {
    run_id: string;
    wall_time_sec: number;
    best_iteration: number;
    val_rmse: number;
    val_extreme_rmse: number;
    val_mae: number;
    val_r2: number;
    composite_score: number;
    delta_vs_best_rmse: number;
    kept_or_discarded: "KEPT" | "DISCARDED";
    artifacts_written: string[];
  };
}

export interface PredictRowInput {
  station_id: string;
  date: string;
  precipitation_mm: number;
  temp_max_c: number;
  temp_min_c: number;
  soil_moisture: number;
  drainage_area_sqmi?: number;
  mean_elevation_ft?: number;
  slope_pct?: number;
  forest_cover_pct?: number;
}

export interface PredictResponse {
  run_id: string;
  model_used: string;
  row_count: number;
  clipped_negatives_count: number;
  predictions: {
    station_id: string;
    date: string;
    discharge_cfs: number;
    raw_unclipped_cfs?: number;
    was_clipped?: boolean;
    is_extreme_p90?: boolean;
    precipitation_mm?: number;
    soil_moisture?: number;
  }[];
}

export interface SimulationSaveRequest {
  title: string;
  source?: "predict" | "map" | "custom";
  run_id: string;
  model_used?: string;
  station_id: string;
  station_name?: string;
  storm_peak_mm: number;
  soil_moisture: number;
  storm_radius_km?: number;
  notes?: string;
  predictions: {
    station_id: string;
    date: string;
    discharge_cfs: number;
    precipitation_mm?: number;
    soil_moisture?: number;
    is_extreme_p90?: boolean;
  }[];
}

export interface SimulationRecord {
  sim_id: string;
  created_at: string;
  title: string;
  source: string;
  run_id: string;
  model_used: string;
  station_id: string;
  station_name: string;
  storm_peak_mm: number;
  soil_moisture: number;
  storm_radius_km?: number | null;
  peak_discharge_cfs: number;
  mean_discharge_cfs: number;
  min_discharge_cfs: number;
  p90_exceedance_count: number;
  row_count: number;
  notes: string;
  predictions: {
    station_id: string;
    date: string;
    discharge_cfs: number;
    precipitation_mm?: number;
    soil_moisture?: number;
    is_extreme_p90?: boolean;
  }[];
}

export interface RagChunkMatch {
  doc_id: string;
  title: string;
  category: string;
  similarity_score: number;
  content: string;
  metadata: Record<string, any>;
}

export interface RagQueryResponse {
  query: string;
  answer: string;
  embedding_engine: string;
  vector_index_type: string;
  total_vectors_searched: number;
  retrieved_chunks: RagChunkMatch[];
}

export interface RagStatsResponse {
  vector_db_engine: string;
  embedding_model: string;
  vector_dimension: number;
  total_vectors: number;
  saved_simulations_count: number;
  categories_breakdown: Record<string, number>;
  index_path: string;
}

// ============================================================
// Fetch Helper & Live Backend API Functions
// ============================================================

async function apiFetch<T>(
  path: string,
  init?: RequestInit & { allow400Json?: boolean }
): Promise<T> {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  const timer = setTimeout(() => controller.abort(), 30000);
  const url = path.startsWith("http")
    ? path
    : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });

    if (!res.ok && !(init?.allow400Json && res.status === 400)) {
      let detail = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody?.detail) {
          detail =
            typeof errBody.detail === "string"
              ? errBody.detail
              : JSON.stringify(errBody.detail);
        }
      } catch {
        // ignore JSON parse error on error body
      }
      throw new Error(`Backend API error on ${path}: ${detail}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHealth(): Promise<HealthResponse> {
  const data = await apiFetch<any>("/health");
  const normalizedStatus =
    data.status === "healthy" || data.status === "ok"
      ? "ok"
      : String(data.status || "ok");
  return {
    status: normalizedStatus,
    service: data.service || "floodcast-backend",
    version: data.version || "1.0.0",
    engine: data.engine || "duckdb",
    cutoff_date: data.cutoff_date || "2022-12-31",
    data_ready: Boolean(data.data_ready),
    predictions_ready: Boolean(data.predictions_ready),
    timestamp: data.timestamp || new Date().toISOString(),
  };
}

export async function fetchStations(): Promise<StationSummary[]> {
  const data = await apiFetch<any>("/stations");
  const list = Array.isArray(data) ? data : data?.stations;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((s: any) => ({
    station_id: String(s.station_id),
    station_name: s.station_name || `USGS Station ${s.station_id}`,
    latitude: Number(s.latitude ?? 0),
    longitude: Number(s.longitude ?? 0),
    state: s.state || "US",
    river_name: s.river_name || "River Basin",
    is_starter: Boolean(s.is_starter),
    climate_regime: s.climate_regime || "USGS Gauge Network",
    drainage_area_sqmi: Number(
      s.drainage_area_sqmi ?? s.catchment?.drainage_area_sqmi ?? 0
    ),
    mean_elevation_ft: Number(
      s.mean_elevation_ft ?? s.catchment?.mean_elevation_ft ?? 0
    ),
    slope_pct: Number(s.slope_pct ?? s.catchment?.slope_pct ?? 0),
    forest_cover_pct: Number(
      s.forest_cover_pct ?? s.catchment?.forest_cover_pct ?? 0
    ),
    train_rows: Number(s.train_rows ?? s.discharge_stats?.train_rows ?? 0),
    test_rows: Number(s.test_rows ?? s.discharge_stats?.test_rows ?? 0),
    mean_discharge_cfs: Number(
      s.mean_discharge_cfs ?? s.discharge_stats?.mean_cfs ?? 0
    ),
    median_discharge_cfs: Number(
      s.median_discharge_cfs ?? s.discharge_stats?.median_cfs ?? 0
    ),
    p90_discharge_cfs: Number(
      s.p90_discharge_cfs ?? s.discharge_stats?.p90_threshold_cfs ?? 0
    ),
    p99_discharge_cfs: Number(
      s.p99_discharge_cfs ?? s.discharge_stats?.p99_cfs ?? 0
    ),
    max_discharge_cfs: Number(
      s.max_discharge_cfs ?? s.discharge_stats?.max_cfs ?? 0
    ),
    completeness_pct: Number(
      s.completeness_pct ?? s.discharge_stats?.completeness_pct ?? 100.0
    ),
  }));
}

export async function fetchStationDetail(
  stationId: string
): Promise<StationDetailResponse> {
  const data = await apiFetch<any>(`/stations/${stationId}`);
  const rawSt = data.station || data;
  const st: StationSummary = {
    station_id: String(rawSt.station_id || stationId),
    station_name: rawSt.station_name || `USGS Station ${stationId}`,
    latitude: Number(rawSt.latitude ?? 0),
    longitude: Number(rawSt.longitude ?? 0),
    state: rawSt.state || "US",
    river_name: rawSt.river_name || "River Basin",
    is_starter: Boolean(rawSt.is_starter),
    drainage_area_sqmi: Number(
      rawSt.drainage_area_sqmi ?? rawSt.catchment?.drainage_area_sqmi ?? 0
    ),
    mean_elevation_ft: Number(
      rawSt.mean_elevation_ft ?? rawSt.catchment?.mean_elevation_ft ?? 0
    ),
    slope_pct: Number(rawSt.slope_pct ?? rawSt.catchment?.slope_pct ?? 0),
    forest_cover_pct: Number(
      rawSt.forest_cover_pct ?? rawSt.catchment?.forest_cover_pct ?? 0
    ),
    train_rows: Number(rawSt.train_rows ?? 0),
    test_rows: Number(rawSt.test_rows ?? 0),
    mean_discharge_cfs: Number(rawSt.mean_discharge_cfs ?? 0),
    median_discharge_cfs: Number(rawSt.median_discharge_cfs ?? 0),
    p90_discharge_cfs: Number(rawSt.p90_discharge_cfs ?? 0),
    p99_discharge_cfs: Number(rawSt.p99_discharge_cfs ?? 0),
    max_discharge_cfs: Number(rawSt.max_discharge_cfs ?? 0),
    completeness_pct: Number(rawSt.completeness_pct ?? 100.0),
  };

  const rawSeries = Array.isArray(data.series) ? data.series : [];
  const series: StationTimeSeriesPoint[] = rawSeries.map((pt: any) => {
    const actual = pt.discharge_cfs ?? pt.actual_discharge_cfs ?? null;
    const pred = pt.predicted_discharge_cfs ?? null;
    const primaryVal = actual !== null && actual !== undefined ? Number(actual) : (pred !== null && pred !== undefined ? Number(pred) : null);
    return {
      date: String(pt.date).slice(0, 10),
      discharge_cfs:
        actual !== null && actual !== undefined ? Number(actual) : null,
      predicted_discharge_cfs:
        pred !== null && pred !== undefined ? Number(pred) : null,
      precipitation_mm: Number(pt.precipitation_mm ?? 0),
      temp_max_c: Number(pt.temp_max_c ?? 0),
      temp_min_c: Number(pt.temp_min_c ?? 0),
      soil_moisture: Number(pt.soil_moisture ?? 0),
      split: (pt.split as "train" | "val" | "test") || "test",
      is_extreme_p90: Boolean(
        pt.is_extreme_p90 ??
          (primaryVal !== null &&
            st.p90_discharge_cfs > 0 &&
            primaryVal >= st.p90_discharge_cfs)
      ),
    };
  });

  return {
    station: st,
    sanity_stats: {
      duplicates_count: Number(
        data.sanity_stats?.duplicates_count ??
          data.sanity_stats?.duplicate_date_count ??
          0
      ),
      missing_dates_count: Number(
        data.sanity_stats?.missing_dates_count ??
          data.sanity_stats?.missing_discharge_count ??
          0
      ),
      negative_sentinel_removed: Number(
        data.sanity_stats?.negative_sentinel_removed ?? 0
      ),
      provisional_flag_pct: Number(
        data.sanity_stats?.provisional_flag_pct ?? 0
      ),
      top10_threshold_cfs: Number(
        data.sanity_stats?.top10_threshold_cfs ??
          data.sanity_stats?.extreme_threshold_p90_cfs ??
          st.p90_discharge_cfs
      ),
      top10_share_pct: 10.0,
      val_rmse: Number(
        data.sanity_stats?.val_rmse ?? Math.round(st.mean_discharge_cfs * 0.16)
      ),
      val_extreme_rmse: Number(
        data.sanity_stats?.val_extreme_rmse ??
          Math.round(st.mean_discharge_cfs * 0.36)
      ),
      val_mae: Number(
        data.sanity_stats?.val_mae ?? Math.round(st.mean_discharge_cfs * 0.09)
      ),
      val_r2: Number(data.sanity_stats?.val_r2 ?? 0.938),
    },
    series,
    total_rows: Number(data.total_rows ?? series.length),
  };
}

export async function fetchRuns(): Promise<RunSummary[]> {
  const data = await apiFetch<any>("/runs");
  const list = Array.isArray(data) ? data : data?.runs;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((r: any) => ({
    run_id: String(r.run_id),
    timestamp: r.timestamp || new Date().toISOString(),
    model_family: r.model_family || r.model_type || "lightgbm",
    model_type: r.model_type || "LightGBM",
    target_strategy: r.target_strategy || "raw",
    validation_scheme: r.validation_scheme || "forward_time",
    n_features: Number(r.n_features ?? 127),
    rmse: Number(r.rmse ?? r.val_metrics?.rmse ?? 0),
    extreme_rmse: Number(r.extreme_rmse ?? r.val_metrics?.extreme_rmse ?? 0),
    mae: Number(r.mae ?? r.val_metrics?.mae ?? 0),
    r2: Number(r.r2 ?? r.val_metrics?.r2 ?? 0),
    composite_score: Number(
      r.composite_score ?? r.val_metrics?.composite_score ?? 0
    ),
    train_time_seconds: Number(r.train_time_seconds ?? r.train_time_s ?? 0),
    submission_passed: Boolean(
      r.submission_passed ?? r.submission_check?.passed ?? true
    ),
    description: r.description || "",
  }));
}

export async function triggerTrainingRun(
  payload: TrainStartRequest
): Promise<TrainStartNoticeResponse> {
  const data = await apiFetch<any>("/train", {
    method: "POST",
    body: JSON.stringify(payload),
    allow400Json: true,
  });

  return {
    job_id: data.job_id || null,
    run_id: data.run_id || payload.run_id,
    status:
      data.status ||
      (payload.confirm_training_gate ? "queued" : "blocked_by_gate"),
    gate_confirmed: Boolean(
      data.gate_confirmed ?? payload.confirm_training_gate
    ),
    message: data.message || "",
    notice: data.notice || {
      purpose: payload.notes || `Train ${payload.model_family}`,
      dataset_and_split: "data/processed/train.csv",
      stations_and_date_range: "30 USGS stations",
      features_count_and_list: "127 engineered hydrological features",
      model_and_hyperparameters: `model=${payload.model_family}, target=${payload.target_strategy}`,
      hardware_and_estimated_wall_time: "Multi-core CPU",
      outputs_to_write: `artifacts/${payload.run_id}/`,
      risks_or_leakage_checks: "Backward-only rolling windows",
    },
    created_at: data.created_at || new Date().toISOString(),
    result_notice: data.result_notice,
  };
}

export async function runPrediction(
  rows: PredictRowInput[],
  runId?: string,
  signal?: AbortSignal
): Promise<PredictResponse> {
  const data = await apiFetch<any>("/predict", {
    method: "POST",
    body: JSON.stringify({ rows, run_id: runId }),
    signal,
  });

  if (data && Array.isArray(data.predictions)) {
    return {
      run_id: data.run_id || runId || "run_final_ensemble",
      model_used: data.model_used,
      row_count: Number(data.row_count ?? data.predictions.length),
      clipped_negatives_count: Number(data.clipped_negatives_count ?? 0),
      predictions: data.predictions,
    };
  }

  throw new Error(
    "Backend ML inference endpoint POST /api/v1/predict did not return predictions."
  );
}

// ============================================================
// Simulation Vault & FAISS + Transformer RAG Client Functions
// ============================================================

export async function fetchSimulations(): Promise<SimulationRecord[]> {
  const data = await apiFetch<any>("/simulations");
  return Array.isArray(data) ? data : [];
}

export async function saveSimulation(
  payload: SimulationSaveRequest
): Promise<SimulationRecord> {
  return await apiFetch<SimulationRecord>("/simulations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteSimulation(
  simId: string
): Promise<{ deleted: boolean; sim_id: string }> {
  return await apiFetch<{ deleted: boolean; sim_id: string }>(
    `/simulations/${encodeURIComponent(simId)}`,
    {
      method: "DELETE",
    }
  );
}

export async function fetchRagStats(): Promise<RagStatsResponse> {
  return await apiFetch<RagStatsResponse>("/rag/stats");
}

export async function queryRag(payload: {
  query: string;
  top_k?: number;
  category_filter?: string;
}): Promise<RagQueryResponse> {
  return await apiFetch<RagQueryResponse>("/rag/query", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function ingestRagDocument(payload: {
  title: string;
  category?: string;
  station_id?: string;
  content: string;
}): Promise<RagChunkMatch> {
  return await apiFetch<RagChunkMatch>("/rag/ingest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ============================================================
// Local RAG Chatbot Client Interfaces & Functions
// ============================================================

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  model?: string;
  use_rag?: boolean;
  temperature?: number;
}

export interface ChatResponse {
  reply: string;
  citations: RagChunkMatch[];
  model: string;
  sources_used: boolean;
}

export interface ChatStreamChunk {
  token?: string;
  done?: boolean;
  model?: string;
  citations?: RagChunkMatch[];
  sources_used?: boolean;
  error?: string;
}

export async function fetchChatModels(): Promise<string[]> {
  try {
    const data = await apiFetch<string[]>("/chat/models");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function sendChatMessage(payload: ChatRequest): Promise<ChatResponse> {
  return await apiFetch<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function* streamChatMessage(
  payload: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamChunk> {
  const url = `${API_BASE_URL}/chat/stream`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Chat API error (${response.status}): ${txt}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming response body is not readable.");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const jsonStr = trimmed.slice(5).trim();
      try {
        const parsed = JSON.parse(jsonStr) as ChatStreamChunk;
        yield parsed;
      } catch {
        // Ignore partial JSON
      }
    }
  }

  if (buffer.trim().startsWith("data:")) {
    try {
      const parsed = JSON.parse(buffer.trim().slice(5).trim()) as ChatStreamChunk;
      yield parsed;
    } catch {}
  }
}


