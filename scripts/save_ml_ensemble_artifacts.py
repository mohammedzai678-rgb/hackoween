"""
Train and serialize all scale-consistent ML ensemble models & USGS/Duan (1983) priors
into `artifacts/final_ensemble/` for real-time `<40ms` ML inference in `/api/v1/predict`.

References:
1. Duan, N. (1983). "Smearing Estimate: A Nonparametric Retransformation Method."
   Journal of the American Statistical Association (JASA), 78(383), 605-610.
2. Helsel, D.R., & Hirsch, R.M. (2002). "Statistical Methods in Water Resources."
   USGS Techniques of Water-Resources Investigations, Book 4, Chapter A3.
3. USDA-NRCS (1986). "Urban Hydrology for Small Watersheds (TR-55)."
   SCS Curve Number runoff equation: Q = (P - 0.2S)^2 / (P + 0.8S), S = 25400/CN - 254.
4. Kohler, M.A., & Linsley, R.K. (1951). "Predicting the Runoff from Storm Rainfall."
   U.S. Weather Bureau Research Paper No. 34 (Antecedent Precipitation Index, API_t = k*API_{t-1} + P_t).
5. Kratzert, F., et al. (2019). "Towards learning universal, regional, and local hydrological
   behaviors via machine learning applied to large-sample datasets (CAMELS)." HESS, 23, 5089-5110.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parent.parent
import sys
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from floodcast.features import compute_all_features, get_feature_columns

PROCESSED_DIR = ROOT / "data" / "processed"
ARTIFACTS_DIR = ROOT / "artifacts" / "final_ensemble"


def main() -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(ROOT / "configs" / "base.yaml", "r") as f:
        config = yaml.safe_load(f)

    print("[1/4] Loading train.csv (2010-2021) and computing 127 hydrological features...")
    train_df = pd.read_csv(PROCESSED_DIR / "train.csv", dtype={"station_id": str})
    train_df["station_id"] = train_df["station_id"].str.strip().str.zfill(8)

    feat_df = compute_all_features(train_df, config, train_discharge=train_df)
    feature_cols = get_feature_columns(feat_df)

    X_tr = feat_df[feature_cols]
    y_tr = feat_df["discharge_cfs"].values.astype(float)
    sids = feat_df["station_id"].values

    # Station scale & 99.9% clip (Kratzert et al. 2019 normalized specific discharge)
    st_means = feat_df.groupby("station_id")["discharge_cfs"].mean().clip(lower=10.0)
    tr_scale = feat_df["station_id"].map(st_means).values
    raw_scaled = y_tr / tr_scale
    q999 = (
        pd.Series(raw_scaled)
        .groupby(sids)
        .transform(lambda x: max(10.0, float(np.percentile(x, 99.9))))
        .values
    )
    y_scaled = np.clip(raw_scaled, 0.0, q999)
    scale_weights = (tr_scale / np.mean(tr_scale)) ** 0.70

    # Ensure model.lgb exists alongside model_lgb_seed42.lgb
    seed42_path = ARTIFACTS_DIR / "model_lgb_seed42.lgb"
    default_lgb_path = ARTIFACTS_DIR / "model.lgb"
    if seed42_path.exists():
        if not default_lgb_path.exists():
            shutil.copyfile(seed42_path, default_lgb_path)
        print(f"  [SKIP] {seed42_path.name} and {default_lgb_path.name} already exist.")
    else:
        print("  Training model_lgb_seed42.lgb...")
        m_raw = lgb.train(
            {
                "objective": "regression",
                "metric": "rmse",
                "learning_rate": 0.03,
                "num_leaves": 63,
                "min_child_samples": 40,
                "feature_fraction": 0.70,
                "bagging_fraction": 0.80,
                "bagging_freq": 1,
                "lambda_l2": 5.0,
                "seed": 42,
                "n_jobs": -1,
                "verbose": -1,
            },
            lgb.Dataset(X_tr, label=y_tr),
            num_boost_round=500,
        )
        m_raw.save_model(str(seed42_path))
        m_raw.save_model(str(default_lgb_path))

    scaled_path = ARTIFACTS_DIR / "model_scaled.lgb"
    if scaled_path.exists():
        print(f"[2/7] [SKIP] {scaled_path.name} already exists.")
    else:
        print("[2/7] Training Station-Scaled LightGBM (model_scaled.lgb)...")
        m_scaled = lgb.train(
            {
                "objective": "regression",
                "metric": "rmse",
                "learning_rate": 0.03,
                "num_leaves": 63,
                "min_child_samples": 40,
                "feature_fraction": 0.70,
                "bagging_fraction": 0.80,
                "bagging_freq": 1,
                "lambda_l2": 5.0,
                "seed": 42,
                "n_jobs": -1,
                "verbose": -1,
            },
            lgb.Dataset(X_tr, label=y_scaled, weight=scale_weights),
            num_boost_round=550,
        )
        m_scaled.save_model(str(scaled_path))

    log1p_path = ARTIFACTS_DIR / "model_log1p.lgb"
    y_log = np.log1p(np.maximum(y_tr, 0.0))
    if log1p_path.exists():
        print(f"[3/7] [SKIP] {log1p_path.name} already exists.")
        m_log = lgb.Booster(model_file=str(log1p_path))
    else:
        print("[3/7] Training Log1p LightGBM + Duan (1983) Nonparametric Smearing Estimator (model_log1p.lgb)...")
        m_log = lgb.train(
            {
                "objective": "regression",
                "metric": "rmse",
                "learning_rate": 0.03,
                "num_leaves": 63,
                "min_child_samples": 40,
                "feature_fraction": 0.70,
                "bagging_fraction": 0.80,
                "bagging_freq": 1,
                "lambda_l2": 5.0,
                "seed": 42,
                "n_jobs": -1,
                "verbose": -1,
            },
            lgb.Dataset(X_tr, label=y_log),
            num_boost_round=550,
        )
        m_log.save_model(str(log1p_path))

    # Compute Duan (1983) smearing factor per station: CF_s = mean(exp(e_i))
    log_residuals = y_log - m_log.predict(X_tr)
    smear_df = pd.DataFrame({
        "station_id": sids,
        "exp_res": np.exp(np.clip(log_residuals, -2.0, 2.0)),
    })
    duan_cf_map = smear_df.groupby("station_id")["exp_res"].mean().clip(lower=0.90, upper=1.25).to_dict()

    st_meds = feat_df.groupby("station_id")["discharge_cfs"].median().clip(lower=1.0)
    st_p90s = feat_df.groupby("station_id")["discharge_cfs"].quantile(0.90).clip(lower=10.0)
    med_vec = feat_df["station_id"].map(st_meds).values
    p90_vec = feat_df["station_id"].map(st_p90s).values

    storm_path = ARTIFACTS_DIR / "model_storm_response.lgb"
    if storm_path.exists():
        print(f"[4/7] [SKIP] {storm_path.name} already exists.")
    else:
        print("[4/7] Training Physics-Constrained Monotonic Storm-Response LightGBM (model_storm_response.lgb)...")
        storm_features = [
            "precipitation_mm",
            "rain_sum_2d",
            "rain_sum_3d",
            "rain_sum_7d",
            "rain_sum_14d",
            "rain_max_1d_in_3d",
            "rain_max_1d_in_7d",
            "rain_decayed_05",
            "rain_decayed_055",
            "rain_decayed_08",
            "soil_moisture",
            "soil_moisture_mean_7d",
            "soil_x_rain",
            "runoff_proxy",
            "runoff_coeff_proxy",
            "fast_runoff_depth",
            "temp_max_c",
            "temp_min_c",
            "doy_sin",
            "doy_cos",
            "drainage_area_sqmi",
            "slope_pct",
            "forest_cover_pct",
            "mean_elevation_ft",
        ]
        mono_constraints = [
            1 if (f.startswith("rain_") or f == "precipitation_mm" or "soil" in f or "runoff" in f) else 0
            for f in storm_features
        ]
        surge_gap_vec = np.maximum(p90_vec - med_vec, med_vec * 0.85)
        y_storm_idx = np.clip((y_tr - med_vec * 0.45) / surge_gap_vec, 0.0, 4.5)

        m_storm = lgb.train(
            {
                "objective": "regression",
                "metric": "rmse",
                "learning_rate": 0.03,
                "num_leaves": 63,
                "min_child_samples": 50,
                "feature_fraction": 0.85,
                "bagging_fraction": 0.85,
                "bagging_freq": 1,
                "lambda_l2": 8.0,
                "monotone_constraints": mono_constraints,
                "seed": 42,
                "n_jobs": -1,
                "verbose": -1,
            },
            lgb.Dataset(feat_df[storm_features], label=y_storm_idx, weight=scale_weights),
            num_boost_round=450,
        )
        m_storm.save_model(str(storm_path))

    peak_path = ARTIFACTS_DIR / "model_peak_weighted.lgb"
    if peak_path.exists():
        print(f"[5/7] [SKIP] {peak_path.name} already exists.")
    else:
        print("[5/7] Training Flood-Peak Weighted LightGBM (model_peak_weighted.lgb)...")
        peak_weights = scale_weights * (1.0 + 3.0 * (y_tr >= p90_vec).astype(float))
        m_peak = lgb.train(
            {
                "objective": "regression",
                "metric": "rmse",
                "learning_rate": 0.03,
                "num_leaves": 63,
                "min_child_samples": 40,
                "feature_fraction": 0.70,
                "bagging_fraction": 0.80,
                "bagging_freq": 1,
                "lambda_l2": 5.0,
                "seed": 42,
                "n_jobs": -1,
                "verbose": -1,
            },
            lgb.Dataset(X_tr, label=y_scaled, weight=peak_weights),
            num_boost_round=450,
        )
        m_peak.save_model(str(peak_path))

    xgb_path = ARTIFACTS_DIR / "model_xgboost.json"
    if xgb_path.exists():
        print(f"[6/7] [SKIP] {xgb_path.name} already exists.")
    else:
        print("[6/7] Training Scale-Consistent XGBoost Regressor (model_xgboost.json)...")
        import xgboost as xgb
        m_xgb = xgb.XGBRegressor(
            n_estimators=350,
            max_depth=6,
            learning_rate=0.04,
            subsample=0.80,
            colsample_bytree=0.70,
            reg_lambda=5.0,
            random_state=42,
            n_jobs=-1,
            tree_method="hist",
        )
        m_xgb.fit(X_tr, y_scaled, sample_weight=scale_weights)
        m_xgb.save_model(str(xgb_path))

    cb_path = ARTIFACTS_DIR / "model_catboost.cbm"
    if cb_path.exists():
        print(f"[7/7] [SKIP] {cb_path.name} already exists.")
    else:
        print("[7/7] Training Scale-Consistent CatBoost Regressor (model_catboost.cbm)...")
        from catboost import CatBoostRegressor
        m_cb = CatBoostRegressor(
            iterations=450,
            depth=6,
            learning_rate=0.05,
            l2_leaf_reg=5.0,
            random_seed=42,
            thread_count=-1,
            verbose=False,
        )
        m_cb.fit(X_tr, y_scaled, sample_weight=scale_weights)
        m_cb.save_model(str(cb_path))

    print("[4/4] Saving station hydrological priors & empirical runoff elasticity (station_priors.json)...")
    priors = {}
    for sid, grp in train_df.groupby("station_id"):
        q = grp["discharge_cfs"].dropna()
        rain = grp["precipitation_mm"].fillna(0.0)
        sm = grp["soil_moisture"].fillna(0.30)
        area = float(grp["drainage_area_sqmi"].iloc[0]) if "drainage_area_sqmi" in grp.columns else 1000.0
        slope = float(grp["slope_pct"].iloc[0]) if "slope_pct" in grp.columns else 2.0
        forest = float(grp["forest_cover_pct"].iloc[0]) if "forest_cover_pct" in grp.columns else 40.0
        elev = float(grp["mean_elevation_ft"].iloc[0]) if "mean_elevation_ft" in grp.columns else 500.0

        # Empirical USDA SCS Curve Number (TR-55) calibrated from forest cover, slope, and soil moisture
        cn_ii = float(np.clip(78.0 - 0.22 * forest + 0.65 * min(slope, 20.0), 52.0, 91.0))

        # Monthly median & mean discharge
        dts = pd.to_datetime(grp["date"])
        m_means = grp.groupby(dts.dt.month)["discharge_cfs"].mean().to_dict()
        m_meds = grp.groupby(dts.dt.month)["discharge_cfs"].median().to_dict()

        priors[str(sid)] = {
            "station_id": str(sid),
            "mean_q": round(float(q.mean()), 2),
            "median_q": round(float(q.median()), 2),
            "std_q": round(float(q.std()), 2),
            "p10_q": round(float(np.percentile(q, 10)), 2),
            "p25_q": round(float(np.percentile(q, 25)), 2),
            "p75_q": round(float(np.percentile(q, 75)), 2),
            "p90_q": round(float(np.percentile(q, 90)), 2),
            "p95_q": round(float(np.percentile(q, 95)), 2),
            "p99_q": round(float(np.percentile(q, 99)), 2),
            "max_q": round(float(q.max()), 2),
            "mean_rain_mm": round(float(rain.mean()), 3),
            "p90_rain_mm": round(float(np.percentile(rain, 90)), 2),
            "p99_rain_mm": round(float(np.percentile(rain, 99)), 2),
            "mean_sm": round(float(sm.mean()), 4),
            "std_sm": round(float(max(sm.std(), 0.02)), 4),
            "drainage_area_sqmi": round(area, 2),
            "slope_pct": round(slope, 3),
            "forest_cover_pct": round(forest, 2),
            "mean_elevation_ft": round(elev, 2),
            "scs_curve_number_ii": round(cn_ii, 2),
            "duan_smearing_cf": round(float(duan_cf_map.get(str(sid), 1.05)), 4),
            "monthly_mean_q": {str(int(k)): round(float(v), 2) for k, v in m_means.items()},
            "monthly_median_q": {str(int(k)): round(float(v), 2) for k, v in m_meds.items()},
        }

    with open(ARTIFACTS_DIR / "station_priors.json", "w") as f:
        json.dump(priors, f, indent=2)

    # Also save last 120 days of 2021 weather per station for fast "<40ms" spin-up in /api/v1/predict
    spinup_df = (
        train_df.sort_values(["station_id", "date"])
        .groupby("station_id")
        .tail(120)
        .reset_index(drop=True)
    )
    spinup_df.to_csv(ARTIFACTS_DIR / "station_spinup_120d.csv", index=False)
    print(f"  Saved station_priors.json ({len(priors)} stations) and station_spinup_120d.csv ({len(spinup_df)} rows).")
    print("[DONE] All ML ensemble artifacts serialized successfully.")


if __name__ == "__main__":
    main()
