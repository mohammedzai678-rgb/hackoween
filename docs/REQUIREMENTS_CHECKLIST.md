# FLOODCAST Requirements Checklist

> Extracted from `docs/FLOODCAST_Participant_PS_Updated.pdf`. Every requirement is verified (`[x]`) and mapped to the exact file/module that satisfies it.

---

## 1. Problem Statement & Task
- [x] For each `(station_id, date)` in `test.csv`, predict `discharge_cfs` — **PSA-1** → `floodcast/train.py`, `predictions.csv`
- [x] `discharge_cfs` is continuous, non-negative — **PSA-2** → `floodcast/check_submission.py`
- [x] Predict peak/daily discharge (cfs) — **PSA-3** → `floodcast/train.py`, `docs/DECISIONS.md` (`DEC-003`)
- [x] Model must generalize to stations not seen during training — **PSA-4** → `floodcast/validate.py` (`leave_one_station_out`)

## 2. Dataset Requirements
### 2.1 Dataset 1 — USGS NWIS (Primary target data)
- [x] Use USGS daily discharge data (parameter 00060) — **DS1-1** → `floodcast/ingest.py`
- [x] Include recommended starter stations: `01646500`, `07010000`, `08158000`, `02087500`, `11447650` — **DS1-2** → `configs/base.yaml`
- [x] Add more stations from USGS beyond starter data (32 configured station metadata records; 30 stations in train, 29 in test) — **DS1-3** → `configs/base.yaml`, `data/processed/station_metadata.csv`

### 2.2 Dataset 2 — Open-Meteo Historical Weather API
- [x] Retrieve daily precipitation (mm), max/min temperature (°C), soil moisture — **DS2-1** → `floodcast/ingest.py`
- [x] Match weather data to each USGS station by latitude and longitude — **DS2-2** → `floodcast/ingest.py`
- [x] Free, no API key needed — **DS2-3** → verified in `docs/DATA_EXTRACTION.md`

### 2.3 Dataset 3 — USGS StreamStats Catchment Attributes
- [x] Extract `DRNAREA`, `ELEV`, `FOREST`, `SLOPE_PCT` per station — **DS3-1** → `floodcast/ingest.py`
- [x] Static features: drainage area, mean elevation, mean slope, % forest — **DS3-2** → `floodcast/features.py`

### 2.4 Dataset Joins
- [x] `station_id` joins discharge ↔ catchment attributes — **DJ-1** → `floodcast/ingest.py`
- [x] `(lat, lon, date)` joins discharge ↔ weather — **DJ-2** → `floodcast/ingest.py`
- [x] Pre-joined processed dataset (`128,811` train rows, `10,585` test rows) — **DJ-3** → `data/processed/`

## 3. Input/Output Contract
### 3.1 Files Provided
- [x] `train.csv` with columns: `station_id, date, discharge_cfs, precipitation_mm, temp_max_c, temp_min_c, soil_moisture, drainage_area_sqmi, mean_elevation_ft, slope_pct, forest_cover_pct` (`128,811` rows) — **IO-1** → `data/processed/train.csv`
- [x] `test.csv` same columns minus `discharge_cfs` (`10,585` rows) — **IO-2** → `data/processed/test.csv`
- [x] `sample_submission.csv`: `station_id, date, discharge_cfs` (zeros, `10,585` rows) — **IO-3** → `data/processed/sample_submission.csv`
- [x] `station_metadata.csv`: `station_id, station_name, latitude, longitude, state, river_name` (`32` rows) — **IO-4** → `data/processed/station_metadata.csv`

### 3.2 Required Output — `predictions.csv`
- [x] Exactly three columns: `station_id`, `date`, `discharge_cfs` — **OP-1** → `floodcast/check_submission.py`
- [x] One row per test record (`10,585` rows in the committed artifact) — **OP-2** → `floodcast/check_submission.py`
- [x] `discharge_cfs` must be a non-negative float — **OP-3** → `floodcast/train.py`, `floodcast/check_submission.py`
- [x] No NaN values — **OP-4** → `floodcast/check_submission.py`
- [x] No negative values — **OP-5** → `floodcast/check_submission.py`
- [x] No missing rows — **OP-6** → `floodcast/check_submission.py`
- [x] No extra columns — **OP-7** → `floodcast/check_submission.py`
- [x] UTF-8 encoded CSV — **OP-8** → `floodcast/check_submission.py`
- [x] Column names not misspelled and in correct order — **OP-9** → `floodcast/check_submission.py`

## 4. Validation Rules (Auto-reject Shield)
- [x] Every `(station_id, date)` in `test.csv` present in predictions — **VR-1** → `floodcast/check_submission.py`
- [x] No negative or NaN `discharge_cfs` — **VR-2** → `floodcast/check_submission.py`
- [x] Same row count as `test.csv` (`10,585` in the committed artifact) — **VR-3** → `floodcast/check_submission.py`
- [x] Correct column names and order — **VR-4** → `floodcast/check_submission.py`
- [x] UTF-8 encoding — **VR-5** → `floodcast/check_submission.py`

## 5. Evaluation Criteria
- [x] RMSE (overall) — weight 40% — **EC-1** → `floodcast/scoring.py`
- [x] RMSE on extreme events (top 10% discharge days per station) — weight 30% — **EC-2** → `floodcast/scoring.py`
- [x] MAE — weight 20% — **EC-3** → `floodcast/scoring.py`
- [x] R-squared — weight 10% — **EC-4** → `floodcast/scoring.py`
- [x] Each metric normalized to 0–100 scale using best/worst across submissions — **EC-5** → `floodcast/scoring.py`
- [x] `RMSE_norm = 100 * (worst_RMSE - your_RMSE) / (worst_RMSE - best_RMSE)` — **EC-6** → `floodcast/scoring.py`
- [x] Composite = weighted average of normalized scores (higher = better) — **EC-7** → `floodcast/scoring.py`

## 6. Hard Disqualification Rules
- [x] No negative discharge values in predictions — **DQ-1** → `floodcast/check_submission.py`
- [x] No missing rows in `predictions.csv` — **DQ-2** → `floodcast/check_submission.py`
- [x] No submitting actual test labels as predictions (leakage) — **DQ-3** → `tests/test_no_leakage.py`
- [x] `predictions.csv` must be generated by running code, not hand-edited — **DQ-4** → `solution.py`
- [x] No pre-built model from before the event (declared in `model_card.md`) — **DQ-5** → `model_card.md`
- [x] No sharing predictions or code with other teams — **DQ-6** → team policy

## 7. Submission Requirements
- [x] Public GitHub repo with all code — **SR-1** → repository root
- [x] `predictions.csv` — **SR-2** → `predictions.csv`
- [x] `README.md` with team name, members, approach summary (3–5 sentences), how to run — **SR-3** → `README.md`
- [x] `requirements.txt` or `environment.yml` — **SR-4** → `requirements.txt`
- [x] `model_card.md`: features used, model type, train/val RMSE, known limitations — **SR-5** → `model_card.md`
- [x] Presentation (3–5 slides): Problem → Data → Model → Results → Limitations — **SR-6** → `slides/slides.md`
- [x] `solution.py` or `solution.ipynb` — **SR-7** → `solution.py`

## 8. Repo Structure (Minimum Required)
- [x] `README.md` at root — **RS-1** → `README.md`
- [x] `requirements.txt` at root — **RS-2** → `requirements.txt`
- [x] `solution.py` at root — **RS-3** → `solution.py`
- [x] `predictions.csv` at root — **RS-4** → `predictions.csv`
- [x] `model_card.md` at root — **RS-5** → `model_card.md`

## 9. Rules — Allowed
- [x] Any ML framework (`scikit-learn`, `XGBoost`, `LightGBM`, `CatBoost`) — **RA-1** → `requirements.txt`
- [x] Pre-trained models if declared in `model_card.md` (`None` used) — **RA-2** → `model_card.md`
- [x] Adding more stations from USGS (`32` total) — **RA-3** → `configs/base.yaml`
- [x] Any feature engineering on provided columns (`60+` features) — **RA-4** → `floodcast/features.py`
- [x] Teams of 1 to 4 members — **RA-5** → `README.md`

## 10. Rules — Not Allowed
- [x] ❌ Using `test.csv` discharge values as model input (leakage) — **RN-1** → `tests/test_no_leakage.py`
- [x] ❌ Manually editing `predictions.csv` — **RN-2** → enforced by pipeline
- [x] ❌ Submitting pre-built model from before event — **RN-3** → `model_card.md`
- [x] ❌ Sharing predictions/code with other teams — **RN-4** → team policy

## 11. Internal Quality Requirements
- [x] No data leakage: test dates strictly after training dates — **IQ-1** → `tests/test_no_leakage.py`
- [x] `CUTOFF` enforcement: no discharge download after `CUTOFF` (`2021-12-31`) — **IQ-2** → `configs/base.yaml`, `floodcast/ingest.py`
- [x] All rolling/lag features look backward only — **IQ-3** → `floodcast/features.py`, `tests/test_no_leakage.py`
- [x] Predictions clipped at 0 — **IQ-4** → `floodcast/train.py`
- [x] One-command reproducibility — **IQ-5** → `solution.py`, `Makefile`
- [x] Full data extraction provenance — **IQ-6** → `docs/DATA_EXTRACTION.md`, `data/processed/data_manifest.csv`
- [x] Training Gate protocol — **IQ-7** → `docs/TRAINING_LOG.md`, `docs/API.md`

---

*Last updated: 2026-11-04 — All checklist items verified*
