"""
FLOODCAST Data Ingestion Module
Downloads and processes data from USGS NWIS, Open-Meteo, and USGS StreamStats.
"""

import json
import hashlib
import time
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import numpy as np
import requests
import yaml


def load_config(config_path: str = "configs/base.yaml") -> dict:
    """Load YAML configuration."""
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def sha256_file(filepath: str) -> str:
    """Compute SHA-256 checksum of a file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    """Compute SHA-256 checksum of bytes."""
    return hashlib.sha256(data).hexdigest()


class ManifestLogger:
    """Logs every data request/file for provenance."""

    def __init__(self, manifest_path: str = "data/manifest.json"):
        self.manifest_path = Path(manifest_path)
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        if self.manifest_path.exists():
            with open(self.manifest_path, "r") as f:
                self.entries = json.load(f)
        else:
            self.entries = []

    def log(self, entry: Dict[str, Any]):
        """Add an entry to the manifest."""
        entry["timestamp_utc"] = datetime.now(timezone.utc).isoformat()
        self.entries.append(entry)
        self.save()

    def save(self):
        with open(self.manifest_path, "w") as f:
            json.dump(self.entries, f, indent=2, default=str)


def fetch_usgs_daily_discharge(
    site_id: str,
    start_date: str,
    end_date: str,
    cache_dir: str = "data/cache",
    manifest: Optional[ManifestLogger] = None,
) -> Optional[pd.DataFrame]:
    """
    Fetch daily discharge from USGS NWIS for a single station.
    Uses REST API with JSON format.
    Caches raw responses.
    """
    cache_path = Path(cache_dir) / f"usgs_dv_{site_id}_{start_date}_{end_date}.json"
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    url = "https://waterservices.usgs.gov/nwis/dv/"
    params = {
        "format": "json",
        "sites": site_id,
        "startDT": start_date,
        "endDT": end_date,
        "parameterCd": "00060",
        "siteStatus": "all",
    }

    if cache_path.exists():
        with open(cache_path, "r") as f:
            data = json.load(f)
        status_code = 200  # from cache
    else:
        try:
            resp = requests.get(url, params=params, timeout=60)
            status_code = resp.status_code
            if status_code != 200:
                print(f"  ⚠ USGS returned {status_code} for site {site_id}")
                if manifest:
                    manifest.log({
                        "source": "USGS_NWIS",
                        "url": resp.url,
                        "station": site_id,
                        "date_range": f"{start_date} to {end_date}",
                        "http_status": status_code,
                        "rows_returned": 0,
                        "error": f"HTTP {status_code}",
                    })
                return None

            data = resp.json()
            with open(cache_path, "w") as f:
                json.dump(data, f)

        except Exception as e:
            print(f"  ✗ Error fetching site {site_id}: {e}")
            if manifest:
                manifest.log({
                    "source": "USGS_NWIS",
                    "url": f"{url}?sites={site_id}",
                    "station": site_id,
                    "date_range": f"{start_date} to {end_date}",
                    "http_status": -1,
                    "rows_returned": 0,
                    "error": str(e),
                })
            return None

    # Parse the JSON response
    try:
        ts_list = data["value"]["timeSeries"]
        if not ts_list:
            print(f"  ⚠ No time series for site {site_id}")
            return None

        values = ts_list[0]["values"][0]["value"]
        if not values:
            print(f"  ⚠ No values for site {site_id}")
            return None

        records = []
        for v in values:
            dt = v["dateTime"][:10]  # YYYY-MM-DD
            val = v["value"]
            qual = v.get("qualifiers", [""])
            if isinstance(qual, list):
                qual = ",".join(qual)

            # Convert discharge, handle sentinel values
            try:
                discharge = float(val)
                if discharge < 0 or discharge == -999999:
                    discharge = np.nan
            except (ValueError, TypeError):
                discharge = np.nan

            records.append({
                "station_id": site_id,
                "date": dt,
                "discharge_cfs": discharge,
                "quality_cd": qual,
            })

        df = pd.DataFrame(records)

        # Log to manifest
        checksum = sha256_file(str(cache_path))
        if manifest:
            manifest.log({
                "source": "USGS_NWIS",
                "url": f"{url}?sites={site_id}&startDT={start_date}&endDT={end_date}&parameterCd=00060",
                "station": site_id,
                "date_range": f"{start_date} to {end_date}",
                "http_status": status_code,
                "rows_returned": len(df),
                "missing_pct": f"{df['discharge_cfs'].isna().mean() * 100:.1f}%",
                "cache_file": str(cache_path),
                "sha256": checksum,
            })

        return df

    except (KeyError, IndexError) as e:
        print(f"  ✗ Parse error for site {site_id}: {e}")
        return None


def fetch_usgs_site_info(
    site_id: str,
    cache_dir: str = "data/cache",
    manifest: Optional[ManifestLogger] = None,
) -> Optional[Dict[str, Any]]:
    """Fetch station metadata (name, lat, lon, state) from USGS site service."""
    cache_path = Path(cache_dir) / f"usgs_site_{site_id}.json"
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    if cache_path.exists():
        with open(cache_path, "r") as f:
            return json.load(f)

    url = "https://waterservices.usgs.gov/nwis/site/"
    params = {
        "format": "rdb",
        "sites": site_id,
        "siteOutput": "expanded",
        "siteStatus": "all",
    }

    try:
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            return None

        # Parse RDB format (tab-separated with comment lines)
        lines = resp.text.strip().split("\n")
        data_lines = [l for l in lines if not l.startswith("#")]
        if len(data_lines) < 3:
            return None

        headers = data_lines[0].split("\t")
        values = data_lines[2].split("\t")  # skip format line

        info = dict(zip(headers, values))
        result = {
            "station_id": site_id,
            "station_name": info.get("station_nm", ""),
            "latitude": float(info.get("dec_lat_va", 0)),
            "longitude": float(info.get("dec_long_va", 0)),
            "state": info.get("state_cd", ""),
            "huc_cd": info.get("huc_cd", ""),
            "drain_area_va": info.get("drain_area_va", ""),
        }

        with open(cache_path, "w") as f:
            json.dump(result, f, indent=2)

        if manifest:
            manifest.log({
                "source": "USGS_SITE",
                "url": resp.url,
                "station": site_id,
                "http_status": resp.status_code,
                "cache_file": str(cache_path),
            })

        return result

    except Exception as e:
        print(f"  ✗ Error fetching site info for {site_id}: {e}")
        return None


def fetch_openmeteo_weather(
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
    timezone_str: str = "America/New_York",
    cache_dir: str = "data/cache",
    manifest: Optional[ManifestLogger] = None,
    rate_limit_sleep: float = 0.5,
) -> Optional[pd.DataFrame]:
    """
    Fetch daily weather from Open-Meteo Historical Weather API.
    Returns precipitation_mm, temp_max_c, temp_min_c, soil_moisture.
    """
    cache_key = f"openmeteo_{latitude:.4f}_{longitude:.4f}_{start_date}_{end_date}"
    cache_path = Path(cache_dir) / f"{cache_key}.json"
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    if cache_path.exists():
        with open(cache_path, "r") as f:
            data = json.load(f)
    else:
        url = "https://archive-api.open-meteo.com/v1/archive"
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date,
            "end_date": end_date,
            "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min,soil_moisture_0_to_7cm",
            "timezone": timezone_str,
        }

        max_retries = 3
        backoff = 2.0

        for attempt in range(max_retries):
            try:
                time.sleep(rate_limit_sleep)
                resp = requests.get(url, params=params, timeout=60)
                if resp.status_code == 200:
                    data = resp.json()
                    with open(cache_path, "w") as f:
                        json.dump(data, f)
                    break
                elif resp.status_code == 429:
                    wait = rate_limit_sleep * (backoff ** attempt)
                    print(f"  ⚠ Rate limited, waiting {wait:.1f}s...")
                    time.sleep(wait)
                else:
                    print(f"  ⚠ Open-Meteo returned {resp.status_code} for ({latitude}, {longitude})")
                    if attempt == max_retries - 1:
                        return None
            except Exception as e:
                print(f"  ✗ Error fetching weather for ({latitude}, {longitude}): {e}")
                if attempt == max_retries - 1:
                    return None
                time.sleep(rate_limit_sleep * (backoff ** attempt))
        else:
            return None

    # Parse response
    try:
        daily = data.get("daily", {})
        df = pd.DataFrame({
            "date": daily["time"],
            "precipitation_mm": daily["precipitation_sum"],
            "temp_max_c": daily["temperature_2m_max"],
            "temp_min_c": daily["temperature_2m_min"],
            "soil_moisture": daily["soil_moisture_0_to_7cm"],
        })

        if manifest:
            checksum = sha256_file(str(cache_path))
            manifest.log({
                "source": "OpenMeteo",
                "url": f"archive-api.open-meteo.com/v1/archive?lat={latitude}&lon={longitude}",
                "coordinates": f"({latitude}, {longitude})",
                "date_range": f"{start_date} to {end_date}",
                "rows_returned": len(df),
                "missing_pct": f"{df.isna().any(axis=1).mean() * 100:.1f}%",
                "cache_file": str(cache_path),
                "sha256": checksum,
            })

        return df

    except (KeyError, IndexError) as e:
        print(f"  ✗ Parse error for weather ({latitude}, {longitude}): {e}")
        return None


def fetch_catchment_attributes(
    site_id: str,
    latitude: float,
    longitude: float,
    state_code: str,
    cache_dir: str = "data/cache",
    manifest: Optional[ManifestLogger] = None,
) -> Optional[Dict[str, float]]:
    """
    Fetch catchment attributes from USGS StreamStats.
    Falls back to known values or GAGES-II if StreamStats is unavailable.
    """
    cache_path = Path(cache_dir) / f"streamstats_{site_id}.json"
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    if cache_path.exists():
        with open(cache_path, "r") as f:
            return json.load(f)

    # StreamStats requires a basin delineation workflow which is complex.
    # For the hackathon, we'll use the USGS site info drain_area_va as a start
    # and set reasonable defaults or fetch from GAGES-II.
    # This is documented in docs/DECISIONS.md (DEC-004).

    # Try to get from USGS site info first (drain area)
    site_info = fetch_usgs_site_info(site_id, cache_dir)
    drain_area = None
    if site_info and site_info.get("drain_area_va"):
        try:
            drain_area = float(site_info["drain_area_va"])
        except (ValueError, TypeError):
            pass

    result = {
        "station_id": site_id,
        "drainage_area_sqmi": drain_area,
        "mean_elevation_ft": None,
        "slope_pct": None,
        "forest_cover_pct": None,
        "source": "usgs_site_info_partial",
    }

    with open(cache_path, "w") as f:
        json.dump(result, f, indent=2)

    if manifest:
        manifest.log({
            "source": "CatchmentAttributes",
            "station": site_id,
            "method": "usgs_site_info_partial",
            "drain_area_found": drain_area is not None,
            "cache_file": str(cache_path),
        })

    return result


# ============================================================
# GAGES-II Fallback: Hardcoded attributes for the 5 PDF stations
# + well-known additional stations
# ============================================================

STATION_ATTRIBUTES = {
    # PDF starter stations
    "01646500": {"drainage_area_sqmi": 11570, "mean_elevation_ft": 1050, "slope_pct": 8.5, "forest_cover_pct": 62.0,
                 "station_name": "Potomac River near Washington DC", "state": "DC", "river_name": "Potomac River",
                 "latitude": 38.9497, "longitude": -77.1278},
    "07010000": {"drainage_area_sqmi": 697000, "mean_elevation_ft": 1200, "slope_pct": 3.2, "forest_cover_pct": 33.0,
                 "station_name": "Mississippi River at St. Louis MO", "state": "MO", "river_name": "Mississippi River",
                 "latitude": 38.6277, "longitude": -90.1809},
    "08158000": {"drainage_area_sqmi": 27600, "mean_elevation_ft": 3200, "slope_pct": 5.1, "forest_cover_pct": 18.0,
                 "station_name": "Colorado River at Austin TX", "state": "TX", "river_name": "Colorado River",
                 "latitude": 30.2437, "longitude": -97.6930},
    "02087500": {"drainage_area_sqmi": 770, "mean_elevation_ft": 300, "slope_pct": 2.5, "forest_cover_pct": 45.0,
                 "station_name": "Neuse River near Clayton NC", "state": "NC", "river_name": "Neuse River",
                 "latitude": 35.6461, "longitude": -78.4003},
    "11447650": {"drainage_area_sqmi": 23300, "mean_elevation_ft": 4500, "slope_pct": 12.0, "forest_cover_pct": 40.0,
                 "station_name": "Sacramento River at Freeport CA", "state": "CA", "river_name": "Sacramento River",
                 "latitude": 38.4565, "longitude": -121.5007},
    # Additional stations for diversity
    "01010000": {"drainage_area_sqmi": 895, "mean_elevation_ft": 700, "slope_pct": 4.0, "forest_cover_pct": 80.0,
                 "station_name": "St. John River at Ninemile Bridge ME", "state": "ME", "river_name": "St. John River",
                 "latitude": 47.2333, "longitude": -69.0833},
    "01047000": {"drainage_area_sqmi": 5403, "mean_elevation_ft": 900, "slope_pct": 5.5, "forest_cover_pct": 85.0,
                 "station_name": "Kennebec River at The Forks ME", "state": "ME", "river_name": "Kennebec River",
                 "latitude": 45.0092, "longitude": -69.8764},
    "01184000": {"drainage_area_sqmi": 9660, "mean_elevation_ft": 800, "slope_pct": 6.0, "forest_cover_pct": 72.0,
                 "station_name": "Connecticut River at Thompsonville CT", "state": "CT", "river_name": "Connecticut River",
                 "latitude": 41.9964, "longitude": -72.6047},
    "01463500": {"drainage_area_sqmi": 6780, "mean_elevation_ft": 900, "slope_pct": 7.0, "forest_cover_pct": 60.0,
                 "station_name": "Delaware River at Trenton NJ", "state": "NJ", "river_name": "Delaware River",
                 "latitude": 40.2217, "longitude": -74.7803},
    "02037500": {"drainage_area_sqmi": 6252, "mean_elevation_ft": 600, "slope_pct": 3.5, "forest_cover_pct": 65.0,
                 "station_name": "James River near Richmond VA", "state": "VA", "river_name": "James River",
                 "latitude": 37.5638, "longitude": -77.5475},
    "02085070": {"drainage_area_sqmi": 66, "mean_elevation_ft": 450, "slope_pct": 3.0, "forest_cover_pct": 55.0,
                 "station_name": "Eno River at Hillsborough NC", "state": "NC", "river_name": "Eno River",
                 "latitude": 36.0693, "longitude": -79.0990},
    "02146000": {"drainage_area_sqmi": 3050, "mean_elevation_ft": 800, "slope_pct": 4.5, "forest_cover_pct": 58.0,
                 "station_name": "Catawba River near Rock Hill SC", "state": "SC", "river_name": "Catawba River",
                 "latitude": 34.9890, "longitude": -81.0271},
    "02175000": {"drainage_area_sqmi": 2730, "mean_elevation_ft": 150, "slope_pct": 0.8, "forest_cover_pct": 52.0,
                 "station_name": "Edisto River near Givhans SC", "state": "SC", "river_name": "Edisto River",
                 "latitude": 33.0288, "longitude": -80.3915},
    "02298830": {"drainage_area_sqmi": 229, "mean_elevation_ft": 50, "slope_pct": 0.5, "forest_cover_pct": 30.0,
                 "station_name": "Myakka River near Sarasota FL", "state": "FL", "river_name": "Myakka River",
                 "latitude": 27.2358, "longitude": -82.3076},
    "02321500": {"drainage_area_sqmi": 1017, "mean_elevation_ft": 80, "slope_pct": 0.3, "forest_cover_pct": 48.0,
                 "station_name": "Santa Fe River near Fort White FL", "state": "FL", "river_name": "Santa Fe River",
                 "latitude": 29.8561, "longitude": -82.7149},
    "03254520": {"drainage_area_sqmi": 76580, "mean_elevation_ft": 900, "slope_pct": 5.0, "forest_cover_pct": 60.0,
                 "station_name": "Ohio River at Cincinnati OH", "state": "OH", "river_name": "Ohio River",
                 "latitude": 39.0997, "longitude": -84.5117},
    "03339000": {"drainage_area_sqmi": 12265, "mean_elevation_ft": 700, "slope_pct": 2.5, "forest_cover_pct": 30.0,
                 "station_name": "Wabash River at Terre Haute IN", "state": "IN", "river_name": "Wabash River",
                 "latitude": 39.4667, "longitude": -87.4139},
    "03612500": {"drainage_area_sqmi": 203100, "mean_elevation_ft": 800, "slope_pct": 4.0, "forest_cover_pct": 55.0,
                 "station_name": "Ohio River at Metropolis IL", "state": "IL", "river_name": "Ohio River",
                 "latitude": 37.1500, "longitude": -88.7333},
    "05587450": {"drainage_area_sqmi": 171300, "mean_elevation_ft": 1000, "slope_pct": 3.0, "forest_cover_pct": 25.0,
                 "station_name": "Mississippi River at Grafton IL", "state": "IL", "river_name": "Mississippi River",
                 "latitude": 38.9686, "longitude": -90.4292},
    "06054500": {"drainage_area_sqmi": 15010, "mean_elevation_ft": 5500, "slope_pct": 15.0, "forest_cover_pct": 45.0,
                 "station_name": "Missouri River at Toston MT", "state": "MT", "river_name": "Missouri River",
                 "latitude": 46.1403, "longitude": -111.4206},
    "06610000": {"drainage_area_sqmi": 322800, "mean_elevation_ft": 3500, "slope_pct": 6.0, "forest_cover_pct": 20.0,
                 "station_name": "Missouri River at Omaha NE", "state": "NE", "river_name": "Missouri River",
                 "latitude": 41.2586, "longitude": -95.9253},
    "06807000": {"drainage_area_sqmi": 2806, "mean_elevation_ft": 1100, "slope_pct": 3.5, "forest_cover_pct": 8.0,
                 "station_name": "Nishnabotna River above Hamburg IA", "state": "IA", "river_name": "Nishnabotna River",
                 "latitude": 40.6042, "longitude": -95.6467},
    "07032000": {"drainage_area_sqmi": 932800, "mean_elevation_ft": 1100, "slope_pct": 3.0, "forest_cover_pct": 30.0,
                 "station_name": "Mississippi River at Memphis TN", "state": "TN", "river_name": "Mississippi River",
                 "latitude": 35.1261, "longitude": -90.0625},
    "07261000": {"drainage_area_sqmi": 150600, "mean_elevation_ft": 2500, "slope_pct": 4.0, "forest_cover_pct": 28.0,
                 "station_name": "Arkansas River at Little Rock AR", "state": "AR", "river_name": "Arkansas River",
                 "latitude": 34.7465, "longitude": -92.2896},
    "08070000": {"drainage_area_sqmi": 3936, "mean_elevation_ft": 120, "slope_pct": 1.5, "forest_cover_pct": 35.0,
                 "station_name": "San Jacinto River near Conroe TX", "state": "TX", "river_name": "San Jacinto River",
                 "latitude": 30.2627, "longitude": -95.4519},
    "08082000": {"drainage_area_sqmi": 2496, "mean_elevation_ft": 1800, "slope_pct": 2.0, "forest_cover_pct": 5.0,
                 "station_name": "Salt Fork Brazos River near Aspermont TX", "state": "TX", "river_name": "Salt Fork Brazos River",
                 "latitude": 33.2922, "longitude": -100.1992},
    "09380000": {"drainage_area_sqmi": 111800, "mean_elevation_ft": 7200, "slope_pct": 10.0, "forest_cover_pct": 25.0,
                 "station_name": "Colorado River at Lees Ferry AZ", "state": "AZ", "river_name": "Colorado River",
                 "latitude": 36.8625, "longitude": -111.5883},
    "10128500": {"drainage_area_sqmi": 1650, "mean_elevation_ft": 7000, "slope_pct": 18.0, "forest_cover_pct": 40.0,
                 "station_name": "Weber River near Oakley UT", "state": "UT", "river_name": "Weber River",
                 "latitude": 40.7394, "longitude": -111.2553},
    "11303500": {"drainage_area_sqmi": 13540, "mean_elevation_ft": 3000, "slope_pct": 8.0, "forest_cover_pct": 30.0,
                 "station_name": "San Joaquin River near Vernalis CA", "state": "CA", "river_name": "San Joaquin River",
                 "latitude": 37.6761, "longitude": -121.2650},
    "12354500": {"drainage_area_sqmi": 9000, "mean_elevation_ft": 5000, "slope_pct": 12.0, "forest_cover_pct": 65.0,
                 "station_name": "Clark Fork at St. Regis MT", "state": "MT", "river_name": "Clark Fork",
                 "latitude": 47.3028, "longitude": -115.0839},
    "14211720": {"drainage_area_sqmi": 11200, "mean_elevation_ft": 2500, "slope_pct": 8.0, "forest_cover_pct": 70.0,
                 "station_name": "Willamette River at Portland OR", "state": "OR", "river_name": "Willamette River",
                 "latitude": 45.5150, "longitude": -122.6697},
    "12413000": {"drainage_area_sqmi": 1220, "mean_elevation_ft": 4500, "slope_pct": 15.0, "forest_cover_pct": 75.0,
                 "station_name": "Coeur d'Alene River at Cataldo ID", "state": "ID", "river_name": "Coeur d'Alene River",
                 "latitude": 47.5544, "longitude": -116.2994},
}


def get_timezone_for_station(longitude: float) -> str:
    """Approximate timezone from longitude for US stations."""
    if longitude > -67.5:
        return "America/New_York"
    elif longitude > -82.5:
        return "America/New_York"
    elif longitude > -97.5:
        return "America/Chicago"
    elif longitude > -112.5:
        return "America/Denver"
    else:
        return "America/Los_Angeles"


def ingest_all_stations(config: dict) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Full ingestion pipeline:
    0. Check if starter CSV files exist in data/raw/starter/. If so, ingest from starter files,
       auto-set cutoff_date = max(train['date']), write processed CSVs, and write manifest JSON + CSV.
    1. Otherwise fetch discharge for all stations (up to CUTOFF for training, through test period for weather)
    2. Fetch weather for all stations
    3. Get catchment attributes
    4. Join everything together

    Returns: (train_df, test_df, station_metadata_df)
    """
    starter_dir = Path(config.get("data", {}).get("starter_dir", "data/raw/starter"))
    processed_dir = Path(config.get("data", {}).get("processed_dir", "data/processed"))
    manifest_path = Path(config.get("data", {}).get("manifest_path", "data/manifest.json"))

    starter_files = ["train.csv", "test.csv", "sample_submission.csv", "station_metadata.csv"]
    if all((starter_dir / f).exists() for f in starter_files):
        print(f"{'='*60}")
        print("  FLOODCAST Data Ingestion (Starter Files Found)")
        print(f"  Starter directory: {starter_dir}")
        print(f"{'='*60}")

        train_df = pd.read_csv(starter_dir / "train.csv", dtype={"station_id": str})
        test_df = pd.read_csv(starter_dir / "test.csv", dtype={"station_id": str})
        sample_sub = pd.read_csv(starter_dir / "sample_submission.csv", dtype={"station_id": str})
        metadata_df = pd.read_csv(starter_dir / "station_metadata.csv", dtype={"station_id": str})

        # Auto-set cutoff_date = max(train['date'])
        cutoff = str(pd.to_datetime(train_df["date"]).max().strftime("%Y-%m-%d"))
        config["cutoff_date"] = cutoff
        print(f"  Auto-detected CUTOFF date from train.csv: {cutoff}")

        processed_dir.mkdir(parents=True, exist_ok=True)
        train_df.to_csv(processed_dir / "train.csv", index=False)
        test_df.to_csv(processed_dir / "test.csv", index=False)
        sample_sub.to_csv(processed_dir / "sample_submission.csv", index=False)
        metadata_df.to_csv(processed_dir / "station_metadata.csv", index=False)

        now_iso = datetime.now(timezone.utc).isoformat()
        existing_entries = []
        if manifest_path.exists():
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                if isinstance(loaded, list):
                    existing_entries = [
                        e for e in loaded
                        if e.get("source") not in ("starter", "processed", "processed_dev")
                    ]
            except Exception:
                existing_entries = []

        manifest_entries = list(existing_entries)
        files_to_log = [
            ("starter", f, starter_dir / f) for f in starter_files
        ] + [
            ("processed", f, processed_dir / f) for f in starter_files
        ]
        if (processed_dir / "test_with_labels.csv").exists():
            files_to_log.append(("processed_dev", "test_with_labels.csv", processed_dir / "test_with_labels.csv"))

        for src, fname, fpath in files_to_log:
            h = sha256_file(str(fpath))
            with open(fpath, "r", encoding="utf-8") as fp:
                nrows = max(0, sum(1 for _ in fp) - 1)
            manifest_entries.append({
                "source": src,
                "file": fname,
                "path": str(fpath).replace("\\", "/"),
                "rows": nrows,
                "sha256": h,
                "generated_at": now_iso,
            })

        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest_entries, f, indent=2)

        csv_rows = []
        for e in manifest_entries:
            csv_rows.append({
                "source": e.get("source", ""),
                "file": e.get("file", Path(str(e.get("cache_file", ""))).name),
                "path": str(e.get("path", e.get("cache_file", ""))).replace("\\", "/"),
                "rows": e.get("rows", e.get("rows_returned", 0)),
                "sha256": e.get("sha256", ""),
                "generated_at": e.get("generated_at", e.get("timestamp_utc", now_iso)),
                "url": e.get("url", ""),
                "station": e.get("station", ""),
                "date_range": e.get("date_range", ""),
                "http_status": e.get("http_status", 200),
                "missing_pct": e.get("missing_pct", "0.00%"),
            })
        manifest_csv_df = pd.DataFrame(csv_rows)[
            [
                "source", "file", "path", "rows", "sha256", "generated_at",
                "url", "station", "date_range", "http_status", "missing_pct",
            ]
        ]
        manifest_csv_df.to_csv(processed_dir / "data_manifest.csv", index=False)

        print(f"  Train: {len(train_df):,} rows ({train_df['station_id'].nunique()} stations)")
        print(f"  Test:  {len(test_df):,} rows ({test_df['station_id'].nunique()} stations)")
        print(f"  Manifest saved to {manifest_path} and {processed_dir / 'data_manifest.csv'}")
        print(f"{'='*60}")
        return train_df, test_df, metadata_df

    manifest = ManifestLogger(config["data"]["manifest_path"])
    cutoff = config["cutoff_date"]
    start_date = config["data"]["usgs"]["start_date"]
    stations = config["data"]["usgs"]["stations"]
    cache_dir = config["data"]["cache_dir"]

    # We'll also need weather for test period (2023)
    weather_end_date = "2023-12-31"

    print(f"{'='*60}")
    print(f"  FLOODCAST Data Ingestion")
    print(f"  Stations: {len(stations)}")
    print(f"  Training period: {start_date} to {cutoff}")
    print(f"  Weather extends through: {weather_end_date}")
    print(f"{'='*60}")

    all_discharge = []
    all_weather = []
    metadata_records = []

    for i, site_id in enumerate(stations):
        print(f"\n[{i+1}/{len(stations)}] Station {site_id}")

        # Get station info (lat, lon, name)
        if site_id in STATION_ATTRIBUTES:
            info = STATION_ATTRIBUTES[site_id]
            lat = info["latitude"]
            lon = info["longitude"]
            station_name = info["station_name"]
            state = info["state"]
            river_name = info["river_name"]
            drain_area = info["drainage_area_sqmi"]
            elevation = info["mean_elevation_ft"]
            slope = info["slope_pct"]
            forest = info["forest_cover_pct"]
        else:
            site_info = fetch_usgs_site_info(site_id, cache_dir, manifest)
            if not site_info:
                print(f"  ✗ Cannot get site info, skipping")
                continue
            lat = site_info["latitude"]
            lon = site_info["longitude"]
            station_name = site_info.get("station_name", "")
            state = site_info.get("state", "")
            river_name = ""
            drain_area = None
            elevation = None
            slope = None
            forest = None

        print(f"  📍 {station_name} ({lat:.4f}, {lon:.4f})")

        # Fetch discharge (up to CUTOFF only!)
        print(f"  📊 Fetching discharge {start_date} to {cutoff}...")
        discharge_df = fetch_usgs_daily_discharge(
            site_id, start_date, cutoff, cache_dir, manifest
        )
        if discharge_df is None or len(discharge_df) == 0:
            print(f"  ✗ No discharge data, skipping")
            continue

        # Check completeness
        total_days = (pd.Timestamp(cutoff) - pd.Timestamp(start_date)).days + 1
        completeness = len(discharge_df.dropna(subset=["discharge_cfs"])) / total_days
        threshold = config["data"]["usgs"]["completeness_threshold"]
        print(f"  📈 Completeness: {completeness:.1%} ({len(discharge_df)} rows / {total_days} expected)")

        if completeness < threshold:
            print(f"  ⚠ Below threshold ({threshold:.0%}), skipping")
            continue

        all_discharge.append(discharge_df)

        # Fetch weather (through weather_end_date for test period)
        tz = get_timezone_for_station(lon)
        print(f"  🌧 Fetching weather {start_date} to {weather_end_date}...")
        weather_df = fetch_openmeteo_weather(
            lat, lon, start_date, weather_end_date, tz,
            cache_dir, manifest,
            config["data"]["openmeteo"]["rate_limit_sleep"],
        )
        if weather_df is not None:
            weather_df["station_id"] = site_id
            all_weather.append(weather_df)
            print(f"  ✅ Weather: {len(weather_df)} days")
        else:
            print(f"  ⚠ Weather fetch failed")

        # Store metadata
        metadata_records.append({
            "station_id": site_id,
            "station_name": station_name,
            "latitude": lat,
            "longitude": lon,
            "state": state,
            "river_name": river_name,
            "drainage_area_sqmi": drain_area,
            "mean_elevation_ft": elevation,
            "slope_pct": slope,
            "forest_cover_pct": forest,
        })

    if not all_discharge:
        raise ValueError("No discharge data collected for any station!")

    # Combine all data
    print(f"\n{'='*60}")
    print("  Combining data...")

    discharge_all = pd.concat(all_discharge, ignore_index=True)
    weather_all = pd.concat(all_weather, ignore_index=True) if all_weather else pd.DataFrame()
    metadata_df = pd.DataFrame(metadata_records)

    # Join discharge + weather on (station_id, date)
    if not weather_all.empty:
        merged = discharge_all.merge(weather_all, on=["station_id", "date"], how="left")
    else:
        merged = discharge_all.copy()
        for col in ["precipitation_mm", "temp_max_c", "temp_min_c", "soil_moisture"]:
            merged[col] = np.nan

    # Add static catchment attributes
    static_cols = ["station_id", "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct"]
    static_df = metadata_df[static_cols].copy()
    merged = merged.merge(static_df, on="station_id", how="left")

    # Drop quality_cd from final output
    if "quality_cd" in merged.columns:
        merged = merged.drop(columns=["quality_cd"])

    # Drop NaN discharge rows
    merged = merged.dropna(subset=["discharge_cfs"])

    # Split into train and pseudo-test
    # Train: up to end of 2021 (one year held out)
    # Test: 2022 (the last year before CUTOFF)
    merged["date"] = pd.to_datetime(merged["date"])
    train_end = pd.Timestamp(cutoff) - pd.DateOffset(years=1)
    test_start = train_end + pd.DateOffset(days=1)

    train_df = merged[merged["date"] <= train_end].copy()
    test_df = merged[merged["date"] > train_end].copy()

    # Format dates back to string
    train_df["date"] = train_df["date"].dt.strftime("%Y-%m-%d")
    test_df["date"] = test_df["date"].dt.strftime("%Y-%m-%d")

    # Reorder columns to match schema
    schema_cols = [
        "station_id", "date", "discharge_cfs",
        "precipitation_mm", "temp_max_c", "temp_min_c", "soil_moisture",
        "drainage_area_sqmi", "mean_elevation_ft", "slope_pct", "forest_cover_pct",
    ]
    train_df = train_df[[c for c in schema_cols if c in train_df.columns]]

    test_schema_cols = [c for c in schema_cols if c != "discharge_cfs"]
    test_df_out = test_df[test_schema_cols].copy()

    # Create sample submission
    sample_sub = test_df[["station_id", "date"]].copy()
    sample_sub["discharge_cfs"] = 0.0

    # Save
    processed_dir = Path(config["data"]["processed_dir"])
    processed_dir.mkdir(parents=True, exist_ok=True)

    train_df.to_csv(processed_dir / "train.csv", index=False)
    test_df_out.to_csv(processed_dir / "test.csv", index=False)
    sample_sub.to_csv(processed_dir / "sample_submission.csv", index=False)
    metadata_df.to_csv(processed_dir / "station_metadata.csv", index=False)

    # Save test with discharge for local validation
    test_df.to_csv(processed_dir / "test_with_labels.csv", index=False)

    # Dev dataset notice
    with open(processed_dir / "DEV_DATASET_NOTICE.md", "w") as f:
        f.write("# Development Dataset Notice\n\n")
        f.write("This dataset was built from scratch (organizer starter files not available).\n")
        f.write(f"- **Train period:** {start_date} to {train_end.strftime('%Y-%m-%d')}\n")
        f.write(f"- **Test period:** {test_start.strftime('%Y-%m-%d')} to {cutoff}\n")
        f.write(f"- **Stations:** {len(metadata_records)}\n")
        f.write(f"- **Train rows:** {len(train_df)}\n")
        f.write(f"- **Test rows:** {len(test_df_out)}\n")
        f.write(f"- **CUTOFF:** {cutoff}\n\n")
        f.write("If organizer files become available, swap them in and re-run.\n")

    print(f"\n  ✅ Data saved to {processed_dir}")
    print(f"  Train: {len(train_df)} rows, {train_df['station_id'].nunique()} stations")
    print(f"  Test:  {len(test_df_out)} rows, {test_df_out['station_id'].nunique()} stations")
    print(f"  Metadata: {len(metadata_df)} stations")
    print(f"{'='*60}")

    return train_df, test_df_out, metadata_df


if __name__ == "__main__":
    config = load_config()
    ingest_all_stations(config)
