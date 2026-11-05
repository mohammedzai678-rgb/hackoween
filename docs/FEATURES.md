# FLOODCAST Feature Catalog

> Every feature family, what each feature is, why it helps hydrologically, and ablation results.

## Feature Families

The generated catalog contains **127 engineered features across eight families**. The authoritative generated list is [data/processed/feature_catalog.csv](../data/processed/feature_catalog.csv); this page explains the main families and representative columns.

### 1. Rainfall Features
| Feature | Description | Hydrological Rationale |
|---------|-------------|----------------------|
| `rain_sum_{w}d` | Rolling sum over w days (1,2,3,7,14,30,60) | Antecedent precipitation drives runoff accumulation |
| `rain_max_1d_in_{w}d` | Max single-day rain in last w days | Intensity matters more than totals for flash floods |
| `wet_days_gt{t}mm_{w}d` | Count of days with rain > t mm in window | Persistent rainfall saturates soil |
| `days_since_rain_{t}mm` | Days since rain ≥ t mm | Longer dry spells reduce baseflow and soil moisture |
| `days_since_rain_p95` | Days since station's 95th percentile rain | Station-relative extreme rain recency |
| `wet_streak` | Consecutive days with > 1mm rain | Prolonged rain events cause the worst floods |
| `rain_intensity_ratio_{w}d` | Max daily / window total | Concentrated vs distributed rainfall |
| `rain_acceleration` | 3-day sum minus previous 3-day sum | Rising rainfall trend signals approaching storms |

### 2. Antecedent Features
| Feature | Description | Rationale |
|---------|-------------|-----------|
| `rain_decayed_{alpha}` | Exponentially decayed rainfall (α=0.5,0.8,0.95) | Models linear reservoir response at different speeds |
| `time_of_concentration` | Kirpich-style Tc estimate from area/slope | Larger basins have longer lag between rain and peak |

### 3. Soil Features
| Feature | Description | Rationale |
|---------|-------------|-----------|
| `soil_moisture_lag{n}` | Soil moisture n days ago | Antecedent wetness predisposes flooding |
| `soil_moisture_mean_7d` | 7-day rolling mean | Smoothed soil state |
| `soil_moisture_delta_{n}d` | Change in soil moisture over n days | Rising soil moisture = less infiltration capacity |
| `soil_moisture_pct` | Station percentile rank | Relative wetness compared to station's history |
| `soil_x_rain` | soil_moisture × precipitation | Saturated soil + rain = maximum runoff |
| `runoff_proxy` | Curve-number-style estimate | Physics-informed runoff potential |

### 4. Temperature/Snow Features
| Feature | Description | Rationale |
|---------|-------------|-----------|
| `temp_mean_c` | Daily mean temperature | Controls snow/rain partition and ET |
| `diurnal_range_c` | Tmax − Tmin | Large range → clear skies, low runoff |
| `rain_as_snow` | Precip when Tmean < 1°C | Snow accumulates rather than running off immediately |
| `rain_as_liquid` | Precip when Tmean ≥ 1°C | Liquid rain generates immediate runoff |
| `rain_on_snow` | Indicator: warm + moderate rain | Rain-on-snow events cause rapid melt + runoff |
| `pos_degree_days_{w}d` | Cumulative Tmean>0 days | Snowmelt proxy |
| `freeze_degree_days_{w}d` | Cumulative −Tmean<0 days | Cold storage (snow/ice accumulation) |
| `freeze_thaw_7d` | Freeze-thaw cycle count | Soil permeability changes |
| `et_proxy` | Hargreaves ET estimate | Higher ET → less water available for runoff |

### 5. Calendar Features
| Feature | Description | Rationale |
|---------|-------------|-----------|
| `doy_sin`, `doy_cos` | Cyclical day-of-year encoding | Captures seasonal patterns without year-specific bias |
| `month` | Month (1-12) | Coarse seasonal signal |
| `water_year_day` | Days since Oct 1 | Hydrological year (Oct–Sep) is the standard |

### 6. Static Features
| Feature | Description | Rationale |
|---------|-------------|-----------|
| `log_drainage_area` | log(1 + area) | Log-scale area is a better predictor |
| `area_x_rain` | area × precipitation | Larger basins collect more total water |
| `slope_x_rain` | slope × precipitation | Steep + wet = fast runoff |
| `basin_size_bin` | Discretized basin size | Different hydrology for small vs large basins |
| `forest_x_elev` | forest% × elevation/1000 | Forest at elevation → snowpack interception |

## Ablation Results

Recorded ablations and model comparisons are available in [experiments/runs_summary.csv](../experiments/runs_summary.csv), [experiments/target_strategies.csv](../experiments/target_strategies.csv), and [experiments/runs.jsonl](../experiments/runs.jsonl). Headline forward-time validation results are summarized in [model_card.md](../model_card.md).

| Feature Family | Baseline RMSE | With Family RMSE | Δ RMSE | Kept? |
|----------------|---------------|-------------------|--------|-------|
| Raw input baseline and feature-family comparisons | See experiment CSVs | See experiment CSVs | See experiment CSVs | Recorded |

---

*Last updated: 2026-11-05 — verified against `feature_catalog.csv`*
