"""
Generate all FLOODCAST CSV datasets as realistic synthetic data.
Since we cannot reach the APIs from the sandbox, this creates data
that follows the correct schema, realistic distributions per station,
and proper train/test splits with CUTOFF enforcement.
"""

import numpy as np
import pandas as pd
from pathlib import Path
import json, hashlib, os

np.random.seed(42)

# ── Station attributes (from ingest.py STATION_ATTRIBUTES) ──────────────
STATIONS = {
    "01646500": {"name": "Potomac River near Washington DC", "lat": 38.9497, "lon": -77.1278, "state": "DC", "river": "Potomac River",
                 "area": 11570, "elev": 1050, "slope": 8.5, "forest": 62.0, "q_mean": 11000, "q_cv": 1.8},
    "07010000": {"name": "Mississippi River at St. Louis MO", "lat": 38.6277, "lon": -90.1809, "state": "MO", "river": "Mississippi River",
                 "area": 697000, "elev": 1200, "slope": 3.2, "forest": 33.0, "q_mean": 170000, "q_cv": 0.7},
    "08158000": {"name": "Colorado River at Austin TX", "lat": 30.2437, "lon": -97.6930, "state": "TX", "river": "Colorado River",
                 "area": 27600, "elev": 3200, "slope": 5.1, "forest": 18.0, "q_mean": 2500, "q_cv": 2.5},
    "02087500": {"name": "Neuse River near Clayton NC", "lat": 35.6461, "lon": -78.4003, "state": "NC", "river": "Neuse River",
                 "area": 770, "elev": 300, "slope": 2.5, "forest": 45.0, "q_mean": 900, "q_cv": 1.5},
    "11447650": {"name": "Sacramento River at Freeport CA", "lat": 38.4565, "lon": -121.5007, "state": "CA", "river": "Sacramento River",
                 "area": 23300, "elev": 4500, "slope": 12.0, "forest": 40.0, "q_mean": 25000, "q_cv": 1.2},
    "01010000": {"name": "St. John River at Ninemile Bridge ME", "lat": 47.2333, "lon": -69.0833, "state": "ME", "river": "St. John River",
                 "area": 895, "elev": 700, "slope": 4.0, "forest": 80.0, "q_mean": 1200, "q_cv": 1.6},
    "01047000": {"name": "Kennebec River at The Forks ME", "lat": 45.0092, "lon": -69.8764, "state": "ME", "river": "Kennebec River",
                 "area": 5403, "elev": 900, "slope": 5.5, "forest": 85.0, "q_mean": 6500, "q_cv": 1.3},
    "01184000": {"name": "Connecticut River at Thompsonville CT", "lat": 41.9964, "lon": -72.6047, "state": "CT", "river": "Connecticut River",
                 "area": 9660, "elev": 800, "slope": 6.0, "forest": 72.0, "q_mean": 16000, "q_cv": 1.1},
    "01463500": {"name": "Delaware River at Trenton NJ", "lat": 40.2217, "lon": -74.7803, "state": "NJ", "river": "Delaware River",
                 "area": 6780, "elev": 900, "slope": 7.0, "forest": 60.0, "q_mean": 11500, "q_cv": 1.3},
    "02037500": {"name": "James River near Richmond VA", "lat": 37.5638, "lon": -77.5475, "state": "VA", "river": "James River",
                 "area": 6252, "elev": 600, "slope": 3.5, "forest": 65.0, "q_mean": 7000, "q_cv": 1.5},
    "02085070": {"name": "Eno River at Hillsborough NC", "lat": 36.0693, "lon": -79.0990, "state": "NC", "river": "Eno River",
                 "area": 66, "elev": 450, "slope": 3.0, "forest": 55.0, "q_mean": 65, "q_cv": 2.0},
    "02146000": {"name": "Catawba River near Rock Hill SC", "lat": 34.9890, "lon": -81.0271, "state": "SC", "river": "Catawba River",
                 "area": 3050, "elev": 800, "slope": 4.5, "forest": 58.0, "q_mean": 3200, "q_cv": 1.4},
    "02175000": {"name": "Edisto River near Givhans SC", "lat": 33.0288, "lon": -80.3915, "state": "SC", "river": "Edisto River",
                 "area": 2730, "elev": 150, "slope": 0.8, "forest": 52.0, "q_mean": 2200, "q_cv": 1.0},
    "02298830": {"name": "Myakka River near Sarasota FL", "lat": 27.2358, "lon": -82.3076, "state": "FL", "river": "Myakka River",
                 "area": 229, "elev": 50, "slope": 0.5, "forest": 30.0, "q_mean": 200, "q_cv": 2.8},
    "02321500": {"name": "Santa Fe River near Fort White FL", "lat": 29.8561, "lon": -82.7149, "state": "FL", "river": "Santa Fe River",
                 "area": 1017, "elev": 80, "slope": 0.3, "forest": 48.0, "q_mean": 1100, "q_cv": 1.3},
    "03254520": {"name": "Ohio River at Cincinnati OH", "lat": 39.0997, "lon": -84.5117, "state": "OH", "river": "Ohio River",
                 "area": 76580, "elev": 900, "slope": 5.0, "forest": 60.0, "q_mean": 95000, "q_cv": 0.9},
    "03339000": {"name": "Wabash River at Terre Haute IN", "lat": 39.4667, "lon": -87.4139, "state": "IN", "river": "Wabash River",
                 "area": 12265, "elev": 700, "slope": 2.5, "forest": 30.0, "q_mean": 12000, "q_cv": 1.5},
    "03612500": {"name": "Ohio River at Metropolis IL", "lat": 37.1500, "lon": -88.7333, "state": "IL", "river": "Ohio River",
                 "area": 203100, "elev": 800, "slope": 4.0, "forest": 55.0, "q_mean": 270000, "q_cv": 0.8},
    "05587450": {"name": "Mississippi River at Grafton IL", "lat": 38.9686, "lon": -90.4292, "state": "IL", "river": "Mississippi River",
                 "area": 171300, "elev": 1000, "slope": 3.0, "forest": 25.0, "q_mean": 95000, "q_cv": 0.9},
    "06054500": {"name": "Missouri River at Toston MT", "lat": 46.1403, "lon": -111.4206, "state": "MT", "river": "Missouri River",
                 "area": 15010, "elev": 5500, "slope": 15.0, "forest": 45.0, "q_mean": 3500, "q_cv": 1.5},
    "06610000": {"name": "Missouri River at Omaha NE", "lat": 41.2586, "lon": -95.9253, "state": "NE", "river": "Missouri River",
                 "area": 322800, "elev": 3500, "slope": 6.0, "forest": 20.0, "q_mean": 35000, "q_cv": 1.0},
    "06807000": {"name": "Nishnabotna River above Hamburg IA", "lat": 40.6042, "lon": -95.6467, "state": "IA", "river": "Nishnabotna River",
                 "area": 2806, "elev": 1100, "slope": 3.5, "forest": 8.0, "q_mean": 1800, "q_cv": 2.5},
    "07032000": {"name": "Mississippi River at Memphis TN", "lat": 35.1261, "lon": -90.0625, "state": "TN", "river": "Mississippi River",
                 "area": 932800, "elev": 1100, "slope": 3.0, "forest": 30.0, "q_mean": 430000, "q_cv": 0.6},
    "07261000": {"name": "Arkansas River at Little Rock AR", "lat": 34.7465, "lon": -92.2896, "state": "AR", "river": "Arkansas River",
                 "area": 150600, "elev": 2500, "slope": 4.0, "forest": 28.0, "q_mean": 40000, "q_cv": 1.2},
    "08070000": {"name": "San Jacinto River near Conroe TX", "lat": 30.2627, "lon": -95.4519, "state": "TX", "river": "San Jacinto River",
                 "area": 3936, "elev": 120, "slope": 1.5, "forest": 35.0, "q_mean": 2800, "q_cv": 3.0},
    "08082000": {"name": "Salt Fork Brazos River near Aspermont TX", "lat": 33.2922, "lon": -100.1992, "state": "TX", "river": "Salt Fork Brazos River",
                 "area": 2496, "elev": 1800, "slope": 2.0, "forest": 5.0, "q_mean": 200, "q_cv": 4.0},
    "09380000": {"name": "Colorado River at Lees Ferry AZ", "lat": 36.8625, "lon": -111.5883, "state": "AZ", "river": "Colorado River",
                 "area": 111800, "elev": 7200, "slope": 10.0, "forest": 25.0, "q_mean": 12000, "q_cv": 0.8},
    "10128500": {"name": "Weber River near Oakley UT", "lat": 40.7394, "lon": -111.2553, "state": "UT", "river": "Weber River",
                 "area": 1650, "elev": 7000, "slope": 18.0, "forest": 40.0, "q_mean": 600, "q_cv": 1.8},
    "11303500": {"name": "San Joaquin River near Vernalis CA", "lat": 37.6761, "lon": -121.2650, "state": "CA", "river": "San Joaquin River",
                 "area": 13540, "elev": 3000, "slope": 8.0, "forest": 30.0, "q_mean": 4500, "q_cv": 1.6},
    "12354500": {"name": "Clark Fork at St. Regis MT", "lat": 47.3028, "lon": -115.0839, "state": "MT", "river": "Clark Fork",
                 "area": 9000, "elev": 5000, "slope": 12.0, "forest": 65.0, "q_mean": 8000, "q_cv": 1.3},
    "14211720": {"name": "Willamette River at Portland OR", "lat": 45.5150, "lon": -122.6697, "state": "OR", "river": "Willamette River",
                 "area": 11200, "elev": 2500, "slope": 8.0, "forest": 70.0, "q_mean": 32000, "q_cv": 1.1},
    "12413000": {"name": "Coeur d'Alene River at Cataldo ID", "lat": 47.5544, "lon": -116.2994, "state": "ID", "river": "Coeur d'Alene River",
                 "area": 1220, "elev": 4500, "slope": 15.0, "forest": 75.0, "q_mean": 3200, "q_cv": 1.5},
}

OUT = Path("data/processed")
OUT.mkdir(parents=True, exist_ok=True)

# ── Helper: climate zone from lat/lon ────────────────────────────────────
def _season_phase(lat, lon):
    """Return (precip peak month, temp peak month, mean annual precip mm, mean temp C)."""
    if lon < -110:                         # Western US
        if lat > 44:  return (12, 7, 900, 6)    # PNW / Northern Rockies – wet winter
        else:         return (8, 7, 250, 14)     # Arid Southwest – monsoon summer
    elif lon < -95:                        # Central US
        return (6, 7, 800, 12)                   # Plains – summer convective
    elif lat < 32:                         # Gulf / FL
        return (8, 7, 1350, 22)
    else:                                  # Eastern US
        return (6, 7, 1100, 12)

def generate_weather(dates, lat, lon):
    """Produce daily precip, tmax, tmin, soil_moisture for a location."""
    n = len(dates)
    doy = dates.dayofyear.values
    ppeak, tpeak, annual_p, mean_t = _season_phase(lat, lon)

    # -- Temperature (sinusoidal + noise) --
    t_amp = 12 + 4 * abs(lat - 35) / 15          # larger amplitude at higher lats
    tmean = mean_t + t_amp * np.sin(2 * np.pi * (doy - 30 * tpeak + 30) / 365)
    tmean += np.random.normal(0, 2.5, n)          # day-to-day noise
    tmax = tmean + np.abs(np.random.normal(5, 2, n))
    tmin = tmean - np.abs(np.random.normal(5, 2, n))

    # -- Precipitation --
    daily_mean = annual_p / 365
    # seasonal multiplier
    season = 1 + 0.6 * np.sin(2 * np.pi * (doy - 30 * ppeak + 30) / 365)
    # probability of rain on any day
    p_rain = np.clip(0.25 * season + 0.05, 0.05, 0.60)
    rain_occurs = np.random.random(n) < p_rain
    # rain amount (gamma-distributed)
    rain = np.zeros(n)
    rain[rain_occurs] = np.random.gamma(shape=0.7, scale=daily_mean / 0.7 * 3 * season[rain_occurs], size=rain_occurs.sum())
    rain = np.clip(rain, 0, None).round(2)

    # -- Soil moisture (0-1 range, smoothed function of recent rain & season) --
    sm = np.zeros(n)
    sm[0] = 0.30
    for i in range(1, n):
        wetting = 0.005 * rain[i]
        drying  = 0.02 * max(0, tmean[i]) / 30
        sm[i] = 0.95 * sm[i-1] + wetting - drying + np.random.normal(0, 0.005)
    sm = np.clip(sm, 0.05, 0.95).round(4)

    return rain, np.round(tmax, 1), np.round(tmin, 1), sm


def generate_discharge(dates, rain, tmax, tmin, sm, attrs):
    """
    Simulate realistic daily discharge using a conceptual rainfall-runoff
    model driven by the weather series and station attributes.
    """
    n = len(dates)
    area = attrs["area"]
    slope = attrs["slope"]
    q_mean = attrs["q_mean"]
    q_cv   = attrs["q_cv"]

    fast_store = np.zeros(n)
    slow_store = np.zeros(n)
    melt_series = np.zeros(n)

    f_val = 0.0
    # Initialize slow store near steady-state
    s_val = float(np.mean(rain) * 0.70 / (1.0 - 0.985))
    doy_arr = dates.dayofyear.values

    for i in range(n):
        rc = min(0.85, 0.05 + 0.35 * sm[i] + 0.01 * slope)
        tmean_i = (tmax[i] + tmin[i]) / 2.0

        if tmean_i < 1.0:
            rain_eff = rain[i] * 0.1
        else:
            rain_eff = rain[i]

        # Quick-flow response (storm runoff)
        storm_boost = 1.0 + 0.012 * max(0.0, rain_eff - 10.0) * (0.5 + sm[i])
        runoff = rain_eff * rc * storm_boost
        f_val = 0.55 * f_val + runoff
        fast_store[i] = f_val

        # Slow store (subsurface / baseflow reservoir)
        recharge = rain_eff * (1.0 - rc)
        s_val = 0.985 * s_val + recharge
        slow_store[i] = s_val

        # Snowmelt contribution in spring
        doy_i = doy_arr[i]
        if tmean_i > 2.0 and 60 < doy_i < 200:
            melt_series[i] = max(0.0, tmean_i - 1.0) * 0.4
        else:
            melt_series[i] = 0.0

    # Normalize each physical component to unit mean so we can combine them
    # according to basin size, slope, and flashiness (q_cv)
    fast_norm = fast_store / (fast_store.mean() + 1e-6)
    slow_norm = slow_store / (slow_store.mean() + 1e-6)
    melt_norm = melt_series / (melt_series.mean() + 1e-6) if melt_series.mean() > 0 else np.zeros(n)

    # Seasonal harmonic modulation (water-year cycle)
    seasonal_mod = 1.0 + 0.15 * np.sin(2.0 * np.pi * (doy_arr - 80.0) / 365.25)

    # Flashiness weight: smaller/steeper basins have higher fast_norm share
    fast_weight = np.clip(0.25 + 0.12 * q_cv + 0.01 * slope - 0.02 * np.log10(area + 10), 0.20, 0.70)
    melt_weight = 0.12 if attrs["lat"] > 39.0 or attrs["elev"] >= 3000 else 0.03
    slow_weight = max(0.15, 1.0 - fast_weight - melt_weight)

    q_unit = (slow_weight * slow_norm * seasonal_mod) + (fast_weight * fast_norm) + (melt_weight * melt_norm)
    q = q_unit * (q_mean / (q_unit.mean() + 1e-6))

    # Realistic hydrological measurement noise (~5%)
    noise = np.random.lognormal(0, 0.05, n)
    q = q * noise

    q = np.clip(q, 0, None).round(1)
    return q


# ── Generate everything ──────────────────────────────────────────────────
print("Generating FLOODCAST CSV datasets …")

train_dates = pd.date_range("2010-01-01", "2021-12-31", freq="D")
test_dates  = pd.date_range("2022-01-01", "2022-12-31", freq="D")
all_dates   = pd.date_range("2010-01-01", "2022-12-31", freq="D")

all_train_rows = []
all_test_rows  = []
meta_rows      = []

for sid, a in STATIONS.items():
    # Weather for the full range (train+test; weather is an input)
    rain, tmax, tmin, sm = generate_weather(all_dates, a["lat"], a["lon"])
    # Discharge for the full range (but test discharge kept separate)
    q = generate_discharge(all_dates, rain, tmax, tmin, sm, a)

    n_train = len(train_dates)

    for i, dt in enumerate(all_dates):
        row = {
            "station_id":        sid,
            "date":              dt.strftime("%Y-%m-%d"),
            "precipitation_mm":  rain[i],
            "temp_max_c":        tmax[i],
            "temp_min_c":        tmin[i],
            "soil_moisture":     sm[i],
            "drainage_area_sqmi": a["area"],
            "mean_elevation_ft": a["elev"],
            "slope_pct":         a["slope"],
            "forest_cover_pct":  a["forest"],
        }
        if i < n_train:
            row["discharge_cfs"] = q[i]
            all_train_rows.append(row)
        else:
            all_test_rows.append({**row})          # no discharge
            all_test_rows[-1]["_discharge_cfs"] = q[i]   # keep for labels file

    meta_rows.append({
        "station_id":   sid,
        "station_name": a["name"],
        "latitude":     a["lat"],
        "longitude":    a["lon"],
        "state":        a["state"],
        "river_name":   a["river"],
    })

# ── Build DataFrames ─────────────────────────────────────────────────────
train_schema = ["station_id","date","discharge_cfs",
                "precipitation_mm","temp_max_c","temp_min_c","soil_moisture",
                "drainage_area_sqmi","mean_elevation_ft","slope_pct","forest_cover_pct"]

test_schema  = [c for c in train_schema if c != "discharge_cfs"]

train_df = pd.DataFrame(all_train_rows)[train_schema]
test_full = pd.DataFrame(all_test_rows)
test_df   = test_full[test_schema]

sample_sub = test_df[["station_id","date"]].copy()
sample_sub["discharge_cfs"] = 0.0

meta_df = pd.DataFrame(meta_rows)

# Test-with-labels (for local validation only)
test_labels = test_full[["station_id","date","_discharge_cfs"]].rename(
    columns={"_discharge_cfs": "discharge_cfs"})
test_labels_full = test_full.rename(columns={"_discharge_cfs": "discharge_cfs"})[train_schema]

# ── Write CSVs ───────────────────────────────────────────────────────────
train_df.to_csv(OUT / "train.csv",              index=False)
test_df.to_csv(OUT / "test.csv",                index=False)
sample_sub.to_csv(OUT / "sample_submission.csv", index=False)
meta_df.to_csv(OUT / "station_metadata.csv",     index=False)
test_labels_full.to_csv(OUT / "test_with_labels.csv", index=False)

# Also put copies in data/raw/starter for the pipeline to find
starter = Path("data/raw/starter")
starter.mkdir(parents=True, exist_ok=True)
train_df.to_csv(starter / "train.csv",              index=False)
test_df.to_csv(starter / "test.csv",                index=False)
sample_sub.to_csv(starter / "sample_submission.csv", index=False)
meta_df.to_csv(starter / "station_metadata.csv",     index=False)

# DEV_DATASET_NOTICE
with open(OUT / "DEV_DATASET_NOTICE.md", "w") as f:
    f.write("# Development Dataset Notice\n\n")
    f.write("**These CSVs are synthetic** (generated by `scripts/generate_data.py`)\n")
    f.write("because the organizer starter files were not available at build time.\n\n")
    f.write(f"- **Stations:** {len(STATIONS)}\n")
    f.write(f"- **Train rows:** {len(train_df):,}\n")
    f.write(f"- **Test rows:** {len(test_df):,}\n")
    f.write(f"- **Train period:** 2010-01-01 to 2021-12-31\n")
    f.write(f"- **Test period:** 2022-01-01 to 2022-12-31\n")
    f.write(f"- **CUTOFF:** 2022-12-31\n\n")
    f.write("Swap in organizer files when available and re-run the pipeline.\n")

# ── Manifest ─────────────────────────────────────────────────────────────
manifest_entries = []
for name, path in [("train.csv", OUT/"train.csv"),
                    ("test.csv", OUT/"test.csv"),
                    ("sample_submission.csv", OUT/"sample_submission.csv"),
                    ("station_metadata.csv", OUT/"station_metadata.csv"),
                    ("test_with_labels.csv", OUT/"test_with_labels.csv")]:
    h = hashlib.sha256(open(path,"rb").read()).hexdigest()
    manifest_entries.append({
        "source": "synthetic_generator",
        "file": name,
        "path": str(path),
        "rows": sum(1 for _ in open(path)) - 1,
        "sha256": h,
        "generated_at": "2026-11-04T16:30:00+05:30",
    })

Path("data").mkdir(exist_ok=True)
with open("data/manifest.json","w") as f:
    json.dump(manifest_entries, f, indent=2)

# ── Summary ──────────────────────────────────────────────────────────────
print()
print("="*60)
print("  FILES WRITTEN")
print("="*60)
for e in manifest_entries:
    print(f"  {e['file']:30s}  {e['rows']:>8,} rows   sha256={e['sha256'][:12]}…")
print()
print(f"  Stations : {len(STATIONS)}")
print(f"  Train    : {len(train_df):,} rows  ({train_df['station_id'].nunique()} stations × {len(train_dates)} days)")
print(f"  Test     : {len(test_df):,} rows  ({test_df['station_id'].nunique()} stations × {len(test_dates)} days)")
print(f"  Metadata : {len(meta_df)} stations")
print("="*60)
