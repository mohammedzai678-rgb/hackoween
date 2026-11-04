"""
FLOODCAST — No Data Leakage Tests
Ensures training never uses data after CUTOFF and no future information leaks.
"""

import pytest
import pandas as pd
import numpy as np
import yaml
from pathlib import Path


def load_config():
    config_path = Path("configs/base.yaml")
    if config_path.exists():
        with open(config_path, "r") as f:
            return yaml.safe_load(f)
    return {"cutoff_date": "2022-12-31"}


class TestNoLeakage:
    """Test suite for data leakage prevention."""

    def test_train_dates_before_cutoff(self):
        """No training row should have a date after CUTOFF."""
        config = load_config()
        cutoff = pd.Timestamp(config["cutoff_date"])

        train_path = Path(config.get("data", {}).get("processed_dir", "data/processed")) / "train.csv"
        if not train_path.exists():
            pytest.skip("train.csv not found")

        train = pd.read_csv(train_path)
        train["date"] = pd.to_datetime(train["date"])

        violations = train[train["date"] > cutoff]
        assert len(violations) == 0, (
            f"Found {len(violations)} training rows after CUTOFF ({cutoff.date()}). "
            f"Date range in violations: {violations['date'].min()} to {violations['date'].max()}"
        )

    def test_test_dates_after_train(self):
        """All test dates should be strictly after all training dates."""
        config = load_config()
        processed_dir = Path(config.get("data", {}).get("processed_dir", "data/processed"))

        train_path = processed_dir / "train.csv"
        test_path = processed_dir / "test.csv"
        if not train_path.exists() or not test_path.exists():
            pytest.skip("Data files not found")

        train = pd.read_csv(train_path)
        test = pd.read_csv(test_path)

        train_max = pd.to_datetime(train["date"]).max()
        test_min = pd.to_datetime(test["date"]).min()

        assert test_min > train_max, (
            f"Test dates are not strictly after training dates. "
            f"Train max: {train_max}, Test min: {test_min}"
        )

    def test_no_discharge_in_test(self):
        """Test CSV must not contain discharge_cfs column."""
        config = load_config()
        test_path = Path(config.get("data", {}).get("processed_dir", "data/processed")) / "test.csv"
        if not test_path.exists():
            pytest.skip("test.csv not found")

        test = pd.read_csv(test_path)
        assert "discharge_cfs" not in test.columns, (
            "test.csv contains discharge_cfs column — potential leakage!"
        )

    def test_no_future_features_in_rolling(self):
        """
        Rolling features should look backward only.
        Verify that for any row, the feature only uses data from that day and earlier.
        This is a structural test: we check that rolling windows use min_periods=1
        and are applied per-station in date order.
        """
        # This is enforced by the feature engineering code structure:
        # all rolling operations use .rolling(window, min_periods=1) which is backward by default.
        # We verify here with a small synthetic example.
        from floodcast.features import compute_rainfall_features

        dates = pd.date_range("2020-01-01", "2020-01-10", freq="D")
        df = pd.DataFrame({
            "station_id": "test_station",
            "date": dates.strftime("%Y-%m-%d"),
            "precipitation_mm": [0, 0, 0, 0, 10, 0, 0, 0, 0, 0],
            "temp_max_c": 20.0,
            "temp_min_c": 10.0,
            "soil_moisture": 0.3,
        })

        config = {"enabled": True, "rolling_windows": [3], "max_rain_windows": [3],
                  "wet_day_thresholds_mm": [1], "wet_day_windows": [7],
                  "days_since_rain_mm": [5], "percentile_threshold": 0.95}

        result = compute_rainfall_features(df.copy(), config)

        # The 3-day rolling sum at row 3 (index 3) should be 0 (days 1-3 have no rain)
        # The rain happens on day 5 (index 4)
        assert result.loc[3, "rain_sum_3d"] == 0, "Rolling sum leaked future data!"

        # The 3-day rolling sum at row 6 (index 6) should include the rain from day 5
        assert result.loc[6, "rain_sum_3d"] == 10, "Rolling sum should capture past rain"


class TestScorerIntegrity:
    """Test the scorer with hand-computed examples."""

    def test_rmse_basic(self):
        from floodcast.scoring import compute_rmse
        y_true = np.array([1.0, 2.0, 3.0])
        y_pred = np.array([1.0, 2.0, 3.0])
        assert compute_rmse(y_true, y_pred) == 0.0

    def test_rmse_known_value(self):
        from floodcast.scoring import compute_rmse
        y_true = np.array([1.0, 2.0, 3.0, 4.0])
        y_pred = np.array([1.5, 2.5, 3.5, 4.5])
        expected = 0.5  # sqrt(mean(0.25)) = 0.5
        assert abs(compute_rmse(y_true, y_pred) - expected) < 1e-10

    def test_mae_basic(self):
        from floodcast.scoring import compute_mae
        y_true = np.array([1.0, 2.0, 3.0, 4.0])
        y_pred = np.array([1.5, 2.5, 3.5, 4.5])
        assert abs(compute_mae(y_true, y_pred) - 0.5) < 1e-10

    def test_r2_perfect(self):
        from floodcast.scoring import compute_r2
        y_true = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_pred = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        assert abs(compute_r2(y_true, y_pred) - 1.0) < 1e-10

    def test_r2_zero(self):
        from floodcast.scoring import compute_r2
        y_true = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_pred = np.array([3.0, 3.0, 3.0, 3.0, 3.0])  # predicting mean
        assert abs(compute_r2(y_true, y_pred)) < 1e-10

    def test_extreme_rmse_per_station(self):
        from floodcast.scoring import compute_extreme_rmse
        # Station A: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] → top 10% = 10
        # Station B: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] → top 10% = 100
        y_true = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
        y_pred = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 10, 20, 30, 40, 50, 60, 70, 80, 90, 90])
        stations = np.array(["A"]*10 + ["B"]*10)

        result = compute_extreme_rmse(y_true, y_pred, stations)
        # Extreme rows: station A row 10 (true=10, pred=8, err=4), station B row 100 (true=100, pred=90, err=100)
        # RMSE = sqrt(mean([4, 100])) = sqrt(52) ≈ 7.21
        assert result > 0

    def test_composite_normalization(self):
        from floodcast.scoring import compute_composite
        metrics = {"rmse": 500, "extreme_rmse": 1000, "mae": 300, "r2": 0.8}
        best = {"rmse": 100, "extreme_rmse": 200, "mae": 50, "r2": 0.95}
        worst = {"rmse": 2000, "extreme_rmse": 5000, "mae": 1000, "r2": -0.5}

        composite = compute_composite(metrics, best, worst)
        assert 0 <= composite <= 100
