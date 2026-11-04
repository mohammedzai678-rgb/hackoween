"""
FLOODCAST Validation Module
Forward-in-time split, expanding window, and leave-one-station-out validation.
"""

import numpy as np
import pandas as pd
from typing import Dict, Generator, List, Optional, Tuple

from .scoring import compute_all_metrics, compute_composite, per_station_metrics


def forward_time_split(
    df: pd.DataFrame,
    val_years: int = 1,
    date_col: str = "date",
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Split data by time: train on early years, validate on the most recent val_years.
    """
    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col])
    max_date = df[date_col].max()
    split_date = max_date - pd.DateOffset(years=val_years)

    train = df[df[date_col] <= split_date].copy()
    val = df[df[date_col] > split_date].copy()

    return train, val


def expanding_window_splits(
    df: pd.DataFrame,
    n_folds: int = 3,
    date_col: str = "date",
    min_train_years: int = 3,
) -> Generator[Tuple[pd.DataFrame, pd.DataFrame, int], None, None]:
    """
    Expanding-window backtest: train on growing early data, validate on the next year.
    Yields (train_df, val_df, fold_index).
    """
    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col])

    min_date = df[date_col].min()
    max_date = df[date_col].max()
    total_years = (max_date - min_date).days / 365.25

    if total_years < min_train_years + n_folds:
        # Not enough data; fall back to a single fold
        n_folds = max(1, int(total_years - min_train_years))

    for fold in range(n_folds):
        val_end = max_date - pd.DateOffset(years=fold)
        val_start = val_end - pd.DateOffset(years=1)
        train_end = val_start

        if train_end < min_date + pd.DateOffset(years=min_train_years):
            break

        train = df[df[date_col] <= train_end].copy()
        val = df[(df[date_col] > val_start) & (df[date_col] <= val_end)].copy()

        if len(train) > 0 and len(val) > 0:
            yield train, val, fold


def leave_one_station_out(
    df: pd.DataFrame,
    station_col: str = "station_id",
) -> Generator[Tuple[pd.DataFrame, pd.DataFrame, str], None, None]:
    """
    Leave-one-station-out cross-validation for geographic generalization.
    Yields (train_df, val_df, held_out_station_id).
    """
    stations = df[station_col].unique()
    for sid in stations:
        train = df[df[station_col] != sid].copy()
        val = df[df[station_col] == sid].copy()
        yield train, val, sid


def evaluate_predictions(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    station_ids: np.ndarray,
    run_id: str = "",
    description: str = "",
) -> Dict:
    """
    Full evaluation: all four metrics, per-station breakdown.
    Returns a dict suitable for logging to runs.jsonl.
    """
    metrics = compute_all_metrics(y_true, y_pred, station_ids)
    per_station = per_station_metrics(y_true, y_pred, station_ids)

    result = {
        "run_id": run_id,
        "description": description,
        "n_samples": len(y_true),
        "n_stations": len(np.unique(station_ids)),
        "metrics": metrics,
        "per_station": per_station.to_dict("records"),
    }

    return result
