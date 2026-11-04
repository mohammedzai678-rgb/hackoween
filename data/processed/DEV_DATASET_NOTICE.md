# Real USGS + Open-Meteo + Catchment Dataset Notice

This dataset was extracted directly from the live APIs specified in the FLOODCAST Problem Statement:
- **Dataset 1 (Target):** USGS NWIS Daily Values (`parameterCd=00060`, `https://waterservices.usgs.gov/nwis/dv/`)
- **Dataset 2 (Weather):** Open-Meteo Historical Weather API (`https://archive-api.open-meteo.com/v1/archive`)
- **Dataset 3 (Catchment):** USGS Expanded Site Service + GAGES-II attributes

- **Stations:** 30
- **Train rows:** 128,811 (`2010-01-01` to `2021-12-31`)
- **Test rows:** 10,585 (`2022-01-01` to `2022-12-31`)
- **CUTOFF:** `2021-12-31` (train target cap) / `2022-12-31` (evaluation cap)
