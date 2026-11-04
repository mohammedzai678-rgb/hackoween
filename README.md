---
title: FLOODCAST
emoji: 🌊
colorFrom: blue
colorTo: cyan
sdk: docker
app_port: 7860
pinned: false
---

# FLOODCAST — Predict the Surge Before It Strikes

> **24-Hour Regression Hackathon · Hydrological Discharge Prediction (`discharge_cfs`)**
> **Repository:** https://github.com/mohammedzai678-rgb/hackoween

---

## 1. Executive Summary & Approach

We built a complete, leak-free, physics-informed hydrological forecasting system (`floodcast`) that predicts daily river discharge (`discharge_cfs`, cubic feet per second) across **30 USGS gauge stations** (`128,811` training rows from `2010-01-01` to `2021-12-31` and `10,585` test rows across `29` active stations in `2022-01-01` to `2022-12-31`) using only meteorological forcing (Open-Meteo ERA5/ERA5-Land daily precipitation, max/min temperature, and 0–7 cm soil moisture) and static catchment attributes (`drainage_area_sqmi`, `mean_elevation_ft`, `slope_pct`, `forest_cover_pct`).

### Key Technical Highlights
1. **100% Real Multi-Source Data Extraction (`scripts/fetch_real_data.py`)**:
   - **Dataset 1 (USGS NWIS `00060`)**: Live daily discharge & expanded site metadata from `https://waterservices.usgs.gov/nwis/dv/` and `/site/` (`139,396` raw rows).
   - **Dataset 2 (Open-Meteo ERA5 Archive)**: Complete 13-year meteorological histories across all 30 stations (`142,440` station-days, `0.00%` missing values).
   - **Dataset 3 (Catchment Attributes)**: USGS `drain_area_va` + GAGES-II watershed slope (`SLOPE_PCT`), elevation (`ELEV_SITE_M`), and forest cover (`FOREST06`).
   - Every API call and CSV file is SHA-256 hashed in `data/manifest.json` (`67` provenance entries) and `data/processed/data_manifest.csv`.
2. **127 Backward-Only Hydrological Features Across 8 Families (`floodcast/features.py`)**:
   - **Rainfall Memory & Volumetric Forcing (`35` features)**: 1-to-365-day backward rolling sums, volumetric basin precipitation (`rain_vol_7d..365d = rain_sum * drainage_area_sqmi / 1000`), climatological anomaly ratios (`rain_anomaly_7d/30d/90d_vs_365d`), max 1-day intensities, wet streaks, and storm acceleration.
   - **Antecedent Routing (`6` features)**: Vectorized causal IIR Antecedent Precipitation Index (`scipy.signal.lfilter` with $\alpha \in \{0.50, 0.55, 0.80, 0.95, 0.985\}$) + Kirpich time-of-concentration proxy.
   - **Soil Moisture & SCS Curve-Number Runoff (`15` features)**: Lags, rolling means, deltas, expanding percentile rank (`soil_moisture_pctl`), `soil_x_rain`, and SCS-CN `runoff_proxy`.
   - **Snowmelt & Evapotranspiration (`14` features)**: Rain/snow partitioning, `rain_on_snow`, positive/freezing degree-days (`pdd`, `fdd`), freeze-thaw cycles, and Hargreaves `et_proxy`.
   - **Calendar (`4`), Static Routing (`8`), Pre-Cutoff Station Priors (`26`), and HUC-2 Cross-Station Synoptic Context (`11`)**.
3. **Scale-Consistent Multi-Target Ensemble (`scripts/run_full_experiments.py`)**:
   - Combines **LightGBM (3 seeds: `42, 100, 2026`)**, **XGBoost**, and **CatBoost** across four target spaces (**Raw $L_2$**, **Per-Station Mean-Scaled (`99.9%` training clip)**, **$\ln(1+Q)$ with per-station Duan smearing**, and **Tweedie $p=1.5$**) plus a **High-Flow Sample-Weighted specialist (`1 + 3*I(q>=p90) + 5*I(q>=p99)`)** and **basin-scale interpolation** so small creeks (`31 cfs` mean flow) never suffer additive raw-$L_2$ error floors while continental rivers (`199,092 cfs` mean flow) achieve optimal flood-peak tracking.

---

## 2. Final Validation & Test Results

| Run / Stage | Features | `best_iteration` | Val RMSE (cfs) | Extreme RMSE (Top 10%) | MAE (cfs) | $R^2$ | Composite |
|---|---:|---:|---:|---:|---:|---:|---:|
| `run_naive_station_mean` | 1 | 0 | 28,684.21 | 36,950.65 | 10,477.39 | 0.6226 | 40.03 |
| `run_naive_station_doy_mean` | 2 | 0 | 25,097.56 | 23,623.81 | 8,672.43 | 0.7111 | 63.66 |
| `run_naive_ridge_rain` | 11 | 0 | 33,916.68 | 54,419.02 | 17,038.36 | 0.4723 | 0.00 |
| `run_baseline_lgb` (8 Raw Cols) | 8 | 40 | 22,341.62 | 44,819.27 | 11,182.37 | 0.7710 | 49.62 |
| `run_ablation_8_cross_station` (All 8 Families) | 127 | 48 | 16,224.48 | 33,542.97 | 8,536.07 | 0.8792 | 78.92 |
| `run_target_scaled` (`mean_q` + 99.9% clip) | 127 | 989 | 21,527.73 | 17,361.04 | 6,773.93 | 0.7874 | 81.41 |
| `run_target_log1p_smearing` | 127 | 794 | 21,657.44 | **17,306.31** | 6,612.86 | 0.7848 | 81.39 |
| `run_target_tweedie` ($p=1.5$) | 127 | 82 | 16,299.40 | 34,572.84 | 5,715.03 | 0.8781 | 82.67 |
| `run_target_blend_raw_log1p` | 127 | 478 | 15,547.97 | 32,497.72 | 5,289.26 | 0.8891 | 86.94 |
| `run_flood_peak_weighted` | 127 | 53 | 15,762.20 | 28,590.60 | 6,119.24 | 0.8860 | 88.17 |
| `run_xgboost` (Raw + Scaled) | 127 | 50 | 16,233.02 | 26,351.98 | 5,655.18 | 0.8791 | 89.59 |
| `run_catboost` (Raw + Scaled) | 127 | 34 | 17,160.79 | 32,367.16 | 5,809.13 | 0.8649 | 82.13 |
| `run_lgb_3seed_avg` (Seeds 42, 100, 2026) | 127 | 50 | **15,285.03** | 31,530.27 | **5,216.74** | **0.8928** | 88.50 |
| **`run_final_ensemble` (FLOODCAST Final)** | **127** | **293** | **15,795.20** | **27,533.56** | **5,411.65** | **0.8856** | **90.13** |

---

## 3. One-Command Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the full end-to-end pipeline (ingest -> features -> train -> predict -> check)
python solution.py

# 3. Reproduce all 10 experimental tables, plots, and multi-model ensemble
python -u scripts/run_full_experiments.py

# 4. Run submission validator & full pytest suite (leakage, checker, FastAPI endpoints)
python -m floodcast.check_submission predictions.csv data/processed/test.csv
python -m pytest tests/ -v

# 5. Launch full-stack website (FastAPI backend on :8000 + Next.js 14 frontend on :3000)
docker compose up --build
```

---

## 4. Complete CSV Artifacts & Documentation Index

- **Root Submission Deliverables**:
  - `predictions.csv` (`10,585` rows, `29` stations, `2022-01-01..2022-12-31`, `PASS`)
  - `solution.py`, `model_card.md`, `requirements.txt`, `Makefile`, `docker-compose.yml`
- **Processed Data & Catalogs (`data/processed/`)**:
  - `train.csv` (`128,811` rows), `test.csv` (`10,585` rows), `sample_submission.csv`, `station_metadata.csv` (`30` stations)
  - `station_sanity_summary.csv`, `feature_catalog.csv` (`127` features), `data_manifest.csv` (`67` entries), `train_features_sample.csv`, `test_features_sample.csv`
- **Experiment CSV Logs (`experiments/`)**:
  - `runs_summary.csv` & `runs.jsonl` (`25` logged runs with `best_iteration` and `early_stopping_rounds=200`)
  - `naive_baselines.csv`, `ablations.csv`, `target_strategies.csv`, `flood_peak_handling.csv`
  - `per_station_metrics.csv`, `worst_50_errors.csv`, `expanding_window_folds.csv`, `leave_one_station_out.csv`
- **Documentation (`docs/` & `slides/slides.md`)**:
  - See `docs/README.md` for all 16 engineering documents and `slides/slides.md` for the 6-slide presentation deck.
