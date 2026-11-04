# FLOODCAST Decisions Log

> Every assumption, trade-off, and conflict resolution is recorded here.

---

## DEC-001: Starter files not available
- **Date:** 2026-11-04
- **Context:** The PDF says "We will provide pre-processed versions of the core files at the event start" and "a pre-joined starter CSV at the event with 5 stations already merged."
- **Finding:** `data/raw/starter/` is empty. No train.csv, test.csv, sample_submission.csv, or station_metadata.csv found.
- **Decision:** Build a development dataset from scratch using the three sources named in the PDF (USGS NWIS, Open-Meteo, USGS StreamStats). Label it clearly as a dev dataset. Will swap in organizer files if they appear later.
- **Fallback:** Use CUTOFF = 2022-12-31 as default. Create pseudo-test from held-out final year (2023).
- **Risk:** Schema or station list may differ from organizer files.

## DEC-002: CUTOFF date
- **Date:** 2026-11-04
- **Context:** No train.csv available to extract max(date).
- **Decision:** Use configurable default CUTOFF = 2022-12-31 in `configs/base.yaml`. Auto-override with max(date) from train.csv if it becomes available.

## DEC-003: Daily mean vs. daily peak discharge
- **Date:** 2026-11-04
- **Context:** The PDF says "predict the peak daily discharge" but USGS parameter 00060 returns "00060_Mean" (daily mean). The PDF's API example uses parameterCd=00060 which is the mean. This is ambiguous.
- **Decision:** Use daily mean discharge (00060_Mean) as the target, since that's what the API returns. Record in OPEN_QUESTIONS.md for organizer confirmation.
- **Risk:** If the test labels are peak values, our model will systematically under-predict.

## DEC-004: StreamStats fallback
- **Date:** 2026-11-04
- **Context:** StreamStats API can be slow/unreliable. GAGES-II or CAMELS are alternatives but not named in the PDF.
- **Decision:** Try StreamStats first. If unreliable, use GAGES-II as fallback but document it and add to OPEN_QUESTIONS.md.

## DEC-005: Scoring normalization assumption
- **Date:** 2026-11-04
- **Context:** The PDF gives the normalization formula only for RMSE: `RMSE_norm = 100 * (worst_RMSE - your_RMSE) / (worst_RMSE - best_RMSE)`. No formula given for MAE, extreme RMSE, or R2.
- **Decision:** Assume the same min-max normalization for all lower-is-better metrics (RMSE, extreme RMSE, MAE). For R2 (higher-is-better): `R2_norm = 100 * (your_R2 - worst_R2) / (best_R2 - worst_R2)`. Document this assumption.

## DEC-006: Open-Meteo Flood API
- **Date:** 2026-11-04
- **Context:** Open-Meteo has a flood/modeled-discharge API. Using it could count as a pre-built model.
- **Decision:** Do NOT use the Open-Meteo flood API. Only use the historical weather API for raw meteorological inputs.

## DEC-007: PDF rendering artifacts in URLs
- **Date:** 2026-11-04
- **Context:** URLs in the PDF contain `sites;=` and `startDT;=` which are rendering artifacts.
- **Decision:** Use correct parameter names: `sites=`, `startDT=`, `endDT=`, `parameterCd=`.

---

*Last updated: 2026-11-04 Phase A*
