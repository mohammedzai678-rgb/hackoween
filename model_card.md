# Model Card — FLOODCAST Multi-Target Hydrological Ensemble

## 1. Model Details
- **Model Name:** FLOODCAST Scale-Consistent Multi-Target GBDT Ensemble (`run_final_ensemble`)
- **Model Architecture:** 7-component diverse gradient-boosted decision tree ensemble combining **LightGBM (3 random seeds: `42, 100, 2026`)**, **XGBoost (`tree_method="hist"`)**, and **CatBoost** across four hydrological target spaces (**Raw $L_2$**, **Per-Station Mean-Scaled (`99.9%` training clip)**, **$\ln(1+Q)$ with per-station Duan smearing**, and **Tweedie (`p=1.5`)**) plus a **High-Flow Sample-Weighted (`1 + 3*I(q>=p90) + 5*I(q>=p99)`)** flood-peak specialist and **basin-scale interpolation** ($\alpha_{\text{scale}} = \text{clip}((\bar{Q}_s - 500)/25000, 0, 1)$).
- **Target Variable:** Daily river discharge (`discharge_cfs`, cubic feet per second) — continuous, strictly non-negative (`np.clip(pred, 0.0, None)`).
- **Pre-trained Components:** **None.** Every tree, scaling statistic, and ensemble weight is trained from scratch on historical data up to `CUTOFF = 2021-12-31`.

---

## 2. Dataset & Provenance
All data is fetched from the three public APIs specified in the FLOODCAST Problem Statement (`scripts/fetch_real_data.py`) and logged with SHA-256 checksums in `data/manifest.json` (`67` provenance entries) and `data/processed/data_manifest.csv`:
1. **Dataset 1 — USGS NWIS Daily Values (`parameterCd=00060`)**: `https://waterservices.usgs.gov/nwis/dv/` and `https://waterservices.usgs.gov/nwis/site/` (`139,396` daily records across 30 stations passing $\ge 80\%$ completeness).
2. **Dataset 2 — Open-Meteo Historical Weather API (ERA5 / ERA5-Land)**: `https://archive-api.open-meteo.com/v1/archive` (`142,440` station-days, 100% weather coverage across all 30 stations for `precipitation_mm`, `temp_max_c`, `temp_min_c`, and daily-mean `soil_moisture` 0–7 cm).
3. **Dataset 3 — USGS StreamStats & GAGES-II Catchment Attributes**: `drainage_area_sqmi` (`DRNAREA` cross-checked against live USGS `drain_area_va`), `mean_elevation_ft` (`ELEV_SITE_M * 3.28084`), `slope_pct` (`SLOPE_PCT`), and `forest_cover_pct` (`FOREST06`).

### Canonical Split (`CUTOFF = 2021-12-31`)
- **`train.csv`**: `128,811` rows (`2010-01-01` to `2021-12-31`, `30` stations, `0.00%` missing values).
- **`test.csv` / `predictions.csv`**: `10,585` rows (`2022-01-01` to `2022-12-31`, `29` active stations; `11447650` Sacramento River at Freeport CA ended `00060` reporting on `2015-09-30`).
- **Forward-in-Time Validation Split**: Train `2010-01-01..2020-12-31` (`118,229` rows) $\rightarrow$ Validate `2021-01-01..2021-12-31` (`10,582` rows, 29 stations).

---

## 3. Feature Engineering (`127` Features Across 8 Families)
Documented in `data/processed/feature_catalog.csv` and `floodcast/features.py`. All rolling, decay, and cumulative operations are strictly backward-looking (`t-W..t`) per station:
1. **Raw Weather & Static (`8` cols)**: `precipitation_mm`, `temp_max_c`, `temp_min_c`, `soil_moisture`, `drainage_area_sqmi`, `mean_elevation_ft`, `slope_pct`, `forest_cover_pct`.
2. **Rainfall Memory & Volumetric Forcing (`35` cols)**: Rolling sums (`1, 2, 3, 7, 14, 30, 60, 90, 180, 365d`), volumetric basin rainfall (`rain_vol_7d..365d = rain_sum * area / 1000`), climatological anomaly ratios (`rain_anomaly_7d/30d/90d_vs_365d`), max 1-day rain (`3, 7, 14d`), wet-day counts (`>1mm, >5mm`), days since `5/10/25mm/p95` rain, consecutive `wet_streak`, intensity ratios, and 3-day `rain_acceleration`.
3. **Antecedent Routing (`6` cols)**: Causal IIR Antecedent Precipitation Index (`api_fast` $\alpha=0.50$, `api_med` $\alpha=0.80$, `api_slow` $\alpha=0.95$, `api_baseflow` $\alpha=0.985$), Kirpich `conc_time_proxy`, and `rain_at_conc_window`.
4. **Soil Moisture & SCS Runoff (`15` cols)**: Lags (`1, 3, 7d`), rolling means (`7, 14, 30d`), deltas (`1, 3, 7d`), expanding station percentile rank (`soil_moisture_pctl`), `soil_x_rain`, SCS-CN `runoff_proxy`, `effective_precip`, and `soil_fast_slow_diff`.
5. **Temperature, Snowmelt & ET (`14` cols)**: `temp_mean_c`, `diurnal_range_c`, `snow_mm`, `liquid_rain_mm`, `rain_on_snow`, `pdd_7d/14d/30d`, `fdd_7d/14d`, `freeze_thaw_7d`, `et_proxy` (Hargreaves), `net_precip_7d`, and `spring_snowmelt_idx`.
6. **Cyclical Calendar (`4` cols)**: `doy_sin`, `doy_cos`, `month`, and `water_year_day` (starting Oct 1).
7. **Static & Conceptual Two-Store Basin Routing (`8` cols)**: `log_drainage_area`, `area_x_rain7`, `area_x_api_slow`, `slope_x_rain3`, `forest_x_elev`, `fast_runoff_store`, `slow_baseflow_store`, and `conceptual_water_balance`.
8. **Pre-Cutoff Station Priors (`26` cols)** & **Cross-Station Synoptic Context (`11` cols)**: Historical discharge quantiles (`mean, median, std, p75, p90, p99`), smoothed DOY climatology (`station_doy_mean_q`), calibrated water balance (`station_calibrated_wb`, `station_doy_x_wb`), and HUC-2 regional rainfall/soil moisture context.

---

## 4. Validation & Test Results

### 2021 Forward-in-Time Validation Progression (`experiments/runs_summary.csv`)
| Stage / Model | Features | `best_iteration` | RMSE (cfs) | Extreme RMSE (Top 10%) | MAE (cfs) | $R^2$ | Composite |
|---|---:|---:|---:|---:|---:|---:|---:|
| Naive Station Mean | 1 | 0 | 28,684.21 | 36,950.65 | 10,477.39 | 0.6226 | 40.03 |
| Naive Station DOY Mean | 2 | 0 | 25,097.56 | 23,623.81 | 8,672.43 | 0.7111 | 63.66 |
| Naive Linear Ridge | 11 | 0 | 33,916.68 | 54,419.02 | 17,038.36 | 0.4723 | 0.00 |
| Baseline LightGBM (8 Raw Cols) | 8 | 40 | 22,341.62 | 44,819.27 | 11,182.37 | 0.7710 | 49.62 |
| Full Ablation LightGBM (All 8 Families) | 127 | 48 | 16,224.48 | 33,542.97 | 8,536.07 | 0.8792 | 78.92 |
| Target Strategy: `scaled` (`mean_q` + 99.9% clip) | 127 | 989 | 21,527.73 | 17,361.04 | 6,773.93 | 0.7874 | 81.41 |
| Target Strategy: `log1p_smearing` | 127 | 794 | 21,657.44 | **17,306.31** | 6,612.86 | 0.7848 | 81.39 |
| Target Strategy: `tweedie` ($p=1.5$) | 127 | 82 | 16,299.40 | 34,572.84 | 5,715.03 | 0.8781 | 82.67 |
| Target Strategy: `blend_raw_log1p` | 127 | 478 | 15,547.97 | 32,497.72 | 5,289.26 | 0.8891 | 86.94 |
| Flood-Peak High-Flow Weighted LightGBM | 127 | 53 | 15,762.20 | 28,590.60 | 6,119.24 | 0.8860 | 88.17 |
| XGBoost Regressor (Raw + Scaled) | 127 | 50 | 16,233.02 | 26,351.98 | 5,655.18 | 0.8791 | 89.59 |
| CatBoost Regressor (Raw + Scaled) | 127 | 34 | 17,160.79 | 32,367.16 | 5,809.13 | 0.8649 | 82.13 |
| 3-Seed LightGBM Average (Seeds 42, 100, 2026) | 127 | 50 | **15,285.03** | 31,530.27 | **5,216.74** | **0.8928** | 88.50 |
| **FLOODCAST Final Ensemble (`run_final_ensemble`)** | **127** | **293** | **15,795.20** | **27,533.56** | **5,411.65** | **0.8856** | **90.13** |

### Held-Out 2022 Pseudo-Test Check (Evaluated Once, Zero Tuning)
- **Overall RMSE:** `20,185.62 cfs` | **Extreme RMSE (Top 10%):** `33,058.01 cfs` | **MAE:** `6,459.62 cfs` | **$R^2$:** `0.7752`

---

## 5. Known Limitations
1. **Unobserved Dam Releases & Reservoir Regulation:** Stations below major reservoirs (`08158000` Colorado River at Austin TX, `09380000` Colorado River at Lees Ferry AZ, `06610000` Missouri River at Omaha NE) exhibit step-changes driven by human release schedules rather than local weather.
2. **Point-Scale Grid Weather for Continental Basins:** Open-Meteo weather queried at the gauge coordinates is a local proxy for huge continental watersheds (`07010000` Mississippi River at St. Louis, `697,000 sqmi`, which contributes `62.07%` of total validation squared error).
3. **Daily Mean (`00060`) vs. Instantaneous Peak Flow:** USGS `parameterCd=00060` reports daily mean discharge; flash-flood instantaneous sub-daily peaks on small creeks (`< 200 sqmi`) can exceed the 24-hour mean.
4. **Ungauged Station Generalization:** In Leave-One-Station-Out CV (`experiments/leave_one_station_out.csv`), removing a station's historical discharge prior reduces median per-station $R^2$ to `0.1041`, showing that historical basin yield priors are critical when no recent flow lags are available.

---

## 6. Verification

The committed output is checked against the processed test keys by:

```bash
python -m floodcast.check_submission predictions.csv data/processed/test.csv
python -m pytest tests -q
```

See [docs/JUDGE_GUIDE.md](docs/JUDGE_GUIDE.md) for the complete criterion-to-file map and [docs/FILE_MAP.md](docs/FILE_MAP.md) for the repository navigation guide.

*Last updated: 2026-11-05*
