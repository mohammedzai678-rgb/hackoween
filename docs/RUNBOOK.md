# FLOODCAST Runbook

## Prerequisites
- Python 3.10+
- pip or conda

## Setup

```bash
# Clone the repo
git clone <repo-url>
cd hackoween

# Install dependencies
pip install -r requirements.txt
```

## One-Command Run

```bash
python solution.py
```

This runs the full pipeline: ingest → features → train → predict → check.

## Step-by-Step

```bash
# 1. Ingest data from USGS and Open-Meteo
python -m floodcast ingest --config configs/base.yaml

# 2. Train model and generate predictions
python -m floodcast train --config configs/base.yaml

# 3. Check submission
python -m floodcast check --config configs/base.yaml

# 4. Run tests
python -m pytest tests/ -v
```

## Using Make

```bash
make data        # Ingest only
make train       # Train only
make predict     # Generate predictions
make check       # Validate predictions.csv
make test        # Run test suite
make run         # Full pipeline
make site        # Start website (Docker)
```

## Configuration

Edit `configs/base.yaml` to change:
- Stations list
- Date ranges and CUTOFF
- Feature toggles
- Model hyperparameters
- Validation scheme

## Troubleshooting

| Issue | Solution |
|-------|----------|
| USGS API timeout | Check network; cached data in `data/cache/` will be used |
| Open-Meteo rate limit | Increase `rate_limit_sleep` in config |
| LightGBM not found | `pip install lightgbm` |
| Missing data/ files | Run `make data` or `python -m floodcast ingest` |
| Submission check fails | Check error messages; common issues: NaN, negatives, row count |

---

*Last updated: 2026-11-04 Phase A*
