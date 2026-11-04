# FLOODCAST Data Card

## Overview

| Property | Value |
|----------|-------|
| **Task** | Predict daily river discharge (cfs) from weather + catchment attributes |
| **Target** | `discharge_cfs` (continuous, non-negative) |
| **CUTOFF** | 2022-12-31 (configurable in `configs/base.yaml`) |
| **Training period** | 2010-01-01 to 2021-12-31 |
| **Test period** | 2022-01-01 to 2022-12-31 |
| **Starter files** | ❌ NOT FOUND — built development dataset from scratch |

## Data Sources

### Dataset 1 — USGS NWIS (Target: Discharge)
- **API:** `https://waterservices.usgs.gov/nwis/dv/`
- **Parameter:** 00060 (daily mean discharge, cfs)
- **Format:** JSON
- **Coverage:** 2010-01-01 to CUTOFF (training) / through 2023-12-31 (weather)

### Dataset 2 — Open-Meteo Historical Weather
- **API:** `https://archive-api.open-meteo.com/v1/archive`
- **Variables:** `precipitation_sum`, `temperature_2m_max`, `temperature_2m_min`, `soil_moisture_0_to_7cm`
- **Coverage:** Same date range, matched by station lat/lon

### Dataset 3 — Catchment Attributes
- **Source:** USGS site info (drain area) + hardcoded GAGES-II values
- **Variables:** drainage_area_sqmi, mean_elevation_ft, slope_pct, forest_cover_pct
- **Note:** StreamStats API not used due to complexity; see `docs/DECISIONS.md` DEC-004

## Stations

### 5 Starter Stations (from PDF)
| Station ID | Name | State | Drainage Area (sq mi) |
|------------|------|-------|-----------------------|
| 01646500 | Potomac River near Washington DC | DC | 11,570 |
| 07010000 | Mississippi River at St. Louis | MO | 697,000 |
| 08158000 | Colorado River at Austin TX | TX | 27,600 |
| 02087500 | Neuse River near Clayton NC | NC | 770 |
| 11447650 | Sacramento River at Freeport CA | CA | 23,300 |

### Additional Stations (~26 more for diversity)
- Small basins: Eno River NC (66 sq mi), Myakka River FL (229 sq mi)
- Medium basins: Nishnabotna River IA (2,806 sq mi), Weber River UT (1,650 sq mi)
- Large basins: Ohio River (76,580+ sq mi), Missouri River (322,800 sq mi)
- Snowmelt: St. John River ME, Missouri River MT, Clark Fork MT
- Arid: Colorado River AZ, Salt Fork Brazos TX
- Humid: Edisto River SC, Santa Fe River FL
- Coastal: Myakka River FL

## Schema

### train.csv
| Column | Type | Description |
|--------|------|-------------|
| station_id | str | USGS station ID |
| date | str (YYYY-MM-DD) | Date |
| discharge_cfs | float | Daily mean discharge (target) |
| precipitation_mm | float | Daily total precipitation |
| temp_max_c | float | Daily max temperature (°C) |
| temp_min_c | float | Daily min temperature (°C) |
| soil_moisture | float | Surface soil moisture (0-7cm) |
| drainage_area_sqmi | float | Catchment drainage area |
| mean_elevation_ft | float | Mean basin elevation |
| slope_pct | float | Mean basin slope |
| forest_cover_pct | float | Forest cover percentage |

### test.csv
Same as train.csv, **without** `discharge_cfs`.

### station_metadata.csv
| Column | Type |
|--------|------|
| station_id | str |
| station_name | str |
| latitude | float |
| longitude | float |
| state | str |
| river_name | str |

## Completeness Threshold
Stations with < 80% complete daily discharge records are dropped.

## Known Issues
- Discharge is daily **mean**, not daily **peak** (see `docs/OPEN_QUESTIONS.md` OQ-001)
- Some stations have provisional "P" quality flags
- Sentinel values (-999999) are removed
- Ice-affected records are flagged but retained

---

*Last updated: 2026-11-04 Phase A*
