"""
FLOODCAST — Comprehensive Unit Tests for `floodcast/check_submission.py`.
Verifies all PDF specification validation rules and hard disqualification rules:
- Valid submission passes
- Negative values rejected
- NaN values rejected
- Non-numeric values rejected
- Wrong column names or wrong column order rejected
- Extra columns rejected
- Missing rows / row count mismatch rejected
- Duplicate (station_id, date) pairs rejected
- Non-UTF-8 encoding rejected
- Missing files rejected
"""

from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd
import pytest

from floodcast.check_submission import check_submission


@pytest.fixture
def sample_test_and_pred(tmp_path: Path):
    """Create a clean reference test.csv and matching valid predictions.csv."""
    test_df = pd.DataFrame(
        {
            "station_id": ["01646500", "01646500", "07010000", "07010000"],
            "date": ["2022-01-01", "2022-01-02", "2022-01-01", "2022-01-02"],
            "precipitation_mm": [0.0, 12.4, 3.1, 0.0],
            "temp_max_c": [8.0, 10.2, 4.5, 6.1],
            "temp_min_c": [-1.0, 2.1, -3.4, -1.2],
            "soil_moisture": [0.28, 0.34, 0.31, 0.30],
        }
    )
    pred_df = pd.DataFrame(
        {
            "station_id": ["01646500", "01646500", "07010000", "07010000"],
            "date": ["2022-01-01", "2022-01-02", "2022-01-01", "2022-01-02"],
            "discharge_cfs": [11200.5, 15400.0, 168000.2, 162300.8],
        }
    )
    test_path = tmp_path / "test.csv"
    pred_path = tmp_path / "predictions.csv"
    test_df.to_csv(test_path, index=False)
    pred_df.to_csv(pred_path, index=False)
    return test_path, pred_path, test_df, pred_df


class TestSubmissionChecker:
    """Edge-case test suite for `check_submission`."""

    def test_valid_submission_passes(self, sample_test_and_pred):
        test_path, pred_path, _, _ = sample_test_and_pred
        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is True
        assert reasons == []

    def test_missing_files_rejected(self, tmp_path: Path):
        passed, reasons = check_submission(
            str(tmp_path / "nonexistent_pred.csv"),
            str(tmp_path / "nonexistent_test.csv"),
            verbose=False,
        )
        assert passed is False
        assert any("not found" in r for r in reasons)

    def test_negative_discharge_rejected(self, sample_test_and_pred):
        test_path, pred_path, _, pred_df = sample_test_and_pred
        pred_df.loc[1, "discharge_cfs"] = -0.01
        pred_df.to_csv(pred_path, index=False)

        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is False
        assert any("negative" in r.lower() for r in reasons)

    def test_nan_discharge_rejected(self, sample_test_and_pred):
        test_path, pred_path, _, pred_df = sample_test_and_pred
        pred_df.loc[2, "discharge_cfs"] = np.nan
        pred_df.to_csv(pred_path, index=False)

        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is False
        assert any("nan" in r.lower() for r in reasons)

    def test_non_numeric_discharge_rejected(self, sample_test_and_pred):
        test_path, pred_path, _, pred_df = sample_test_and_pred
        pred_df["discharge_cfs"] = ["100.0", "bad_val", "200.0", "300.0"]
        pred_df.to_csv(pred_path, index=False)

        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is False
        assert any("not numeric" in r.lower() for r in reasons)

    def test_wrong_column_order_rejected(self, sample_test_and_pred):
        test_path, pred_path, _, pred_df = sample_test_and_pred
        pred_df = pred_df[["date", "station_id", "discharge_cfs"]]
        pred_df.to_csv(pred_path, index=False)

        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is False
        assert any("column names/order mismatch" in r.lower() for r in reasons)

    def test_misspelled_column_rejected(self, sample_test_and_pred):
        test_path, pred_path, _, pred_df = sample_test_and_pred
        pred_df = pred_df.rename(columns={"discharge_cfs": "discharge"})
        pred_df.to_csv(pred_path, index=False)

        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is False
        assert any("column names/order mismatch" in r.lower() for r in reasons)

    def test_extra_columns_rejected(self, sample_test_and_pred):
        test_path, pred_path, _, pred_df = sample_test_and_pred
        pred_df["extra_col"] = 1.0
        pred_df.to_csv(pred_path, index=False)

        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is False
        assert any("extra columns" in r.lower() or "mismatch" in r.lower() for r in reasons)

    def test_missing_rows_rejected(self, sample_test_and_pred):
        test_path, pred_path, _, pred_df = sample_test_and_pred
        pred_df = pred_df.iloc[:-1]
        pred_df.to_csv(pred_path, index=False)

        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is False
        assert any("row count mismatch" in r.lower() for r in reasons)
        assert any("missing" in r.lower() for r in reasons)

    def test_duplicate_station_date_rejected(self, sample_test_and_pred):
        test_path, pred_path, _, pred_df = sample_test_and_pred
        # Replace row 1 with a duplicate of row 0 so row count stays 4
        pred_df.iloc[1] = pred_df.iloc[0]
        pred_df.to_csv(pred_path, index=False)

        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is False
        assert any("duplicate" in r.lower() for r in reasons)

    def test_non_utf8_encoding_rejected(self, sample_test_and_pred):
        test_path, pred_path, _, _ = sample_test_and_pred
        # Write invalid UTF-8 bytes
        pred_path.write_bytes(b"\xff\xfe\x00\x00invalid,utf8,bytes\n")

        passed, reasons = check_submission(str(pred_path), str(test_path), verbose=False)
        assert passed is False
        assert any("utf-8" in r.lower() or "parse" in r.lower() for r in reasons)
