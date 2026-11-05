# FLOODCAST File Map

Use this page when a judge, reviewer, or maintainer needs to find the implementation behind a behavior.

## Submission and entry points

| File | Purpose |
|---|---|
| [README.md](../README.md) | Project overview, quick start, artifacts, and judge entry points |
| [solution.py](../solution.py) | One-command ingestion, training, prediction, and validation entry point |
| [predictions.csv](../predictions.csv) | Committed three-column submission artifact |
| [model_card.md](../model_card.md) | Model disclosure, validation results, provenance, and limitations |
| [requirements.txt](../requirements.txt) | Python dependencies |
| [Makefile](../Makefile) | Common pipeline, validation, test, and Docker commands |

## Python pipeline

| File | Responsibility |
|---|---|
| [floodcast/__main__.py](../floodcast/__main__.py) | CLI commands: `run`, `ingest`, `train`, `predict`, `check`, `validate` |
| [floodcast/ingest.py](../floodcast/ingest.py) | Public data retrieval, normalization, joins, caching, and processed CSV creation |
| [floodcast/features.py](../floodcast/features.py) | Backward-looking hydrology, weather, routing, soil, snow, calendar, static, station, and cross-station features |
| [floodcast/train.py](../floodcast/train.py) | Forward split, feature computation, model fitting, prediction, evaluation, and artifact writing |
| [floodcast/validate.py](../floodcast/validate.py) | Forward-time, expanding-window, and leave-one-station-out validation helpers |
| [floodcast/scoring.py](../floodcast/scoring.py) | RMSE, extreme RMSE, MAE, R², normalized composite, and per-station metrics |
| [floodcast/check_submission.py](../floodcast/check_submission.py) | Hard submission contract and disqualification checks |

## Configuration and data

| File or directory | Responsibility |
|---|---|
| [configs/base.yaml](../configs/base.yaml) | Cutoff date, station list, API endpoints, feature switches, model settings, and output paths |
| [data/processed/train.csv](../data/processed/train.csv) | Training rows with target and input columns |
| [data/processed/test.csv](../data/processed/test.csv) | Prediction rows without `discharge_cfs` |
| [data/processed/feature_catalog.csv](../data/processed/feature_catalog.csv) | Generated feature names and descriptions |
| [data/processed/data_manifest.csv](../data/processed/data_manifest.csv) | Extraction provenance and checksums |
| [data/processed/station_metadata.csv](../data/processed/station_metadata.csv) | Station names, coordinates, states, and river names |
| [data/manifest.json](../data/manifest.json) | Raw API/file provenance manifest |

## Tests and evidence

| File or directory | What it proves |
|---|---|
| [tests/test_no_leakage.py](../tests/test_no_leakage.py) | Cutoff, temporal ordering, no target in test input, backward-only rolling behavior, and scorer integrity |
| [tests/test_submission_checker.py](../tests/test_submission_checker.py) | Valid output plus negative, NaN, non-numeric, duplicate, missing-row, column, and encoding rejection |
| [tests/test_backend_api.py](../tests/test_backend_api.py) | FastAPI endpoint behavior |
| [tests/test_rag.py](../tests/test_rag.py) | Retrieval-augmented chatbot behavior |
| [experiments/](../experiments/) | Experiment logs, validation summaries, target comparisons, and error diagnostics |
| [artifacts/](../artifacts/) | Saved model and visualization artifacts |

## Application

| File or directory | Responsibility |
|---|---|
| [backend/app/main.py](../backend/app/main.py) | FastAPI application and lifecycle |
| [backend/app/routers/v1.py](../backend/app/routers/v1.py) | Versioned API routes |
| [backend/app/services/](../backend/app/services/) | Data, chat, RAG, training, and job services |
| [frontend/src/app/](../frontend/src/app/) | Next.js pages for dashboard, map, prediction, stations, training, and vault |
| [frontend/src/components/](../frontend/src/components/) | Shared navigation, role/theme providers, and map components |
| [docker-compose.yml](../docker-compose.yml) | Backend/frontend production-like local orchestration |

## Documentation

| File | Purpose |
|---|---|
| [JUDGE_GUIDE.md](JUDGE_GUIDE.md) | Criterion-to-evidence map and shortest verification path |
| [REQUIREMENTS_CHECKLIST.md](REQUIREMENTS_CHECKLIST.md) | Full challenge checklist |
| [ARCHITECTURE.md](ARCHITECTURE.md) | End-to-end architecture |
| [API.md](API.md) | API contract |
| [FRONTEND.md](FRONTEND.md) | Frontend structure |
| [DATA.md](DATA.md) | Data card |
| [DATA_EXTRACTION.md](DATA_EXTRACTION.md) | Data provenance |
| [FEATURES.md](FEATURES.md) | Feature catalog |
| [MODELING.md](MODELING.md) | Modeling choices |
| [EVALUATION.md](EVALUATION.md) | Evaluation formulas |
| [RUNBOOK.md](RUNBOOK.md) | Operational runbook |
| [DECISIONS.md](DECISIONS.md) | Architecture decisions |
| [CHANGELOG.md](CHANGELOG.md) | Change history |
| [slides/slides.md](../slides/slides.md) | Presentation deck |
