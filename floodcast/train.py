"""
FLOODCAST Training Module
Trains models (LightGBM, XGBoost, CatBoost) with various target strategies.
"""

import json
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import yaml

try:
    import lightgbm as lgb
except ImportError:
    lgb = None

try:
    import xgboost as xgb
except ImportError:
    xgb = None

try:
    import catboost as cb
except ImportError:
    cb = None

from .features import compute_all_features, get_feature_columns
from .scoring import compute_all_metrics, compute_composite, per_station_metrics
from .validate import forward_time_split, expanding_window_splits
from .check_submission import check_submission


def load_config(config_path: str = "configs/base.yaml") -> dict:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def apply_target_strategy(
    y: pd.Series,
    station_ids: pd.Series,
    strategy: str,
    train_stats: Optional[Dict] = None,
) -> Tuple[np.ndarray, Dict]:
    """
    Transform the target variable.
    Returns (transformed_y, stats_dict_for_inverse).
    """
    if strategy == "raw":
        return y.values.astype(float), {}

    elif strategy == "log1p":
        return np.log1p(y.values.astype(float)), {"strategy": "log1p"}

    elif strategy == "scaled":
        is_train = train_stats is None
        if is_train:
            train_stats = {}
            for sid in station_ids.unique():
                mask = station_ids == sid
                mean_q = float(y[mask].mean())
                if mean_q <= 0 or np.isnan(mean_q):
                    mean_q = 1.0
                q999 = float(np.percentile(y[mask] / mean_q, 99.9)) if mask.sum() > 0 else 20.0
                train_stats[sid] = {"scale": float(mean_q), "clip_upper": max(10.0, q999)}

        y_scaled = y.copy().astype(float)
        for sid, stats in train_stats.items():
            mask = station_ids == sid
            vals = y_scaled[mask] / stats["scale"]
            if is_train:
                vals = np.clip(vals, 0.0, stats.get("clip_upper", 20.0))
            y_scaled[mask] = vals

        return y_scaled.values, {"strategy": "scaled", "stats": train_stats}

    else:
        return y.values.astype(float), {}


def inverse_target_strategy(
    y_pred: np.ndarray,
    station_ids: np.ndarray,
    strategy_info: Dict,
) -> np.ndarray:
    """Inverse-transform predictions back to raw discharge."""
    strategy = strategy_info.get("strategy", "raw")

    if strategy == "raw" or not strategy:
        return y_pred

    elif strategy == "log1p":
        # Bias-corrected back-transform (smearing)
        return np.expm1(y_pred)

    elif strategy == "scaled":
        y_raw = y_pred.copy()
        stats = strategy_info.get("stats", {})
        for sid, st in stats.items():
            mask = station_ids == sid
            y_raw[mask] = y_raw[mask] * st["scale"]
        return y_raw

    return y_pred


def train_lightgbm(
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    X_val: pd.DataFrame,
    y_val: np.ndarray,
    config: dict,
    feature_names: List[str],
    sample_weights: Optional[np.ndarray] = None,
) -> Tuple[Any, Dict]:
    """Train a LightGBM model."""
    if lgb is None:
        raise ImportError("LightGBM not installed. Run: pip install lightgbm")

    model_config = config.get("model", {})

    params = {
        "objective": model_config.get("objective", "regression"),
        "metric": model_config.get("metric", "rmse"),
        "learning_rate": model_config.get("learning_rate", 0.03),
        "num_leaves": model_config.get("num_leaves", 63),
        "min_child_samples": model_config.get("min_child_samples", 40),
        "feature_fraction": model_config.get("feature_fraction", 0.7),
        "bagging_fraction": model_config.get("bagging_fraction", 0.8),
        "bagging_freq": model_config.get("bagging_freq", 1),
        "lambda_l2": model_config.get("lambda_l2", 5.0),
        "seed": config.get("seed", 42),
        "n_jobs": model_config.get("n_jobs", -1),
        "verbose": -1,
    }

    train_set = lgb.Dataset(
        X_train[feature_names], y_train,
        weight=sample_weights,
        free_raw_data=False,
    )
    val_set = lgb.Dataset(
        X_val[feature_names], y_val,
        reference=train_set,
        free_raw_data=False,
    )

    callbacks = [
        lgb.early_stopping(model_config.get("early_stopping_rounds", 200)),
        lgb.log_evaluation(period=100),
    ]

    model = lgb.train(
        params,
        train_set,
        num_boost_round=model_config.get("n_estimators", 5000),
        valid_sets=[val_set],
        valid_names=["val"],
        callbacks=callbacks,
    )

    train_info = {
        "model_type": "lightgbm",
        "params": params,
        "best_iteration": model.best_iteration,
        "best_score": model.best_score,
        "feature_importance": dict(zip(
            feature_names,
            model.feature_importance("gain").tolist(),
        )),
    }

    return model, train_info


def predict_with_model(
    model: Any,
    X: pd.DataFrame,
    feature_names: List[str],
    model_type: str = "lightgbm",
) -> np.ndarray:
    """Generate predictions from a trained model."""
    if model_type == "lightgbm":
        return model.predict(X[feature_names])
    elif model_type == "xgboost":
        return model.predict(xgb.DMatrix(X[feature_names]))
    elif model_type == "catboost":
        return model.predict(X[feature_names])
    else:
        raise ValueError(f"Unknown model type: {model_type}")


def run_training_pipeline(
    config_path: str = "configs/base.yaml",
    run_id: Optional[str] = None,
    description: str = "",
) -> Dict:
    """
    Full training pipeline:
    1. Load data
    2. Compute features
    3. Split (forward-time)
    4. Train model
    5. Evaluate
    6. Generate predictions on test
    7. Check submission
    8. Save artifacts
    """
    config = load_config(config_path)
    if run_id is None:
        run_id = f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

    print(f"\n{'='*60}")
    print(f"  FLOODCAST Training Pipeline")
    print(f"  Run ID: {run_id}")
    print(f"  Config: {config_path}")
    print(f"{'='*60}")

    # Load data
    if hasattr(os.sys.stdout, "reconfigure"):
        try:
            os.sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    processed_dir = Path(config["data"]["processed_dir"])
    train_df = pd.read_csv(processed_dir / "train.csv", dtype={"station_id": str})
    test_df = pd.read_csv(processed_dir / "test.csv", dtype={"station_id": str})

    # Check for test labels (dev mode)
    test_labels_path = processed_dir / "test_with_labels.csv"
    has_test_labels = test_labels_path.exists()
    if has_test_labels:
        test_labels_df = pd.read_csv(test_labels_path, dtype={"station_id": str})

    print(f"  Train: {len(train_df)} rows, {train_df['station_id'].nunique()} stations")
    print(f"  Test:  {len(test_df)} rows, {test_df['station_id'].nunique()} stations")

    # Validation split first (to ensure station_stats never leak validation discharge)
    print("\n  Splitting data (forward-in-time) and computing features...")
    raw_train_split, raw_val_split = forward_time_split(
        train_df,
        val_years=config["validation"]["val_years"],
    )
    raw_train_split["date"] = raw_train_split["date"].dt.strftime("%Y-%m-%d")
    raw_val_split["date"] = raw_val_split["date"].dt.strftime("%Y-%m-%d")

    val_combined = pd.concat([
        raw_train_split.assign(_split="train"),
        raw_val_split.drop(columns=["discharge_cfs"]).assign(discharge_cfs=np.nan, _split="val"),
    ], ignore_index=True)
    val_combined = compute_all_features(val_combined, config, train_discharge=raw_train_split)
    train_split = val_combined[val_combined["_split"] == "train"].drop(columns=["_split"]).reset_index(drop=True)
    val_split = val_combined[val_combined["_split"] == "val"].drop(columns=["_split", "discharge_cfs"]).merge(
        raw_val_split[["station_id", "date", "discharge_cfs"]], on=["station_id", "date"], how="left"
    )

    # Also compute full train + test features using full train_df for final test prediction
    full_combined = pd.concat([
        train_df.assign(_split="train"),
        test_df.assign(discharge_cfs=np.nan, _split="test"),
    ], ignore_index=True)
    full_combined = compute_all_features(full_combined, config, train_discharge=train_df)
    train_featured = full_combined[full_combined["_split"] == "train"].drop(columns=["_split"]).reset_index(drop=True)
    test_featured = full_combined[full_combined["_split"] == "test"].drop(columns=["_split"]).reset_index(drop=True)

    feature_cols = get_feature_columns(train_split)
    print(f"  Features: {len(feature_cols)}")
    print(f"  Train split: {len(train_split)}, Val split: {len(val_split)}")

    # Target strategy
    strategy = config["model"].get("target_strategy", "raw")
    print(f"  Target strategy: {strategy}")

    y_train, strategy_info = apply_target_strategy(
        train_split["discharge_cfs"],
        train_split["station_id"],
        strategy,
    )
    y_val_raw = val_split["discharge_cfs"].values.astype(float)

    # Apply same strategy to val for evaluation
    if strategy != "raw":
        y_val, _ = apply_target_strategy(
            val_split["discharge_cfs"],
            val_split["station_id"],
            strategy,
            strategy_info.get("stats"),
        )
    else:
        y_val = y_val_raw

    # Train
    print("\n  Training model...")
    start_time = time.time()

    model, train_info = train_lightgbm(
        train_split, y_train,
        val_split, y_val,
        config, feature_cols,
    )

    train_time = time.time() - start_time
    print(f"  Training time: {train_time:.1f}s")
    print(f"  Best iteration: {train_info['best_iteration']}")

    # Validate
    print("\n  Evaluating on validation set...")
    y_val_pred = predict_with_model(model, val_split, feature_cols)

    # Inverse transform if needed
    if strategy != "raw":
        y_val_pred = inverse_target_strategy(
            y_val_pred, val_split["station_id"].values, strategy_info
        )

    # Clip predictions at 0
    y_val_pred = np.clip(y_val_pred, 0, None)

    val_metrics = compute_all_metrics(y_val_raw, y_val_pred, val_split["station_id"].values)
    val_per_station = per_station_metrics(y_val_raw, y_val_pred, val_split["station_id"].values)

    print(f"\n  Validation Results:")
    print(f"    RMSE:         {val_metrics['rmse']:.2f}")
    print(f"    Extreme RMSE: {val_metrics['extreme_rmse']:.2f}")
    print(f"    MAE:          {val_metrics['mae']:.2f}")
    print(f"    R²:           {val_metrics['r2']:.4f}")

    # Predict on test set
    print("\n  Generating test predictions...")
    y_test_pred = predict_with_model(model, test_featured, feature_cols)

    if strategy != "raw":
        y_test_pred = inverse_target_strategy(
            y_test_pred, test_featured["station_id"].values, strategy_info
        )

    y_test_pred = np.clip(y_test_pred, 0, None)

    # Create predictions.csv aligned to test_df order
    pred_raw_df = pd.DataFrame({
        "station_id": test_featured["station_id"].values,
        "date": test_featured["date"].values,
        "discharge_cfs": np.round(y_test_pred, 2),
    })
    predictions = test_df[["station_id", "date"]].merge(pred_raw_df, on=["station_id", "date"], how="left")
    predictions["discharge_cfs"] = predictions["discharge_cfs"].fillna(0.0).clip(lower=0.0)
    predictions.to_csv("predictions.csv", index=False)
    predictions.to_csv(processed_dir / "predictions.csv", index=False)
    print(f"  [OK] predictions.csv written ({len(predictions)} rows)")

    # Run submission checker
    print("\n  Running submission checker...")
    test_path = str(processed_dir / "test.csv")
    passed, reasons = check_submission("predictions.csv", test_path)

    # Evaluate on test labels if available (dev mode)
    test_metrics = None
    if has_test_labels:
        test_labels = test_labels_df.set_index(["station_id", "date"])["discharge_cfs"]
        pred_indexed = predictions.set_index(["station_id", "date"])["discharge_cfs"]
        common = test_labels.index.intersection(pred_indexed.index)
        if len(common) > 0:
            y_true_test = test_labels.loc[common].values
            y_pred_test = pred_indexed.loc[common].values
            sids = [idx[0] for idx in common]
            test_metrics = compute_all_metrics(y_true_test, y_pred_test, np.array(sids))
            print(f"\n  Test Results (dev mode):")
            print(f"    RMSE:         {test_metrics['rmse']:.2f}")
            print(f"    Extreme RMSE: {test_metrics['extreme_rmse']:.2f}")
            print(f"    MAE:          {test_metrics['mae']:.2f}")
            print(f"    R²:           {test_metrics['r2']:.4f}")

    # Save artifacts
    artifacts_dir = Path(config["output"]["artifacts_dir"]) / run_id
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    # Save model
    if lgb is not None:
        model.save_model(str(artifacts_dir / "model.lgb"))

    # Save config
    with open(artifacts_dir / "config.yaml", "w") as f:
        yaml.dump(config, f)

    # Save run info
    run_record = {
        "run_id": run_id,
        "description": description,
        "timestamp": datetime.now().isoformat(),
        "config_path": config_path,
        "model_type": train_info["model_type"],
        "target_strategy": strategy,
        "n_features": len(feature_cols),
        "feature_names": feature_cols,
        "train_rows": len(train_split),
        "val_rows": len(val_split),
        "test_rows": len(test_featured),
        "train_time_seconds": train_time,
        "best_iteration": train_info["best_iteration"],
        "val_metrics": val_metrics,
        "test_metrics": test_metrics,
        "submission_check": {"passed": passed, "reasons": reasons},
        "per_station_val": val_per_station.to_dict("records"),
    }

    with open(artifacts_dir / "run_info.json", "w") as f:
        json.dump(run_record, f, indent=2, default=str)

    # Append to runs log
    runs_log = Path(config["output"]["runs_log"])
    runs_log.parent.mkdir(parents=True, exist_ok=True)
    with open(runs_log, "a") as f:
        f.write(json.dumps(run_record, default=str) + "\n")

    # Feature importance
    importance_df = pd.DataFrame({
        "feature": feature_cols,
        "importance": [train_info["feature_importance"].get(f, 0) for f in feature_cols],
    }).sort_values("importance", ascending=False)
    importance_df.to_csv(artifacts_dir / "feature_importance.csv", index=False)

    print(f"\n  Top 10 features:")
    for _, row in importance_df.head(10).iterrows():
        print(f"    {row['feature']}: {row['importance']:.0f}")

    print(f"\n  Artifacts saved to {artifacts_dir}")
    print(f"{'='*60}")

    return run_record


if __name__ == "__main__":
    run_training_pipeline()
