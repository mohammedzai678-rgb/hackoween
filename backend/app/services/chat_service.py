"""
FLOODCAST Local Chatbot Service with Hybrid RAG Vector Grounding.
Connects to local Ollama instance (GPU/CPU accelerated), retrieves relevant
hydrological and platform context from FAISS IndexFlatIP + SQLite Vault,
and streams grounded responses to the frontend.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import re
import threading
from typing import Any, Dict, Generator, List, Optional, Tuple

import requests

from backend.app.schemas.api_schemas import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    RagChunkMatch,
    RagQueryRequest,
)
from backend.app.services.rag_service import rag_service

logger = logging.getLogger("floodcast.backend.chat_service")

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

SIMULATION_KEYWORDS = {
    "simulation", "simulations", "vault", "scenario", "scenarios", "recent",
    "latest", "risk", "riskiest", "safest", "crest", "highest", "lowest", "worst",
    "saved", "stored", "nor'easter", "deluge", "compare",
}


class LocalChatService:
    def __init__(self) -> None:
        self._cached_base_url: Optional[str] = None

    def get_ollama_base_url(self) -> str:
        """Find the reachable Ollama instance URL."""
        if self._cached_base_url:
            return self._cached_base_url

        for url in OLLAMA_CANDIDATE_URLS:
            try:
                res = requests.get(f"{url}/", timeout=1.5)
                if res.status_code == 200:
                    self._cached_base_url = url
                    logger.info("Connected to local Ollama at %s", url)
                    return url
            except Exception:
                continue

        # Default fallback
        return "http://host.docker.internal:11434"

    def get_available_models(self) -> List[str]:
        """Fetch list of locally installed Ollama models."""
        base_url = self.get_ollama_base_url()
        try:
            res = requests.get(f"{base_url}/api/tags", timeout=3.0)
            if res.status_code == 200:
                data = res.json()
                models = [m.get("name") for m in data.get("models", []) if m.get("name")]
                if models:
                    return models
        except Exception as exc:
            logger.warning("Could not fetch models from Ollama: %s", exc)

        return ["qwen2.5:0.5b", "qwen2.5:1.5b", "llama3.2:3b"]

    def _is_hydrology_or_platform_query(self, query: str) -> bool:
        """Check if query is asking about river discharge, models, or FloodCast platform."""
        lower = query.lower()
        tokens = set(re.findall(r"[a-z0-9_.\-]+", lower))
        if tokens & HYDROLOGY_KEYWORDS:
            return True
        # Check for 8-digit USGS station IDs (e.g. 01646500)
        if re.search(r"\b0\d{7}\b", lower):
            return True
        return False

    def _get_simulation_vault_analytics_block(self) -> str:
        """Extracts real-time comparative risk metrics from all saved simulations."""
        try:
            sims = rag_service.list_simulations()
            if not sims:
                return "SIMULATION VAULT STATUS: Currently 0 saved simulations in SQLite Vault."

            # 1. Most recent simulation
            recent = sims[0]

            # 2. Highest risk by peak discharge
            highest_discharge = max(sims, key=lambda s: float(s.peak_discharge_cfs or 0))

            # 3. Lowest risk / safest by peak discharge
            lowest_discharge = min(sims, key=lambda s: float(s.peak_discharge_cfs or 0))

            # 4. Longest flood surge duration
            most_surge_days = max(sims, key=lambda s: int(s.p90_exceedance_count or 0))

            lines = [
                "REAL-TIME SIMULATION VAULT ANALYTICS (EXACT SQL VERIFIED DATA):",
                f"- TOTAL STORED SIMULATIONS: {len(sims)} simulations archived.",
                f"- MOST RECENT SIMULATION: '{recent.title}' | Station #{recent.station_id} ({recent.station_name}) | Model: {recent.model_used} | Created: {recent.created_at[:19].replace('T', ' ')} UTC | Rain: {recent.storm_peak_mm}mm | Peak Discharge: {float(recent.peak_discharge_cfs):,.1f} cfs | P90+ Surge Days: {recent.p90_exceedance_count}.",
                f"- HIGHEST RISK / MAXIMUM PEAK DISCHARGE: '{highest_discharge.title}' | Station #{highest_discharge.station_id} ({highest_discharge.station_name}) | Model: {highest_discharge.model_used} | Peak Discharge: {float(highest_discharge.peak_discharge_cfs):,.1f} cfs | Rain: {highest_discharge.storm_peak_mm}mm | P90+ Surge Days: {highest_discharge.p90_exceedance_count}.",
                f"- LEAST RISK / LOWEST PEAK DISCHARGE: '{lowest_discharge.title}' | Station #{lowest_discharge.station_id} ({lowest_discharge.station_name}) | Model: {lowest_discharge.model_used} | Peak Discharge: {float(lowest_discharge.peak_discharge_cfs):,.1f} cfs | Rain: {lowest_discharge.storm_peak_mm}mm | P90+ Surge Days: {lowest_discharge.p90_exceedance_count}.",
                f"- LONGEST SUSTAINED FLOOD SURGE: '{most_surge_days.title}' with {most_surge_days.p90_exceedance_count} consecutive days exceeding the P90 historical flood threshold.",
                "\nALL SAVED SIMULATIONS DIRECTORY (Ranked by Recency):",
            ]
            for s in sims[:10]:
                lines.append(
                    f"  * '{s.title}': Station #{s.station_id} ({s.station_name}) | Peak: {float(s.peak_discharge_cfs):,.1f} cfs | P90 Days: {s.p90_exceedance_count} | Rain: {s.storm_peak_mm}mm | Date: {s.created_at[:10]}"
                )
            return "\n".join(lines)
        except Exception as exc:
            logger.warning("Error fetching simulation vault analytics: %s", exc)
            return ""

    def _build_system_prompt_and_citations(
        self, user_message: str, use_rag: bool
    ) -> Tuple[str, List[RagChunkMatch], bool]:
        """
        Retrieves grounded platform context from the FAISS vector database
        and assembles a rich, helpful system prompt.
        """
        citations: List[RagChunkMatch] = []
        sources_used = False

        is_domain = self._is_hydrology_or_platform_query(user_message)
        lower_msg = user_message.lower()
        msg_tokens = set(re.findall(r"[a-z0-9_.\-]+", lower_msg))
        is_simulation_query = bool(msg_tokens & SIMULATION_KEYWORDS)

        if use_rag:
            try:
                rag_res = rag_service.query_rag(
                    RagQueryRequest(query=user_message, top_k=4)
                )
                filtered = [
                    c for c in rag_res.retrieved_chunks
                    if c.similarity_score >= 0.30 or is_domain
                ]
                if filtered:
                    citations = filtered[:3]
                    sources_used = True
            except Exception as exc:
                logger.warning("RAG retrieval exception in chat: %s", exc)

        # Build system instruction
        base_instructions = (
            "You are FLOODCAST Assistant, an AI hydrologist and general-purpose intelligent agent. "
            "You are running 100% locally on the user's computer.\n\n"
            "SYSTEM CAPABILITIES:\n"
            "- You can answer ANY question (general coding, mathematics, science, writing, history, reasoning, etc.).\n"
            "- You also have comprehensive access to the FLOODCAST river discharge system (32 USGS stations, "
            "7 machine learning models, physics guardrails, and real-time user-saved storm simulations in the SQLite Vault).\n\n"
            "RESPONSE GUIDELINES:\n"
            "1. If the user asks about simulations, saved scenarios, most recent simulation, highest risk simulation, or lowest risk simulation, "
            "USE THE PROVIDED REAL-TIME SIMULATION VAULT ANALYTICS DATA. Quote the exact title, station name, rainfall (mm), peak discharge (cfs), and P90 exceedance days accurately.\n"
            "2. If the question relates to FLOODCAST, river discharge, USGS stations, or machine learning forecasts, "
            "synthesize your answer using the provided GROUNDED KNOWLEDGE BASE and cite station names/IDs or models accurately.\n"
            "3. If the question is a GENERAL question (e.g., coding, general science, math, general advice, trivia), "
            "answer directly, thoroughly, and helpfully using your core general knowledge.\n"
            "4. Format your answers clearly using clean Markdown (headings, bullet points, and bold text).\n"
            "5. Keep your tone professional, concise, and helpful."
        )

        context_blocks = []

        # If question touches simulations, inject live vault analytics block
        if is_simulation_query or is_domain:
            vault_block = self._get_simulation_vault_analytics_block()
            if vault_block:
                context_blocks.append(vault_block)

        if citations:
            kb_parts = []
            for i, c in enumerate(citations, 1):
                kb_parts.append(
                    f"[Source {i} | Category: {c.category} | Title: {c.title}]\n{c.content}"
                )
            context_blocks.append("GROUNDED PLATFORM KNOWLEDGE BASE:\n" + "\n---\n".join(kb_parts))

        if context_blocks:
            system_prompt = base_instructions + "\n\n" + "\n\n====================\n\n".join(context_blocks)
        else:
            system_prompt = base_instructions

        return system_prompt, citations, sources_used

    def stream_chat(self, req: ChatRequest) -> Generator[str, None, None]:
        """
        Streams assistant response tokens as Server-Sent Events (SSE).
        Format: data: {"token": "..."}\n\n
        Final: data: {"done": true, "citations": [...], "model": "...", "sources_used": true}\n\n
        """
        base_url = self.get_ollama_base_url()
        avail_models = self.get_available_models()
        target_model = req.model or (avail_models[0] if avail_models else "qwen2.5:0.5b")
        if avail_models and target_model not in avail_models:
            # Fallback to the first installed model tag
            target_model = avail_models[0]

        system_prompt, citations, sources_used = self._build_system_prompt_and_citations(
            req.message, req.use_rag
        )

        # Assemble full conversation messages
        messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
        for h in req.history[-8:]:  # keep last 8 conversation turns for fast context
            messages.append({"role": h.role, "content": h.content})
        messages.append({"role": "user", "content": req.message})

        ollama_payload = {
            "model": target_model,
            "messages": messages,
            "stream": True,
            "keep_alive": "5m",
            "options": {
                "temperature": req.temperature,
                "top_p": 0.9,
                "num_thread": 2,
                "num_ctx": 2048,
            },
        }

        events: queue.Queue[Optional[Dict[str, Any]]] = queue.Queue()

        def run_ollama() -> None:
            try:
                with requests.post(
                    f"{base_url}/api/chat",
                    json=ollama_payload,
                    stream=True,
                    timeout=(5.0, 180.0),
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
                            events.put({"token": token})

                        if chunk.get("done", False):
                            break

                events.put({
                    "done": True,
                    "model": target_model,
                    "sources_used": sources_used,
                    "citations": [c.model_dump() for c in citations],
                })
            except Exception as exc:
                logger.error("Error streaming from Ollama: %s", exc)
                events.put({"error": f"Local inference engine error: {str(exc)}"})
            finally:
                events.put(None)

        worker = threading.Thread(target=run_ollama, daemon=True)
        worker.start()
        try:
            while True:
                try:
                    event = events.get(timeout=10.0)
                except queue.Empty:
                    # Keep the proxy connection alive during cold model loading.
                    yield ": keep-alive\n\n"
                    continue
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            # If the client disconnects, do not retain queued tokens in this generator.
            while not events.empty():
                try:
                    events.get_nowait()
                except queue.Empty:
                    break

    def generate_chat(self, req: ChatRequest) -> ChatResponse:
        """Non-streaming complete chat response."""
        base_url = self.get_ollama_base_url()
        avail_models = self.get_available_models()
        target_model = req.model or (avail_models[0] if avail_models else "qwen2.5:0.5b")
        if avail_models and target_model not in avail_models:
            # Fallback to the first installed model tag
            target_model = avail_models[0]

        system_prompt, citations, sources_used = self._build_system_prompt_and_citations(
            req.message, req.use_rag
        )

        messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
        for h in req.history[-8:]:
            messages.append({"role": h.role, "content": h.content})
        messages.append({"role": "user", "content": req.message})

        ollama_payload = {
            "model": target_model,
            "messages": messages,
            "stream": False,
            "keep_alive": "5m",
            "options": {
                "temperature": req.temperature,
                "top_p": 0.9,
                "num_thread": 2,
                "num_ctx": 2048,
            },
        }

        try:
            resp = requests.post(
                f"{base_url}/api/chat",
                json=ollama_payload,
                timeout=45.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                reply_text = data.get("message", {}).get("content", "")
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
            return ChatResponse(
                reply=f"Failed to connect to local Ollama inference service: {str(exc)}. Ensure Ollama is running.",
                citations=[],
                model=target_model,
                sources_used=False,
            )


chat_service = LocalChatService()
