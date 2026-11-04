"""
FLOODCAST Training Job Manager & Training Gate Enforcement.
Persists training jobs in SQLite (`backend/floodcast_meta.db`), enforces the
mandatory Training Gate (`confirm_training_gate=True`), runs subprocess workers,
and tails live logs over Server-Sent Events (SSE).
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from backend.app.core.config import (
    LOGS_DIR,
    PROCESSED_DATA_DIR,
    PROJECT_ROOT,
    SQLITE_DB_PATH,
    get_cutoff_date,
    load_yaml_config,
)
from backend.app.schemas.api_schemas import (
    TrainStartNoticeResponse,
    TrainStartRequest,
)

logger = logging.getLogger("floodcast.backend.job_manager")


class JobManager:
    """Manages SQLite-backed training jobs and enforces the Training Gate."""

    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path: Path = db_path or SQLITE_DB_PATH
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        conn = self._get_conn()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS training_jobs (
                    job_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    notice_json TEXT NOT NULL,
                    result_json TEXT,
                    log_path TEXT NOT NULL
                )
                """
            )
            conn.commit()
        finally:
            conn.close()

    def build_start_notice(self, req: TrainStartRequest) -> Dict[str, Any]:
        """Construct the mandatory pre-run Training Start Notice preview."""
        cfg = load_yaml_config()
        cutoff = get_cutoff_date()
        feat_cfg = cfg.get("features", {})
        enabled_families = [
            fam
            for fam, fconf in feat_cfg.items()
            if isinstance(fconf, dict) and fconf.get("enabled", False)
        ]
        if not enabled_families:
            enabled_families = [
                "rainfall",
                "antecedent",
                "soil",
                "temperature",
                "calendar",
                "static",
            ]

        train_path = PROCESSED_DATA_DIR / "train.csv"
        test_path = PROCESSED_DATA_DIR / "test.csv"

        return {
            "notice_type": "TRAINING_START_NOTICE",
            "run_id": req.run_id,
            "purpose": req.notes or f"Train {req.model_family} ({req.target_strategy}) on {req.validation_scheme} split",
            "model_family": req.model_family,
            "target_strategy": req.target_strategy,
            "validation_scheme": req.validation_scheme,
            "seed": req.seed,
            "cutoff_date": cutoff,
            "feature_families": enabled_families,
            "data_summary": {
                "train_file": "data/processed/train.csv",
                "test_file": "data/processed/test.csv",
                "train_exists": train_path.exists(),
                "test_exists": test_path.exists(),
                "leakage_guard": f"All training discharge dates <= {cutoff}; backward-only rolling windows",
            },
            "expected_runtime": "5-25s (CPU)",
            "artifacts_destination": f"artifacts/{req.run_id}/",
            "gate_requirement": "Set confirm_training_gate=True after reviewing this Training Start Notice.",
        }

    def start_training_job(
        self, req: TrainStartRequest
    ) -> Tuple[bool, TrainStartNoticeResponse]:
        """
        Enforce the Training Gate and launch a subprocess training job if confirmed.
        Returns (gate_passed, response_model).
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        notice = self.build_start_notice(req)

        if req.confirm_training_gate is not True:
            return (
                False,
                TrainStartNoticeResponse(
                    job_id=None,
                    run_id=req.run_id,
                    status="GATE_BLOCKED",
                    gate_confirmed=False,
                    message=(
                        "Training Gate blocked: confirm_training_gate must be True. "
                        "Review the pre-run Training Start Notice preview and re-submit with confirm_training_gate=True."
                    ),
                    notice=notice,
                    created_at=now_iso,
                ),
            )

        job_id = f"job_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        log_file = LOGS_DIR / f"{job_id}.log"

        # Pre-seed the log file with the Training Start Notice immediately
        initial_log = (
            f"[{now_iso}] TRAINING GATE CONFIRMED (job_id={job_id}, run_id={req.run_id})\n"
            f"[{now_iso}] Pre-run Training Start Notice:\n"
            f"{json.dumps(notice, indent=2)}\n"
        )
        log_file.write_text(initial_log, encoding="utf-8")

        config_dict = req.model_dump()
        conn = self._get_conn()
        try:
            conn.execute(
                """
                INSERT INTO training_jobs (
                    job_id, status, created_at, updated_at,
                    config_json, notice_json, result_json, log_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    "RUNNING",
                    now_iso,
                    now_iso,
                    json.dumps(config_dict),
                    json.dumps(notice),
                    None,
                    str(log_file),
                ),
            )
            conn.commit()
        finally:
            conn.close()

        # Launch background thread monitoring subprocess
        thread = threading.Thread(
            target=self._run_subprocess_worker,
            args=(job_id, req, log_file),
            daemon=True,
        )
        thread.start()

        return (
            True,
            TrainStartNoticeResponse(
                job_id=job_id,
                run_id=req.run_id,
                status="RUNNING",
                gate_confirmed=True,
                message=f"Training Gate confirmed. Job {job_id} started in background.",
                notice=notice,
                created_at=now_iso,
            ),
        )

    def _run_subprocess_worker(
        self,
        job_id: str,
        req: TrainStartRequest,
        log_file: Path,
    ) -> None:
        result_payload: Optional[Dict[str, Any]] = None
        final_status = "FAILED"

        try:
            from backend.app.services.train_worker import run_worker_to_log

            result_payload = run_worker_to_log(
                job_id=job_id,
                run_id=req.run_id,
                model_family=req.model_family,
                target_strategy=req.target_strategy,
                validation_scheme=req.validation_scheme,
                seed=req.seed,
                notes=req.notes or "",
                log_file=log_file,
            )
            final_status = "COMPLETED"
        except Exception as exc:
            logger.exception("Training worker failed for %s", job_id)
            final_status = "FAILED"
            result_payload = {
                "job_id": job_id,
                "run_id": req.run_id,
                "status": "FAILED",
                "error": str(exc),
            }
            with open(log_file, "a", encoding="utf-8") as lf:
                lf.write(f"\n[ERROR] Worker exception: {exc}\n")

        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        try:
            conn.execute(
                """
                UPDATE training_jobs
                SET status = ?, updated_at = ?, result_json = ?
                WHERE job_id = ?
                """,
                (
                    final_status,
                    now_iso,
                    json.dumps(result_payload) if result_payload else None,
                    job_id,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a training job record from SQLite."""
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT * FROM training_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if row is None:
                return None
            return {
                "job_id": row["job_id"],
                "status": row["status"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "config": json.loads(row["config_json"]) if row["config_json"] else {},
                "notice": json.loads(row["notice_json"]) if row["notice_json"] else {},
                "result": json.loads(row["result_json"]) if row["result_json"] else None,
                "log_path": row["log_path"],
            }
        finally:
            conn.close()

    def list_jobs(self) -> List[Dict[str, Any]]:
        """List all training jobs ordered by creation time descending."""
        conn = self._get_conn()
        try:
            rows = conn.execute(
                "SELECT * FROM training_jobs ORDER BY created_at DESC"
            ).fetchall()
            return [
                {
                    "job_id": r["job_id"],
                    "status": r["status"],
                    "created_at": r["created_at"],
                    "updated_at": r["updated_at"],
                    "config": json.loads(r["config_json"]) if r["config_json"] else {},
                    "notice": json.loads(r["notice_json"]) if r["notice_json"] else {},
                    "result": json.loads(r["result_json"]) if r["result_json"] else None,
                    "log_path": r["log_path"],
                }
                for r in rows
            ]
        finally:
            conn.close()

    async def stream_job_logs(
        self, job_id: str, max_wait_seconds: float = 15.0
    ) -> AsyncGenerator[str, None]:
        """
        Async generator tailing the job's log file for Server-Sent Events (SSE).
        Streams each line as `data: <json>\n\n` and closes when the job finishes.
        """
        job = self.get_job(job_id)
        if job is None:
            yield f"data: {json.dumps({'event': 'error', 'message': f'Job {job_id} not found'})}\n\n"
            return

        log_path = Path(job["log_path"])
        offset = 0
        elapsed = 0.0
        poll_interval = 0.15

        while elapsed < max_wait_seconds:
            if log_path.exists():
                with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(offset)
                    new_text = f.read()
                    offset = f.tell()

                if new_text:
                    for line in new_text.splitlines():
                        payload = {
                            "job_id": job_id,
                            "event": "log",
                            "line": line,
                        }
                        yield f"data: {json.dumps(payload)}\n\n"

            current = self.get_job(job_id)
            status = current["status"] if current else "UNKNOWN"
            if status in ("COMPLETED", "FAILED"):
                # Flush any final log lines written right before completion
                if log_path.exists():
                    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                        f.seek(offset)
                        tail_text = f.read()
                    for line in tail_text.splitlines():
                        yield f"data: {json.dumps({'job_id': job_id, 'event': 'log', 'line': line})}\n\n"

                done_payload = {
                    "job_id": job_id,
                    "event": "complete",
                    "status": status,
                    "result": current.get("result") if current else None,
                }
                yield f"data: {json.dumps(done_payload)}\n\n"
                return

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        # Timeout reached while still running
        yield f"data: {json.dumps({'job_id': job_id, 'event': 'status', 'status': 'RUNNING'})}\n\n"


job_manager = JobManager()
