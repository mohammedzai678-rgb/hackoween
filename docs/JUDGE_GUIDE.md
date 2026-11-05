# FLOODCAST Judge Guide

This guide is the shortest path from the challenge criteria to the implementation evidence in this repository. It is intentionally evidence-led: each claim points to a source file, a generated artifact, or a runnable check.

## 1. What is being submitted?

FLOODCAST predicts daily USGS river discharge, `discharge_cfs`, for every `(station_id, date)` in the test set. The committed submission is [predictions.csv](../predictions.csv).

The current repository snapshot contains:

| Artifact | Verified value |
|---|---:|
| Training rows | 128,811 |
| Training stations | 30 |
| Training dates | 2010-01-01 through 2021-12-31 |
| Test rows | 10,585 |
| Test stations | 29 |
| Test dates | 2022-01-01 through 2022-12-31 |
| Engineered features | 127 |
| Prediction columns | `station_id`, `date`, `discharge_cfs` |

The station metadata file contains 32 configured/known stations; two stations do not have a complete row in the final train/test prediction split. Always use the actual processed CSVs for row counts.

## 2. Five-minute verification

From the repository root:

```bash
python -m floodcast.check_submission predictions.csv data/processed/test.csv
python -m pytest tests -q
```

The submission checker verifies:

- UTF-8 readability;
- exact column names and order;
- row-count equality with `test.csv`;
- exact `(station_id, date)` key coverage;
- duplicate-key rejection;
- numeric, non-null, non-negative discharge predictions.

The test suite additionally covers forward-time leakage, backward-only rolling features, scoring formulas, API behavior, RAG behavior, and checker edge cases.

## 3. Requirement-to-evidence map

| Criterion | Primary evidence | How to inspect |
|---|---|---|
| Problem target | [floodcast/train.py](../floodcast/train.py), [data/processed/train.csv](../data/processed/train.csv) | Follow `run_training_pipeline` and the `discharge_cfs` target |
| USGS discharge input | [floodcast/ingest.py](../floodcast/ingest.py), [configs/base.yaml](../configs/base.yaml) | Inspect `parameter_cd: "00060"` and USGS URLs |
| Open-Meteo weather input | [floodcast/ingest.py](../floodcast/ingest.py), [configs/base.yaml](../configs/base.yaml) | Inspect the Open-Meteo base URL and daily variables |
| Catchment attributes | [floodcast/ingest.py](../floodcast/ingest.py), [data/processed/train.csv](../data/processed/train.csv) | Inspect drainage area, elevation, slope, and forest columns |
| Dataset joins | [floodcast/ingest.py](../floodcast/ingest.py) | Inspect station/date and latitude/longitude joins |
| Feature engineering | [floodcast/features.py](../floodcast/features.py), [data/processed/feature_catalog.csv](../data/processed/feature_catalog.csv) | Inspect the eight feature families and 127-row catalog |
| Backward-only features | [floodcast/features.py](../floodcast/features.py), [tests/test_no_leakage.py](../tests/test_no_leakage.py) | Inspect rolling/lag/expanding operations and the synthetic leakage test |
| Forward-time validation | [floodcast/validate.py](../floodcast/validate.py), [floodcast/train.py](../floodcast/train.py) | Inspect `forward_time_split` before feature computation |
| Model training | [floodcast/train.py](../floodcast/train.py), [configs/base.yaml](../configs/base.yaml) | Inspect LightGBM configuration and training pipeline |
| Non-negative output | [floodcast/train.py](../floodcast/train.py) | Inspect the final prediction clipping before CSV output |
| Submission contract | [floodcast/check_submission.py](../floodcast/check_submission.py) | Run the checker command above |
| Disqualification protection | [tests/test_submission_checker.py](../tests/test_submission_checker.py), [tests/test_no_leakage.py](../tests/test_no_leakage.py) | Review negative, NaN, duplicate, missing-row, encoding, and leakage tests |
| Evaluation metrics | [floodcast/scoring.py](../floodcast/scoring.py), [docs/EVALUATION.md](EVALUATION.md) | Inspect RMSE, extreme RMSE, MAE, R², and composite scoring |
| Reproducibility | [solution.py](../solution.py), [docs/RUNBOOK.md](RUNBOOK.md) | Run `python solution.py` or follow the staged commands |
| Model disclosure | [model_card.md](../model_card.md) | Review architecture, data cutoff, validation, and limitations |
| Presentation | [slides/slides.md](../slides/slides.md) | Review the problem/data/model/results/limitations narrative |

## 4. Reproducibility commands

### Validate the committed submission without network access

```bash
python -m floodcast.check_submission predictions.csv data/processed/test.csv
python -m pytest tests -q
```

### Re-run the complete pipeline

```bash
pip install -r requirements.txt
python solution.py
```

The full pipeline retrieves public data and may take substantially longer than the offline checks. It writes processed data, trains the configured model, writes `predictions.csv`, and invokes the submission checker.

### Run the web application

```bash
docker compose up --build
```

Then open `http://localhost:3000`. The FastAPI backend is exposed at `http://localhost:8000`; its endpoint reference is [docs/API.md](API.md).

## 5. Interpreting the evidence

- `predictions.csv` is the final output, not a proof of model quality by itself.
- `experiments/` contains recorded validation results and diagnostics.
- `data/manifest.json` and `data/processed/data_manifest.csv` provide data provenance and checksums.
- `model_card.md` documents known limitations, including point-scale weather for large basins, regulated rivers, daily-mean versus instantaneous flow, and ungauged-station generalization.
- The challenge's hidden test labels are not available in the repository's normal `data/processed/test.csv`; do not treat the development-only labeled artifact as an allowed model input.

## 6. Documentation index

- [FILE_MAP.md](FILE_MAP.md): source and artifact map.
- [REQUIREMENTS_CHECKLIST.md](REQUIREMENTS_CHECKLIST.md): detailed checklist.
- [DATA.md](DATA.md): dataset schema and split.
- [DATA_EXTRACTION.md](DATA_EXTRACTION.md): provenance and ingestion.
- [FEATURES.md](FEATURES.md): feature definitions.
- [MODELING.md](MODELING.md): modeling decisions.
- [EVALUATION.md](EVALUATION.md): scoring formulas.
- [RUNBOOK.md](RUNBOOK.md): setup and operations.

*Last verified: 2026-11-05.*
