"""
FLOODCAST — Main pipeline entry point
Runs: ingest → clean → features → validate → train → predict → check → document
"""

import argparse
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="FLOODCAST Pipeline")
    parser.add_argument("command", choices=["run", "ingest", "train", "predict", "check", "validate"],
                        help="Pipeline stage to run")
    parser.add_argument("--config", default="configs/base.yaml", help="Config file path")
    parser.add_argument("--run-id", default=None, help="Run identifier")
    parser.add_argument("--description", default="", help="Run description")
    args = parser.parse_args()

    if args.command == "ingest":
        from .ingest import ingest_all_stations, load_config
        config = load_config(args.config)
        ingest_all_stations(config)

    elif args.command == "train":
        from .train import run_training_pipeline
        run_training_pipeline(args.config, args.run_id, args.description)

    elif args.command == "predict":
        from .train import run_training_pipeline
        run_training_pipeline(args.config, args.run_id, args.description)

    elif args.command == "check":
        from .check_submission import check_submission
        from .ingest import load_config
        config = load_config(args.config)
        test_path = str(Path(config["data"]["processed_dir"]) / "test.csv")
        passed, reasons = check_submission("predictions.csv", test_path)
        sys.exit(0 if passed else 1)

    elif args.command == "run":
        # Full pipeline
        from .ingest import ingest_all_stations, load_config
        from .train import run_training_pipeline

        config = load_config(args.config)

        # Step 1: Ingest
        print("\n" + "="*60)
        print("  PHASE 1: Data Ingestion")
        print("="*60)
        ingest_all_stations(config)

        # Step 2: Train + Predict + Check
        print("\n" + "="*60)
        print("  PHASE 2: Training & Prediction")
        print("="*60)
        run_training_pipeline(args.config, args.run_id, args.description)


if __name__ == "__main__":
    main()
