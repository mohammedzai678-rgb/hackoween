"""
FLOODCAST — Backend API Integration & Unit Tests (`tests/test_backend_api.py`).
Tests all FastAPI endpoints under `/health` and `/api/v1/`:
- `/health` & `/openapi.json`
- `/api/v1/stations` & `/api/v1/stations/{station_id}`
- `/api/v1/features`
- `/api/v1/runs` & `/api/v1/runs/{run_id}`
- `/api/v1/train` (Training Gate enforcement: blocks unconfirmed, accepts confirmed)
- `/api/v1/train/{job_id}/logs` (SSE streaming)
- `/api/v1/predict` (JSON rows and CSV upload, non-negative clipping, no hand-edit of predictions.csv)
- `/api/v1/validate` (validates uploaded CSVs against test.csv)
- `/api/v1/submission/status`
- `/api/v1/docs-index` & `/api/v1/docs/{doc_name}`
"""

from __future__ import annotations

import io
from pathlib import Path
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.config import PROCESSED_DATA_DIR, PREDICTIONS_PATH

client = TestClient(app)


class TestHealthAndOpenAPI:
    """Verify health endpoint, CORS headers, and OpenAPI schema generation."""

    def test_health_endpoint(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["cutoff_date"] in ("2021-12-31", "2022-12-31")
        assert "engine" in data
        assert "X-Process-Time-Ms" in resp.headers

    def test_openapi_docs_available(self):
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        schema = resp.json()
        assert schema["info"]["title"] == "FLOODCAST Hydrological Intelligence API"
        assert "/api/v1/stations" in schema["paths"]
        assert "/api/v1/train" in schema["paths"]


class TestStationsEndpoints:
    """Verify station listing and station detail endpoints."""

    def test_list_stations(self):
        resp = client.get("/api/v1/stations")
        assert resp.status_code == 200
        stations = resp.json()
        assert isinstance(stations, list)
        assert len(stations) >= 5
        ids = {s["station_id"] for s in stations}
        assert "01646500" in ids
        first = stations[0]
        assert "station_name" in first
        assert "latitude" in first
        assert "longitude" in first

    def test_get_station_detail_and_filtering(self):
        resp = client.get(
            "/api/v1/stations/01646500",
            params={"limit": 30, "start_date": "2020-01-01", "end_date": "2020-12-31"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["station"]["station_id"] == "01646500"
        assert "sanity_stats" in data
        assert isinstance(data["series"], list)
        assert len(data["series"]) <= 30

    def test_get_unknown_station_returns_404(self):
        resp = client.get("/api/v1/stations/99999999")
        assert resp.status_code == 404
        err = resp.json()
        assert err["status_code"] == 404


class TestFeaturesAndRunsEndpoints:
    """Verify feature catalog, importances, ablations, and experiment runs endpoints."""

    def test_get_features(self):
        resp = client.get("/api/v1/features")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_features"] > 20
        assert "rainfall" in data["families"]
        assert len(data["catalog"]) == data["total_features"]
        assert len(data["importances"]) > 0
        assert len(data["ablations"]) > 0

    def test_list_and_get_runs(self):
        resp = client.get("/api/v1/runs")
        assert resp.status_code == 200
        runs = resp.json()
        assert isinstance(runs, list)
        assert len(runs) >= 1
        top_run = runs[0]
        assert 0.0 <= top_run["composite_score"] <= 100.0
        assert "rmse" in top_run
        assert "extreme_rmse" in top_run

        # Fetch detail for the first run
        run_id = top_run["run_id"]
        detail_resp = client.get(f"/api/v1/runs/{run_id}")
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        assert detail["run_id"] == run_id
        assert "val_metrics" in detail

    def test_get_unknown_run_returns_404(self):
        resp = client.get("/api/v1/runs/nonexistent_run_xyz")
        assert resp.status_code == 404


class TestTrainingGateAndJobs:
    """Verify the Training Gate blocks unconfirmed requests and accepts confirmed requests."""

    def test_training_gate_blocks_unconfirmed_request(self):
        payload = {
            "confirm_training_gate": False,
            "run_id": "test_gate_blocked_run",
            "model_family": "lightgbm",
            "target_strategy": "raw",
            "validation_scheme": "forward_time",
            "seed": 42,
            "notes": "Testing Training Gate block",
        }
        resp = client.post("/api/v1/train", json=payload)
        assert resp.status_code == 400
        body = resp.json()
        assert body["gate_confirmed"] is False
        assert body["status"] == "GATE_BLOCKED"
        assert body["job_id"] is None
        assert "notice" in body
        assert body["notice"]["run_id"] == "test_gate_blocked_run"
        assert body["notice"]["cutoff_date"] in ("2021-12-31", "2022-12-31")

    def test_training_gate_accepts_confirmed_request_and_streams_logs(self):
        payload = {
            "confirm_training_gate": True,
            "run_id": "test_gate_confirmed_run",
            "model_family": "lightgbm",
            "target_strategy": "log1p",
            "validation_scheme": "forward_time",
            "seed": 42,
            "notes": "Confirmed unit test training run",
        }
        resp = client.post("/api/v1/train", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["gate_confirmed"] is True
        assert body["job_id"] is not None
        assert body["status"] in ("RUNNING", "COMPLETED")
        job_id = body["job_id"]

        # Verify job record in SQLite via GET /api/v1/train/{job_id}
        job_resp = client.get(f"/api/v1/train/{job_id}")
        assert job_resp.status_code == 200
        assert job_resp.json()["job_id"] == job_id

        # Stream logs via SSE endpoint
        sse_resp = client.get(f"/api/v1/train/{job_id}/logs", params={"timeout": 8.0})
        assert sse_resp.status_code == 200
        assert "text/event-stream" in sse_resp.headers.get("content-type", "")
        assert "data:" in sse_resp.text


class TestPredictValidateSubmissionAndDocs:
    """Verify prediction inference, validation checker, submission status, and docs endpoints."""

    def test_predict_json_rows_and_no_negative_values(self):
        before_mtime = PREDICTIONS_PATH.stat().st_mtime if PREDICTIONS_PATH.exists() else None
        payload = {
            "rows": [
                {
                    "station_id": "01646500",
                    "date": "2022-06-15",
                    "precipitation_mm": 35.0,
                    "temp_max_c": 28.0,
                    "temp_min_c": 17.5,
                    "soil_moisture": 0.48,
                    "drainage_area_sqmi": 11570.0,
                    "mean_elevation_ft": 1050.0,
                    "slope_pct": 8.5,
                    "forest_cover_pct": 62.0,
                },
                {
                    "station_id": "02085070",
                    "date": "2022-06-15",
                    "precipitation_mm": 0.0,
                    "temp_max_c": 31.0,
                    "temp_min_c": 19.0,
                    "soil_moisture": 0.12,
                },
            ]
        }
        resp = client.post("/api/v1/predict", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["row_count"] == 2
        assert len(data["predictions"]) == 2
        for pred in data["predictions"]:
            assert pred["discharge_cfs"] >= 0.0

        # Ensure ad-hoc /predict never modifies root predictions.csv
        after_mtime = PREDICTIONS_PATH.stat().st_mtime if PREDICTIONS_PATH.exists() else None
        assert before_mtime == after_mtime

    def test_predict_csv_upload(self):
        csv_text = (
            "station_id,date,precipitation_mm,temp_max_c,temp_min_c,soil_moisture\n"
            "01646500,2022-03-10,15.2,14.0,3.0,0.35\n"
        )
        files = {"file": ("input.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")}
        resp = client.post("/api/v1/predict", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert data["row_count"] == 1
        assert data["predictions"][0]["discharge_cfs"] >= 0.0

    def test_validate_endpoint_rejects_bad_csv(self):
        bad_csv = (
            "station_id,date,discharge_cfs\n"
            "01646500,2022-01-01,-15.0\n"
        )
        files = {"file": ("bad_predictions.csv", io.BytesIO(bad_csv.encode("utf-8")), "text/csv")}
        resp = client.post("/api/v1/validate", files=files)
        assert resp.status_code == 200
        report = resp.json()
        assert report["passed"] is False
        assert any("negative" in r.lower() or "row count" in r.lower() for r in report["reasons"])

    def test_validate_endpoint_accepts_valid_sample_submission(self):
        sample_sub_path = PROCESSED_DATA_DIR / "sample_submission.csv"
        if not sample_sub_path.exists():
            pytest.skip("sample_submission.csv not generated yet")
        files = {
            "file": (
                "sample_submission.csv",
                io.BytesIO(sample_sub_path.read_bytes()),
                "text/csv",
            )
        }
        resp = client.post("/api/v1/validate", files=files)
        assert resp.status_code == 200
        report = resp.json()
        assert report["passed"] is True
        assert report["reasons"] == []

    def test_submission_status_endpoint(self):
        resp = client.get("/api/v1/submission/status")
        assert resp.status_code == 200
        status_data = resp.json()
        assert "deliverables" in status_data
        for required_key in [
            "predictions.csv",
            "README.md",
            "model_card.md",
            "solution.py",
            "requirements.txt",
            "slides/slides.md",
        ]:
            assert required_key in status_data["deliverables"]
        assert status_data["cutoff_date"] in ("2021-12-31", "2022-12-31")
        assert status_data["no_leakage_verified"] is True

    def test_docs_index_and_doc_content(self):
        resp = client.get("/api/v1/docs-index")
        assert resp.status_code == 200
        docs = resp.json()
        assert len(docs) >= 5
        names = {d["name"] for d in docs}
        assert "ARCHITECTURE.md" in names
        assert "README.md" in names

        doc_resp = client.get("/api/v1/docs/ARCHITECTURE.md")
        assert doc_resp.status_code == 200
        doc_data = doc_resp.json()
        assert "FLOODCAST" in doc_data["content"]

        not_found = client.get("/api/v1/docs/DOES_NOT_EXIST.md")
        assert not_found.status_code == 404
