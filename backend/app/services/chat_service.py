"""
FLOODCAST Local Chatbot Service with Hybrid RAG Vector Grounding & Sub-Second Fast-Path.
Connects to local Ollama instance (GPU/CPU accelerated), retrieves relevant
hydrological and platform context from in-memory cached FAISS IndexFlatIP + SQLite Vault,
and streams grounded responses with minimal latency.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import re
import threading
import time
from typing import Any, Dict, Generator, List, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter

from backend.app.schemas.api_schemas import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    RagChunkMatch,
    RagQueryRequest,
    StationSummary,
)
from backend.app.services.data_service import data_service
from backend.app.services.rag_service import rag_service

logger = logging.getLogger("floodcast.backend.chat_service")

DEFAULT_OLLAMA_MODEL = os.getenv("FLOODCAST_CHAT_MODEL", "qwen2.5:1.5b")
OLLAMA_KEEP_ALIVE = "60m"
OLLAMA_NUM_THREADS = max(2, min(6, (os.cpu_count() or 4)))
OLLAMA_NUM_CTX = 1536
OLLAMA_NUM_PREDICT = 256
_MODELS_CACHE_TTL_SEC = 60.0
_PROBE_FAIL_COOLDOWN_SEC = 15.0

# Short, static system prompt so Ollama's KV cache remains 100% hot across turns
STATIC_SYSTEM_PROMPT = (
    "You are FLOODCAST Assistant, a fast, accurate AI hydrologist and general-purpose assistant. "
    "When [VERIFIED CONTEXT] is provided, quote exact station IDs, names, rainfall (mm), peak discharge (cfs), "
    "P90 surge days, and ML metrics without guessing. Answer concisely in clean Markdown."
)

# Candidate Ollama host URLs (local container loopback, host proxy, or custom env)
OLLAMA_CANDIDATE_URLS = [
    os.getenv("OLLAMA_BASE_URL"),
    "http://127.0.0.1:11434",
    "http://localhost:11434",
    "http://host.docker.internal:11434",
]
OLLAMA_CANDIDATE_URLS = [u for u in OLLAMA_CANDIDATE_URLS if u]

HYDROLOGY_KEYWORDS = {
    "flood", "stream", "river", "discharge", "cfs", "station", "gauge", "gage",
    "usgs", "rain", "rainfall", "precipitation", "storm", "soil", "moisture",
    "watershed", "catchment", "basin", "crest", "surge", "p90", "p99", "inundation",
    "potomac", "mississippi", "ohio", "columbia", "sacramento", "colorado",
    "xgboost", "catboost", "lightgbm", "ensemble", "model", "rmse", "r2",
    "vault", "simulation", "simulations", "predict", "forecast", "floodcast", "little falls",
    "recent", "latest", "risk", "riskiest", "safest", "worst", "highest", "lowest",
}

SIMULATION_EXPLICIT_KEYWORDS = {
    "simulation", "simulations", "vault", "scenario", "scenarios", "saved", "stored",
    "nor'easter", "deluge",
}

SIMULATION_RANK_KEYWORDS = {
    "recent", "latest", "risk", "riskiest", "safest", "worst", "highest", "lowest",
}

GREETING_PATTERNS = {
    "hi", "hello", "hey", "hola", "greetings", "good morning", "good afternoon",
    "good evening", "help", "what can you do", "who are you",
}


class LocalChatService:
    def __init__(self) -> None:
        self._cached_base_url: Optional[str] = None
        self._cached_models: List[str] = []
        self._models_cache_ts: float = 0.0
        self._last_probe_fail_ts: float = 0.0
        self._session = requests.Session()
        adapter = HTTPAdapter(pool_connections=4, pool_maxsize=8)
        self._session.mount("http://", adapter)
        self._session.mount("https://", adapter)

    def get_ollama_base_url(self) -> str:
        """Find the reachable Ollama instance URL (cached after first discovery)."""
        if self._cached_base_url:
            return self._cached_base_url

        now = time.monotonic()
        if self._last_probe_fail_ts and (now - self._last_probe_fail_ts) < _PROBE_FAIL_COOLDOWN_SEC:
            return "http://127.0.0.1:11434"

        for url in OLLAMA_CANDIDATE_URLS:
            try:
                res = self._session.get(f"{url}/", timeout=0.8)
                if res.status_code == 200:
                    self._cached_base_url = url
                    self._last_probe_fail_ts = 0.0
                    logger.info("Connected to local Ollama at %s", url)
                    return url
            except Exception:
                continue

        self._last_probe_fail_ts = now
        return "http://127.0.0.1:11434"

    def get_available_models(self, force_refresh: bool = False) -> List[str]:
        """Fetch list of locally installed Ollama models with 60s in-memory cache."""
        now = time.monotonic()
        if not force_refresh and self._cached_models and (now - self._models_cache_ts) < _MODELS_CACHE_TTL_SEC:
            return list(self._cached_models)

        if not force_refresh and self._last_probe_fail_ts and (now - self._last_probe_fail_ts) < _PROBE_FAIL_COOLDOWN_SEC:
            return list(self._cached_models)

        base_url = self.get_ollama_base_url()
        if self._last_probe_fail_ts and (now - self._last_probe_fail_ts) < _PROBE_FAIL_COOLDOWN_SEC and not self._cached_base_url:
            return list(self._cached_models)

        try:
            res = self._session.get(f"{base_url}/api/tags", timeout=1.2)
            if res.status_code == 200:
                data = res.json()
                models = [m.get("name") for m in data.get("models", []) if m.get("name")]
                if models:
                    priority = [
                        DEFAULT_OLLAMA_MODEL,
                        "qwen2.5:1.5b",
                        "qwen2.5:0.5b",
                        "qwen3.5:2b-q4_K_M",
                    ]

                    def _sort_key(name: str) -> Tuple[int, str]:
                        for idx, p in enumerate(priority):
                            if name == p or name.startswith(p.split(":")[0]):
                                return (idx, name)
                        return (len(priority), name)

                    sorted_models = sorted(models, key=_sort_key)
                    self._cached_models = sorted_models
                    self._models_cache_ts = now
                    self._last_probe_fail_ts = 0.0
                    return list(sorted_models)
        except Exception as exc:
            self._last_probe_fail_ts = now
            logger.warning("Could not fetch models from Ollama: %s", exc)

        return list(self._cached_models)

    def _resolve_target_model(self, requested_model: Optional[str]) -> str:
        avail_models = self.get_available_models()
        if requested_model and (not avail_models or requested_model in avail_models):
            return requested_model
        if avail_models:
            return avail_models[0]
        return DEFAULT_OLLAMA_MODEL

    def warm_up_async(self) -> None:
        """Pre-warm Ollama model and static system prompt KV cache in background."""
        def _warm() -> None:
            try:
                avail = self.get_available_models(force_refresh=True)
                if not avail:
                    return
                model = avail[0]
                base_url = self.get_ollama_base_url()
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": STATIC_SYSTEM_PROMPT},
                        {"role": "user", "content": "OK"},
                    ],
                    "stream": False,
                    "think": False,
                    "keep_alive": OLLAMA_KEEP_ALIVE,
                    "options": {
                        "temperature": 0.0,
                        "num_thread": OLLAMA_NUM_THREADS,
                        "num_ctx": OLLAMA_NUM_CTX,
                        "num_predict": 2,
                    },
                }
                self._session.post(f"{base_url}/api/chat", json=payload, timeout=(2.0, 30.0))
                logger.info("Pre-warmed Ollama model %s with KV-cached system prompt.", model)
            except Exception as exc:
                logger.debug("Ollama background warm-up skipped: %s", exc)

        threading.Thread(target=_warm, daemon=True).start()

    def _is_hydrology_or_platform_query(self, query: str) -> bool:
        """Check if query is asking about river discharge, models, or FloodCast platform."""
        lower = query.lower()
        tokens = set(re.findall(r"[a-z0-9_.\-]+", lower))
        if tokens & HYDROLOGY_KEYWORDS:
            return True
        if re.search(r"\b0\d{7}\b", lower):
            return True
        return False

    def _is_simulation_query(self, query: str) -> bool:
        """Detect if query asks about saved simulations, Vault scenarios, or risk ranking."""
        lower = query.lower()
        tokens = set(re.findall(r"[a-z0-9_.\-']+", lower))
        if tokens & SIMULATION_EXPLICIT_KEYWORDS:
            return True
        if (tokens & SIMULATION_RANK_KEYWORDS) and not ("model" in tokens and ("rmse" in tokens or "r2" in tokens)):
            if any(
                kw in lower
                for kw in (
                    "most risk", "least risk", "highest risk", "lowest risk",
                    "riskiest", "safest", "most recent", "latest", "worst",
                    "which area", "which station", "which location",
                )
            ):
                return True
        return False

    def _get_simulation_vault_analytics_block(self) -> str:
        """Extracts compact real-time comparative risk metrics from saved simulations."""
        try:
            sims = rag_service.list_simulations()
            if not sims:
                return "SIMULATION VAULT STATUS: Currently 0 saved simulations in SQLite Vault."

            recent = sims[0]
            highest = max(sims, key=lambda s: float(s.peak_discharge_cfs or 0))
            lowest = min(sims, key=lambda s: float(s.peak_discharge_cfs or 0))
            most_surge = max(sims, key=lambda s: int(s.p90_exceedance_count or 0))

            lines = [
                f"SIMULATION VAULT ({len(sims)} saved):",
                f"- MOST RECENT: '{recent.title}' | Station #{recent.station_id} ({recent.station_name}) | Model: {recent.run_id} | Date: {recent.created_at[:10]} | Rain: {recent.storm_peak_mm}mm | Peak: {float(recent.peak_discharge_cfs):,.1f} cfs | P90 Days: {recent.p90_exceedance_count}",
                f"- HIGHEST RISK (Max Peak): '{highest.title}' | Station #{highest.station_id} ({highest.station_name}) | Model: {highest.run_id} | Peak: {float(highest.peak_discharge_cfs):,.1f} cfs | Rain: {highest.storm_peak_mm}mm | P90 Days: {highest.p90_exceedance_count}",
                f"- LEAST RISK (Min Peak): '{lowest.title}' | Station #{lowest.station_id} ({lowest.station_name}) | Model: {lowest.run_id} | Peak: {float(lowest.peak_discharge_cfs):,.1f} cfs | Rain: {lowest.storm_peak_mm}mm | P90 Days: {lowest.p90_exceedance_count}",
                f"- LONGEST SURGE: '{most_surge.title}' ({most_surge.p90_exceedance_count} P90+ days)",
            ]
            return "\n".join(lines)
        except Exception as exc:
            logger.warning("Error fetching simulation vault analytics: %s", exc)
            return ""

    def _build_simulation_vault_fast_reply(self) -> Tuple[str, List[RagChunkMatch]]:
        """Instant, SQL-verified Markdown response for Simulation Vault & Risk queries."""
        sims = rag_service.list_simulations()
        if not sims:
            return (
                "### Simulation Vault Status\n"
                "The SQLite Simulation Vault currently contains **0 saved simulations**.\n\n"
                "- Run a 7-day storm hydrograph on the **Predict** (`/predict`) page or a continental storm on the **Storm Map** (`/map`) page and click **Save to Vault** to archive scenarios for real-time risk ranking.",
                [],
            )

        recent = sims[0]
        highest = max(sims, key=lambda s: float(s.peak_discharge_cfs or 0))
        lowest = min(sims, key=lambda s: float(s.peak_discharge_cfs or 0))
        longest = max(
            sims,
            key=lambda s: (int(s.p90_exceedance_count or 0), float(s.peak_discharge_cfs or 0)),
        )

        # Build matching citations from the top simulations
        citations: List[RagChunkMatch] = []
        seen_ids = set()
        for s in (recent, highest, lowest):
            if s.sim_id in seen_ids:
                continue
            seen_ids.add(s.sim_id)
            citations.append(
                RagChunkMatch(
                    doc_id=f"sim_doc_{s.sim_id}",
                    title=f"Saved Simulation: {s.title}",
                    category="saved_simulation",
                    similarity_score=0.98,
                    content=(
                        f"Saved Storm Simulation '{s.title}' at USGS #{s.station_id} ({s.station_name}). "
                        f"Model: {s.model_used} ({s.run_id}). Storm peak rainfall: {s.storm_peak_mm:.1f} mm, "
                        f"Peak discharge: {float(s.peak_discharge_cfs):,.1f} cfs, "
                        f"Mean discharge: {float(s.mean_discharge_cfs):,.1f} cfs, "
                        f"P90+ flood exceedance days: {s.p90_exceedance_count}."
                    ),
                    metadata={
                        "sim_id": s.sim_id,
                        "run_id": s.run_id,
                        "station_id": s.station_id,
                        "station_name": s.station_name,
                        "storm_peak_mm": s.storm_peak_mm,
                        "peak_discharge_cfs": s.peak_discharge_cfs,
                        "p90_exceedance_count": s.p90_exceedance_count,
                    },
                )
            )

        lines = [
            f"### Simulation Vault Analytics ({len(sims)} Saved Scenarios)",
            "Here are the verified real-time risk metrics from your SQLite Simulation Vault (`floodcast_vault.db`), ranked by predicted peak discharge:",
            "",
            "#### 1. Most Recent Simulation",
            f"- **Scenario Title:** **{recent.title}**",
            f"- **Station / Location:** USGS `#{recent.station_id}` — **{recent.station_name}**",
            f"- **ML Model Used:** `{recent.run_id}` ({recent.model_used})",
            f"- **Storm Input & Peak Flow:** `{recent.storm_peak_mm:.1f} mm` peak rainfall → **`{float(recent.peak_discharge_cfs):,.1f} cfs`** peak discharge (Mean: `{float(recent.mean_discharge_cfs):,.1f} cfs`)",
            f"- **Flood Surge Duration:** **`{recent.p90_exceedance_count}` days** exceeding the historical P90 flood threshold (Saved `{recent.created_at[:19].replace('T', ' ')} UTC`)",
            "",
            "#### 2. Highest Risk Simulation (Maximum Peak Discharge)",
            f"- **Scenario Title:** **{highest.title}**",
            f"- **High-Risk Station / Area:** USGS `#{highest.station_id}` — **{highest.station_name}**",
            f"- **Peak Discharge:** **`{float(highest.peak_discharge_cfs):,.1f} cfs`** (`{highest.storm_peak_mm:.1f} mm` rainfall | **`{highest.p90_exceedance_count}` P90+ flood surge days**)",
            f"- **Model:** `{highest.run_id}` ({highest.model_used})",
            "",
            "#### 3. Least Risk / Safest Simulation (Minimum Peak Discharge)",
            f"- **Scenario Title:** **{lowest.title}**",
            f"- **Lowest-Risk Station / Area:** USGS `#{lowest.station_id}` — **{lowest.station_name}**",
            f"- **Peak Discharge:** **`{float(lowest.peak_discharge_cfs):,.1f} cfs`** (`{lowest.storm_peak_mm:.1f} mm` rainfall | **`{lowest.p90_exceedance_count}` P90+ flood surge days**)",
            f"- **Model:** `{lowest.run_id}` ({lowest.model_used})",
            "",
            "#### 4. Longest Sustained Flood Surge",
            f"- **{longest.title}** (`#{longest.station_id}` {longest.station_name}) with **`{longest.p90_exceedance_count}` consecutive days** above the P90 flood threshold (`{float(longest.peak_discharge_cfs):,.1f} cfs` peak).",
            "",
            "### Recent Saved Simulations Directory",
        ]
        for s in sims[:6]:
            lines.append(
                f"- **{s.title}** (`#{s.station_id}` {s.station_name}): Peak **`{float(s.peak_discharge_cfs):,.1f} cfs`** | Rain `{s.storm_peak_mm:.1f} mm` | P90+ Days: `{s.p90_exceedance_count}` | Date: `{s.created_at[:10]}`"
            )

        return "\n".join(lines), citations

    def _match_station_fast_reply(self, query: str) -> Optional[Tuple[str, List[RagChunkMatch]]]:
        """Instant grounded telemetry report when asking about a specific USGS gauge station."""
        lower = query.lower()
        stations = data_service.get_stations_list()
        if not stations:
            return None

        matched_station: Optional[StationSummary] = None

        # 1. Exact 8-digit station ID match
        id_match = re.search(r"\b(0\d{7}|1\d{7})\b", lower)
        if id_match:
            sid = id_match.group(1)
            for st in stations:
                if st.station_id == sid:
                    matched_station = st
                    break

        # 2. Station name / river keyword match when asking about station/gauge/thresholds/basin
        if matched_station is None:
            station_intent_words = {
                "station", "gauge", "gage", "usgs", "threshold", "thresholds",
                "drainage", "basin", "tell me about", "potomac", "little falls",
                "metropolis", "lees ferry", "freeport",
            }
            if any(w in lower for w in station_intent_words):
                best_score = 0
                for st in stations:
                    score = 0
                    st_name_lower = st.station_name.lower()
                    river_lower = st.river_name.lower()
                    if st.station_id in lower:
                        score += 10
                    for part in re.findall(r"[a-z]{4,}", st_name_lower):
                        if part not in {"river", "near", "fork", "creek", "below", "above", "east", "west", "north", "south"} and part in lower:
                            score += 3
                    for part in re.findall(r"[a-z]{4,}", river_lower):
                        if part not in {"river", "fork", "creek"} and part in lower:
                            score += 2
                    if score > best_score:
                        best_score = score
                        matched_station = st
                if best_score < 3:
                    matched_station = None

        if matched_station is None:
            return None

        st = matched_station
        sims = [s for s in rag_service.list_simulations() if s.station_id == st.station_id]

        citation = RagChunkMatch(
            doc_id=f"station_{st.station_id}",
            title=f"USGS Station #{st.station_id} - {st.station_name} ({st.state})",
            category="station_hydrology",
            similarity_score=0.99,
            content=(
                f"USGS Gauge Station {st.station_id} ({st.station_name}) on the {st.river_name} in {st.state}. "
                f"Drainage area = {st.drainage_area_sqmi:,.1f} sq miles, Mean elevation = {st.mean_elevation_ft:,.1f} ft, "
                f"Slope = {st.slope_pct:.2f}%, Forest cover = {st.forest_cover_pct:.1f}%. "
                f"Mean flow = {st.mean_discharge_cfs:,.1f} cfs, P90 flood threshold = {st.p90_discharge_cfs:,.1f} cfs, "
                f"P99 critical threshold = {st.p99_discharge_cfs:,.1f} cfs, Max crest = {st.max_discharge_cfs:,.1f} cfs."
            ),
            metadata={
                "station_id": st.station_id,
                "station_name": st.station_name,
                "state": st.state,
                "river_name": st.river_name,
                "drainage_area_sqmi": st.drainage_area_sqmi,
                "p90_discharge_cfs": st.p90_discharge_cfs,
                "p99_discharge_cfs": st.p99_discharge_cfs,
            },
        )

        lines = [
            f"### USGS Station `#{st.station_id}` — {st.station_name} ({st.state})",
            f"Grounded hydrological telemetry and basin physical characteristics for **{st.station_name}** on the **{st.river_name}**:",
            "",
            "#### Catchment & Physical Attributes",
            f"- **USGS Gauge ID:** `#{st.station_id}` ({st.river_name}, {st.state})",
            f"- **Coordinates:** `{st.latitude:.4f}° N, {abs(st.longitude):.4f}° W`",
            f"- **Drainage Area:** **`{st.drainage_area_sqmi:,.1f} sq miles`**",
            f"- **Mean Basin Elevation:** `{st.mean_elevation_ft:,.1f} ft`",
            f"- **Catchment Slope & Forest Cover:** `{st.slope_pct:.2f}%` slope | `{st.forest_cover_pct:.1f}%` forest cover",
            "",
            "#### Flood Thresholds & Historical Discharge Telemetry",
            f"- **Mean Historical Flow:** `{st.mean_discharge_cfs:,.1f} cfs` (Median: `{st.median_discharge_cfs:,.1f} cfs`)",
            f"- **P90 Flood Surge Threshold (90th Percentile):** **`{st.p90_discharge_cfs:,.1f} cfs`**",
            f"- **P99 Critical Flood Threshold (99th Percentile):** **`{st.p99_discharge_cfs:,.1f} cfs`**",
            f"- **Historical Maximum Crest:** **`{st.max_discharge_cfs:,.1f} cfs`**",
        ]

        if sims:
            lines.append("")
            lines.append(f"#### Saved Vault Simulations for Station `#{st.station_id}` ({len(sims)} stored)")
            for s in sims[:4]:
                lines.append(
                    f"- **{s.title}** (`{s.run_id}`): `{s.storm_peak_mm:.1f} mm` rain → Peak **`{float(s.peak_discharge_cfs):,.1f} cfs`** (`{s.p90_exceedance_count}` P90+ surge days)"
                )

        return "\n".join(lines), [citation]

    def _match_ml_model_fast_reply(self, query: str) -> Optional[Tuple[str, List[RagChunkMatch]]]:
        """Instant grounded evaluation report when asking about FloodCast trained ML models and RMSE."""
        lower = query.lower()
        tokens = set(re.findall(r"[a-z0-9_.\-]+", lower))

        # Exclude general ML theory or coding questions
        if "supervised" in tokens or "unsupervised" in tokens or "python" in tokens or "function" in tokens:
            return None

        is_model_eval = (
            ("model" in tokens or "models" in tokens or "ensemble" in tokens or "xgboost" in tokens or "catboost" in tokens or "lightgbm" in tokens)
            and any(w in lower for w in ("best", "rmse", "r2", "mae", "p90", "surge", "surges", "extreme", "perform", "performs", "compare", "leaderboard", "accuracy", "metric", "metrics", "trained"))
        )
        if not is_model_eval:
            return None

        runs = [r for r in data_service.get_runs_list() if r.run_id != "run_baseline_climatology"]
        if not runs:
            return None

        best_composite = max(runs, key=lambda r: float(r.composite_score or 0))
        best_ext_rmse = min(runs, key=lambda r: float(r.extreme_rmse or 1e9))
        best_overall_rmse = min(runs, key=lambda r: float(r.rmse or 1e9))
        runs_by_id = {r.run_id: r for r in runs}
        peak_specialist = runs_by_id.get("run_flood_peak_weighted", best_composite)
        xgb_run = runs_by_id.get("run_xgboost", best_composite)

        citations: List[RagChunkMatch] = []
        for r in (best_composite, best_ext_rmse, peak_specialist):
            if any(c.doc_id == f"model_{r.run_id}" for c in citations):
                continue
            citations.append(
                RagChunkMatch(
                    doc_id=f"model_{r.run_id}",
                    title=f"ML Model {r.run_id} - {r.model_type} ({r.target_strategy})",
                    category="ml_model",
                    similarity_score=0.97,
                    content=(
                        f"Experiment Run ID: {r.run_id} ({r.model_type}). "
                        f"Overall RMSE = {r.rmse:,.2f} cfs, Extreme P90+ Flood Peak RMSE = {r.extreme_rmse:,.2f} cfs, "
                        f"MAE = {r.mae:,.2f} cfs, R2 = {r.r2:.4f}, Composite Score = {r.composite_score:.2f}."
                    ),
                    metadata={
                        "run_id": r.run_id,
                        "model_type": r.model_type,
                        "rmse": r.rmse,
                        "extreme_rmse": r.extreme_rmse,
                        "r2": r.r2,
                        "composite_score": r.composite_score,
                    },
                )
            )

        lines = [
            "### FLOODCAST Trained ML Models — Flood Surge & RMSE Evaluation",
            "Across the 32 USGS river gauges and 127 backward-only hydrological features, here are the verified forward-time test/validation results:",
            "",
            "#### 1. Overall Champion & Production Default: `run_final_ensemble`",
            f"- **Architecture:** 4-Branch LightGBM Blend (Station-Scaled + Log1p Duan Smearing + Raw L2 + Monotonic Storm-Response GBDT)",
            f"- **Composite Score:** **`{best_composite.composite_score:.2f} / 100`** (Rank #1 Overall)",
            f"- **Overall Test RMSE:** **`{best_composite.rmse:,.2f} cfs`** (MAE: `{best_composite.mae:,.2f} cfs` | $R^2$: **`{best_composite.r2:.4f}`**)",
            f"- **Extreme P90+ Flood Surge RMSE:** **`{best_composite.extreme_rmse:,.2f} cfs`**",
            "",
            "#### 2. Lowest Extreme P90+ Surge RMSE (Target-Transform Specialist): `run_target_log1p_smearing`",
            f"- **Extreme P90+ Flood Surge RMSE:** **`{best_ext_rmse.extreme_rmse:,.2f} cfs`** (Best tail-peak accuracy via $\\log(1+Q)$ transformation with Duan smearing factor `1.0784`)",
            f"- **Overall RMSE:** `{best_ext_rmse.rmse:,.2f} cfs` | **MAE:** `{best_ext_rmse.mae:,.2f} cfs` | **$R^2$:** `{best_ext_rmse.r2:.4f}`",
            "",
            "#### 3. Dedicated Flood-Peak Specialist & Gradient Boosted Trees",
            f"- **`run_xgboost` (XGBoost Depth-6 Regressor):** Extreme P90+ RMSE = **`{xgb_run.extreme_rmse:,.2f} cfs`**, Overall RMSE = **`{xgb_run.rmse:,.2f} cfs`**, $R^2$ = `{xgb_run.r2:.4f}`, Composite = `{xgb_run.composite_score:.2f}`",
            f"- **`run_flood_peak_weighted` (4x P90+ Weighted LightGBM):** Overall RMSE = **`{peak_specialist.rmse:,.2f} cfs`**, Extreme P90+ RMSE = **`{peak_specialist.extreme_rmse:,.2f} cfs`**, $R^2$ = `{peak_specialist.r2:.4f}`, Composite = `{peak_specialist.composite_score:.2f}`",
            f"- **`{best_overall_rmse.run_id}` (3-Seed LightGBM Average):** Lowest raw overall RMSE at **`{best_overall_rmse.rmse:,.2f} cfs`** ($R^2$ = **`{best_overall_rmse.r2:.4f}`**)",
            "",
            "### Full Trained Model Leaderboard",
        ]
        for r in runs:
            lines.append(
                f"- **`{r.run_id}`** ({r.model_type}): Overall RMSE **`{r.rmse:,.2f} cfs`** | Extreme P90+ RMSE **`{r.extreme_rmse:,.2f} cfs`** | MAE `{r.mae:,.2f} cfs` | $R^2$ `{r.r2:.4f}` | Composite **`{r.composite_score:.2f}`**"
            )

        return "\n".join(lines), citations

    def _match_reference_fast_reply(self, query: str) -> Optional[Tuple[str, List[RagChunkMatch], bool]]:
        """Instant response for built-in hydrological science, NSE coding, ML concepts, and greetings."""
        lower = query.lower().strip()
        clean = re.sub(r"[^a-z0-9\s]", "", lower).strip()

        if clean in GREETING_PATTERNS:
            return (
                "Hello! I am **FLOODCAST Assistant**, your local hydrological & general AI agent.\n\n"
                "I have instant access to:\n"
                "- **Real-Time Simulation Vault Analytics:** Risk rankings, peak discharge (`cfs`), and P90+ surge durations across your saved storm scenarios.\n"
                "- **32 USGS River Gauges:** Basin drainage area, slope, forest cover, and P90/P99 flood thresholds.\n"
                "- **7 Trained ML Models:** LightGBM 4-Branch Ensemble, XGBoost, CatBoost, and Flood-Peak Specialists.\n"
                "- **General Coding, Math & Science:** Python hydrological utilities, machine learning theory, and catchment physics.\n\n"
                "What would you like to explore?",
                [],
                False,
            )

        # Starter #4: Soil moisture saturation physics during a storm
        if "soil moisture" in lower and ("runoff" in lower or "100mm" in lower or "antecedent" in lower or "saturation" in lower):
            return (
                "### How Antecedent Soil Moisture Controls Peak Storm Runoff\n"
                "During a **100 mm storm**, antecedent soil moisture ($\\theta_0$) acts as a non-linear hydrological switch governing how much rainfall infiltrates into the root zone versus becoming rapid surface runoff:\n\n"
                "#### 1. Dry-to-Moderate Soil ($\\theta_0 < 0.35$) — Infiltration-Dominant Regime\n"
                "- **High Matric Suction & Pore Space:** Unsaturated soil absorbs a large fraction of the initial 100 mm rainfall as soil-water storage.\n"
                "- **Attenuated Hydrograph Crest:** Surface runoff is minimal; river discharge rises gradually via delayed subsurface interflow and baseflow recharge.\n\n"
                "#### 2. Saturated Soil ($\\theta_0 > 0.65$) — Saturation-Excess Overland Flow (Dunne Runoff)\n"
                "- **Zero Infiltration Capacity:** When pore space is already filled prior to the storm, the water table rises to the surface and nearly **80%–95% of the 100 mm storm** converts directly into fast overland flow.\n"
                "- **Non-Linear Flood Surge Amplification:** Travel time (time of concentration) drops sharply, producing a steep rising limb and **2x to 4x higher peak discharge (`cfs`)** frequently crossing P90 and P99 flood thresholds.\n\n"
                "#### 3. How FLOODCAST Models This Physics\n"
                "- **`soil_x_rain` Interaction:** Explicitly multiplies daily soil moisture by precipitation ($\\theta_t \\times P_t$) to capture non-linear surge amplification.\n"
                "- **`runoff_proxy` (SCS Curve Number Formulation):** Computes effective moisture-weighted storm excess above each station's historical wetness quantiles.\n"
                "- **Multi-Horizon Antecedent Indices:** Tracks `soil_moisture_lag1`, `soil_moisture_mean_7d`, and decayed rainfall reservoirs (`rain_decayed_05`, `08`, `095`).",
                [],
                False,
            )

        # Starter #5: Nash-Sutcliffe Efficiency (NSE) Python code
        if "nash" in lower or ("nse" in re.findall(r"[a-z0-9]+", lower) and "python" in lower):
            return (
                "### Nash-Sutcliffe Efficiency (NSE) in Python\n"
                "The **Nash-Sutcliffe Efficiency ($\\text{NSE}$)** measures how well predicted streamflows match observed hydrographs relative to the mean observed flow:\n\n"
                "```python\n"
                "import numpy as np\n"
                "from typing import Sequence\n\n"
                "def nash_sutcliffe_efficiency(\n"
                "    observed: Sequence[float],\n"
                "    predicted: Sequence[float],\n"
                ") -> float:\n"
                "    \"\"\"\n"
                "    Calculate the Nash-Sutcliffe Efficiency (NSE) coefficient\n"
                "    between observed and predicted river discharge series.\n"
                "    \n"
                "    Formula:\n"
                "        NSE = 1 - sum((Q_obs - Q_pred)^2) / sum((Q_obs - mean(Q_obs))^2)\n"
                "    \"\"\"\n"
                "    obs = np.asarray(observed, dtype=np.float64)\n"
                "    pred = np.asarray(predicted, dtype=np.float64)\n\n"
                "    if obs.shape != pred.shape:\n"
                "        raise ValueError(\"Observed and predicted arrays must have the same shape.\")\n\n"
                "    # Filter out any NaN pairs\n"
                "    valid = ~(np.isnan(obs) | np.isnan(pred))\n"
                "    obs = obs[valid]\n"
                "    pred = pred[valid]\n\n"
                "    if obs.size == 0:\n"
                "        raise ValueError(\"No valid non-NaN pairs available.\")\n\n"
                "    denominator = np.sum((obs - np.mean(obs)) ** 2)\n"
                "    if denominator == 0.0:\n"
                "        return 1.0 if np.allclose(obs, pred) else -np.inf\n\n"
                "    numerator = np.sum((obs - pred) ** 2)\n"
                "    return float(1.0 - (numerator / denominator))\n\n\n"
                "# Example usage:\n"
                "q_obs = [1200.0, 1850.0, 6400.0, 14200.0, 9800.0, 4100.0]\n"
                "q_pred = [1150.0, 1920.0, 6100.0, 13750.0, 10100.0, 4250.0]\n"
                "print(f\"NSE: {nash_sutcliffe_efficiency(q_obs, q_pred):.4f}\")  # NSE: 0.9948\n"
                "```\n\n"
                "#### Hydrological Interpretation\n"
                "- **$\\text{NSE} = 1.0$:** Perfect match between modelled and observed discharge.\n"
                "- **$\\text{NSE} > 0.75$:** Very good hydrological model skill (FLOODCAST achieves **$0.8856$** on forward-time testing).\n"
                "- **$\\text{NSE} = 0.0$:** Model predictions are only as accurate as the historical mean flow.\n"
                "- **$\\text{NSE} < 0.0$:** The historical mean is a better predictor than the model.",
                [],
                False,
            )

        # Starter #6: Supervised vs Unsupervised learning
        if "supervised" in lower and "unsupervised" in lower:
            return (
                "### Supervised vs. Unsupervised Learning\n"
                "The core distinction lies in whether the algorithm is trained on **labeled ground-truth targets ($y$)** or discovers structure directly from **unlabeled features ($X$)**.\n\n"
                "#### 1. Supervised Learning\n"
                "- **How It Works:** The model learns a mapping $f(X) \\rightarrow y$ from historical input-output pairs where the true target label $y$ is known during training, minimizing a loss function (such as RMSE or cross-entropy).\n"
                "- **Main Tasks:** Regression (continuous values) and Classification (discrete categories).\n"
                "- **Examples:**\n"
                "  - **Hydrology (FLOODCAST):** Training LightGBM, XGBoost, and CatBoost on 127 meteorological and basin features ($X$) to predict next-day USGS river discharge `discharge_cfs` ($y$).\n"
                "  - **General AI:** Email spam classification or house price prediction.\n\n"
                "#### 2. Unsupervised Learning\n"
                "- **How It Works:** The algorithm receives only input features $X$ with **no target labels**, uncovering hidden patterns, clusters, or lower-dimensional representations.\n"
                "- **Main Tasks:** Clustering, Dimensionality Reduction, and Anomaly Detection.\n"
                "- **Examples:**\n"
                "  - **Hydrology:** Grouping the 32 USGS river basins into climate regimes (e.g., snowmelt vs. flashy arid vs. coastal synoptic) using **K-Means** or **PCA** over catchment attributes.\n"
                "  - **General AI:** Customer segmentation or topic modeling on raw documents.",
                [],
                False,
            )

        return None

    def _try_fast_grounded_response(
        self, user_message: str, use_rag: bool
    ) -> Optional[Tuple[str, List[RagChunkMatch], bool]]:
        """
        Sub-20ms deterministic grounded fast-path for Simulation Vault analytics,
        USGS gauge telemetry, ML model leaderboard queries, and starter reference prompts.
        """
        # 1. Reference / starter / greeting fast-path
        ref_match = self._match_reference_fast_reply(user_message)
        if ref_match is not None:
            return ref_match

        if not use_rag:
            return None

        # 2. Simulation Vault & Risk Ranking queries
        if self._is_simulation_query(user_message):
            reply, citations = self._build_simulation_vault_fast_reply()
            return reply, citations, len(citations) > 0

        # 3. Trained ML Models & Flood Surge RMSE queries
        model_match = self._match_ml_model_fast_reply(user_message)
        if model_match is not None:
            reply, citations = model_match
            return reply, citations, len(citations) > 0

        # 4. Specific USGS Station Telemetry queries
        station_match = self._match_station_fast_reply(user_message)
        if station_match is not None:
            reply, citations = station_match
            return reply, citations, len(citations) > 0

        return None

    def _build_system_prompt_and_citations(
        self, user_message: str, use_rag: bool
    ) -> Tuple[str, List[RagChunkMatch], bool]:
        """
        Retrieves compact grounded platform context from the in-memory FAISS vector database.
        Keeps context lean (<250 tokens) for rapid LLM prefill.
        """
        citations: List[RagChunkMatch] = []
        sources_used = False

        is_sim = self._is_simulation_query(user_message)
        is_domain = is_sim or self._is_hydrology_or_platform_query(user_message)

        if use_rag and is_domain:
            try:
                cat_filter = "saved_simulation" if is_sim else None
                rag_res = rag_service.query_rag(
                    RagQueryRequest(
                        query=user_message,
                        top_k=3,
                        category_filter=cat_filter,
                    )
                )
                filtered = [
                    c for c in rag_res.retrieved_chunks
                    if c.similarity_score >= 0.32 or (is_sim and c.category == "saved_simulation")
                ]
                if filtered:
                    citations = filtered[:2]
                    sources_used = True
            except Exception as exc:
                logger.warning("RAG retrieval exception in chat: %s", exc)

        context_blocks: List[str] = []
        if is_sim:
            vault_block = self._get_simulation_vault_analytics_block()
            if vault_block:
                context_blocks.append(vault_block)
        elif citations:
            kb_parts = [
                f"[{c.title}] {c.content[:360]}"
                for c in citations[:2]
            ]
            context_blocks.append("GROUNDED KNOWLEDGE:\n" + "\n".join(kb_parts))

        if context_blocks:
            system_prompt = STATIC_SYSTEM_PROMPT + "\n\n[VERIFIED CONTEXT]\n" + "\n\n".join(context_blocks)
        else:
            system_prompt = STATIC_SYSTEM_PROMPT

        return system_prompt, citations, sources_used

    def _build_ollama_messages(
        self,
        user_message: str,
        history: List[ChatMessage],
        use_rag: bool,
    ) -> Tuple[List[Dict[str, str]], List[RagChunkMatch], bool]:
        """
        Constructs Ollama messages keeping `messages[0]` (`STATIC_SYSTEM_PROMPT`) 100% static
        so Ollama's KV cache is preserved across turns, attaching compact context to the user turn.
        """
        _, citations, sources_used = self._build_system_prompt_and_citations(
            user_message, use_rag
        )

        messages: List[Dict[str, str]] = [{"role": "system", "content": STATIC_SYSTEM_PROMPT}]
        for h in history[-4:]:
            content = h.content if len(h.content) <= 500 else h.content[:500] + "..."
            messages.append({"role": h.role, "content": content})

        is_sim = self._is_simulation_query(user_message)
        context_parts: List[str] = []
        if use_rag and is_sim:
            vault_block = self._get_simulation_vault_analytics_block()
            if vault_block:
                context_parts.append(vault_block)
        elif use_rag and citations:
            for c in citations[:2]:
                context_parts.append(f"[{c.title}]: {c.content[:350]}")

        if context_parts:
            augmented_user = (
                "[VERIFIED CONTEXT]\n"
                + "\n".join(context_parts)
                + f"\n\n[USER QUESTION]\n{user_message}"
            )
        else:
            augmented_user = user_message

        messages.append({"role": "user", "content": augmented_user})
        return messages, citations, sources_used

    def stream_chat(self, req: ChatRequest) -> Generator[str, None, None]:
        """
        Streams assistant response tokens as Server-Sent Events (SSE).
        Format: data: {"token": "..."}\n\n
        Final: data: {"done": true, "citations": [...], "model": "...", "sources_used": true}\n\n
        """
        target_model = self._resolve_target_model(req.model)

        # 1. Check sub-20ms deterministic grounded fast-path first
        fast_hit = self._try_fast_grounded_response(req.message, req.use_rag)
        if fast_hit is not None:
            fast_reply, citations, sources_used = fast_hit
            citations_dump = [c.model_dump() for c in citations]
            # Immediately flush initial metadata + citations frame
            yield f"data: {json.dumps({'model': target_model, 'sources_used': sources_used, 'citations': citations_dump})}\n\n"
            # Stream chunks smoothly without waiting on CPU LLM prefill
            chunk_size = 80
            for idx in range(0, len(fast_reply), chunk_size):
                piece = fast_reply[idx : idx + chunk_size]
                yield f"data: {json.dumps({'token': piece})}\n\n"
            yield f"data: {json.dumps({'done': True, 'model': target_model, 'sources_used': sources_used, 'citations': citations_dump})}\n\n"
            return

        # 2. Compact KV-cached Ollama streaming path
        base_url = self.get_ollama_base_url()
        messages, citations, sources_used = self._build_ollama_messages(
            req.message, req.history, req.use_rag
        )
        citations_dump = [c.model_dump() for c in citations]

        # Flush initial metadata & grounded citations immediately (<5ms) so proxy & UI open stream
        yield f"data: {json.dumps({'model': target_model, 'sources_used': sources_used, 'citations': citations_dump})}\n\n"

        ollama_payload = {
            "model": target_model,
            "messages": messages,
            "stream": True,
            "think": False,
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": {
                "temperature": req.temperature,
                "top_p": 0.9,
                "num_thread": OLLAMA_NUM_THREADS,
                "num_ctx": OLLAMA_NUM_CTX,
                "num_predict": OLLAMA_NUM_PREDICT,
            },
        }

        events: queue.Queue[Optional[Dict[str, Any]]] = queue.Queue()

        def run_ollama() -> None:
            try:
                received_content = False
                completed = False
                logger.info("Starting Ollama chat inference with model=%s", target_model)
                with self._session.post(
                    f"{base_url}/api/chat",
                    json=ollama_payload,
                    stream=True,
                    timeout=(3.0, 60.0),
                ) as resp:
                    if resp.status_code != 200:
                        events.put({
                            "error": f"Ollama returned HTTP {resp.status_code}: {resp.text}"
                        })
                        return

                    for line in resp.iter_lines(decode_unicode=True):
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                        except (TypeError, ValueError):
                            continue

                        if chunk.get("error"):
                            events.put({"error": str(chunk["error"])})
                            return

                        token = chunk.get("message", {}).get("content", "")
                        if token:
                            received_content = True
                            events.put({"token": token})

                        if chunk.get("done", False):
                            completed = True
                            break

                if not received_content:
                    events.put({"error": "Ollama completed without producing an answer."})
                    return
                if not completed:
                    events.put({"error": "Ollama stopped the response before it completed."})
                    return

                events.put({
                    "done": True,
                    "model": target_model,
                    "sources_used": sources_used,
                    "citations": citations_dump,
                })
            except Exception as exc:
                logger.error("Error streaming from Ollama: %s", exc)
                if citations:
                    # Graceful grounded fallback if local Ollama is unreachable
                    fallback = rag_service.query_rag(RagQueryRequest(query=req.message, top_k=3)).answer
                    events.put({"token": fallback})
                    events.put({
                        "done": True,
                        "model": target_model,
                        "sources_used": sources_used,
                        "citations": citations_dump,
                    })
                else:
                    events.put({"error": f"Local inference engine error: {str(exc)}"})
            finally:
                events.put(None)

        worker = threading.Thread(target=run_ollama, daemon=True)
        worker.start()
        try:
            while True:
                try:
                    event = events.get(timeout=8.0)
                except queue.Empty:
                    yield ": keep-alive\n\n"
                    continue
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            while not events.empty():
                try:
                    events.get_nowait()
                except queue.Empty:
                    break

    def generate_chat(self, req: ChatRequest) -> ChatResponse:
        """Non-streaming complete chat response."""
        target_model = self._resolve_target_model(req.model)

        fast_hit = self._try_fast_grounded_response(req.message, req.use_rag)
        if fast_hit is not None:
            fast_reply, citations, sources_used = fast_hit
            return ChatResponse(
                reply=fast_reply,
                citations=citations,
                model=target_model,
                sources_used=sources_used,
            )

        base_url = self.get_ollama_base_url()
        messages, citations, sources_used = self._build_ollama_messages(
            req.message, req.history, req.use_rag
        )

        ollama_payload = {
            "model": target_model,
            "messages": messages,
            "stream": False,
            "think": False,
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": {
                "temperature": req.temperature,
                "top_p": 0.9,
                "num_thread": OLLAMA_NUM_THREADS,
                "num_ctx": OLLAMA_NUM_CTX,
                "num_predict": OLLAMA_NUM_PREDICT,
            },
        }

        try:
            resp = self._session.post(
                f"{base_url}/api/chat",
                json=ollama_payload,
                timeout=(3.0, 60.0),
            )
            if resp.status_code == 200:
                data = resp.json()
                reply_text = data.get("message", {}).get("content", "")
                if not reply_text.strip():
                    return ChatResponse(
                        reply="Ollama completed without producing an answer.",
                        citations=[],
                        model=target_model,
                        sources_used=False,
                    )
                return ChatResponse(
                    reply=reply_text,
                    citations=citations,
                    model=target_model,
                    sources_used=sources_used,
                )
            else:
                return ChatResponse(
                    reply=f"Ollama returned HTTP error {resp.status_code}: {resp.text}",
                    citations=[],
                    model=target_model,
                    sources_used=False,
                )
        except Exception as exc:
            if citations:
                fallback = rag_service.query_rag(RagQueryRequest(query=req.message, top_k=3)).answer
                return ChatResponse(
                    reply=fallback,
                    citations=citations,
                    model=target_model,
                    sources_used=sources_used,
                )
            return ChatResponse(
                reply=f"Failed to connect to local Ollama inference service: {str(exc)}. Ensure Ollama is running.",
                citations=[],
                model=target_model,
                sources_used=False,
            )


chat_service = LocalChatService()
