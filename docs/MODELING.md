# FLOODCAST Modeling Notes

> Data sanity findings, target strategies, model choices.

## Data Sanity Checks (Step 1)

*To be completed after data ingestion.*

- [ ] Duplicates check
- [ ] Missing dates per station
- [ ] Units verification (discharge in cfs, precipitation in mm, temperature in °C)
- [ ] Outlier detection
- [ ] Per-station discharge statistics (mean, median, p99, max)
- [ ] Share of rows in top 10% per station
- [ ] Station overlap between train and test

## Target Strategies

| Strategy | Description | Pros | Cons |
|----------|-------------|------|------|
| **raw** | Predict discharge_cfs directly | Simple, natural scale | Large rivers dominate RMSE |
| **scaled** | Divide by per-station median, predict ratio | Normalizes across stations | Requires station stats at prediction time |
| **log1p** | Predict log(1+discharge), back-transform | Compresses range, stabilizes variance | Under-predicts peaks without bias correction |
| **tweedie** | Tweedie/gamma objective on raw | Handles skewness naturally | May not outperform L2 on RMSE |
| **blend** | Weighted average of raw + log1p models | Combines strengths | More complex, risk of overfitting weights |

## Model Choices

### Primary: LightGBM
- Fast training, handles mixed feature types well
- Built-in feature importance
- Good at capturing nonlinear interactions
- Early stopping prevents overfitting

### Secondary: XGBoost, CatBoost
- Diversity for ensemble
- CatBoost handles categorical features natively

### Optional: GRU/LSTM
- Can capture temporal dependencies in 30-90 day windows
- Only if time permits and tree models are tuned

---

*Last updated: 2026-11-04 Phase A*
