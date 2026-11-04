#!/usr/bin/env python
"""
solution.py — FLOODCAST One-Command Entry Point
Runs the full pipeline and writes predictions.csv.

Usage:
    python solution.py
    python solution.py --config configs/base.yaml
"""

import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from floodcast.ingest import ingest_all_stations, load_config
from floodcast.train import run_training_pipeline


def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    config_path = "configs/base.yaml"
    if len(sys.argv) > 1 and sys.argv[1] == "--config":
        config_path = sys.argv[2]

    print("=" * 60)
    print("  FLOODCAST — Predict the Surge Before It Strikes")
    print("  One-command pipeline execution")
    print("=" * 60)

    # Step 1: Data ingestion
    config = load_config(config_path)
    ingest_all_stations(config)

    # Step 2: Train, predict, validate
    result = run_training_pipeline(config_path)

    # Report
    if result["submission_check"]["passed"]:
        print("\n[SUCCESS] predictions.csv generated and validated!")
    else:
        print("\n[FAIL] SUBMISSION CHECK FAILED:")
        for r in result["submission_check"]["reasons"]:
            print(f"  - {r}")
        sys.exit(1)


if __name__ == "__main__":
    main()
