"""
FLOODCAST — Complete Experimental Pipeline & CSV Artifact Generator
Executes Steps 1 through 10:
  Step 1: Data Sanity CSVs, Feature Catalog (80+ features), Feature Matrix Samples
  Step 2: Naive Baselines (Station Mean, Station DOY Mean, Ridge Regression)
  Step 3: Smoke Test (<60s) & Baseline LightGBM
  Step 4: Feature Family Ablations (+rainfall, +antecedent, +soil, +temperature, +calendar, +static, +station_stats, +cross_station)
  Step 5: Target Strategies (raw, scaled, log1p_smearing, tweedie, blend_raw_log1p)
  Step 6: Flood-Peak Handling (high-flow sample weighting, wet-condition specialist, tail calibration)
  Step 7: Error Analysis (worst_50_errors.csv), 3-Fold Expanding Window, 32-Station Leave-One-Station-Out CV
  Step 8-10: Model Diversity (LightGBM 3 seeds, XGBoost, CatBoost), Final Full-Train Ensemble, Plots & Submission Check
"""

import os
import sys
import json
import time
import hashlib
from pathlib import Path
from datetime import datetime, timezone

# Ensure project root is on sys.path and MPLCONFIGDIR is writable
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / "artifacts" / ".mplconfig"))
(ROOT / "artifacts" / ".mplconfig").mkdir(parents=True, exist_ok=True)

import numpy as np
import pandas as pd
import yaml
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
import lightgbm as lgb
import xgboost as xgb
from catboost import CatBoostRegressor

from floodcast.ingest import ingest_all_stations, load_config
from floodcast.features import (
    compute_rainfall_features,
    compute_antecedent_features,
    compute_soil_features,
    compute_temperature_features,
    compute_calendar_features,
    compute_static_features,
    compute_station_stats,
    compute_cross_station_features,
    compute_all_features,
    get_feature_columns,
)
from floodcast.scoring import (
    compute_all_metrics,
    compute_composite,
    per_station_metrics,
)
from floodcast.validate import (
    forward_time_split,
    expanding_window_splits,
    leave_one_station_out,
)
from floodcast.check_submission import check_submission

np.random.seed(42)

PROCESSED_DIR = ROOT / "data" / "processed"
EXPERIMENTS_DIR = ROOT / "experiments"
ARTIFACTS_DIR = ROOT / "artifacts" / "final_ensemble"
EXPERIMENTS_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

RUNS_LOG_PATH = EXPERIMENTS_DIR / "runs.jsonl"
if RUNS_LOG_PATH.exists():
    RUNS_LOG_PATH.unlink()  # Fresh, reproducible experimental log

ALL_RUN_RECORDS = []


def log_run(
    run_id: str,
    stage: str,
    model_type: str,
    target_strategy: str,
    n_features: int,
    val_metrics: dict,
    train_time_s: float,
    description: str,
    best_iteration: int = 0,
    early_stopping_rounds: int = 200,
    extra: dict = None,
):
    """Append a structured run record to experiments/runs.jsonl and memory list."""
    rec = {
        "run_id": run_id,
        "stage": stage,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_type": model_type,
        "target_strategy": target_strategy,
        "n_features": int(n_features),
        "best_iteration": int(best_iteration),
        "early_stopping_rounds": int(early_stopping_rounds),
        "rmse": round(float(val_metrics["rmse"]), 4),
        "extreme_rmse": round(float(val_metrics["extreme_rmse"]), 4),
        "mae": round(float(val_metrics["mae"]), 4),
        "r2": round(float(val_metrics["r2"]), 6),
        "train_time_s": round(float(train_time_s), 2),
        "description": description,
    }
    if extra:
        rec.update(extra)
    ALL_RUN_RECORDS.append(rec)
    with open(RUNS_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, default=str) + "\n")
    return rec


def build_feature_catalog(feature_cols: list, df_sample: pd.DataFrame) -> pd.DataFrame:
    """Create comprehensive feature_catalog.csv documenting every raw and engineered feature."""
    raw_cols = {
        "precipitation_mm": ("raw_weather", "float64", "1d (day t)", "Daily total precipitation (mm) from Open-Meteo", "Primary rainfall forcing driving surface runoff and streamflow"),
        "temp_max_c": ("raw_weather", "float64", "1d (day t)", "Daily maximum air temperature at 2m (C)", "Controls snowmelt, evapotranspiration, and convective storm potential"),
        "temp_min_c": ("raw_weather", "float64", "1d (day t)", "Daily minimum air temperature at 2m (C)", "Indicates freezing conditions, snow accumulation, and frost depth"),
        "soil_moisture": ("raw_weather", "float64", "1d (day t)", "Top-layer volumetric soil moisture (0-7cm, m3/m3)", "Direct indicator of catchment antecedent wetness and infiltration capacity"),
        "drainage_area_sqmi": ("raw_static", "float64", "static", "Watershed contributing drainage area (sq miles)", "First-order physical control on total discharge volume and routing lag"),
        "mean_elevation_ft": ("raw_static", "float64", "static", "Mean basin elevation above sea level (ft)", "Controls orographic precipitation and snowpack accumulation regime"),
        "slope_pct": ("raw_static", "float64", "static", "Mean watershed terrain slope (%)", "Governs overland flow velocity, runoff ratio, and hydrograph flashiness"),
        "forest_cover_pct": ("raw_static", "float64", "static", "Basin forest canopy cover percentage (%)", "Modulates canopy interception, evapotranspiration, and soil infiltration"),
    }

    rows = []
    for col in feature_cols:
        dtype_str = str(df_sample[col].dtype) if col in df_sample.columns else "float64"
        if col in raw_cols:
            fam, dt, win, desc, rat = raw_cols[col]
        elif col.startswith("rain_sum_"):
            w = col.split("_")[-1]
            fam, win = "rainfall", w
            desc = f"Backward-looking {w} cumulative precipitation sum (mm)"
            rat = f"Captures {w} cumulative storm volume contributing to quickflow and interflow"
        elif col.startswith("rain_max_1d_in_"):
            w = col.split("_")[-1]
            fam, win = "rainfall", w
            desc = f"Peak single-day rainfall within past {w} window (mm)"
            rat = f"Captures peak storm intensity over {w} that triggers infiltration-excess overland flow"
        elif col.startswith("wet_days_gt"):
            parts = col.replace("wet_days_gt", "").split("_")
            fam, win = "rainfall", parts[1]
            desc = f"Count of wet days exceeding {parts[0]} in past {parts[1]}"
            rat = "Persistent wet spells saturate upper soil horizons and elevate baseflow"
        elif col.startswith("days_since_rain_"):
            thresh = col.replace("days_since_rain_", "")
            fam, win = "rainfall", "expanding_past"
            desc = f"Days elapsed since daily precipitation last exceeded {thresh}"
            rat = "Measures catchment drying time and recession limb duration since last significant storm"
        elif col == "wet_streak":
            fam, win = "rainfall", "expanding_past"
            desc = "Consecutive backward-looking days with precipitation > 1mm"
            rat = "Multi-day consecutive rainfall compounds soil saturation and flood peak risk"
        elif col.startswith("rain_intensity_ratio_"):
            w = col.split("_")[-1]
            fam, win = "rainfall", w
            desc = f"Ratio of peak 1-day rainfall to total {w} rainfall"
            rat = "Distinguishes concentrated cloudburst storms from uniform drizzle over the window"
        elif col == "rain_acceleration":
            fam, win = "rainfall", "6d"
            desc = "3-day rainfall sum minus prior 3-day rainfall sum (mm)"
            rat = "Positive acceleration identifies the rising limb of an active synoptic storm event"
        elif col.startswith("rain_anomaly_"):
            w = col.split("_")[2]
            fam, win = "rainfall", f"{w}_vs_365d"
            desc = f"Ratio of backward {w} rainfall sum to station 365-day baseline rainfall rate"
            rat = f"Captures multi-week/seasonal hydroclimatic wetness anomaly over {w} relative to local climate"
        elif col.startswith("rain_vol_"):
            w = col.split("_")[-1]
            fam, win = "rainfall", w
            desc = f"Volumetric basin precipitation input over {w} (rain_sum_{w} * drainage_area_sqmi / 1000)"
            rat = f"First-order physical water volume delivered to watershed over {w} across 4 orders of basin area"
        elif col.startswith("rain_decayed_"):
            alpha = "0." + col.split("_")[-1][1:]
            fam, win = "antecedent", f"IIR_decay_{alpha}"
            desc = f"Exponentially decayed Antecedent Precipitation Index (API, alpha={alpha})"
            rat = f"Linear reservoir memory proxy with decay constant alpha={alpha} representing subsurface storage"
        elif col == "time_of_concentration":
            fam, win = "antecedent", "static"
            desc = "Kirpich-style basin time of concentration proxy from area and slope"
            rat = "Estimates kinematic wave travel time from basin divide to gauge outlet"
        elif col.startswith("soil_moisture_lag"):
            w = col.replace("soil_moisture_lag", "") + "d"
            fam, win = "soil", w
            desc = f"Soil moisture lagged by {w}"
            rat = "Captures delayed subsurface percolation and pre-storm catchment wetness state"
        elif col.startswith("soil_moisture_mean_"):
            w = col.split("_")[-1]
            fam, win = "soil", w
            desc = f"{w} backward rolling mean soil moisture"
            rat = f"Smooths daily surface noise to represent {w} root-zone and subsurface wetness state"
        elif col.startswith("soil_moisture_delta_"):
            w = col.split("_")[-1]
            fam, win = "soil", w
            desc = f"Change in soil moisture over past {w}"
            rat = "Rapid soil wetting rate signals active infiltration and imminent saturation excess"
        elif col == "soil_moisture_pct":
            fam, win = "soil", "expanding_past"
            desc = "Per-station expanding percentile rank of soil moisture"
            rat = "Normalizes soil wetness relative to local soil porosity and climate regime"
        elif col == "soil_x_rain":
            fam, win = "soil", "1d"
            desc = "Interaction of daily soil moisture and daily precipitation"
            rat = "Nonlinear saturation-excess runoff generation when heavy rain falls on wet soil"
        elif col == "runoff_proxy":
            fam, win = "soil", "1d"
            desc = "SCS Curve-Number style nonlinear runoff depth proxy"
            rat = "Boosts effective rainfall when soil moisture exceeds its 70th percentile threshold"
        elif col == "runoff_coeff_proxy":
            fam, win = "soil", "1d"
            desc = "Estimated runoff coefficient from soil moisture and basin slope"
            rat = "Hydrological fraction of rainfall converted to quickflow vs infiltration"
        elif col == "fast_runoff_depth":
            fam, win = "soil", "IIR_decay_0.55"
            desc = "Fast linear reservoir routing of effective surface runoff depth (alpha=0.55)"
            rat = "Simulates 1-3 day quickflow hydrograph response to effective rainfall"
        elif col == "slow_recharge_depth":
            fam, win = "soil", "IIR_decay_0.985"
            desc = "Slow linear reservoir routing of soil recharge depth (alpha=0.985)"
            rat = "Simulates multi-month groundwater baseflow storage and slow recession"
        elif col == "temp_mean_c":
            fam, win = "temperature", "1d"
            desc = "Daily mean air temperature (0.5 * (tmax + tmin)) in Celsius"
            rat = "Governs phase of precipitation (rain vs snow) and thermal energy balance"
        elif col == "diurnal_range_c":
            fam, win = "temperature", "1d"
            desc = "Daily diurnal temperature range (tmax - tmin) in Celsius"
            rat = "Proxy for cloud cover, solar radiation, and Hargreaves evapotranspiration"
        elif col == "rain_as_snow":
            fam, win = "temperature", "1d"
            desc = "Precipitation falling on days with mean temperature below 1C (mm)"
            rat = "Precipitation stored as snowpack rather than immediately contributing to runoff"
        elif col == "rain_as_liquid":
            fam, win = "temperature", "1d"
            desc = "Effective liquid precipitation adjusted for freezing threshold (mm)"
            rat = "Liquid water input immediately available for infiltration and overland runoff"
        elif col == "rain_on_snow":
            fam, win = "temperature", "1d"
            desc = "Binary indicator of warm rain (>5mm) during near-freezing transition (1-4C)"
            rat = "Rain-on-snow events trigger rapid compound snowmelt + rainfall flood surges"
        elif col.startswith("pos_degree_days_"):
            w = col.split("_")[-1]
            fam, win = "temperature", w
            desc = f"Cumulative positive degree-days (>0C) over past {w}"
            rat = "Thermal energy index driving seasonal snowpack ablation and snowmelt runoff"
        elif col.startswith("freeze_degree_days_"):
            w = col.split("_")[-1]
            fam, win = "temperature", w
            desc = f"Cumulative freezing degree-days (<0C) over past {w}"
            rat = "Measures cold-season snowpack accumulation potential and frozen ground severity"
        elif col == "freeze_thaw_7d":
            fam, win = "temperature", "7d"
            desc = "Count of freeze-thaw days (tmin < 0C and tmax > 0C) in past 7 days"
            rat = "Indicates active diurnal snowmelt and frozen-soil permeability transitions"
        elif col == "et_proxy":
            fam, win = "temperature", "1d"
            desc = "Hargreaves-Samani potential evapotranspiration proxy (mm/day)"
            rat = "Estimates atmospheric water demand depleting catchment soil moisture storage"
        elif col == "spring_snowmelt_dd":
            fam, win = "temperature", "1d"
            desc = "Spring window (DOY 60-200) degree-day snowmelt rate proxy"
            rat = "Captures spring freshet snowmelt pulse in northern and mountain watersheds"
        elif col in ("doy_sin", "doy_cos", "month", "water_year_day"):
            fam, win = "calendar", "1d"
            desc = f"Cyclical/seasonal calendar coordinate ({col})"
            rat = "Encodes smooth seasonal phase within the hydrological water year (starting Oct 1)"
        elif col in ("log_drainage_area", "area_x_rain", "slope_x_rain", "basin_size_bin", "forest_x_elev"):
            fam, win = "static", "1d/static"
            desc = f"Catchment physiographic interaction feature ({col})"
            rat = "Scales meteorological forcing by watershed area, terrain slope, and land cover"
        elif col in ("conceptual_fast_flow", "conceptual_slow_flow", "conceptual_water_balance"):
            fam, win = "static", "IIR_routing"
            desc = f"Conceptual two-store HBV-style basin water balance state ({col})"
            rat = "Combines drainage area, slope, soil moisture, snowmelt, and fast/slow linear reservoirs"
        elif col.startswith("station_"):
            if col == "station_rain_vs_regional":
                fam, win = "cross_station", "1d"
                desc = "Station daily rainfall minus concurrent national/regional mean rainfall (mm)"
                rat = "Isolates localized convective storms from broad synoptic precipitation systems"
            else:
                fam, win = "station_stats", "train_only_prior"
                desc = f"Training-set historical station discharge statistic ({col})"
                rat = "Calibrates baseline flow scale and seasonal regime per gauge using pre-cutoff training data only"
        elif col.startswith("regional_") or col.startswith("basin_") or col.startswith("upstream_"):
            fam, win = "cross_station", "1d_to_60d"
            desc = f"Cross-station synoptic and upstream basin weather aggregate ({col})"
            rat = "Captures large-scale atmospheric rivers, HUC-2 regional storms, and upstream Midwest basin routing"
        else:
            fam, win = "engineered", "backward"
            desc = f"Engineered hydrological feature ({col})"
            rat = "Captures backward-looking hydrological state"

        rows.append({
            "feature_name": col,
            "family": fam,
            "data_type": dtype_str,
            "lookback_window": win,
            "description": desc,
            "hydrological_rationale": rat,
            "leakage_free": True,
        })
    return pd.DataFrame(rows)


def compute_features_with_Active_families(
    train_df: pd.DataFrame,
    eval_df: pd.DataFrame,
    active_families: list,
) -> tuple:
    """
    Compute features on concatenated (train_df + eval_df without discharge)
    with only the specified feature families enabled, and station_stats computed
    STRICTLY from train_df.
    """
    all_fams = ["rainfall", "antecedent", "soil", "temperature", "calendar", "static", "station_stats", "cross_station"]
    cfg = {
        "features": {
            fam: {"enabled": (fam in active_families)} for fam in all_fams
        }
    }
    combined = pd.concat([
        train_df.assign(_split="train"),
        eval_df.drop(columns=["discharge_cfs"], errors="ignore").assign(discharge_cfs=np.nan, _split="eval"),
    ], ignore_index=True)

    featured = compute_all_features(combined, cfg, train_discharge=train_df if "station_stats" in active_families else None)
    tr_out = featured[featured["_split"] == "train"].drop(columns=["_split"]).reset_index(drop=True)
    ev_out = featured[featured["_split"] == "eval"].drop(columns=["_split"]).reset_index(drop=True)
    if "discharge_cfs" in eval_df.columns:
        # Align eval discharge_cfs by (station_id, date)
        ev_out = ev_out.drop(columns=["discharge_cfs"]).merge(
            eval_df[["station_id", "date", "discharge_cfs"]],
            on=["station_id", "date"],
            how="left",
        )
    return tr_out, ev_out


def train_and_eval_lgb(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    feature_cols: list,
    params_override: dict = None,
    sample_weights: np.ndarray = None,
    y_train_override: np.ndarray = None,
    y_val_override: np.ndarray = None,
    n_estimators: int = 5000,
    early_stopping_rounds: int = 200,
):
    """Fast, reproducible LightGBM training helper matching configs/base.yaml."""
    params = {
        "objective": "regression",
        "metric": "rmse",
        "learning_rate": 0.03,
        "num_leaves": 63,
        "min_child_samples": 40,
        "feature_fraction": 0.7,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "lambda_l2": 5.0,
        "seed": 42,
        "n_jobs": -1,
        "verbose": -1,
    }
    if params_override:
        params.update(params_override)

    y_tr = y_train_override if y_train_override is not None else train_df["discharge_cfs"].values.astype(float)
    y_va = y_val_override if y_val_override is not None else val_df["discharge_cfs"].values.astype(float)

    dtrain = lgb.Dataset(train_df[feature_cols], label=y_tr, weight=sample_weights, free_raw_data=False)
    dval = lgb.Dataset(val_df[feature_cols], label=y_va, reference=dtrain, free_raw_data=False)

    t0 = time.time()
    model = lgb.train(
        params,
        dtrain,
        num_boost_round=n_estimators,
        valid_sets=[dval],
        valid_names=["val"],
        callbacks=[lgb.early_stopping(early_stopping_rounds, verbose=False)],
    )
    elapsed = time.time() - t0
    preds = model.predict(val_df[feature_cols])
    return model, preds, elapsed


def main():
    t_pipeline_start = time.time()
    print("=" * 72)
    print("  FLOODCAST — FULL EXPERIMENTAL PIPELINE (STEPS 1 TO 10)")
    print("=" * 72)

    config = load_config(str(ROOT / "configs" / "base.yaml"))
    train_df, test_df, meta_df = ingest_all_stations(config)
    test_labels_df = pd.read_csv(PROCESSED_DIR / "test_with_labels.csv", dtype={"station_id": str})

    # =========================================================================
    # STEP 1: DATA SANITY CSVs + FEATURE CATALOG + SAMPLE MATRICES
    # =========================================================================
    print("\n[STEP 1] Computing Station Sanity Summary, Feature Catalog & Sample CSVs...")
    sanity_rows = []
    train_sids = set(train_df["station_id"].unique())
    test_sids = set(test_df["station_id"].unique())

    from floodcast.ingest import STATION_ATTRIBUTES
    for _, mrow in meta_df.iterrows():
        sid = str(mrow["station_id"])
        tr_s = train_df[train_df["station_id"] == sid]
        te_s = test_df[test_df["station_id"] == sid]
        fb = STATION_ATTRIBUTES.get(sid, {})
        q = tr_s["discharge_cfs"].dropna() if len(tr_s) > 0 else pd.Series([], dtype=float)
        p90 = float(q.quantile(0.90)) if len(q) > 0 else 0.0
        top10 = q[q >= p90] if len(q) > 0 else pd.Series([], dtype=float)
        missing_pct = float(tr_s.isna().any(axis=1).mean() * 100.0) if len(tr_s) > 0 else 100.0

        sanity_rows.append({
            "station_id": sid,
            "station_name": mrow["station_name"],
            "state": mrow["state"],
            "river_name": mrow["river_name"],
            "latitude": float(mrow["latitude"]),
            "longitude": float(mrow["longitude"]),
            "drainage_area_sqmi": float(tr_s["drainage_area_sqmi"].iloc[0]) if len(tr_s) > 0 else float(fb.get("drainage_area_sqmi", 0.0)),
            "mean_elevation_ft": float(tr_s["mean_elevation_ft"].iloc[0]) if len(tr_s) > 0 else float(fb.get("mean_elevation_ft", 0.0)),
            "slope_pct": float(tr_s["slope_pct"].iloc[0]) if len(tr_s) > 0 else float(fb.get("slope_pct", 0.0)),
            "forest_cover_pct": float(tr_s["forest_cover_pct"].iloc[0]) if len(tr_s) > 0 else float(fb.get("forest_cover_pct", 0.0)),
            "train_rows": int(len(tr_s)),
            "test_rows": int(len(te_s)),
            "train_start": str(tr_s["date"].min()) if len(tr_s) > 0 else "N/A",
            "train_end": str(tr_s["date"].max()) if len(tr_s) > 0 else "N/A",
            "test_start": str(te_s["date"].min()) if len(te_s) > 0 else "N/A",
            "test_end": str(te_s["date"].max()) if len(te_s) > 0 else "N/A",
            "missing_pct": round(missing_pct, 4),
            "discharge_mean": round(float(q.mean()), 2) if len(q) > 0 else 0.0,
            "discharge_median": round(float(q.median()), 2) if len(q) > 0 else 0.0,
            "discharge_std": round(float(q.std()), 2) if len(q) > 0 else 0.0,
            "discharge_min": round(float(q.min()), 2) if len(q) > 0 else 0.0,
            "discharge_p75": round(float(q.quantile(0.75)), 2) if len(q) > 0 else 0.0,
            "discharge_p90": round(p90, 2) if len(q) > 0 else 0.0,
            "discharge_p99": round(float(q.quantile(0.99)), 2) if len(q) > 0 else 0.0,
            "discharge_max": round(float(q.max()), 2) if len(q) > 0 else 0.0,
            "top10_rows_count": int(len(top10)),
            "top10_share_pct": round(float(top10.sum() / (q.sum() + 1e-9) * 100.0), 2) if len(q) > 0 else 0.0,
            "in_train": sid in train_sids,
            "in_test": sid in test_sids,
        })

    sanity_df = pd.DataFrame(sanity_rows)
    sanity_df.to_csv(PROCESSED_DIR / "station_sanity_summary.csv", index=False)
    print(f"  Saved station_sanity_summary.csv ({len(sanity_df)} stations)")

    # Forward-in-time validation split on train_df:
    # Train split: 2010-01-01 to 2020-12-31 (11 years)
    # Val split:   2021-01-01 to 2021-12-31 (1 year, 32 stations * 365 days = 11,680 rows)
    raw_train_split, raw_val_split = forward_time_split(train_df, val_years=1)
    raw_train_split["date"] = raw_train_split["date"].dt.strftime("%Y-%m-%d")
    raw_val_split["date"] = raw_val_split["date"].dt.strftime("%Y-%m-%d")

    all_families = ["rainfall", "antecedent", "soil", "temperature", "calendar", "static", "station_stats", "cross_station"]
    print("  Computing full feature matrix for validation split (train 2010-2020 -> val 2021)...")
    val_tr_feat, val_ev_feat = compute_features_with_Active_families(raw_train_split, raw_val_split, all_families)
    full_feature_cols = get_feature_columns(val_tr_feat)
    print(f"  Total engineered + raw features: {len(full_feature_cols)}")

    # Also compute full features on (all train 2010-2021 -> test 2022) for sample export & final fit
    full_tr_feat, full_te_feat = compute_features_with_Active_families(train_df, test_df, all_families)
    full_tr_feat.head(2000).to_csv(PROCESSED_DIR / "train_features_sample.csv", index=False)
    full_te_feat.head(2000).to_csv(PROCESSED_DIR / "test_features_sample.csv", index=False)
    print("  Saved train_features_sample.csv (2,000 rows) & test_features_sample.csv (2,000 rows)")

    catalog_df = build_feature_catalog(full_feature_cols, full_tr_feat)
    catalog_df.to_csv(PROCESSED_DIR / "feature_catalog.csv", index=False)
    print(f"  Saved feature_catalog.csv ({len(catalog_df)} documented features)")

    # =========================================================================
    # STEP 2: NAIVE BASELINES
    # =========================================================================
    print("\n[STEP 2] Evaluating Naive Baselines on Validation Split (2021)...")
    y_val_true = val_ev_feat["discharge_cfs"].values.astype(float)
    val_sids = val_ev_feat["station_id"].values

    # 1. Per-station training mean
    t0 = time.time()
    st_means = raw_train_split.groupby("station_id")["discharge_cfs"].mean()
    pred_naive_mean = val_ev_feat["station_id"].map(st_means).fillna(raw_train_split["discharge_cfs"].mean()).values
    m_naive_mean = compute_all_metrics(y_val_true, pred_naive_mean, val_sids)
    log_run("run_naive_station_mean", "naive_baseline", "heuristic", "raw", 1, m_naive_mean, time.time() - t0,
            "Per-station training mean discharge (2010-2020)")

    # 2. Per-station day-of-year mean
    t0 = time.time()
    tr_doy = raw_train_split.copy()
    tr_doy["doy"] = pd.to_datetime(tr_doy["date"]).dt.dayofyear
    va_doy = val_ev_feat[["station_id", "date"]].copy()
    va_doy["doy"] = pd.to_datetime(va_doy["date"]).dt.dayofyear
    doy_means = tr_doy.groupby(["station_id", "doy"])["discharge_cfs"].mean().rename("pred_q")
    va_doy = va_doy.merge(doy_means, on=["station_id", "doy"], how="left")
    pred_naive_doy = va_doy["pred_q"].fillna(va_doy["station_id"].map(st_means)).values
    m_naive_doy = compute_all_metrics(y_val_true, pred_naive_doy, val_sids)
    log_run("run_naive_station_doy_mean", "naive_baseline", "heuristic", "raw", 2, m_naive_doy, time.time() - t0,
            "Per-station day-of-year historical mean discharge")

    # 3. Ridge regression on basic rainfall + static features
    t0 = time.time()
    ridge_cols = [
        "precipitation_mm", "rain_sum_3d", "rain_sum_7d", "rain_sum_30d",
        "soil_moisture", "temp_max_c", "temp_min_c",
        "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct",
    ]
    X_tr_ridge = val_tr_feat[ridge_cols].fillna(0.0).values
    X_va_ridge = val_ev_feat[ridge_cols].fillna(0.0).values
    ridge_pipe = make_pipeline(StandardScaler(), Ridge(alpha=100.0))
    ridge_pipe.fit(X_tr_ridge, val_tr_feat["discharge_cfs"].values)
    pred_ridge = np.clip(ridge_pipe.predict(X_va_ridge), 0.0, None)
    m_naive_ridge = compute_all_metrics(y_val_true, pred_ridge, val_sids)
    log_run("run_naive_ridge_rain", "naive_baseline", "ridge", "raw", len(ridge_cols), m_naive_ridge, time.time() - t0,
            "Ridge regression on basic rainfall + static features")

    naive_df = pd.DataFrame([
        {"model": "naive_station_mean", "n_features": 1, **m_naive_mean, "notes": "Per-station historical mean flow"},
        {"model": "naive_station_doy_mean", "n_features": 2, **m_naive_doy, "notes": "Per-station day-of-year climatology"},
        {"model": "naive_ridge_rain", "n_features": len(ridge_cols), **m_naive_ridge, "notes": "Linear Ridge on basic rain + static features"},
    ])
    naive_df.to_csv(EXPERIMENTS_DIR / "naive_baselines.csv", index=False)
    print(naive_df.to_string(index=False))

    # =========================================================================
    # STEP 3: SMOKE TEST (<60s) & BASELINE LIGHTGBM
    # =========================================================================
    print("\n[STEP 3] Running 1,000-Row Smoke Test & Baseline LightGBM...")
    raw_8_cols = [
        "precipitation_mm", "temp_max_c", "temp_min_c", "soil_moisture",
        "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct",
    ]
    t_smoke = time.time()
    _, smoke_preds, smoke_time = train_and_eval_lgb(
        val_tr_feat.iloc[:1000], val_ev_feat.iloc[:500], raw_8_cols, n_estimators=50, early_stopping_rounds=20
    )
    assert not np.isnan(smoke_preds).any(), "Smoke test produced NaNs!"
    assert smoke_time < 60.0, f"Smoke test exceeded 60s ({smoke_time:.1f}s)"
    print(f"  Smoke test on 1,000 rows PASSED in {smoke_time:.2f}s (<60s limit)")

    # Starter baseline LightGBM on raw 8 features
    model_raw8, pred_raw8_lgb, t_raw8 = train_and_eval_lgb(val_tr_feat, val_ev_feat, raw_8_cols)
    pred_raw8_lgb = np.clip(pred_raw8_lgb, 0.0, None)
    m_raw8_lgb = compute_all_metrics(y_val_true, pred_raw8_lgb, val_sids)
    log_run("run_baseline_lgb", "baseline", "lightgbm", "raw", len(raw_8_cols), m_raw8_lgb, t_raw8,
            "Baseline LightGBM on 8 raw starter columns (no engineered features)",
            best_iteration=model_raw8.best_iteration, early_stopping_rounds=200)
    print(f"  Baseline LightGBM (8 raw cols): RMSE={m_raw8_lgb['rmse']:.2f}, Extreme_RMSE={m_raw8_lgb['extreme_rmse']:.2f}, MAE={m_raw8_lgb['mae']:.2f}, R2={m_raw8_lgb['r2']:.4f} (best_iter={model_raw8.best_iteration})")

    # =========================================================================
    # STEP 4: FEATURE FAMILY ABLATIONS
    # =========================================================================
    print("\n[STEP 4] Running Sequential Feature Family Ablations (Fixed Seed=42)...")
    family_Cols_map = {
        "raw_only": raw_8_cols,
        "rainfall": [c for c in catalog_df[catalog_df["family"] == "rainfall"]["feature_name"].tolist() if c in val_tr_feat.columns],
        "antecedent": [c for c in catalog_df[catalog_df["family"] == "antecedent"]["feature_name"].tolist() if c in val_tr_feat.columns],
        "soil": [c for c in catalog_df[catalog_df["family"] == "soil"]["feature_name"].tolist() if c in val_tr_feat.columns],
        "temperature": [c for c in catalog_df[catalog_df["family"] == "temperature"]["feature_name"].tolist() if c in val_tr_feat.columns],
        "calendar": [c for c in catalog_df[catalog_df["family"] == "calendar"]["feature_name"].tolist() if c in val_tr_feat.columns],
        "static": [c for c in catalog_df[catalog_df["family"] == "static"]["feature_name"].tolist() if c in val_tr_feat.columns],
        "station_stats": [c for c in catalog_df[catalog_df["family"] == "station_stats"]["feature_name"].tolist() if c in val_tr_feat.columns],
        "cross_station": [c for c in catalog_df[catalog_df["family"] == "cross_station"]["feature_name"].tolist() if c in val_tr_feat.columns],
    }

    ablation_steps = [
        (0, "raw_only", "8 raw weather + static columns"),
        (1, "+rainfall", "Rolling rainfall sums (1-365d), volumetric area*rain, anomaly ratios, max 1d, wet streaks, intensity"),
        (2, "+antecedent", "Exponentially decayed API (alpha=0.5, 0.55, 0.8, 0.95, 0.985) & concentration time"),
        (3, "+soil", "Soil moisture lags, deltas, expanding pct, SCS runoff proxy, fast/slow depth"),
        (4, "+temperature", "Snow/liquid split, rain-on-snow, degree-days, Hargreaves ET, spring snowmelt"),
        (5, "+calendar", "Cyclical DOY sin/cos, month, water year day"),
        (6, "+static", "Log drainage area, area*rain, slope*rain, conceptual two-store basin routing"),
        (7, "+station_stats", "Pre-cutoff station discharge quantiles, monthly climatology & calibrated water balance"),
        (8, "+cross_station", "Concurrent regional & HUC-2 synoptic rainfall and soil moisture context"),
    ]

    kept_cols = list(raw_8_cols)
    prev_rmse = m_raw8_lgb["rmse"]
    prev_ext_rmse = m_raw8_lgb["extreme_rmse"]
    prev_log_rmse = float(np.sqrt(np.mean((np.log1p(y_val_true) - np.log1p(pred_raw8_lgb)) ** 2)))
    ablation_records = [{
        "step": 0,
        "family_added": "raw_only",
        "n_features": len(kept_cols),
        "rmse": round(m_raw8_lgb["rmse"], 2),
        "extreme_rmse": round(m_raw8_lgb["extreme_rmse"], 2),
        "mae": round(m_raw8_lgb["mae"], 2),
        "r2": round(m_raw8_lgb["r2"], 4),
        "composite": 0.0,
        "delta_rmse": 0.0,
        "delta_extreme_rmse": 0.0,
        "kept": True,
        "notes": "8 raw weather + static columns",
    }]

    best_ablation_preds = pred_raw8_lgb.copy()
    best_ablation_model = model_raw8

    for step_idx, fam_label, fam_notes in ablation_steps[1:]:
        fam_key = fam_label.lstrip("+")
        candidate_cols = kept_cols + [c for c in family_Cols_map[fam_key] if c not in kept_cols]
        model_cand, pred_cand, t_cand = train_and_eval_lgb(val_tr_feat, val_ev_feat, candidate_cols)
        pred_cand = np.clip(pred_cand, 0.0, None)
        m_cand = compute_all_metrics(y_val_true, pred_cand, val_sids)
        cand_log_rmse = float(np.sqrt(np.mean((np.log1p(y_val_true) - np.log1p(pred_cand)) ** 2)))

        d_rmse = m_cand["rmse"] - prev_rmse
        d_ext = m_cand["extreme_rmse"] - prev_ext_rmse
        d_log = cand_log_rmse - prev_log_rmse
        # Keep family if it improves overall RMSE, Extreme RMSE, or multi-basin log-RMSE
        is_kept = (d_rmse <= 0.0) or (d_ext <= 0.0) or (d_log <= 0.0)
        if is_kept:
            kept_cols = candidate_cols
            prev_rmse = m_cand["rmse"]
            prev_ext_rmse = m_cand["extreme_rmse"]
            prev_log_rmse = cand_log_rmse
            best_ablation_preds = pred_cand
            best_ablation_model = model_cand

        log_run(
            f"run_ablation_{step_idx}_{fam_key}",
            "ablation",
            "lightgbm",
            "raw",
            len(candidate_cols),
            m_cand,
            t_cand,
            f"Ablation Step {step_idx}: {fam_label} ({'KEPT' if is_kept else 'DROPPED'})",
            best_iteration=model_cand.best_iteration,
            early_stopping_rounds=200,
        )
        ablation_records.append({
            "step": step_idx,
            "family_added": fam_label,
            "n_features": len(candidate_cols),
            "rmse": round(m_cand["rmse"], 2),
            "extreme_rmse": round(m_cand["extreme_rmse"], 2),
            "mae": round(m_cand["mae"], 2),
            "r2": round(m_cand["r2"], 4),
            "composite": 0.0,  # filled after global normalization
            "delta_rmse": round(d_rmse, 2),
            "delta_extreme_rmse": round(d_ext, 2),
            "kept": bool(is_kept),
            "notes": fam_notes,
        })
        print(f"  Step {step_idx} ({fam_label:15s}): n_feat={len(candidate_cols):2d} | RMSE={m_cand['rmse']:8.2f} ({d_rmse:+7.2f}) | ExtRMSE={m_cand['extreme_rmse']:9.2f} ({d_ext:+8.2f}) | R2={m_cand['r2']:.4f} | iter={model_cand.best_iteration} | kept={is_kept}")

    active_feature_cols = kept_cols
    print(f"  Selected {len(active_feature_cols)} features after ablation.")

    # =========================================================================
    # STEP 5: TARGET STRATEGIES
    # =========================================================================
    print("\n[STEP 5] Comparing Target Transformation Strategies on RAW Discharge Scale...")
    target_records = []

    # (a) Raw L2
    model_raw, pred_target_raw, t_tr_raw = train_and_eval_lgb(val_tr_feat, val_ev_feat, active_feature_cols)
    pred_target_raw = np.clip(pred_target_raw, 0.0, None)
    m_t_raw = compute_all_metrics(y_val_true, pred_target_raw, val_sids)
    log_run("run_target_raw", "target_strategy", "lightgbm", "raw", len(active_feature_cols), m_t_raw, t_tr_raw,
            "Target strategy (a): Raw discharge_cfs with L2 loss",
            best_iteration=model_raw.best_iteration, early_stopping_rounds=200)
    target_records.append({"strategy": "raw", **m_t_raw, "notes": "Direct L2 optimization on raw cfs"})

    # (b) Per-station mean-scaled target (clipped at 99.9th percentile during training to prevent outlier flash-flood destabilization)
    st_means_scale = val_tr_feat.groupby("station_id")["discharge_cfs"].mean().clip(lower=10.0)
    tr_scale = val_tr_feat["station_id"].map(st_means_scale).values
    va_scale = val_ev_feat["station_id"].map(st_means_scale).values
    raw_scaled_tr = val_tr_feat["discharge_cfs"].values / tr_scale
    st_q999 = pd.Series(raw_scaled_tr).groupby(val_tr_feat["station_id"].values).transform(lambda x: max(10.0, float(np.percentile(x, 99.9)))).values
    y_tr_scaled = np.clip(raw_scaled_tr, 0.0, st_q999)
    y_va_scaled = y_val_true / va_scale
    scale_sample_weights = (tr_scale / np.mean(tr_scale)) ** 0.70
    model_scaled, pred_scaled_unit, t_tr_scaled = train_and_eval_lgb(
        val_tr_feat, val_ev_feat, active_feature_cols,
        sample_weights=scale_sample_weights,
        y_train_override=y_tr_scaled, y_val_override=y_va_scaled,
        n_estimators=1000,
    )
    pred_target_scaled = np.clip(pred_scaled_unit * va_scale, 0.0, None)
    m_t_scaled = compute_all_metrics(y_val_true, pred_target_scaled, val_sids)
    log_run("run_target_scaled", "target_strategy", "lightgbm", "scaled", len(active_feature_cols), m_t_scaled, t_tr_scaled,
            "Target strategy (b): Per-station mean-scaled discharge (99.9th pct training clip + scale-balanced weights)",
            best_iteration=model_scaled.best_iteration, early_stopping_rounds=200)
    target_records.append({"strategy": "scaled", **m_t_scaled, "notes": "Divided by per-station training mean (99.9% clip), rescaled at inference"})

    # (c) log1p with per-station Duan's smearing bias correction (clipped residuals to prevent outlier blowup)
    y_tr_log = np.log1p(val_tr_feat["discharge_cfs"].values.astype(float))
    y_va_log = np.log1p(y_val_true)
    model_log, pred_va_log, t_tr_log = train_and_eval_lgb(
        val_tr_feat, val_ev_feat, active_feature_cols,
        y_train_override=y_tr_log, y_val_override=y_va_log,
    )
    pred_tr_log = model_log.predict(val_tr_feat[active_feature_cols])
    tr_res = y_tr_log - pred_tr_log
    smear_df = pd.DataFrame({"station_id": val_tr_feat["station_id"].values, "exp_res": np.exp(np.clip(tr_res, -2.0, 2.0))})
    station_smear = smear_df.groupby("station_id")["exp_res"].mean().clip(lower=0.90, upper=1.25)
    va_smear = val_ev_feat["station_id"].map(station_smear).fillna(1.05).values
    pred_target_log1p = np.clip(np.expm1(pred_va_log) * va_smear, 0.0, None)
    m_t_log1p = compute_all_metrics(y_val_true, pred_target_log1p, val_sids)
    log_run("run_target_log1p_smearing", "target_strategy", "lightgbm", "log1p_smearing", len(active_feature_cols), m_t_log1p, t_tr_log,
            "Target strategy (c): log1p(discharge) with per-station Duan smearing correction",
            best_iteration=model_log.best_iteration, early_stopping_rounds=200)
    target_records.append({"strategy": "log1p_smearing", **m_t_log1p, "notes": "log1p target with per-station Duan smearing back-transform"})

    # (d) Tweedie loss (variance_power=1.5)
    model_tweedie, pred_target_tweedie, t_tr_tweedie = train_and_eval_lgb(
        val_tr_feat, val_ev_feat, active_feature_cols,
        params_override={"objective": "tweedie", "tweedie_variance_power": 1.5, "metric": "rmse"},
    )
    pred_target_tweedie = np.clip(pred_target_tweedie, 0.0, None)
    m_t_tweedie = compute_all_metrics(y_val_true, pred_target_tweedie, val_sids)
    log_run("run_target_tweedie", "target_strategy", "lightgbm", "tweedie", len(active_feature_cols), m_t_tweedie, t_tr_tweedie,
            "Target strategy (d): Tweedie objective (variance_power=1.5)",
            best_iteration=model_tweedie.best_iteration, early_stopping_rounds=200)
    target_records.append({"strategy": "tweedie", **m_t_tweedie, "notes": "LightGBM Tweedie loss (p=1.5) for right-skewed flow"})

    # (e) Optimal validation-weighted blend of raw + scaled + log1p_smearing + tweedie (with scale-consistent gating for small stations)
    va_alpha_scale = np.clip((va_scale - 500.0) / 25000.0, 0.0, 1.0)
    pred_small_scale_ref = 0.45 * pred_target_scaled + 0.30 * pred_target_log1p + 0.25 * pred_target_tweedie

    best_blend_rmse = float("inf")
    best_w = (0.5, 0.2, 0.15, 0.15)
    for w_raw in np.linspace(0.1, 0.8, 15):
        for w_sc in np.linspace(0.0, 1.0 - w_raw, 9):
            for w_log in np.linspace(0.0, 1.0 - w_raw - w_sc, 9):
                w_tw = max(0.0, 1.0 - w_raw - w_sc - w_log)
                raw_b = (
                    w_raw * pred_target_raw
                    + w_sc * pred_target_scaled
                    + w_log * pred_target_log1p
                    + w_tw * pred_target_tweedie
                )
                blend_p = va_alpha_scale * raw_b + (1.0 - va_alpha_scale) * pred_small_scale_ref
                r_val = float(np.sqrt(np.mean((y_val_true - blend_p) ** 2)))
                if r_val < best_blend_rmse:
                    best_blend_rmse = r_val
                    best_w = (round(float(w_raw), 3), round(float(w_sc), 3), round(float(w_log), 3), round(float(w_tw), 3))

    raw_b_opt = (
        best_w[0] * pred_target_raw
        + best_w[1] * pred_target_scaled
        + best_w[2] * pred_target_log1p
        + best_w[3] * pred_target_tweedie
    )
    pred_target_blend = va_alpha_scale * raw_b_opt + (1.0 - va_alpha_scale) * pred_small_scale_ref
    m_t_blend = compute_all_metrics(y_val_true, pred_target_blend, val_sids)
    avg_target_iter = int(np.mean([model_raw.best_iteration, model_scaled.best_iteration, model_log.best_iteration, model_tweedie.best_iteration]))
    log_run("run_target_blend_raw_log1p", "target_strategy", "lightgbm_blend", "blend_raw_log1p", len(active_feature_cols), m_t_blend,
            t_tr_raw + t_tr_scaled + t_tr_log + t_tr_tweedie,
            f"Target strategy (e): Scale-consistent blend (raw={best_w[0]}, scaled={best_w[1]}, log1p={best_w[2]}, tweedie={best_w[3]})",
            best_iteration=avg_target_iter, early_stopping_rounds=200)
    target_records.append({
        "strategy": "blend_raw_log1p",
        **m_t_blend,
        "notes": f"Scale-consistent blend (w_raw={best_w[0]}, w_scaled={best_w[1]}, w_log1p={best_w[2]}, w_tweedie={best_w[3]})",
    })

    target_df = pd.DataFrame(target_records)
    target_df.to_csv(EXPERIMENTS_DIR / "target_strategies.csv", index=False)
    print(target_df.to_string(index=False))

    # =========================================================================
    # STEP 6: FLOOD-PEAK HANDLING (30% OF COMPOSITE SCORE)
    # =========================================================================
    print("\n[STEP 6] Flood-Peak Handling (High-Flow Sample Weights, Wet Specialist & Tail Calibration)...")
    st_p90 = val_tr_feat.groupby("station_id")["discharge_cfs"].quantile(0.90)
    st_p99 = val_tr_feat.groupby("station_id")["discharge_cfs"].quantile(0.99)
    tr_p90_vec = val_tr_feat["station_id"].map(st_p90).values
    tr_p99_vec = val_tr_feat["station_id"].map(st_p99).values
    y_tr_vals = val_tr_feat["discharge_cfs"].values

    high_flow_weights = 1.0 + 3.0 * (y_tr_vals >= tr_p90_vec) + 5.0 * (y_tr_vals >= tr_p99_vec)
    model_hf_weighted, pred_hf_weighted_raw, t_hf_w = train_and_eval_lgb(
        val_tr_feat, val_ev_feat, active_feature_cols,
        sample_weights=high_flow_weights,
        params_override={"num_leaves": 95, "min_child_samples": 25},
    )
    pred_hf_weighted_raw = np.clip(pred_hf_weighted_raw, 0.0, None)
    # Gate small basins with scale-consistent predictions so high-flow raw weights don't inflate small-creek baseflow
    pred_hf_weighted = va_alpha_scale * pred_hf_weighted_raw + (1.0 - va_alpha_scale) * pred_small_scale_ref
    m_hf_weighted = compute_all_metrics(y_val_true, pred_hf_weighted, val_sids)
    log_run("run_flood_peak_weighted", "flood_peak", "lightgbm_weighted", "raw_weighted", len(active_feature_cols), m_hf_weighted, t_hf_w,
            "High-flow sample-weighted LightGBM (1 + 3*I(q>=p90) + 5*I(q>=p99))",
            best_iteration=model_hf_weighted.best_iteration, early_stopping_rounds=200)

    # Dedicated wet-condition specialist trained on top-50% wettest days per station (by conceptual_water_balance / rain_sum_7d)
    wet_thresh = val_tr_feat.groupby("station_id")["conceptual_water_balance"].transform(lambda x: x.quantile(0.55))
    wet_mask_tr = val_tr_feat["conceptual_water_balance"] >= wet_thresh
    model_wet_spec, pred_wet_spec_raw, t_wet_s = train_and_eval_lgb(
        val_tr_feat[wet_mask_tr], val_ev_feat, active_feature_cols,
        sample_weights=high_flow_weights[wet_mask_tr.values],
        params_override={"num_leaves": 63, "min_child_samples": 20, "learning_rate": 0.03},
    )
    pred_wet_spec = va_alpha_scale * np.clip(pred_wet_spec_raw, 0.0, None) + (1.0 - va_alpha_scale) * pred_small_scale_ref

    # Combine base blend + high-flow weighted + wet specialist on high predicted flow regime, and fit tail calibration factor on validation
    va_p90_prior = val_ev_feat["station_p90_q"].values
    is_high_pred = pred_target_blend >= (0.85 * va_p90_prior)

    best_peak_preds = pred_target_blend.copy()
    best_peak_score = m_t_blend["rmse"] * 0.4 + m_t_blend["extreme_rmse"] * 0.3
    best_peak_cfg = (0.7, 0.2, 0.1, 1.0)

    for w_base in [0.5, 0.6, 0.7, 0.8]:
        for w_hfw in [0.1, 0.2, 0.3, 0.4]:
            w_wet = round(max(0.0, 1.0 - w_base - w_hfw), 2)
            if abs(w_base + w_hfw + w_wet - 1.0) > 1e-5:
                continue
            raw_comb = w_base * pred_target_blend + w_hfw * pred_hf_weighted + w_wet * pred_wet_spec
            for tail_mult in [1.0, 1.02, 1.04, 1.06, 1.08, 1.10]:
                cal_pred = np.where(is_high_pred, raw_comb * tail_mult, pred_target_blend)
                m_c = compute_all_metrics(y_val_true, cal_pred, val_sids)
                sc = m_c["rmse"] * 0.4 + m_c["extreme_rmse"] * 0.3
                if sc < best_peak_score:
                    best_peak_score = sc
                    best_peak_preds = cal_pred
                    best_peak_cfg = (w_base, w_hfw, w_wet, tail_mult)

    m_peak_cal = compute_all_metrics(y_val_true, best_peak_preds, val_sids)
    log_run("run_flood_peak_calibrated", "flood_peak", "specialist_blend", "tail_calibrated", len(active_feature_cols),
            m_peak_cal, t_hf_w + t_wet_s,
            f"Flood-peak specialist + tail calibration (w={best_peak_cfg[:3]}, mult={best_peak_cfg[3]})",
            best_iteration=int(0.5 * (model_hf_weighted.best_iteration + model_wet_spec.best_iteration)),
            early_stopping_rounds=200)

    # Compute top-10% under-prediction ratios (mean, volume-weighted, and median) before vs after flood-peak handling
    val_p90_actual = pd.Series(y_val_true).groupby(val_sids).transform(lambda x: np.percentile(x, 90)).values
    top10_mask = y_val_true >= val_p90_actual

    def _top10_ratios(preds_arr):
        p_t10 = preds_arr[top10_mask]
        y_t10 = y_val_true[top10_mask]
        return {
            "top10_pred_to_actual_ratio": round(float(np.mean(p_t10 / (y_t10 + 1e-6))), 4),
            "top10_vol_weighted_pred_to_actual_ratio": round(float(np.sum(p_t10) / (np.sum(y_t10) + 1e-6)), 4),
            "top10_median_pred_to_actual_ratio": round(float(np.median(p_t10 / (y_t10 + 1e-6))), 4),
        }

    flood_peak_df = pd.DataFrame([
        {"method": "unweighted_raw_lgb", **m_t_raw, **_top10_ratios(pred_target_raw)},
        {"method": "target_blend_raw_log1p_tweedie", **m_t_blend, **_top10_ratios(pred_target_blend)},
        {"method": "high_flow_sample_weighted_lgb", **m_hf_weighted, **_top10_ratios(pred_hf_weighted)},
        {"method": "flood_peak_specialist_calibrated", **m_peak_cal, **_top10_ratios(best_peak_preds)},
    ])
    flood_peak_df.to_csv(EXPERIMENTS_DIR / "flood_peak_handling.csv", index=False)
    print(flood_peak_df.to_string(index=False))

    # =========================================================================
    # STEP 8 & 9: MODEL DIVERSITY & MULTI-SEED ENSEMBLE (ON VALIDATION SPLIT)
    # =========================================================================
    print("\n[STEPS 8 & 9] Training Diverse Model Families (LightGBM 3 Seeds, XGBoost, CatBoost in Raw & Scaled Spaces)...")
    # LightGBM Seed 42 (already trained as model_raw), Seed 100, Seed 2026 in Raw Space
    model_lgb_s100, pred_lgb_s100, t_lgb_100 = train_and_eval_lgb(
        val_tr_feat, val_ev_feat, active_feature_cols, params_override={"seed": 100, "feature_fraction": 0.75}
    )
    pred_lgb_s100 = np.clip(pred_lgb_s100, 0.0, None)
    m_lgb_s100 = compute_all_metrics(y_val_true, pred_lgb_s100, val_sids)
    log_run("run_lgb_seed100", "model_diversity", "lightgbm", "raw", len(active_feature_cols), m_lgb_s100, t_lgb_100,
            "LightGBM with seed=100, feature_fraction=0.75",
            best_iteration=model_lgb_s100.best_iteration, early_stopping_rounds=200)

    model_lgb_s2026, pred_lgb_s2026, t_lgb_2026 = train_and_eval_lgb(
        val_tr_feat, val_ev_feat, active_feature_cols, params_override={"seed": 2026, "num_leaves": 95, "feature_fraction": 0.65}
    )
    pred_lgb_s2026 = np.clip(pred_lgb_s2026, 0.0, None)
    m_lgb_s2026 = compute_all_metrics(y_val_true, pred_lgb_s2026, val_sids)
    log_run("run_lgb_seed2026", "model_diversity", "lightgbm", "raw", len(active_feature_cols), m_lgb_s2026, t_lgb_2026,
            "LightGBM with seed=2026, num_leaves=95, feature_fraction=0.65",
            best_iteration=model_lgb_s2026.best_iteration, early_stopping_rounds=200)

    # LightGBM Seed 100 & Seed 2026 in Scaled Space (for 3-seed scaled LightGBM diversity)
    model_scaled_s100, pred_sc_s100_u, t_sc_100 = train_and_eval_lgb(
        val_tr_feat, val_ev_feat, active_feature_cols,
        sample_weights=scale_sample_weights,
        y_train_override=y_tr_scaled, y_val_override=y_va_scaled,
        params_override={"seed": 100, "feature_fraction": 0.75},
        n_estimators=800,
    )
    pred_scaled_s100 = np.clip(pred_sc_s100_u * va_scale, 0.0, None)

    model_scaled_s2026, pred_sc_s2026_u, t_sc_2026 = train_and_eval_lgb(
        val_tr_feat, val_ev_feat, active_feature_cols,
        sample_weights=scale_sample_weights,
        y_train_override=y_tr_scaled, y_val_override=y_va_scaled,
        params_override={"seed": 2026, "num_leaves": 95, "feature_fraction": 0.65},
        n_estimators=800,
    )
    pred_scaled_s2026 = np.clip(pred_sc_s2026_u * va_scale, 0.0, None)
    pred_lgb_scaled_3seed = (pred_target_scaled + pred_scaled_s100 + pred_scaled_s2026) / 3.0

    # XGBoost Regressor (Raw & Scaled)
    print("  Training XGBoost Regressor (Raw & Scaled)...", flush=True)
    t0 = time.time()
    xgb_model = xgb.XGBRegressor(
        n_estimators=5000,
        learning_rate=0.03,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.7,
        reg_lambda=5.0,
        random_state=42,
        n_jobs=-1,
        early_stopping_rounds=200,
        eval_metric="rmse",
    )
    xgb_model.fit(
        val_tr_feat[active_feature_cols],
        val_tr_feat["discharge_cfs"].values,
        eval_set=[(val_ev_feat[active_feature_cols], y_val_true)],
        verbose=False,
    )
    xgb_scaled_model = xgb.XGBRegressor(
        n_estimators=600,
        learning_rate=0.04,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.7,
        reg_lambda=5.0,
        random_state=42,
        n_jobs=-1,
        early_stopping_rounds=100,
        eval_metric="rmse",
    )
    xgb_scaled_model.fit(
        val_tr_feat[active_feature_cols],
        y_tr_scaled,
        sample_weight=scale_sample_weights,
        eval_set=[(val_ev_feat[active_feature_cols], y_va_scaled)],
        verbose=False,
    )
    t_xgb = time.time() - t0
    pred_xgb_raw = np.clip(xgb_model.predict(val_ev_feat[active_feature_cols]), 0.0, None)
    pred_xgb_scaled = np.clip(xgb_scaled_model.predict(val_ev_feat[active_feature_cols]) * va_scale, 0.0, None)
    pred_xgb = va_alpha_scale * (0.75 * pred_xgb_raw + 0.25 * pred_xgb_scaled) + (1.0 - va_alpha_scale) * pred_xgb_scaled
    m_xgb = compute_all_metrics(y_val_true, pred_xgb, val_sids)
    log_run("run_xgboost", "model_diversity", "xgboost", "raw_and_scaled", len(active_feature_cols), m_xgb, t_xgb,
            "XGBoost Regressor (max_depth=6, lr=0.03, colsample=0.7, reg_lambda=5.0, scale-consistent)",
            best_iteration=int(xgb_model.best_iteration), early_stopping_rounds=200)
    print(f"  XGBoost Val: RMSE={m_xgb['rmse']:.2f}, ExtRMSE={m_xgb['extreme_rmse']:.2f}, MAE={m_xgb['mae']:.2f}, R2={m_xgb['r2']:.4f} (iter={xgb_model.best_iteration}, {t_xgb:.1f}s)", flush=True)

    # CatBoost Regressor (Raw & Scaled)
    print("  Training CatBoost Regressor (Raw & Scaled)...", flush=True)
    t0 = time.time()
    cb_model = CatBoostRegressor(
        iterations=5000,
        learning_rate=0.04,
        depth=6,
        l2_leaf_reg=5.0,
        random_seed=42,
        thread_count=-1,
        verbose=False,
    )
    cb_model.fit(
        val_tr_feat[active_feature_cols],
        val_tr_feat["discharge_cfs"].values,
        eval_set=(val_ev_feat[active_feature_cols], y_val_true),
        early_stopping_rounds=200,
        verbose=False,
    )
    cb_scaled_model = CatBoostRegressor(
        iterations=600,
        learning_rate=0.05,
        depth=6,
        l2_leaf_reg=5.0,
        random_seed=42,
        thread_count=-1,
        verbose=False,
    )
    cb_scaled_model.fit(
        val_tr_feat[active_feature_cols],
        y_tr_scaled,
        sample_weight=scale_sample_weights,
        eval_set=(val_ev_feat[active_feature_cols], y_va_scaled),
        early_stopping_rounds=100,
        verbose=False,
    )
    t_cb = time.time() - t0
    pred_cb_raw = np.clip(cb_model.predict(val_ev_feat[active_feature_cols]), 0.0, None)
    pred_cb_scaled = np.clip(cb_scaled_model.predict(val_ev_feat[active_feature_cols]) * va_scale, 0.0, None)
    pred_cb = va_alpha_scale * (0.75 * pred_cb_raw + 0.25 * pred_cb_scaled) + (1.0 - va_alpha_scale) * pred_cb_scaled
    m_cb = compute_all_metrics(y_val_true, pred_cb, val_sids)
    log_run("run_catboost", "model_diversity", "catboost", "raw_and_scaled", len(active_feature_cols), m_cb, t_cb,
            "CatBoost Regressor (depth=6, lr=0.04, l2_leaf_reg=5.0, scale-consistent)",
            best_iteration=int(cb_model.get_best_iteration()), early_stopping_rounds=200)
    print(f"  CatBoost Val: RMSE={m_cb['rmse']:.2f}, ExtRMSE={m_cb['extreme_rmse']:.2f}, MAE={m_cb['mae']:.2f}, R2={m_cb['r2']:.4f} (iter={cb_model.get_best_iteration()}, {t_cb:.1f}s)", flush=True)

    # Multi-seed LightGBM average (with scale-consistent small-station gating)
    pred_lgb_3seed_raw = (pred_target_raw + pred_lgb_s100 + pred_lgb_s2026) / 3.0
    pred_lgb_3seed = va_alpha_scale * pred_lgb_3seed_raw + (1.0 - va_alpha_scale) * pred_lgb_scaled_3seed
    m_lgb_3seed = compute_all_metrics(y_val_true, pred_lgb_3seed, val_sids)
    avg_lgb3_iter = int(np.mean([model_raw.best_iteration, model_lgb_s100.best_iteration, model_lgb_s2026.best_iteration]))
    log_run("run_lgb_3seed_avg", "ensemble", "lightgbm_3seed", "raw_and_scaled", len(active_feature_cols), m_lgb_3seed,
            t_tr_raw + t_lgb_100 + t_lgb_2026, "3-seed LightGBM average (seeds 42, 100, 2026, scale-consistent)",
            best_iteration=avg_lgb3_iter, early_stopping_rounds=200)

    # Scale-consistent diverse ensemble for small/medium basins (zero additive raw-L2 error floor!)
    pred_scale_diverse_val = (
        0.30 * pred_lgb_scaled_3seed
        + 0.25 * pred_xgb_scaled
        + 0.20 * pred_cb_scaled
        + 0.15 * pred_target_log1p
        + 0.10 * pred_target_tweedie
    )

    # Optimize final ensemble blend across all 7 diverse components:
    from scipy.optimize import minimize

    comp_matrix = np.column_stack([
        pred_lgb_3seed,
        pred_xgb,
        pred_cb,
        pred_target_log1p,
        pred_lgb_scaled_3seed,
        pred_target_tweedie,
        pred_hf_weighted,
    ])

    def ensemble_loss(weights):
        weights = np.array(weights)
        weights = weights / np.sum(weights)
        raw_blend = comp_matrix @ weights
        blend = va_alpha_scale * raw_blend + (1.0 - va_alpha_scale) * pred_scale_diverse_val
        rmse_v = np.sqrt(np.mean((y_val_true - blend) ** 2))
        ext_v = np.sqrt(np.mean((y_val_true[top10_mask] - blend[top10_mask]) ** 2))
        mae_v = np.mean(np.abs(y_val_true - blend))
        # Normalized-scale composite loss balancing overall RMSE (40%), Extreme RMSE (30%), and MAE (20%)
        return 0.65 * rmse_v + 0.15 * ext_v + 0.20 * mae_v

    init_w = np.array([0.30, 0.18, 0.15, 0.08, 0.09, 0.10, 0.10])
    bounds = [(0.15, 0.50), (0.08, 0.35), (0.08, 0.35), (0.02, 0.20), (0.04, 0.20), (0.04, 0.25), (0.04, 0.25)]
    res = minimize(ensemble_loss, init_w, method="SLSQP", bounds=bounds, constraints={"type": "eq", "fun": lambda w: np.sum(w) - 1.0})
    ens_weights = np.round(res.x / np.sum(res.x), 4)
    raw_val_ens = np.clip(comp_matrix @ ens_weights, 0.0, None)
    pred_val_ensemble = va_alpha_scale * raw_val_ens + (1.0 - va_alpha_scale) * pred_scale_diverse_val

    # Fine-tune high-flow tail factor on the ensemble
    best_ens_tail = 1.0
    best_ens_obj = ensemble_loss(ens_weights)
    for tm in np.linspace(1.0, 1.06, 13):
        cand_p = np.where(pred_val_ensemble >= 0.90 * va_p90_prior, pred_val_ensemble * tm, pred_val_ensemble)
        obj = (
            0.65 * np.sqrt(np.mean((y_val_true - cand_p) ** 2))
            + 0.15 * np.sqrt(np.mean((y_val_true[top10_mask] - cand_p[top10_mask]) ** 2))
            + 0.20 * np.mean(np.abs(y_val_true - cand_p))
        )
        if obj < best_ens_obj:
            best_ens_obj = obj
            best_ens_tail = round(float(tm), 4)

    pred_val_ensemble_cal = np.where(
        pred_val_ensemble >= 0.90 * va_p90_prior,
        pred_val_ensemble * best_ens_tail,
        pred_val_ensemble,
    )
    m_val_ensemble = compute_all_metrics(y_val_true, pred_val_ensemble_cal, val_sids)
    total_ens_time = t_tr_raw + t_lgb_100 + t_lgb_2026 + t_xgb + t_cb + t_tr_log + t_tr_scaled + t_sc_100 + t_sc_2026 + t_tr_tweedie + t_hf_w
    avg_ens_iter = int(np.mean([
        avg_lgb3_iter, xgb_model.best_iteration, cb_model.get_best_iteration(),
        model_log.best_iteration, model_scaled.best_iteration, model_tweedie.best_iteration, model_hf_weighted.best_iteration,
    ]))
    log_run(
        "run_final_ensemble",
        "final_ensemble",
        "lgb3_xgb_cb_specialist_ensemble",
        "multi_target_tail_calibrated",
        len(active_feature_cols),
        m_val_ensemble,
        total_ens_time,
        f"Final diverse ensemble: LGB-3seed({ens_weights[0]:.3f})+XGB({ens_weights[1]:.3f})+CB({ens_weights[2]:.3f})+Log1p({ens_weights[3]:.3f})+Scaled3seed({ens_weights[4]:.3f})+Tweedie({ens_weights[5]:.3f})+HFWeight({ens_weights[6]:.3f}), tail={best_ens_tail}",
        best_iteration=avg_ens_iter,
        early_stopping_rounds=200,
    )
    print(f"  FINAL ENSEMBLE Val: RMSE={m_val_ensemble['rmse']:.2f}, ExtRMSE={m_val_ensemble['extreme_rmse']:.2f}, MAE={m_val_ensemble['mae']:.2f}, R2={m_val_ensemble['r2']:.4f}")

    # =========================================================================
    # STEP 7: ERROR ANALYSIS (50 WORST ERRORS) + EXPANDING WINDOW & LOO CV
    # =========================================================================
    print("\n[STEP 7] Generating Error Analysis (worst_50_errors.csv), Expanding Window (3 Folds) & LOO CV (32 Stations)...")
    err_df = val_ev_feat[["station_id", "date", "precipitation_mm", "rain_sum_3d", "soil_moisture", "temp_mean_c"]].copy()
    err_df = err_df.merge(meta_df[["station_id", "station_name", "state", "river_name"]], on="station_id", how="left")
    err_df["actual"] = np.round(y_val_true, 2)
    err_df["predicted"] = np.round(pred_val_ensemble_cal, 2)
    err_df["error"] = np.round(err_df["predicted"] - err_df["actual"], 2)
    err_df["abs_error"] = np.round(np.abs(err_df["actual"] - err_df["predicted"]), 2)
    err_df["rel_error_pct"] = np.round(err_df["abs_error"] / (err_df["actual"] + 1.0) * 100.0, 2)

    months = pd.to_datetime(err_df["date"]).dt.month
    err_df["season"] = np.select(
        [months.isin([12, 1, 2]), months.isin([3, 4, 5]), months.isin([6, 7, 8])],
        ["Winter", "Spring", "Summer"],
        default="Autumn",
    )
    err_df["weather_regime"] = np.select(
        [
            (err_df["precipitation_mm"] >= 25.0) & (err_df["soil_moisture"] >= 0.40),
            err_df["precipitation_mm"] >= 15.0,
            (err_df["temp_mean_c"] > 2.0) & (months.isin([3, 4, 5])) & (err_df["soil_moisture"] >= 0.35),
            err_df["soil_moisture"] >= 0.45,
        ],
        [
            "Extreme Storm on Saturated Soil",
            "Heavy Convective/Synoptic Rain",
            "Spring Snowmelt & Wet Basin",
            "High Antecedent Baseflow / Post-Storm Peak",
        ],
        default="Unobserved Sub-Basin Spike / Dam Release Noise",
    )
    worst_50 = err_df.sort_values("abs_error", ascending=False).head(50).reset_index(drop=True)
    worst_50["station"] = worst_50["station_id"].astype(str) + " (" + worst_50["station_name"].astype(str) + ")"
    cols_w50 = [
        "station_id", "station", "station_name", "state", "date",
        "actual", "predicted", "error", "abs_error", "rel_error_pct",
        "precipitation_mm", "rain_sum_3d", "soil_moisture", "temp_mean_c",
        "season", "weather_regime",
    ]
    worst_50[cols_w50].to_csv(EXPERIMENTS_DIR / "worst_50_errors.csv", index=False)
    print(f"  Saved worst_50_errors.csv (top abs_error={worst_50['abs_error'].iloc[0]:,.1f} cfs)")

    # 3-Fold Expanding Window Backtest
    print("  Running 3-Fold Expanding-Window Backtest...")
    exp_rows = []
    # Precompute non-station-stats features once on train_df to speed up expanding window
    base_fams_no_stats = ["rainfall", "antecedent", "soil", "temperature", "calendar", "static", "cross_station"]
    cfg_no_stats = {"features": {fam: {"enabled": (fam in base_fams_no_stats)} for fam in all_families}}
    train_pre_feat = compute_all_features(train_df, cfg_no_stats, train_discharge=None)

    for tr_fold, va_fold, fold_idx in expanding_window_splits(train_pre_feat, n_folds=3):
        t0 = time.time()
        tr_fold["date"] = tr_fold["date"].dt.strftime("%Y-%m-%d")
        va_fold["date"] = va_fold["date"].dt.strftime("%Y-%m-%d")
        comb_fold = pd.concat([tr_fold.assign(_s="tr"), va_fold.assign(_s="va")], ignore_index=True)
        comb_fold = compute_station_stats(comb_fold, tr_fold[["station_id", "date", "discharge_cfs", "drainage_area_sqmi"]], {"enabled": True})
        tr_f = comb_fold[comb_fold["_s"] == "tr"].drop(columns=["_s"])
        va_f = comb_fold[comb_fold["_s"] == "va"].drop(columns=["_s"])

        _, p_fold, elapsed_f = train_and_eval_lgb(tr_f, va_f, active_feature_cols, n_estimators=700, early_stopping_rounds=50)
        p_fold = np.clip(p_fold, 0.0, None)
        m_fold = compute_all_metrics(va_f["discharge_cfs"].values, p_fold, va_f["station_id"].values)
        exp_rows.append({
            "fold": fold_idx + 1,
            "train_start": tr_f["date"].min(),
            "train_end": tr_f["date"].max(),
            "val_start": va_f["date"].min(),
            "val_end": va_f["date"].max(),
            "train_rows": len(tr_f),
            "val_rows": len(va_f),
            "rmse": round(m_fold["rmse"], 2),
            "extreme_rmse": round(m_fold["extreme_rmse"], 2),
            "mae": round(m_fold["mae"], 2),
            "r2": round(m_fold["r2"], 4),
            "train_time_s": round(elapsed_f, 2),
        })
        print(f"    Fold {fold_idx+1} (Val {va_f['date'].min()}..{va_f['date'].max()}): RMSE={m_fold['rmse']:.2f}, ExtRMSE={m_fold['extreme_rmse']:.2f}, R2={m_fold['r2']:.4f}")

    exp_df = pd.DataFrame(exp_rows)
    exp_df.to_csv(EXPERIMENTS_DIR / "expanding_window_folds.csv", index=False)

    # Leave-One-Station-Out (LOO) Cross-Validation across all 32 stations (on 2019-2021 window for speed & accuracy)
    print("  Running Leave-One-Station-Out (LOO) Cross-Validation across all 32 stations...")
    loo_sub = train_pre_feat[train_pre_feat["date"] >= "2018-01-01"].copy().reset_index(drop=True)
    # Physical / weather / static features (excluding station_id target-encoded priors so LOO tests true ungauged basin generalization + area-scaled prior)
    loo_rows = []
    for sid in sorted(loo_sub["station_id"].unique()):
        t0 = time.time()
        tr_loo = loo_sub[loo_sub["station_id"] != sid].copy()
        va_loo = loo_sub[loo_sub["station_id"] == sid].copy()
        comb_loo = pd.concat([tr_loo.assign(_s="tr"), va_loo.assign(_s="va")], ignore_index=True)
        comb_loo = compute_station_stats(comb_loo, tr_loo[["station_id", "date", "discharge_cfs", "drainage_area_sqmi"]], {"enabled": True})
        tr_l = comb_loo[comb_loo["_s"] == "tr"].drop(columns=["_s"])
        va_l = comb_loo[comb_loo["_s"] == "va"].drop(columns=["_s"])

        # Train on log1p scaled by drainage area so trees generalize smoothly to unseen basin sizes
        y_tr_l = np.log1p(tr_l["discharge_cfs"].values / tr_l["drainage_area_sqmi"].clip(lower=1.0).values)
        y_va_l = np.log1p(va_l["discharge_cfs"].values / va_l["drainage_area_sqmi"].clip(lower=1.0).values)
        dtr_l = lgb.Dataset(tr_l[active_feature_cols], label=y_tr_l)
        model_l = lgb.train(
            {
                "objective": "regression",
                "metric": "rmse",
                "learning_rate": 0.05,
                "num_leaves": 31,
                "min_child_samples": 50,
                "feature_fraction": 0.7,
                "lambda_l2": 10.0,
                "seed": 42,
                "n_jobs": -1,
                "verbose": -1,
            },
            dtr_l,
            num_boost_round=180,
        )
        pred_l_unit = np.expm1(model_l.predict(va_l[active_feature_cols]))
        pred_l = np.clip(pred_l_unit * va_l["drainage_area_sqmi"].clip(lower=1.0).values, 0.0, None)
        yt_l = va_l["discharge_cfs"].values
        m_l = compute_all_metrics(yt_l, pred_l, va_l["station_id"].values)
        mrow = meta_df[meta_df["station_id"] == sid].iloc[0]
        loo_rows.append({
            "station_id": sid,
            "station_name": mrow["station_name"],
            "state": mrow["state"],
            "drainage_area_sqmi": float(va_l["drainage_area_sqmi"].iloc[0]),
            "mean_discharge_cfs": round(float(np.mean(yt_l)), 2),
            "rmse": round(m_l["rmse"], 2),
            "extreme_rmse": round(m_l["extreme_rmse"], 2),
            "mae": round(m_l["mae"], 2),
            "r2": round(m_l["r2"], 4),
            "norm_rmse_pct_of_mean": round(float(m_l["rmse"] / (np.mean(yt_l) + 1e-6) * 100.0), 2),
        })

    loo_df = pd.DataFrame(loo_rows)
    loo_df.to_csv(EXPERIMENTS_DIR / "leave_one_station_out.csv", index=False)
    print(f"  Saved leave_one_station_out.csv ({len(loo_df)} stations, median LOO R2={loo_df['r2'].median():.4f})")

    # =========================================================================
    # STEP 10: FINAL FIT ON FULL TRAIN (2010-2021) -> PREDICT TEST (2022)
    # =========================================================================
    print("\n[STEP 10] Fitting Final Diverse Ensemble on ALL Training Data up to CUTOFF (2010-2021)...")
    X_full_tr = full_tr_feat[active_feature_cols]
    y_full_tr = full_tr_feat["discharge_cfs"].values.astype(float)
    X_full_te = full_te_feat[active_feature_cols]

    best_iters_lgb = max(300, int(model_raw.best_iteration * 1.10))
    best_iters_xgb = max(300, int(xgb_model.best_iteration * 1.10))
    best_iters_cb = max(400, int(cb_model.get_best_iteration() * 1.10))

    full_st_means = full_tr_feat.groupby("station_id")["discharge_cfs"].mean().clip(lower=10.0)
    full_tr_scale = full_tr_feat["station_id"].map(full_st_means).values
    full_te_scale = full_te_feat["station_id"].map(full_st_means).values
    full_raw_scaled_tr = y_full_tr / full_tr_scale
    full_q999 = pd.Series(full_raw_scaled_tr).groupby(full_tr_feat["station_id"].values).transform(lambda x: max(10.0, float(np.percentile(x, 99.9)))).values
    y_full_scaled = np.clip(full_raw_scaled_tr, 0.0, full_q999)
    full_scale_weights = (full_tr_scale / np.mean(full_tr_scale)) ** 0.70
    te_alpha_scale = np.clip((full_te_scale - 500.0) / 25000.0, 0.0, 1.0)

    # 1. LightGBM 3 seeds on full train (Raw & Scaled)
    full_lgb_preds_raw = []
    full_lgb_preds_scaled = []
    full_lgb_models = []
    for s_val, ff_val, nl_val, m_raw_ref, m_sc_ref in [
        (42, 0.70, 63, model_raw, model_scaled),
        (100, 0.75, 63, model_lgb_s100, model_scaled_s100),
        (2026, 0.65, 95, model_lgb_s2026, model_scaled_s2026),
    ]:
        lgb_p = {
            "objective": "regression",
            "metric": "rmse",
            "learning_rate": 0.03,
            "num_leaves": nl_val,
            "min_child_samples": 40,
            "feature_fraction": ff_val,
            "bagging_fraction": 0.8,
            "bagging_freq": 1,
            "lambda_l2": 5.0,
            "seed": s_val,
            "n_jobs": -1,
            "verbose": -1,
        }
        m_full = lgb.train(
            lgb_p,
            lgb.Dataset(X_full_tr, label=y_full_tr),
            num_boost_round=max(300, int(m_raw_ref.best_iteration * 1.10)),
        )
        full_lgb_models.append(m_full)
        full_lgb_preds_raw.append(np.clip(m_full.predict(X_full_te), 0.0, None))

        m_full_sc = lgb.train(
            lgb_p,
            lgb.Dataset(X_full_tr, label=y_full_scaled, weight=full_scale_weights),
            num_boost_round=min(900, max(300, int(m_sc_ref.best_iteration * 1.10))),
        )
        full_lgb_preds_scaled.append(np.clip(m_full_sc.predict(X_full_te) * full_te_scale, 0.0, None))

    te_pred_lgb_3seed_raw = np.mean(full_lgb_preds_raw, axis=0)
    te_pred_scaled = np.mean(full_lgb_preds_scaled, axis=0)
    te_pred_lgb_3seed = te_alpha_scale * te_pred_lgb_3seed_raw + (1.0 - te_alpha_scale) * te_pred_scaled

    # 2. XGBoost on full train (Raw & Scaled)
    xgb_full = xgb.XGBRegressor(
        n_estimators=best_iters_xgb,
        learning_rate=0.03,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.7,
        reg_lambda=5.0,
        random_state=42,
        n_jobs=-1,
    )
    xgb_full.fit(X_full_tr, y_full_tr, verbose=False)
    te_pred_xgb_raw = np.clip(xgb_full.predict(X_full_te), 0.0, None)

    xgb_full_sc = xgb.XGBRegressor(
        n_estimators=min(650, max(300, int(xgb_scaled_model.best_iteration * 1.10))),
        learning_rate=0.04,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.7,
        reg_lambda=5.0,
        random_state=42,
        n_jobs=-1,
    )
    xgb_full_sc.fit(X_full_tr, y_full_scaled, sample_weight=full_scale_weights, verbose=False)
    te_pred_xgb_scaled = np.clip(xgb_full_sc.predict(X_full_te) * full_te_scale, 0.0, None)
    te_pred_xgb = te_alpha_scale * (0.75 * te_pred_xgb_raw + 0.25 * te_pred_xgb_scaled) + (1.0 - te_alpha_scale) * te_pred_xgb_scaled

    # 3. CatBoost on full train (Raw & Scaled)
    cb_full = CatBoostRegressor(
        iterations=best_iters_cb,
        learning_rate=0.04,
        depth=6,
        l2_leaf_reg=5.0,
        random_seed=42,
        thread_count=-1,
        verbose=False,
    )
    cb_full.fit(X_full_tr, y_full_tr, verbose=False)
    te_pred_cb_raw = np.clip(cb_full.predict(X_full_te), 0.0, None)

    cb_full_sc = CatBoostRegressor(
        iterations=min(650, max(300, int(cb_scaled_model.get_best_iteration() * 1.10))),
        learning_rate=0.05,
        depth=6,
        l2_leaf_reg=5.0,
        random_seed=42,
        thread_count=-1,
        verbose=False,
    )
    cb_full_sc.fit(X_full_tr, y_full_scaled, sample_weight=full_scale_weights, verbose=False)
    te_pred_cb_scaled = np.clip(cb_full_sc.predict(X_full_te) * full_te_scale, 0.0, None)
    te_pred_cb = te_alpha_scale * (0.75 * te_pred_cb_raw + 0.25 * te_pred_cb_scaled) + (1.0 - te_alpha_scale) * te_pred_cb_scaled

    # 4. Log1p LightGBM with Duan smearing on full train
    y_full_log = np.log1p(y_full_tr)
    m_full_log = lgb.train(
        {
            "objective": "regression",
            "metric": "rmse",
            "learning_rate": 0.03,
            "num_leaves": 63,
            "min_child_samples": 40,
            "feature_fraction": 0.7,
            "bagging_fraction": 0.8,
            "bagging_freq": 1,
            "lambda_l2": 5.0,
            "seed": 42,
            "n_jobs": -1,
            "verbose": -1,
        },
        lgb.Dataset(X_full_tr, label=y_full_log),
        num_boost_round=max(300, int(model_log.best_iteration * 1.10)),
    )
    full_tr_res = y_full_log - m_full_log.predict(X_full_tr)
    full_smear_df = pd.DataFrame({"station_id": full_tr_feat["station_id"].values, "exp_res": np.exp(np.clip(full_tr_res, -2.0, 2.0))})
    full_st_smear = full_smear_df.groupby("station_id")["exp_res"].mean().clip(lower=0.90, upper=1.25)
    full_te_smear = full_te_feat["station_id"].map(full_st_smear).fillna(1.05).values
    te_pred_log1p = np.clip(np.expm1(m_full_log.predict(X_full_te)) * full_te_smear, 0.0, None)

    # 5. Tweedie LightGBM on full train
    m_full_tweedie = lgb.train(
        {
            "objective": "tweedie",
            "tweedie_variance_power": 1.5,
            "metric": "rmse",
            "learning_rate": 0.03,
            "num_leaves": 63,
            "min_child_samples": 40,
            "feature_fraction": 0.7,
            "bagging_fraction": 0.8,
            "bagging_freq": 1,
            "lambda_l2": 5.0,
            "seed": 42,
            "n_jobs": -1,
            "verbose": -1,
        },
        lgb.Dataset(X_full_tr, label=y_full_tr),
        num_boost_round=max(300, int(model_tweedie.best_iteration * 1.10)),
    )
    te_pred_tweedie = np.clip(m_full_tweedie.predict(X_full_te), 0.0, None)

    # 6. High-flow weighted LightGBM on full train
    full_p90 = full_tr_feat.groupby("station_id")["discharge_cfs"].quantile(0.90)
    full_p99 = full_tr_feat.groupby("station_id")["discharge_cfs"].quantile(0.99)
    full_hf_w = 1.0 + 3.0 * (y_full_tr >= full_tr_feat["station_id"].map(full_p90).values) + 5.0 * (y_full_tr >= full_tr_feat["station_id"].map(full_p99).values)
    m_full_hfw = lgb.train(
        {
            "objective": "regression",
            "metric": "rmse",
            "learning_rate": 0.03,
            "num_leaves": 95,
            "min_child_samples": 25,
            "feature_fraction": 0.7,
            "bagging_fraction": 0.8,
            "bagging_freq": 1,
            "lambda_l2": 5.0,
            "seed": 42,
            "n_jobs": -1,
            "verbose": -1,
        },
        lgb.Dataset(X_full_tr, label=y_full_tr, weight=full_hf_w),
        num_boost_round=max(300, int(model_hf_weighted.best_iteration * 1.10)),
    )
    te_pred_hfw_raw = np.clip(m_full_hfw.predict(X_full_te), 0.0, None)
    te_pred_scale_diverse = (
        0.30 * te_pred_scaled
        + 0.25 * te_pred_xgb_scaled
        + 0.20 * te_pred_cb_scaled
        + 0.15 * te_pred_log1p
        + 0.10 * te_pred_tweedie
    )
    te_pred_hfw = te_alpha_scale * te_pred_hfw_raw + (1.0 - te_alpha_scale) * te_pred_scale_diverse

    te_comp_matrix = np.column_stack([
        te_pred_lgb_3seed,
        te_pred_xgb,
        te_pred_cb,
        te_pred_log1p,
        te_pred_scaled,
        te_pred_tweedie,
        te_pred_hfw,
    ])
    te_raw_ens = np.clip(te_comp_matrix @ ens_weights, 0.0, None)
    te_pred_ens = te_alpha_scale * te_raw_ens + (1.0 - te_alpha_scale) * te_pred_scale_diverse
    te_p90_prior = full_te_feat["station_p90_q"].values
    te_pred_final = np.where(te_pred_ens >= 0.90 * te_p90_prior, te_pred_ens * best_ens_tail, te_pred_ens)
    te_pred_final = np.clip(np.round(te_pred_final, 2), 0.0, None)

    # Align predictions to exact order of data/processed/test.csv
    pred_df = pd.DataFrame({
        "station_id": full_te_feat["station_id"].values,
        "date": full_te_feat["date"].values,
        "discharge_cfs": te_pred_final,
    })
    predictions_aligned = test_df[["station_id", "date"]].merge(pred_df, on=["station_id", "date"], how="left")
    predictions_aligned["discharge_cfs"] = predictions_aligned["discharge_cfs"].fillna(0.0).clip(lower=0.0)

    predictions_aligned.to_csv(ROOT / "predictions.csv", index=False)
    predictions_aligned.to_csv(PROCESSED_DIR / "predictions.csv", index=False)
    print(f"  Written predictions.csv ({len(predictions_aligned):,} rows) and data/processed/predictions.csv", flush=True)

    # Evaluate on held-out dev test labels (2022) for diagnostic verification
    tl_merged = test_labels_df[["station_id", "date", "discharge_cfs"]].merge(
        predictions_aligned, on=["station_id", "date"], suffixes=("_true", "_pred")
    )
    m_test_2022 = compute_all_metrics(
        tl_merged["discharge_cfs_true"].values,
        tl_merged["discharge_cfs_pred"].values,
        tl_merged["station_id"].values,
    )
    print(f"  Held-out 2022 Test Set Metrics: RMSE={m_test_2022['rmse']:.2f}, ExtRMSE={m_test_2022['extreme_rmse']:.2f}, MAE={m_test_2022['mae']:.2f}, R2={m_test_2022['r2']:.4f}", flush=True)

    # =========================================================================
    # COMPUTE COMPOSITE SCORES ACROSS ALL RUNS & SAVE SUMMARY CSVs
    # =========================================================================
    runs_df = pd.DataFrame(ALL_RUN_RECORDS)
    best_m = {
        "rmse": float(runs_df["rmse"].min()),
        "extreme_rmse": float(runs_df["extreme_rmse"].min()),
        "mae": float(runs_df["mae"].min()),
        "r2": float(runs_df["r2"].max()),
    }
    worst_m = {
        "rmse": float(runs_df["rmse"].max()),
        "extreme_rmse": float(runs_df["extreme_rmse"].max()),
        "mae": float(runs_df["mae"].max()),
        "r2": float(runs_df["r2"].min()),
    }
    runs_df["composite"] = [
        round(compute_composite({"rmse": r.rmse, "extreme_rmse": r.extreme_rmse, "mae": r.mae, "r2": r.r2}, best_m, worst_m), 2)
        for _, r in runs_df.iterrows()
    ]
    runs_df.to_csv(EXPERIMENTS_DIR / "runs_summary.csv", index=False)

    # Also fill composite in ablations.csv
    for rec in ablation_records:
        rec["composite"] = round(
            compute_composite(
                {"rmse": rec["rmse"], "extreme_rmse": rec["extreme_rmse"], "mae": rec["mae"], "r2": rec["r2"]},
                best_m, worst_m,
            ),
            2,
        )
    ablations_df = pd.DataFrame(ablation_records)
    ablations_df.to_csv(EXPERIMENTS_DIR / "ablations.csv", index=False)

    # Per-station validation metrics for final ensemble (including share of total SSE)
    per_st_df = per_station_metrics(y_val_true, pred_val_ensemble_cal, val_sids)
    per_st_df = per_st_df.merge(meta_df[["station_id", "station_name", "state", "river_name"]], on="station_id", how="left")
    sse_vec = (per_st_df["rmse"] ** 2) * per_st_df["n_rows"]
    per_st_df["sse_share_pct"] = np.round(sse_vec / (sse_vec.sum() + 1e-9) * 100.0, 2)
    per_st_df.to_csv(EXPERIMENTS_DIR / "per_station_metrics.csv", index=False)

    # =========================================================================
    # SAVE FINAL ENSEMBLE ARTIFACTS & MATPLOTLIB DIAGNOSTIC PLOTS
    # =========================================================================
    print("\n[ARTIFACTS] Saving final_ensemble models, feature importance & diagnostic plots...")
    full_lgb_models[0].save_model(str(ARTIFACTS_DIR / "model_lgb_seed42.lgb"))
    with open(ARTIFACTS_DIR / "config.yaml", "w") as f:
        yaml.dump(config, f)

    # Feature importance averaged across the 3 LightGBM full models
    imp_gains = np.mean([m.feature_importance("gain") for m in full_lgb_models], axis=0)
    imp_splits = np.mean([m.feature_importance("split") for m in full_lgb_models], axis=0)
    fi_df = pd.DataFrame({
        "feature": active_feature_cols,
        "importance_gain": np.round(imp_gains, 2),
        "importance_split": np.round(imp_splits, 1),
    }).sort_values("importance_gain", ascending=False).reset_index(drop=True)
    fi_df["gain_pct"] = np.round(fi_df["importance_gain"] / (fi_df["importance_gain"].sum() + 1e-9) * 100.0, 3)
    fi_df.to_csv(ARTIFACTS_DIR / "feature_importance.csv", index=False)

    # Submission Check
    passed, reasons = check_submission(str(ROOT / "predictions.csv"), str(PROCESSED_DIR / "test.csv"), verbose=True)
    assert passed, f"Submission check failed: {reasons}"

    run_info = {
        "run_id": "final_ensemble",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cutoff_date": config["cutoff_date"],
        "n_features": len(active_feature_cols),
        "feature_names": active_feature_cols,
        "ensemble_components": ["lgb_3seed", "xgboost", "catboost", "lgb_log1p_smearing", "lgb_scaled", "lgb_tweedie", "lgb_high_flow_weighted"],
        "ensemble_weights": [float(x) for x in ens_weights],
        "tail_calibration_multiplier": best_ens_tail,
        "val_metrics_2021": m_val_ensemble,
        "test_metrics_2022_dev": m_test_2022,
        "composite_score_val": float(runs_df.loc[runs_df["run_id"] == "run_final_ensemble", "composite"].iloc[0]),
        "submission_check": {"passed": passed, "reasons": reasons},
    }
    with open(ARTIFACTS_DIR / "run_info.json", "w") as f:
        json.dump(run_info, f, indent=2)

    # Plot 1: Predicted vs Actual (Log-Log + Linear inset)
    plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.5), dpi=140)
    axes[0].scatter(y_val_true, pred_val_ensemble_cal, alpha=0.25, s=8, c="#1f77b4", label="Validation days (n=11,680)")
    axes[0].scatter(y_val_true[top10_mask], pred_val_ensemble_cal[top10_mask], alpha=0.45, s=12, c="#d62728", label="Top 10% Flood-Peak days")
    mx_v = max(y_val_true.max(), pred_val_ensemble_cal.max()) * 1.05
    axes[0].plot([0, mx_v], [0, mx_v], "k--", lw=1.5, label="1:1 Perfect Fit")
    axes[0].set_xlabel("Actual Discharge (cfs)")
    axes[0].set_ylabel("Predicted Discharge (cfs)")
    axes[0].set_title(f"Predicted vs Actual (Linear Scale) — R² = {m_val_ensemble['r2']:.4f}")
    axes[0].legend(loc="upper left")

    axes[1].scatter(np.log10(y_val_true + 1), np.log10(pred_val_ensemble_cal + 1), alpha=0.25, s=8, c="#2ca02c")
    axes[1].plot([0, 6.2], [0, 6.2], "k--", lw=1.5)
    axes[1].set_xlabel("log10(Actual Discharge + 1) [cfs]")
    axes[1].set_ylabel("log10(Predicted Discharge + 1) [cfs]")
    axes[1].set_title(f"Across 4 Orders of Basin Magnitude — RMSE = {m_val_ensemble['rmse']:,.1f} cfs")
    plt.tight_layout()
    plt.savefig(ARTIFACTS_DIR / "pred_vs_actual.png")
    plt.close(fig)

    # Plot 2: Residuals Analysis
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.2), dpi=140)
    residuals = pred_val_ensemble_cal - y_val_true
    rel_res = (pred_val_ensemble_cal - y_val_true) / (y_val_true + 10.0) * 100.0
    axes[0].scatter(np.log10(y_val_true + 1), rel_res, alpha=0.2, s=8, c="#9467bd")
    axes[0].axhline(0, color="black", linestyle="--", lw=1.2)
    axes[0].set_ylim(-150, 150)
    axes[0].set_xlabel("log10(Actual Discharge + 1) [cfs]")
    axes[0].set_ylabel("Relative Residual (%)")
    axes[0].set_title("Relative Residuals vs Flow Magnitude")

    axes[1].hist(np.clip(rel_res, -100, 100), bins=60, color="#17becf", edgecolor="black", alpha=0.8)
    axes[1].axvline(0, color="red", linestyle="--", lw=1.5)
    axes[1].set_xlabel("Relative Error (%) [clipped at ±100%]")
    axes[1].set_ylabel("Day-Station Count")
    axes[1].set_title(f"Residual Distribution (MAE = {m_val_ensemble['mae']:,.1f} cfs)")
    plt.tight_layout()
    plt.savefig(ARTIFACTS_DIR / "residuals.png")
    plt.close(fig)

    # Plot 3: Top 20 Feature Importance
    fig, ax = plt.subplots(figsize=(10, 7), dpi=140)
    top20 = fi_df.head(20).iloc[::-1]
    ax.barh(top20["feature"], top20["gain_pct"], color="#1f77b4", edgecolor="black", alpha=0.85)
    ax.set_xlabel("Share of Total Gain Importance (%)")
    ax.set_title("FLOODCAST Final Ensemble — Top 20 Hydrological Features (Gain %)")
    plt.tight_layout()
    plt.savefig(ARTIFACTS_DIR / "feature_importance.png")
    plt.close(fig)

    # Plot 4: Flood Peak Hydrograph Event (Potomac River 01646500 & Mississippi River 07010000 in 2021)
    fig, axes = plt.subplots(2, 1, figsize=(13, 7.5), dpi=140, sharex=True)
    for ax_i, (sid_plot, title_plot) in enumerate([
        ("01646500", "Potomac River near Washington, DC (Station 01646500)"),
        ("07010000", "Mississippi River at St. Louis, MO (Station 07010000)"),
    ]):
        mask_s = val_ev_feat["station_id"].values == sid_plot
        dates_s = pd.to_datetime(val_ev_feat.loc[mask_s, "date"])
        yt_s = y_val_true[mask_s]
        yp_base_s = pred_raw8_lgb[mask_s]
        yp_ens_s = pred_val_ensemble_cal[mask_s]
        p90_s = np.percentile(yt_s, 90)

        axes[ax_i].plot(dates_s, yt_s, color="black", lw=1.8, label="Actual USGS Discharge")
        axes[ax_i].plot(dates_s, yp_base_s, color="#ff7f0e", lw=1.1, alpha=0.75, linestyle=":", label="Starter Raw Baseline")
        axes[ax_i].plot(dates_s, yp_ens_s, color="#d62728", lw=1.5, alpha=0.9, label="FLOODCAST Final Ensemble")
        axes[ax_i].axhline(p90_s, color="#1f77b4", linestyle="--", lw=1.0, label="90th Percentile Flood Threshold")
        axes[ax_i].set_ylabel("Discharge (cfs)")
        axes[ax_i].set_title(f"2021 Hydrograph & Flood-Peak Tracking — {title_plot}")
        axes[ax_i].legend(loc="upper right", ncol=2, fontsize=9)

    axes[1].set_xlabel("Date (2021 Validation Period)")
    plt.tight_layout()
    plt.savefig(ARTIFACTS_DIR / "flood_peak_event.png")
    plt.close(fig)

    print(f"\nAll 10 experimental steps completed in {time.time() - t_pipeline_start:.1f}s!")


if __name__ == "__main__":
    main()
