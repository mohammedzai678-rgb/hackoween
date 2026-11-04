# FLOODCAST Evaluation Criteria

> How the four metrics and the composite score are computed.

---

## Metrics

### 1. RMSE (Root Mean Squared Error) — Weight: 40%

$$\text{RMSE} = \sqrt{\frac{1}{n}\sum_{i=1}^{n}(\hat{y}_i - y_i)^2}$$

Computed across ALL rows in test.csv. Lower is better. Penalizes large errors heavily.

### 2. Extreme RMSE — Weight: 30%

Same formula as RMSE, but computed only on rows where the actual discharge is in the **top 10% per station**.

> **Assumption (OQ-004):** "Per station" means each station's own top 10% discharge days, not a global threshold.

### 3. MAE (Mean Absolute Error) — Weight: 20%

$$\text{MAE} = \frac{1}{n}\sum_{i=1}^{n}|\hat{y}_i - y_i|$$

Less sensitive to outliers. Measures general reliability.

### 4. R-squared (R²) — Weight: 10%

$$R^2 = 1 - \frac{\sum_{i=1}^{n}(y_i - \hat{y}_i)^2}{\sum_{i=1}^{n}(y_i - \bar{y})^2}$$

Higher is better. Measures proportion of variance explained.

---

## Composite Score

Each metric is normalized to 0–100 using best/worst scores across all submissions:

**For lower-is-better metrics (RMSE, extreme RMSE, MAE):**
$$\text{metric\_norm} = 100 \times \frac{\text{worst} - \text{yours}}{\text{worst} - \text{best}}$$

**For higher-is-better metrics (R²):**
$$\text{R2\_norm} = 100 \times \frac{\text{yours} - \text{worst}}{\text{best} - \text{worst}}$$

> **Assumption (DEC-005):** The PDF only gives the RMSE normalization formula. We assume the same min-max scheme for all metrics with direction adjusted.

**Final composite:**
$$\text{Composite} = 0.40 \times \text{RMSE\_norm} + 0.30 \times \text{ExtrRMSE\_norm} + 0.20 \times \text{MAE\_norm} + 0.10 \times \text{R2\_norm}$$

---

## Local Approximation

Since we don't know other teams' scores during development, our local scorer uses:
- For single-experiment evaluation: raw metric values only
- For multi-experiment comparison: normalize within our own experiments

---

*Last updated: 2026-11-04 Phase A*
