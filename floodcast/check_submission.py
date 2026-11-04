"""
FLOODCAST Submission Checker
Validates predictions.csv against test.csv per the PDF spec.
Fails loudly on any violation.
"""

import sys
import pandas as pd
import numpy as np
from pathlib import Path
from typing import List, Tuple


def check_submission(
    predictions_path: str,
    test_path: str,
    verbose: bool = True,
) -> Tuple[bool, List[str]]:
    """
    Validate predictions.csv against test.csv.

    Returns:
        (passed: bool, reasons: list of failure reasons)
    """
    reasons = []

    # 1. Check file exists and is readable
    pred_file = Path(predictions_path)
    test_file = Path(test_path)

    if not pred_file.exists():
        reasons.append(f"predictions file not found: {predictions_path}")
        return False, reasons

    if not test_file.exists():
        reasons.append(f"test file not found: {test_path}")
        return False, reasons

    # 2. Check UTF-8 encoding
    try:
        with open(pred_file, "r", encoding="utf-8") as f:
            f.read(1024)
    except UnicodeDecodeError:
        reasons.append("File is not UTF-8 encoded")

    # 3. Read files
    try:
        pred_df = pd.read_csv(pred_file, dtype={"station_id": str})
    except Exception as e:
        reasons.append(f"Cannot parse predictions CSV: {e}")
        return False, reasons

    try:
        test_df = pd.read_csv(test_file, dtype={"station_id": str})
    except Exception as e:
        reasons.append(f"Cannot parse test CSV: {e}")
        return False, reasons

    # 4. Check column names and order
    expected_cols = ["station_id", "date", "discharge_cfs"]
    if list(pred_df.columns) != expected_cols:
        reasons.append(
            f"Column names/order mismatch. Expected {expected_cols}, "
            f"got {list(pred_df.columns)}"
        )

    # 5. Check no extra columns
    if len(pred_df.columns) > 3:
        extra = [c for c in pred_df.columns if c not in expected_cols]
        reasons.append(f"Extra columns found: {extra}")

    # 6. Check row count
    if len(pred_df) != len(test_df):
        reasons.append(
            f"Row count mismatch: predictions has {len(pred_df)}, "
            f"test has {len(test_df)}"
        )

    # 7. Check (station_id, date) match
    if "station_id" in pred_df.columns and "date" in pred_df.columns:
        pred_keys = set(zip(pred_df["station_id"], pred_df["date"]))
        test_keys = set(zip(test_df["station_id"], test_df["date"]))

        missing = test_keys - pred_keys
        extra = pred_keys - test_keys

        if missing:
            reasons.append(
                f"{len(missing)} (station_id, date) pairs in test.csv missing "
                f"from predictions. Examples: {list(missing)[:5]}"
            )
        if extra:
            reasons.append(
                f"{len(extra)} extra (station_id, date) pairs in predictions "
                f"not in test.csv. Examples: {list(extra)[:5]}"
            )

        # Check for duplicates
        if pred_df.duplicated(subset=["station_id", "date"]).any():
            n_dup = pred_df.duplicated(subset=["station_id", "date"]).sum()
            reasons.append(f"{n_dup} duplicate (station_id, date) rows")

    # 8. Check discharge_cfs column
    if "discharge_cfs" in pred_df.columns:
        # Check for NaN
        n_nan = pred_df["discharge_cfs"].isna().sum()
        if n_nan > 0:
            reasons.append(f"{n_nan} NaN values in discharge_cfs")

        # Check dtype is numeric before comparing < 0
        if not pd.api.types.is_numeric_dtype(pred_df["discharge_cfs"]):
            reasons.append("discharge_cfs is not numeric")
        else:
            # Check for negatives
            n_neg = (pred_df["discharge_cfs"] < 0).sum()
            if n_neg > 0:
                reasons.append(f"{n_neg} negative values in discharge_cfs")

    passed = len(reasons) == 0

    if verbose:
        if hasattr(sys.stdout, "reconfigure"):
            try:
                sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
        if passed:
            print("=" * 60)
            print("  [PASS] SUBMISSION CHECK: PASS")
            print(f"  Rows: {len(pred_df)}")
            print(f"  Stations: {pred_df['station_id'].nunique()}")
            print(f"  Date range: {pred_df['date'].min()} to {pred_df['date'].max()}")
            print(f"  Discharge range: {pred_df['discharge_cfs'].min():.2f} to {pred_df['discharge_cfs'].max():.2f}")
            print("=" * 60)
        else:
            print("=" * 60)
            print("  [FAIL] SUBMISSION CHECK: FAIL")
            for i, r in enumerate(reasons, 1):
                print(f"  {i}. {r}")
            print("=" * 60)

    return passed, reasons


def main():
    """CLI entry point."""
    if len(sys.argv) < 3:
        print("Usage: python -m floodcast.check_submission <predictions.csv> <test.csv>")
        sys.exit(1)

    predictions_path = sys.argv[1]
    test_path = sys.argv[2]

    passed, reasons = check_submission(predictions_path, test_path)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
