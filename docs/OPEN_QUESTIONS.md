# FLOODCAST Open Questions

> Items requiring organizer confirmation. Default safe behavior noted.

---

## OQ-001: Daily mean vs. daily peak discharge?
- **Question:** The PDF says "predict the peak daily discharge" but the USGS API parameter 00060 returns daily mean discharge. Which is the actual test target?
- **Default behavior:** Use daily mean (00060_Mean) since that's what the API returns.
- **Impact:** If peak, our model will systematically under-predict high-flow days.

## OQ-002: Are GAGES-II / CAMELS catchment attributes acceptable?
- **Question:** The PDF names three sources (USGS NWIS, Open-Meteo, StreamStats). If StreamStats is unreliable, can we use GAGES-II or CAMELS attribute tables instead?
- **Default behavior:** Try StreamStats first; use GAGES-II as documented fallback.
- **Impact:** Minor — same underlying data, different access method.

## OQ-003: Are extra Open-Meteo variables allowed?
- **Question:** The PDF says "any feature engineering on the provided columns." Does this extend to additional Open-Meteo variables (snowfall, ET, deeper soil moisture) beyond the four listed?
- **Default behavior:** Start with the four listed variables only. Add extras only if confirmed.

## OQ-004: How is per-station top 10% defined for extreme RMSE?
- **Question:** Is the top 10% computed per-station (each station's own top 10% of discharge days) or globally?
- **Default behavior:** Per-station, as stated: "rows where actual discharge is in top 10% per station."

## OQ-005: Do test stations appear in training data?
- **Question:** The PDF emphasizes "geographic generalization" and "stations not seen during training." Does this mean test.csv contains stations NOT in train.csv?
- **Default behavior:** Assume some test stations may be unseen. Include leave-one-station-out validation.

## OQ-006: Does the presentation affect the final rank?
- **Question:** The PDF says "There is no manual component in the auto-score." But presentations happen at Hour 22. Do they factor into the winner selection?
- **Default behavior:** Prepare strong slides regardless.

## OQ-007: Can the Open-Meteo flood (modeled discharge) API be used?
- **Question:** The Open-Meteo flood API provides modeled river discharge. Is this allowed or would it count as a pre-built model?
- **Default behavior:** Do NOT use it. It could be considered a pre-trained model.

---

*Last updated: 2026-11-04 Phase A*
