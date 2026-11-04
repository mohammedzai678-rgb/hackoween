"""
FLOODCAST Scoring Module
Implements the four evaluation metrics and composite score per the PDF spec.
"""

import numpy as np
import pandas as pd
from typing import Dict, Optional, Tuple


def compute_rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Root Mean Squared Error across all rows."""
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def compute_extreme_rmse(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    station_ids: np.ndarray,
    percentile: float = 90.0,
) -> float:
    """
    RMSE on extreme events: rows where actual discharge is in the
    top 10% PER STATION.
    """
    df = pd.DataFrame({
        "station_id": station_ids,
        "y_true": y_true,
        "y_pred": y_pred,
    })
    # Compute per-station threshold
    thresholds = df.groupby("station_id")["y_true"].quantile(percentile / 100.0)
    df = df.merge(
        thresholds.rename("threshold"),
        left_on="station_id",
        right_index=True,
    )
    extreme_mask = df["y_true"] >= df["threshold"]
    if extreme_mask.sum() == 0:
        return 0.0
    extreme_df = df[extreme_mask]
    return float(np.sqrt(np.mean((extreme_df["y_true"] - extreme_df["y_pred"]) ** 2)))


def compute_mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Mean Absolute Error."""
    return float(np.mean(np.abs(y_true - y_pred)))


def compute_r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """R-squared (coefficient of determination)."""
    ss_res = np.sum((y_true - y_pred) ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    if ss_tot == 0:
        return 0.0
    return float(1.0 - ss_res / ss_tot)


def compute_all_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    station_ids: np.ndarray,
) -> Dict[str, float]:
    """Compute all four metrics."""
    return {
        "rmse": compute_rmse(y_true, y_pred),
        "extreme_rmse": compute_extreme_rmse(y_true, y_pred, station_ids),
        "mae": compute_mae(y_true, y_pred),
        "r2": compute_r2(y_true, y_pred),
    }


def compute_composite(
    metrics: Dict[str, float],
    best_metrics: Optional[Dict[str, float]] = None,
    worst_metrics: Optional[Dict[str, float]] = None,
) -> float:
    """
    Compute the composite score (0-100 scale).
    If best/worst are not provided, returns a raw weighted sum (not normalized).
    """
    weights = {
        "rmse": 0.40,
        "extreme_rmse": 0.30,
        "mae": 0.20,
        "r2": 0.10,
    }

    if best_metrics is None or worst_metrics is None:
        # Without normalization context, return raw metrics info
        return -1.0  # Signal that composite cannot be computed

    composite = 0.0
    for metric, weight in weights.items():
        val = metrics[metric]
        best = best_metrics[metric]
        worst = worst_metrics[metric]

        if metric == "r2":
            # Higher is better
            if best == worst:
                norm = 50.0
            else:
                norm = 100.0 * (val - worst) / (best - worst)
        else:
            # Lower is better
            if worst == best:
                norm = 50.0
            else:
                norm = 100.0 * (worst - val) / (worst - best)

        norm = max(0.0, min(100.0, norm))
        composite += weight * norm

    return composite


def per_station_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    station_ids: np.ndarray,
) -> pd.DataFrame:
    """Compute metrics per station."""
    df = pd.DataFrame({
        "station_id": station_ids,
        "y_true": y_true,
        "y_pred": y_pred,
    })

    results = []
    for sid, group in df.groupby("station_id"):
        yt = group["y_true"].values
        yp = group["y_pred"].values
        n = len(yt)
        rmse = compute_rmse(yt, yp)
        mae = compute_mae(yt, yp)
        r2 = compute_r2(yt, yp)

        # Per-station extreme RMSE
        threshold = np.percentile(yt, 90)
        extreme_mask = yt >= threshold
        if extreme_mask.sum() > 0:
            ext_rmse = compute_rmse(yt[extreme_mask], yp[extreme_mask])
        else:
            ext_rmse = 0.0

        results.append({
            "station_id": sid,
            "n_rows": n,
            "mean_discharge": float(np.mean(yt)),
            "rmse": rmse,
            "extreme_rmse": ext_rmse,
            "mae": mae,
            "r2": r2,
        })

    return pd.DataFrame(results)
