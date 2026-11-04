"""
FLOODCAST Feature Engineering Module
Config-driven, per-station, backward-looking only.
"""

import numpy as np
import pandas as pd
from scipy.signal import lfilter
from typing import Dict, List, Optional
import yaml


def load_feature_config(config_path: str = "configs/base.yaml") -> dict:
    """Load feature configuration."""
    with open(config_path, "r") as f:
        cfg = yaml.safe_load(f)
    return cfg.get("features", {})


def _days_since_exceedance(cond: np.ndarray) -> np.ndarray:
    """Vectorized backward-looking days since condition was True."""
    idx = np.arange(len(cond), dtype=float)
    last_idx = np.where(cond, idx, -np.inf)
    last_seen = np.maximum.accumulate(last_idx)
    res = idx - last_seen
    res[np.isinf(res)] = np.nan
    return res


def _wet_streak(cond: np.ndarray) -> np.ndarray:
    """Vectorized backward-looking consecutive True streak count."""
    idx = np.arange(len(cond), dtype=int)
    last_zero = np.maximum.accumulate(np.where(cond == 0, idx, -1))
    return idx - last_zero


def _exp_decay_filter(x: np.ndarray, alpha: float, init_val: float = 0.0) -> np.ndarray:
    """Vectorized causal exponential decay filter: y[t] = alpha * y[t-1] + x[t]."""
    clean_x = np.nan_to_num(x, nan=0.0).astype(float)
    if init_val != 0.0 and len(clean_x) > 0:
        clean_x = clean_x.copy()
        clean_x[0] += alpha * init_val
    return lfilter([1.0], [1.0, -alpha], clean_x)


def compute_rainfall_features(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """
    Rainfall features: rolling sums, max, wet-day counts, days since rain,
    streaks, intensity ratio, anomaly, acceleration.
    All computed per station, backward-looking only.
    """
    if not config.get("enabled", True):
        return df

    windows = config.get("rolling_windows", [1, 2, 3, 7, 14, 30, 60])
    max_rain_windows = config.get("max_rain_windows", [3, 7, 14])
    wet_thresholds = config.get("wet_day_thresholds_mm", [1, 5])
    wet_windows = config.get("wet_day_windows", [7, 14, 30])
    days_since_thresholds = config.get("days_since_rain_mm", [5, 10, 25])

    rain = df["precipitation_mm"].copy()
    rain_arr = rain.fillna(0.0).values

    # Rolling sums (including long-memory 90d, 180d, 365d for large continental basins)
    all_windows = sorted(set(list(windows) + [90, 180, 365]))
    for w in all_windows:
        df[f"rain_sum_{w}d"] = rain.rolling(w, min_periods=1).sum()

    # Max 1-day rain in windows
    for w in max_rain_windows:
        df[f"rain_max_1d_in_{w}d"] = rain.rolling(w, min_periods=1).max()

    # Wet-day counts
    for thresh in wet_thresholds:
        wet = (rain > thresh).astype(float)
        for w in wet_windows:
            df[f"wet_days_gt{thresh}mm_{w}d"] = wet.rolling(w, min_periods=1).sum()

    # Days since rain above thresholds
    for thresh in days_since_thresholds:
        above = (rain_arr >= thresh) & (~ rain.isna().values)
        df[f"days_since_rain_{thresh}mm"] = _days_since_exceedance(above)

    # Days since station 95th percentile rain
    p95 = rain.quantile(config.get("percentile_threshold", 0.95))
    if p95 > 0:
        above_p95 = (rain_arr >= p95) & (~rain.isna().values)
        df["days_since_rain_p95"] = _days_since_exceedance(above_p95)
    else:
        df["days_since_rain_p95"] = np.nan

    # Consecutive wet-day streak (> 1mm)
    wet_1mm = (rain_arr > 1).astype(int)
    df["wet_streak"] = _wet_streak(wet_1mm)

    # Intensity ratio (max daily / window total)
    for w in [7, 14]:
        total = rain.rolling(w, min_periods=1).sum()
        mx = rain.rolling(w, min_periods=1).max()
        df[f"rain_intensity_ratio_{w}d"] = np.where(total > 0, mx / total, 0)

    # Rain acceleration: 3-day sum minus previous 3-day sum
    sum_3d = rain.rolling(3, min_periods=1).sum()
    df["rain_acceleration"] = sum_3d - sum_3d.shift(3)

    # Long-window rainfall anomaly ratios relative to 365d station baseline
    if "rain_sum_365d" in df.columns:
        r365 = df["rain_sum_365d"].fillna(0.0)
        if "rain_sum_7d" in df.columns:
            df["rain_anomaly_7d_vs_365d"] = df["rain_sum_7d"] / (r365 / 52.14 + 0.5)
        if "rain_sum_30d" in df.columns:
            df["rain_anomaly_30d_vs_365d"] = df["rain_sum_30d"] / (r365 / 12.17 + 1.0)
        if "rain_sum_90d" in df.columns:
            df["rain_anomaly_90d_vs_365d"] = df["rain_sum_90d"] / (r365 / 4.05 + 2.0)

    # Volumetric basin rainfall inputs (area-scaled cumulative precipitation)
    if "drainage_area_sqmi" in df.columns:
        area_k = df["drainage_area_sqmi"].fillna(0.0) / 1000.0
        for w in [7, 30, 90, 180, 365]:
            if f"rain_sum_{w}d" in df.columns:
                df[f"rain_vol_{w}d"] = df[f"rain_sum_{w}d"] * area_k

    return df


def compute_antecedent_features(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """
    Antecedent and routing state features:
    Exponentially decayed rainfall (fast, medium, slow, baseflow reservoirs),
    and time-of-concentration proxy.
    """
    if not config.get("enabled", True):
        return df

    decay_constants = config.get("decay_constants", [0.5, 0.55, 0.8, 0.95, 0.985])
    rain = df["precipitation_mm"].values

    for alpha in decay_constants:
        decayed = _exp_decay_filter(rain, float(alpha))
        label = str(alpha).replace(".", "")
        df[f"rain_decayed_{label}"] = decayed

    # Ensure standard decay columns exist even if config only listed [0.5, 0.8, 0.95]
    for extra_alpha in [0.55, 0.985]:
        label = str(extra_alpha).replace(".", "")
        if f"rain_decayed_{label}" not in df.columns:
            df[f"rain_decayed_{label}"] = _exp_decay_filter(rain, extra_alpha)

    # Time-of-concentration proxy
    if "drainage_area_sqmi" in df.columns and "slope_pct" in df.columns:
        area = df["drainage_area_sqmi"].fillna(1)
        slope = df["slope_pct"].fillna(1).clip(lower=0.1)
        # Kirpich-style estimate (simplified)
        df["time_of_concentration"] = 0.0078 * (np.sqrt(area) ** 0.77) / (slope ** 0.385)

    return df


def compute_soil_features(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Soil moisture features: lags, rolling mean, deltas, percentile, interactions, runoff reservoirs."""
    if not config.get("enabled", True):
        return df

    sm = df["soil_moisture"].copy()
    lag_days = config.get("lag_days", [1, 3, 7])

    for lag in lag_days:
        df[f"soil_moisture_lag{lag}"] = sm.shift(lag)

    df["soil_moisture_mean_7d"] = sm.rolling(7, min_periods=1).mean()
    df["soil_moisture_mean_30d"] = sm.rolling(30, min_periods=1).mean()
    df["soil_moisture_mean_90d"] = sm.rolling(90, min_periods=1).mean()
    df["soil_moisture_delta_1d"] = sm - sm.shift(1)
    df["soil_moisture_delta_3d"] = sm - sm.shift(3)
    df["soil_moisture_delta_7d"] = sm - sm.shift(7)

    # Expanding backward-looking percentile rank per station (no future leakage)
    df["soil_moisture_pct"] = sm.expanding(min_periods=1).rank(pct=True)

    # Soil x rain interaction
    if "precipitation_mm" in df.columns:
        df["soil_x_rain"] = sm * df["precipitation_mm"]

    # Curve-number-style runoff proxy: high soil moisture + rain → more runoff
    if "precipitation_mm" in df.columns:
        sm_q70 = sm.expanding(min_periods=1).quantile(0.70)
        sm_max = sm.expanding(min_periods=1).max().clip(lower=1e-4)
        df["runoff_proxy"] = np.where(
            sm > sm_q70,
            df["precipitation_mm"] * (1 + sm / sm_max),
            df["precipitation_mm"] * 0.5,
        )
        slope_val = df["slope_pct"].fillna(2.0).values if "slope_pct" in df.columns else 2.0
        rc = np.minimum(0.85, 0.05 + 0.35 * sm.fillna(0.3).values + 0.01 * slope_val)
        df["runoff_coeff_proxy"] = rc
        df["fast_runoff_depth"] = _exp_decay_filter(df["precipitation_mm"].fillna(0).values * rc, 0.55)
        df["slow_recharge_depth"] = _exp_decay_filter(df["precipitation_mm"].fillna(0).values * (1.0 - rc), 0.985)

    return df


def compute_temperature_features(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Temperature and snow features."""
    if not config.get("enabled", True):
        return df

    snow_thresh = config.get("snow_threshold_c", 1.0)
    dd_windows = config.get("degree_day_windows", [7, 14, 30])

    tmax = df["temp_max_c"]
    tmin = df["temp_min_c"]
    tmean = (tmax + tmin) / 2

    df["temp_mean_c"] = tmean
    df["diurnal_range_c"] = tmax - tmin

    # Rain vs snow split
    rain = df.get("precipitation_mm", pd.Series(0, index=df.index))
    df["rain_as_snow"] = np.where(tmean < snow_thresh, rain, 0)
    df["rain_as_liquid"] = np.where(tmean >= snow_thresh, rain, 0.1 * rain)

    # Rain-on-snow indicator
    df["rain_on_snow"] = ((tmean > snow_thresh) & (tmean < snow_thresh + 3) & (rain > 5)).astype(int)

    # Positive degree-days (melting proxy)
    pdd = tmean.clip(lower=0)
    for w in dd_windows:
        df[f"pos_degree_days_{w}d"] = pdd.rolling(w, min_periods=1).sum()

    # Freezing degree-days
    fdd = (-tmean).clip(lower=0)
    for w in dd_windows:
        df[f"freeze_degree_days_{w}d"] = fdd.rolling(w, min_periods=1).sum()

    # Freeze-thaw count (# of days where min < 0 and max > 0) in last 7 days
    freeze_thaw = ((tmin < 0) & (tmax > 0)).astype(float)
    df["freeze_thaw_7d"] = freeze_thaw.rolling(7, min_periods=1).sum()

    # Hargreaves-style ET proxy
    ra = 15  # rough extraterrestrial radiation approximation (MJ/m2/day)
    df["et_proxy"] = 0.0023 * ra * (tmean + 17.8) * np.sqrt(df["diurnal_range_c"].clip(lower=0))

    # Spring snowmelt degree-day proxy
    doy = pd.to_datetime(df["date"]).dt.dayofyear.values
    df["spring_snowmelt_dd"] = np.where(
        (tmean.values > 2.0) & (doy > 60) & (doy < 200),
        np.maximum(0.0, tmean.values - 1.0) * 0.4,
        0.0,
    )

    return df


def compute_calendar_features(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Calendar features: sin/cos day-of-year, month, water year day."""
    if not config.get("enabled", True):
        return df

    dates = pd.to_datetime(df["date"])
    doy = dates.dt.dayofyear

    df["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    df["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
    df["month"] = dates.dt.month

    # Water year day (days since Oct 1)
    water_year_start = pd.to_datetime(
        dates.dt.year.where(dates.dt.month >= 10, dates.dt.year - 1).astype(str) + "-10-01"
    )
    df["water_year_day"] = (dates - water_year_start).dt.days

    return df


def compute_static_features(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Static catchment attribute features and physical basin-routing interactions."""
    if not config.get("enabled", True):
        return df

    if "drainage_area_sqmi" in df.columns:
        area = df["drainage_area_sqmi"].fillna(0).values
        df["log_drainage_area"] = np.log1p(area)

        # Area x rain interaction
        if "precipitation_mm" in df.columns:
            df["area_x_rain"] = area * df["precipitation_mm"].values

    if "slope_pct" in df.columns and "precipitation_mm" in df.columns:
        df["slope_x_rain"] = df["slope_pct"].values * df["precipitation_mm"].values

    # Basin size bins
    if "drainage_area_sqmi" in df.columns:
        area_s = df["drainage_area_sqmi"].fillna(0)
        df["basin_size_bin"] = pd.cut(
            area_s,
            bins=[0, 100, 1000, 10000, 100000, float("inf")],
            labels=[0, 1, 2, 3, 4],
            include_lowest=True,
        ).astype(float)

    # Forest x elevation interaction
    if "forest_cover_pct" in df.columns and "mean_elevation_ft" in df.columns:
        df["forest_x_elev"] = df["forest_cover_pct"] * df["mean_elevation_ft"] / 1000

    # Conceptual basin water balance index (unscaled physical routing from weather + static attrs)
    if all(c in df.columns for c in ["drainage_area_sqmi", "slope_pct", "soil_moisture", "precipitation_mm", "temp_max_c", "temp_min_c"]):
        area_val = float(df["drainage_area_sqmi"].iloc[0]) if len(df) > 0 else 1000.0
        slope_val = float(df["slope_pct"].iloc[0]) if len(df) > 0 else 2.0
        sm_arr = df["soil_moisture"].fillna(0.3).values
        rain_arr = df["precipitation_mm"].fillna(0.0).values
        tmean_arr = 0.5 * (df["temp_max_c"].fillna(15.0).values + df["temp_min_c"].fillna(5.0).values)
        doy_arr = pd.to_datetime(df["date"]).dt.dayofyear.values

        rc = np.minimum(0.85, 0.05 + 0.35 * sm_arr + 0.01 * slope_val)
        rain_eff = np.where(tmean_arr < 1.0, rain_arr * 0.1, rain_arr)
        storm_boost = 1.0 + 0.012 * np.maximum(0.0, rain_eff - 10.0) * (0.5 + sm_arr)
        runoff_in = rain_eff * rc * storm_boost
        recharge_in = rain_eff * (1.0 - rc)

        fast_st = _exp_decay_filter(runoff_in, 0.55, init_val=0.0)
        init_slow = float(np.mean(rain_arr[:min(3650, len(rain_arr))]) * 0.70 / (1.0 - 0.985))
        slow_st = _exp_decay_filter(recharge_in, 0.985, init_val=init_slow)
        melt_st = np.where(
            (tmean_arr > 2.0) & (doy_arr > 60) & (doy_arr < 200),
            np.maximum(0.0, tmean_arr - 1.0) * 0.4,
            0.0,
        )
        n_ref = min(3650, len(fast_st))
        fast_norm = fast_st / (np.mean(fast_st[:n_ref]) + 1e-6)
        slow_norm = slow_st / (np.mean(slow_st[:n_ref]) + 1e-6)
        melt_mean = np.mean(melt_st[:n_ref])
        melt_norm = melt_st / (melt_mean + 1e-6) if melt_mean > 0 else np.zeros_like(melt_st)
        seasonal_mod = 1.0 + 0.15 * np.sin(2.0 * np.pi * (doy_arr - 80.0) / 365.25)

        elev_val = float(df["mean_elevation_ft"].iloc[0]) if "mean_elevation_ft" in df.columns and len(df) > 0 else 500.0
        fast_w = np.clip(0.40 + 0.01 * slope_val - 0.02 * np.log10(area_val + 10.0), 0.20, 0.70)
        melt_w = 0.12 if elev_val >= 2500 else 0.05
        slow_w = max(0.15, 1.0 - fast_w - melt_w)

        raw_wb = (slow_w * slow_norm * seasonal_mod) + (fast_w * fast_norm) + (melt_w * melt_norm)
        df["conceptual_fast_flow"] = fast_norm
        df["conceptual_slow_flow"] = slow_norm * seasonal_mod
        df["conceptual_water_balance"] = raw_wb

    return df


def compute_station_stats(
    df: pd.DataFrame,
    train_discharge: pd.DataFrame,
    config: dict,
) -> pd.DataFrame:
    """
    Station-level statistics from TRAINING discharge only.
    Includes fallback scaling by drainage area for unseen stations (e.g., LOO validation).
    """
    if not config.get("enabled", False):
        return df

    td = train_discharge.dropna(subset=["discharge_cfs"]).copy()
    if len(td) == 0:
        return df

    stats = td.groupby("station_id")["discharge_cfs"].agg([
        "mean", "median", "std",
        lambda x: x.quantile(0.75),
        lambda x: x.quantile(0.90),
        lambda x: x.quantile(0.99),
    ])
    stats.columns = [
        "station_mean_q", "station_median_q", "station_std_q",
        "station_p75_q", "station_p90_q", "station_p99_q",
    ]

    # Monthly means
    td["month"] = pd.to_datetime(td["date"]).dt.month
    monthly = td.groupby(["station_id", "month"])["discharge_cfs"].mean().unstack(fill_value=0)
    monthly.columns = [f"station_monthly_mean_q_{m}" for m in monthly.columns]

    stats = stats.join(monthly)
    df = df.merge(stats, left_on="station_id", right_index=True, how="left")

    # Fallback for unseen stations (LOO) using median discharge-per-sqmi on training set
    if "drainage_area_sqmi" in df.columns and df["station_mean_q"].isna().any():
        if "drainage_area_sqmi" in td.columns:
            st_area = td.groupby("station_id")["drainage_area_sqmi"].first()
        else:
            st_area = df.groupby("station_id")["drainage_area_sqmi"].first()
        valid_sids = stats.index.intersection(st_area.index)
        area_ratios = {}
        for col in ["station_mean_q", "station_median_q", "station_std_q", "station_p75_q", "station_p90_q", "station_p99_q"]:
            ratios = (stats.loc[valid_sids, col] / st_area.loc[valid_sids].clip(lower=1.0)).median()
            area_ratios[col] = float(ratios) if not np.isnan(ratios) else 1.0
            df[col] = df[col].fillna(df["drainage_area_sqmi"] * area_ratios[col])
        for m in range(1, 13):
            mcol = f"station_monthly_mean_q_{m}"
            if mcol in df.columns:
                df[mcol] = df[mcol].fillna(df["station_mean_q"])

    # Current row's historical station-month mean discharge
    row_dates = pd.to_datetime(df["date"])
    row_months = row_dates.dt.month
    row_doy = row_dates.dt.dayofyear
    month_lookup = td.groupby(["station_id", "month"])["discharge_cfs"].mean().rename("station_current_month_q")
    df[" _tmp_month"] = row_months
    df = df.merge(month_lookup, left_on=["station_id", " _tmp_month"], right_index=True, how="left")
    df["station_current_month_q"] = df["station_current_month_q"].fillna(df["station_mean_q"])
    df = df.drop(columns=[" _tmp_month"])

    # Smoothed day-of-year station climatology (mean and median) from training data only
    td["doy"] = pd.to_datetime(td["date"]).dt.dayofyear
    doy_piv_mean = td.pivot_table(index="doy", columns="station_id", values="discharge_cfs", aggfunc="mean")
    doy_piv_med = td.pivot_table(index="doy", columns="station_id", values="discharge_cfs", aggfunc="median")
    # Circular 15-day smoothing across year boundary
    doy_pad_mean = pd.concat([doy_piv_mean.iloc[-7:], doy_piv_mean, doy_piv_mean.iloc[:7]])
    doy_smooth_mean = doy_pad_mean.rolling(15, min_periods=1, center=True).mean().iloc[7:-7]
    doy_pad_med = pd.concat([doy_piv_med.iloc[-7:], doy_piv_med, doy_piv_med.iloc[:7]])
    doy_smooth_med = doy_pad_med.rolling(15, min_periods=1, center=True).mean().iloc[7:-7]

    doy_mean_long = doy_smooth_mean.stack().rename("station_doy_mean_q")
    doy_med_long = doy_pad_med.iloc[7:-7].stack().rename("station_doy_median_q")
    df["_tmp_doy"] = row_doy
    df = df.merge(doy_mean_long, left_on=["_tmp_doy", "station_id"], right_index=True, how="left")
    df = df.merge(doy_med_long, left_on=["_tmp_doy", "station_id"], right_index=True, how="left")
    df["station_doy_mean_q"] = df["station_doy_mean_q"].fillna(df["station_current_month_q"])
    df["station_doy_median_q"] = df["station_doy_median_q"].fillna(df["station_median_q"])
    df = df.drop(columns=["_tmp_doy"])

    # Calibrate conceptual water balance and soil moisture anomaly to station historical scale
    if "conceptual_water_balance" in df.columns:
        wb_mean = df.groupby("station_id")["conceptual_water_balance"].transform(
            lambda x: x.iloc[:min(len(x), 3650)].mean()
        ).clip(lower=1e-6)
        df["station_calibrated_wb"] = df["conceptual_water_balance"] * (df["station_mean_q"] / wb_mean)
        df["station_doy_x_wb"] = df["station_doy_mean_q"] * (df["conceptual_water_balance"] / wb_mean)

    if "soil_moisture" in df.columns:
        sm_st_mean = df.groupby("station_id")["soil_moisture"].transform(
            lambda x: x.iloc[:min(len(x), 3650)].mean()
        ).clip(lower=1e-4)
        df["station_sm_ratio_q"] = df["station_doy_mean_q"] * (df["soil_moisture"] / sm_st_mean)

    if "rain_anomaly_30d_vs_365d" in df.columns:
        df["station_rain_30d_scaled_q"] = df["station_doy_mean_q"] * df["rain_anomaly_30d_vs_365d"]
    if "rain_anomaly_90d_vs_365d" in df.columns:
        df["station_rain_90d_scaled_q"] = df["station_doy_mean_q"] * df["rain_anomaly_90d_vs_365d"]

    return df


def compute_cross_station_features(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """
    Cross-station synoptic weather and HUC-region features on the same date.
    Uses only input weather variables (precipitation_mm, soil_moisture), never discharge.
    """
    if not config.get("enabled", False):
        return df

    df = df.copy()
    df["_huc2"] = df["station_id"].astype(str).str[:2]

    # Regional daily weather aggregates across all stations on each date
    daily_agg = df.groupby("date").agg(
        regional_mean_rain_1d=("precipitation_mm", "mean"),
        regional_max_rain_1d=("precipitation_mm", "max"),
        regional_mean_sm_1d=("soil_moisture", "mean"),
    )
    df = df.merge(daily_agg, left_on="date", right_index=True, how="left")
    df["station_rain_vs_regional"] = df["precipitation_mm"] - df["regional_mean_rain_1d"]

    # Basin (2-digit HUC prefix) daily aggregates + rolling upstream basin moisture/rainfall
    basin_agg = df.groupby(["_huc2", "date"]).agg(
        basin_mean_rain_1d=("precipitation_mm", "mean"),
        basin_mean_sm_1d=("soil_moisture", "mean"),
    ).reset_index().sort_values(["_huc2", "date"])
    basin_agg["basin_rain_7d"] = basin_agg.groupby("_huc2")["basin_mean_rain_1d"].transform(lambda x: x.rolling(7, min_periods=1).sum())
    basin_agg["basin_rain_30d"] = basin_agg.groupby("_huc2")["basin_mean_rain_1d"].transform(lambda x: x.rolling(30, min_periods=1).sum())
    df = df.merge(basin_agg, on=["_huc2", "date"], how="left")

    # Upper Mississippi + Missouri upstream weather index (HUC 05, 06, 07) for mainstem routing
    midwest_mask = df["_huc2"].isin(["05", "06", "07"])
    if midwest_mask.any():
        mw_daily = df[midwest_mask].groupby("date").agg(
            mw_rain_1d=("precipitation_mm", "mean"),
            mw_sm_1d=("soil_moisture", "mean"),
        ).sort_index()
        mw_daily["upstream_midwest_rain_14d"] = mw_daily["mw_rain_1d"].rolling(14, min_periods=1).sum()
        mw_daily["upstream_midwest_rain_60d"] = mw_daily["mw_rain_1d"].rolling(60, min_periods=1).sum()
        mw_daily["upstream_midwest_sm_30d"] = mw_daily["mw_sm_1d"].rolling(30, min_periods=1).mean()
        df = df.merge(
            mw_daily[["upstream_midwest_rain_14d", "upstream_midwest_rain_60d", "upstream_midwest_sm_30d"]],
            left_on="date",
            right_index=True,
            how="left",
        )
    df = df.drop(columns=["_huc2"])

    return df


def compute_all_features(
    df: pd.DataFrame,
    config: dict,
    train_discharge: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """
    Compute all feature families, per station, in date order.
    Features are computed on train+test weather concatenated so test windows are not empty.
    """
    feat_config = config.get("features", config)

    # Sort by station and date
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["station_id", "date"]).reset_index(drop=True)

    # Process each station separately to ensure per-station computation
    result_dfs = []
    stations = df["station_id"].unique()

    for sid in stations:
        station_df = df[df["station_id"] == sid].copy()
        station_df = station_df.sort_values("date").reset_index(drop=True)

        # Apply feature families
        station_df = compute_rainfall_features(station_df, feat_config.get("rainfall", {}))
        station_df = compute_antecedent_features(station_df, feat_config.get("antecedent", {}))
        station_df = compute_soil_features(station_df, feat_config.get("soil", {}))
        station_df = compute_temperature_features(station_df, feat_config.get("temperature", {}))
        station_df = compute_calendar_features(station_df, feat_config.get("calendar", {}))
        station_df = compute_static_features(station_df, feat_config.get("static", {}))

        result_dfs.append(station_df)

    result = pd.concat(result_dfs, ignore_index=True)

    # Station stats (from training discharge only)
    if train_discharge is not None:
        result = compute_station_stats(result, train_discharge, feat_config.get("station_stats", {}))

    # Cross-station synoptic features
    result = compute_cross_station_features(result, feat_config.get("cross_station", {}))

    # Convert date back to string
    result["date"] = result["date"].dt.strftime("%Y-%m-%d")

    return result


def get_feature_columns(df: pd.DataFrame) -> List[str]:
    """Return the list of feature columns (excluding identifiers and target)."""
    exclude = {"station_id", "date", "discharge_cfs", "quality_cd"}
    return [c for c in df.columns if c not in exclude]

