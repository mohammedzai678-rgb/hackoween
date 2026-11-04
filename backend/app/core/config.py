"""
FLOODCAST Backend Configuration & DuckDB/Pandas Query Engine.
Defines canonical project paths, SQLite metadata path, and analytical query helpers
with graceful fallback to pandas when duckdb is not installed.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import yaml

try:
    import duckdb  # type: ignore

    HAS_DUCKDB = True
except ImportError:
    duckdb = None  # type: ignore
    HAS_DUCKDB = False

logger = logging.getLogger("floodcast.backend.config")

# Canonical Project Paths
PROJECT_ROOT: Path = Path(
    os.environ.get("FLOODCAST_PROJECT_ROOT", Path(__file__).resolve().parents[3])
).resolve()

DATA_DIR: Path = PROJECT_ROOT / "data"
PROCESSED_DATA_DIR: Path = DATA_DIR / "processed"
MANIFEST_PATH: Path = DATA_DIR / "manifest.json"
EXPERIMENTS_DIR: Path = PROJECT_ROOT / "experiments"
ARTIFACTS_DIR: Path = PROJECT_ROOT / "artifacts"
DOCS_DIR: Path = PROJECT_ROOT / "docs"
SLIDES_DIR: Path = PROJECT_ROOT / "slides"
PREDICTIONS_PATH: Path = PROJECT_ROOT / "predictions.csv"
CONFIG_YAML_PATH: Path = PROJECT_ROOT / "configs" / "base.yaml"
SQLITE_DB_PATH: Path = Path(
    os.environ.get(
        "FLOODCAST_SQLITE_PATH", str(PROJECT_ROOT / "backend" / "floodcast_meta.db")
    )
)
LOGS_DIR: Path = PROJECT_ROOT / "backend" / "logs"

# API & Server Settings
API_V1_PREFIX: str = "/api/v1"
CORS_ORIGINS: List[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
MAX_REQUEST_SIZE_BYTES: int = 50 * 1024 * 1024  # 50 MB


def load_yaml_config(config_path: Optional[Path] = None) -> Dict[str, Any]:
    """Load the project's base YAML configuration."""
    target = config_path or CONFIG_YAML_PATH
    if target.exists():
        with open(target, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {"cutoff_date": "2022-12-31"}


def get_cutoff_date() -> str:
    """Return the configured CUTOFF date string (YYYY-MM-DD)."""
    cfg = load_yaml_config()
    return str(cfg.get("cutoff_date", "2022-12-31"))


class DuckDBHelper:
    """
    Analytical helper to query CSV and Parquet files in `data/processed/` and `experiments/`.
    Uses DuckDB in-memory engine when installed, and gracefully falls back to pandas
    with mtime-based caching when DuckDB is unavailable.
    """

    def __init__(self) -> None:
        self._cache: Dict[str, Tuple[float, pd.DataFrame]] = {}

    @property
    def engine_name(self) -> str:
        return "duckdb" if HAS_DUCKDB else "pandas"

    def read_table(self, file_path: Path, use_cache: bool = True) -> pd.DataFrame:
        """Read a CSV or Parquet file into a DataFrame using DuckDB or pandas."""
        resolved = file_path.resolve()
        if not resolved.exists():
            return pd.DataFrame()

        mtime = resolved.stat().st_mtime
        cache_key = str(resolved)

        if use_cache and cache_key in self._cache:
            cached_mtime, cached_df = self._cache[cache_key]
            if cached_mtime == mtime:
                return cached_df.copy()

        suffix = resolved.suffix.lower()
        if HAS_DUCKDB and duckdb is not None:
            try:
                con = duckdb.connect(database=":memory:")
                escaped_path = str(resolved).replace("\\", "/").replace("'", "''")
                if suffix == ".parquet":
                    df = con.execute(
                        f"SELECT * FROM read_parquet('{escaped_path}')"
                    ).df()
                else:
                    df = con.execute(
                        f"SELECT * FROM read_csv_auto('{escaped_path}', header=True)"
                    ).df()
                con.close()
                if "station_id" in df.columns:
                    df["station_id"] = df["station_id"].astype(str).apply(
                        lambda s: s.zfill(8) if s.isdigit() and len(s) < 8 else s
                    )
                if use_cache:
                    self._cache[cache_key] = (mtime, df)
                return df.copy()
            except Exception as exc:
                logger.warning(
                    "DuckDB read failed for %s (%s), falling back to pandas",
                    resolved,
                    exc,
                )

        # Pandas fallback
        if suffix == ".parquet":
            df = pd.read_parquet(resolved)
        else:
            df = pd.read_csv(resolved, dtype={"station_id": str})

        if "station_id" in df.columns:
            df["station_id"] = df["station_id"].astype(str).apply(
                lambda s: s.zfill(8) if s.isdigit() and len(s) < 8 else s
            )

        if use_cache:
            self._cache[cache_key] = (mtime, df)
        return df.copy()

    def query_station_rows(
        self,
        file_path: Path,
        station_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> pd.DataFrame:
        """
        Query rows for a specific station_id with optional date filtering and limit.
        Uses DuckDB SQL when available, or pandas filtering as fallback.
        """
        df = self.read_table(file_path)
        if df.empty or "station_id" not in df.columns:
            return pd.DataFrame()

        sid_raw = str(station_id).strip()
        sid_norm = sid_raw.zfill(8) if sid_raw.isdigit() and len(sid_raw) < 8 else sid_raw

        if HAS_DUCKDB and duckdb is not None:
            try:
                con = duckdb.connect(database=":memory:")
                con.register("station_tbl", df)
                clauses = ["(station_id = ? OR station_id = ?)"]
                params: List[Any] = [sid_norm, sid_raw]
                if start_date:
                    clauses.append("CAST(date AS VARCHAR) >= ?")
                    params.append(str(start_date))
                if end_date:
                    clauses.append("CAST(date AS VARCHAR) <= ?")
                    params.append(str(end_date))
                where_sql = " AND ".join(clauses)
                sql = f"SELECT * FROM station_tbl WHERE {where_sql} ORDER BY date ASC"
                sub = con.execute(sql, params).df()
                con.close()
                if limit and limit > 0 and len(sub) > limit:
                    sub = sub.tail(limit).reset_index(drop=True)
                return sub
            except Exception as exc:
                logger.warning("DuckDB station query fallback to pandas: %s", exc)

        sub = df[(df["station_id"] == sid_norm) | (df["station_id"] == sid_raw)].copy()
        if sub.empty:
            return sub

        if "date" in sub.columns:
            sub["date"] = sub["date"].astype(str)
            if start_date:
                sub = sub[sub["date"] >= str(start_date)]
            if end_date:
                sub = sub[sub["date"] <= str(end_date)]
            sub = sub.sort_values("date").reset_index(drop=True)

        if limit and limit > 0 and len(sub) > limit:
            sub = sub.tail(limit).reset_index(drop=True)

        return sub

    def clear_cache(self) -> None:
        self._cache.clear()


duckdb_helper = DuckDBHelper()
