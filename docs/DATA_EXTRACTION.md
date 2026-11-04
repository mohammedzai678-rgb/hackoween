# FLOODCAST Data Provenance & Extraction Log

> Cryptographic record of every dataset extraction and processing step, satisfying Section 2.6 (`IQ-6`) and strict `CUTOFF = 2022-12-31` target isolation (`IQ-2`).

---

## 1. Zero-Leakage Extraction Architecture

```mermaid
flowchart LR
    subgraph Sources["External / Generator Sources"]
        U["USGS NWIS (00060)\nDaily Mean Discharge (cfs)"]
        O["Open-Meteo Archive\nPrecip, Tmax, Tmin, Soil (0-7cm)"]
        G["USGS StreamStats / GAGES-II\nDrainage Area, Elev, Slope, Forest"]
    end

    subgraph Gate["Temporal & Quality Gate"]
        C["Strict Target CUTOFF\n2022-12-31"]
        Q["Completeness Filter\n>= 80% Valid Days"]
    end

    subgraph Outputs["Verified Artifacts (SHA-256 Logged)"]
        TR["data/processed/train.csv\n140,256 rows (2010–2021)"]
        TE["data/processed/test.csv\n11,680 rows (2022, No Target)"]
        SM["data/processed/station_metadata.csv\n32 USGS Stations"]
        MF["data/processed/data_manifest.csv\nCryptographic Provenance"]
    end

    U --> C --> Q --> TR
    O --> Q --> TR
    O --> TE
    G --> TR
    G --> TE
    G --> SM
    TR & TE & SM --> MF
```

---

## 2. Cryptographic Data Manifest (`data/processed/data_manifest.csv`)

Every dataset file generated and consumed by the pipeline is fingerprinted with a SHA-256 hash and row count verification:

| Source Tier | File Name | Relative Path | Exact Rows | SHA-256 Checksum | Timestamp (UTC) |
|-------------|-----------|---------------|-----------:|------------------|-----------------|
| `starter` | `train.csv` | `data/raw/starter/train.csv` | `140,256` | `fd39aa229c7290c1b22574cd09921d1cd226e69ac01ec38bc2ea8017652e835e` | `2026-11-04T11:10:34Z` |
| `starter` | `test.csv` | `data/raw/starter/test.csv` | `11,680` | `8d54aa2f66f48a59d51eb92df4bf8773518b27e336d8ea81fb618fb1ac52dcbf` | `2026-11-04T11:10:34Z` |
| `starter` | `sample_submission.csv` | `data/raw/starter/sample_submission.csv` | `11,680` | `8f8cfa099916fe74ddd275e1b4e4fc339805060a1eda78889b39315b1948a7e0` | `2026-11-04T11:10:34Z` |
| `starter` | `station_metadata.csv` | `data/raw/starter/station_metadata.csv` | `32` | `ce0a96d5ac5e98153250f931aa726ceaea1dd8d9cf2ff02d1b4024f0fc801d77` | `2026-11-04T11:10:34Z` |
| `processed` | `train.csv` | `data/processed/train.csv` | `140,256` | `85fceffa1cff88365f04f60061a7f0080ac175f7dbcfce5d89f69fa59ed85fd6` | `2026-11-04T11:10:34Z` |
| `processed` | `test.csv` | `data/processed/test.csv` | `11,680` | `5f737ad543783fbed6174d953fa49e53aa74746e1451e13e7bbb44843d2080c9` | `2026-11-04T11:10:34Z` |
| `processed` | `sample_submission.csv` | `data/processed/sample_submission.csv` | `11,680` | `abeca250e516c4e758faa46b11e8ce0d0bb6612748fab0ebeca36455acec0fb0` | `2026-11-04T11:10:34Z` |
| `processed` | `station_metadata.csv` | `data/processed/station_metadata.csv` | `32` | `aae32e42cad1fc73d3c0160704f52963736d077607953e79f6b670f8629ad680` | `2026-11-04T11:10:34Z` |

---

## 3. API Endpoint Specifications & Caching Protocol

When running with external network access enabled, `floodcast/ingest.py` queries the three official APIs and caches raw JSON responses immutably under `data/cache/`:

1. **USGS National Water Information System (NWIS) Daily Values Service:**
   - **Endpoint:** `https://waterservices.usgs.gov/nwis/dv/?format=json&sites={site_id}&startDT=2010-01-01&endDT=2022-12-31&parameterCd=00060`
   - **Cache Filename:** `data/cache/usgs_dv_{site_id}_2010-01-01_2022-12-31.json`
   - **Sanitization:** Removes USGS sentinel values (`-999999`), strips provisional flags, and enforces `date <= cutoff_date`.
2. **Open-Meteo Historical Weather API:**
   - **Endpoint:** `https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date=2010-01-01&end_date=2022-12-31&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,soil_moisture_0_to_7cm&timezone=UTC`
   - **Cache Filename:** `data/cache/openmeteo_{lat}_{lon}_2010-01-01_2022-12-31.json`
3. **USGS StreamStats / GAGES-II Catchment Attributes:**
   - **Attributes Extracted:** `DRNAREA` (`drainage_area_sqmi`), `ELEV` (`mean_elevation_ft`), `SLOPE_PCT` (`slope_pct`), and `FOREST` (`forest_cover_pct`).

---

## 4. Reproducible Extraction Commands

```bash
# 1. Run full ingestion pipeline (uses starter files or fetches/caches from APIs)
python -m floodcast ingest --config configs/base.yaml

# 2. Deterministically regenerate synthetic development CSVs (offline sandbox mode)
python scripts/generate_data.py

# 3. Verify zero target leakage and manifest integrity
python -m pytest tests/test_no_leakage.py -v
```

---

*Last updated: 2026-11-04 — FLOODCAST Documentation & Slides Lead*
