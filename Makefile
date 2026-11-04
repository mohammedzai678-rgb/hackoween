# Makefile for FLOODCAST

.PHONY: data verify-data train predict check test site clean

# Full pipeline (ingestion + training + prediction + check)
run:
	python -m floodcast run --config configs/base.yaml

# Data ingestion only
data:
	python -m floodcast ingest --config configs/base.yaml

# Verify data checksums
verify-data:
	python -c "import json; m=json.load(open('data/manifest.json')); print(f'{len(m)} manifest entries loaded'); [print(f'  {e.get(\"source\",\"?\")} {e.get(\"station\",\"?\")} {e.get(\"http_status\",\"?\")}') for e in m[:5]]"

# Train model
train:
	python -m floodcast train --config configs/base.yaml

# Generate predictions
predict:
	python -m floodcast predict --config configs/base.yaml

# Check submission
check:
	python -m floodcast check --config configs/base.yaml

# Run tests
test:
	python -m pytest tests/ -v

# Start website (backend + frontend)
site:
	docker compose up --build

# Clean processed data
clean:
	del /Q data\processed\*.csv 2>nul || true
	del /Q predictions.csv 2>nul || true
