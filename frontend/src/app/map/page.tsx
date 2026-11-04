"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  fetchRuns,
  fetchStations,
  PredictRowInput,
  RunSummary,
  runPrediction,
  saveSimulation,
  StationSummary,
} from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";
import type { StationMapForecast } from "@/components/StormForecastMap";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookmarkPlus,
  CheckCircle2,
  CloudRain,
  Compass,
  Cpu,
  Database,
  Droplets,
  Globe,
  MapPin,
  Play,
  Radar,
  TrendingUp,
  Waves,
} from "lucide-react";

const StormForecastMap = dynamic(
  () => import("@/components/StormForecastMap"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] w-full items-center justify-center rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] text-sm text-[var(--text-muted)]">
        Loading interactive USGS watershed &amp; storm forecast map…
      </div>
    ),
  }
);

interface StormPreset {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  peakMm: number;
  radiusKm: number;
  soilMoisture: number;
}

const STORM_PRESETS: StormPreset[] = [
  {
    id: "mid_atlantic",
    name: "Mid-Atlantic Nor'easter",
    region: "Potomac · Delaware · Susquehanna",
    lat: 39.2,
    lon: -77.2,
    peakMm: 135,
    radiusKm: 480,
    soilMoisture: 0.72,
  },
  {
    id: "mississippi_valley",
    name: "Mississippi & Ohio Deluge",
    region: "Mississippi · Ohio · Wabash",
    lat: 38.6,
    lon: -89.5,
    peakMm: 145,
    radiusKm: 620,
    soilMoisture: 0.76,
  },
  {
    id: "texas_flash",
    name: "Texas Convective Supercell",
    region: "Colorado TX · Brazos · Guadalupe",
    lat: 30.4,
    lon: -97.6,
    peakMm: 165,
    radiusKm: 420,
    soilMoisture: 0.64,
  },
  {
    id: "pacific_ar",
    name: "Pacific Atmospheric River",
    region: "Sacramento · Willamette · Columbia",
    lat: 40.2,
    lon: -121.8,
    peakMm: 155,
    radiusKm: 580,
    soilMoisture: 0.78,
  },
  {
    id: "southeast_tropical",
    name: "Southeast Tropical Cyclone",
    region: "Neuse · Cape Fear · Savannah",
    lat: 34.8,
    lon: -79.2,
    peakMm: 160,
    radiusKm: 520,
    soilMoisture: 0.74,
  },
];

const CORE_MODELS = [
  { run_id: "run_final_ensemble", label: "Multi-Model Ensemble (Default)" },
  { run_id: "run_xgboost", label: "XGBoost Regressor" },
  { run_id: "run_catboost", label: "CatBoost Regressor" },
  { run_id: "run_flood_peak_weighted", label: "LightGBM Flood-Peak Specialist" },
  { run_id: "run_target_scaled", label: "LightGBM Station-Scaled" },
  { run_id: "run_target_log1p_smearing", label: "LightGBM Log1p + Duan Smearing" },
  { run_id: "run_target_raw", label: "LightGBM Raw L2" },
];

const FORECAST_DAYS = [
  { dayOffset: 1, label: "Day +1 (Onset)", rainFactor: 0.35 },
  { dayOffset: 2, label: "Day +2 (Intensifying)", rainFactor: 0.75 },
  { dayOffset: 3, label: "Day +3 (Storm Peak)", rainFactor: 1.0 },
  { dayOffset: 4, label: "Day +4 (Basin Crest)", rainFactor: 0.65 },
  { dayOffset: 5, label: "Day +5 (Recession)", rainFactor: 0.25 },
];

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function StormMapPage() {
  const { theme } = useTheme();

  const [stations, setStations] = useState<StationSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedModel, setSelectedModel] = useState("run_final_ensemble");
  const [activePresetId, setActivePresetId] = useState("mid_atlantic");

  // Spatial Storm State
  const [stormLat, setStormLat] = useState(39.2);
  const [stormLon, setStormLon] = useState(-77.2);
  const [stormPeakMm, setStormPeakMm] = useState(135);
  const [stormRadiusKm, setStormRadiusKm] = useState(480);
  const [initialSoil, setInitialSoil] = useState(0.72);
  const [forecastDate, setForecastDate] = useState("2022-05-03");
  const [selectedDayOffset, setSelectedDayOffset] = useState(3);

  // Results & UI State
  const [predictionsByStation, setPredictionsByStation] = useState<
    Record<string, { discharge_cfs: number; is_extreme_p90: boolean }>
  >({});
  const [modelUsedLabel, setModelUsedLabel] = useState<string>("");
  const [selectedStationId, setSelectedStationId] = useState<string | null>(
    "01646500"
  );
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savingMapSim, setSavingMapSim] = useState(false);
  const [savedMapNotice, setSavedMapNotice] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Load stations & runs from live backend
  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchStations().catch((err) => {
        if (mounted) setErrorMsg(err?.message || "Failed to load stations.");
        return [] as StationSummary[];
      }),
      fetchRuns().catch(() => [] as RunSummary[]),
    ]).then(([sList, rList]) => {
      if (!mounted) return;
      if (sList.length > 0) setStations(sList);
      if (rList.length > 0) setRuns(rList);
    });
    return () => {
      mounted = false;
      abortRef.current?.abort();
    };
  }, []);

  const modelOptions = useMemo(() => {
    const map = new Map<string, { run_id: string; label: string }>();
    for (const m of CORE_MODELS) {
      map.set(m.run_id, m);
    }
    for (const r of runs) {
      if (
        r.run_id === "run_baseline_climatology" ||
        r.model_family === "baseline"
      ) {
        continue;
      }
      if (!map.has(r.run_id)) {
        map.set(r.run_id, {
          run_id: r.run_id,
          label: `${r.model_type} (${r.target_strategy})`,
        });
      }
    }
    return Array.from(map.values());
  }, [runs]);

  const activeDayConfig =
    FORECAST_DAYS.find((d) => d.dayOffset === selectedDayOffset) ||
    FORECAST_DAYS[2];

  // Compute spatial storm rainfall at each station based on distance from (stormLat, stormLon)
  const spatialInputs = useMemo(() => {
    const baseDt = new Date(`${forecastDate}T00:00:00Z`);
    const targetDateStr = new Date(
      baseDt.getTime() + (selectedDayOffset - 1) * 86400000
    )
      .toISOString()
      .slice(0, 10);

    return stations.map((st) => {
      const distKm = haversineKm(
        stormLat,
        stormLon,
        st.latitude,
        st.longitude
      );
      // Gaussian radial decay from storm center
      const spatialDecay = Math.exp(
        -Math.pow(distKm / Math.max(stormRadiusKm, 50), 2)
      );
      const localRainMm = Number(
        (stormPeakMm * activeDayConfig.rainFactor * spatialDecay).toFixed(1)
      );
      const localSoil = Number(
        Math.min(
          0.92,
          Math.max(
            0.12,
            initialSoil * (0.45 + 0.55 * spatialDecay) + localRainMm * 0.0025
          )
        ).toFixed(3)
      );

      const row: PredictRowInput = {
        station_id: st.station_id,
        date: targetDateStr,
        precipitation_mm: localRainMm,
        temp_max_c: 20.5,
        temp_min_c: 10.2,
        soil_moisture: localSoil,
        drainage_area_sqmi: st.drainage_area_sqmi,
        mean_elevation_ft: st.mean_elevation_ft,
        slope_pct: st.slope_pct,
        forest_cover_pct: st.forest_cover_pct,
      };

      return {
        station: st,
        distanceKm: distKm,
        rainMm: localRainMm,
        soilMoisture: localSoil,
        row,
      };
    });
  }, [
    stations,
    stormLat,
    stormLon,
    stormPeakMm,
    stormRadiusKm,
    initialSoil,
    forecastDate,
    selectedDayOffset,
    activeDayConfig.rainFactor,
  ]);

  // Trigger live ML prediction across all stations when storm parameters change (debounced + abort-safe)
  const runSpatialPrediction = async () => {
    if (spatialInputs.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setErrorMsg(null);

    try {
      const batchRows = spatialInputs.map((item) => item.row);
      const res = await runPrediction(
        batchRows,
        selectedModel,
        controller.signal
      );

      if (!controller.signal.aborted) {
        const nextMap: Record<
          string,
          { discharge_cfs: number; is_extreme_p90: boolean }
        > = {};
        for (const p of res.predictions) {
          nextMap[String(p.station_id)] = {
            discharge_cfs: Number(p.discharge_cfs),
            is_extreme_p90: Boolean(p.is_extreme_p90),
          };
        }
        setPredictionsByStation(nextMap);
        setModelUsedLabel(res.model_used || selectedModel);
        setErrorMsg(null);
      }
    } catch (err: any) {
      if (
        controller.signal.aborted ||
        err?.name === "AbortError" ||
        String(err?.message || "").toLowerCase().includes("abort")
      ) {
        return;
      }
      setErrorMsg(err?.message || "Spatial ML prediction failed.");
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (spatialInputs.length === 0) return;
    const timer = setTimeout(() => {
      runSpatialPrediction();
    }, 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatialInputs, selectedModel]);

  // Combine station metadata + spatial rainfall + live ML discharge predictions
  const stationForecasts: StationMapForecast[] = useMemo(() => {
    return spatialInputs
      .map((item) => {
        const pred = predictionsByStation[item.station.station_id];
        const p90 = item.station.p90_discharge_cfs || 1;
        const p99 = item.station.p99_discharge_cfs || p90 * 2.1;
        const meanDischarge = item.station.mean_discharge_cfs || 1200;

        // Ground-truth fallback flow if model prediction is awaiting completion
        const physicalSurgeEst = Math.round(
          meanDischarge *
            Math.max(1, 1 + (item.rainMm / 18) * (item.soilMoisture / 0.35))
        );
        const predictedCfs =
          pred && pred.discharge_cfs > 0 ? pred.discharge_cfs : physicalSurgeEst;

        const isExtremeP90 = pred
          ? pred.is_extreme_p90 || predictedCfs >= p90
          : predictedCfs >= p90;
        const isSevereP99 = predictedCfs >= p99;
        const surgeRatioP90 = predictedCfs / Math.max(p90, 1);

        return {
          station: item.station,
          distanceKm: item.distanceKm,
          rainMm: item.rainMm,
          soilMoisture: item.soilMoisture,
          predictedCfs,
          isExtremeP90,
          isSevereP99,
          surgeRatioP90,
        };
      })
      .sort((a, b) => b.surgeRatioP90 - a.surgeRatioP90);
  }, [spatialInputs, predictionsByStation]);

  const handleApplyPreset = (preset: StormPreset) => {
    setActivePresetId(preset.id);
    setStormLat(preset.lat);
    setStormLon(preset.lon);
    setStormPeakMm(preset.peakMm);
    setStormRadiusKm(preset.radiusKm);
    setInitialSoil(preset.soilMoisture);
  };

  const handleMapClickStormCenter = (lat: number, lon: number) => {
    setActivePresetId("custom");
    setStormLat(lat);
    setStormLon(lon);
  };

  const floodWatchCount = stationForecasts.filter(
    (s) => s.isExtremeP90
  ).length;
  const criticalSurgeCount = stationForecasts.filter(
    (s) => s.isSevereP99
  ).length;
  const rainImpactedCount = stationForecasts.filter(
    (s) => s.rainMm >= 10
  ).length;
  const highestFlowStation = useMemo(() => {
    if (stationForecasts.length === 0) return null;
    return [...stationForecasts].sort(
      (a, b) => b.predictedCfs - a.predictedCfs
    )[0];
  }, [stationForecasts]);

  const selectedStationForecast = useMemo(() => {
    return (
      stationForecasts.find(
        (s) => s.station.station_id === selectedStationId
      ) || stationForecasts[0] || null
    );
  }, [stationForecasts, selectedStationId]);

  const handleSaveMapSimulation = async () => {
    if (stationForecasts.length === 0) return;
    setSavingMapSim(true);
    setSavedMapNotice(null);
    try {
      const topSt = stationForecasts[0];
      const presetObj = STORM_PRESETS.find((p) => p.id === activePresetId);
      const title = presetObj
        ? `${presetObj.name} (${activeDayConfig.label} · ${selectedModel.replace(
            "run_",
            ""
          )})`
        : `Spatial Storm (${stormLat.toFixed(1)}°N, ${Math.abs(stormLon).toFixed(
            1
          )}°W · ${stormPeakMm}mm)`;

      const saved = await saveSimulation({
        title,
        source: "map",
        run_id: selectedModel,
        model_used: modelUsedLabel || selectedModel,
        station_id: topSt.station.station_id,
        station_name: `${topSt.station.station_name} (+${
          stationForecasts.length - 1
        } gauges)`,
        storm_peak_mm: Number(
          (stormPeakMm * activeDayConfig.rainFactor).toFixed(1)
        ),
        soil_moisture: initialSoil,
        storm_radius_km: stormRadiusKm,
        notes: `32-station spatial storm simulation centered at (${stormLat.toFixed(
          2
        )}N, ${Math.abs(stormLon).toFixed(
          2
        )}W), radius ${stormRadiusKm}km, ${floodWatchCount} P90+ flood surges.`,
        predictions: stationForecasts.slice(0, 14).map((sf) => ({
          station_id: sf.station.station_id,
          date: forecastDate,
          discharge_cfs: sf.predictedCfs,
          precipitation_mm: sf.rainMm,
          soil_moisture: sf.soilMoisture,
          is_extreme_p90: sf.isExtremeP90,
        })),
      });
      setSavedMapNotice(
        `Stored "${saved.title}" in SQLite Vault & indexed into FAISS Vector DB!`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to store spatial simulation.");
    } finally {
      setSavingMapSim(false);
    }
  };

  const [mapViewMode, setMapViewMode] = useState<"map" | "analytics" | "all">("map");

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <Globe className="h-7 w-7 text-[var(--accent)]" />
            Interactive Storm &amp; Flood Forecast Map
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Click anywhere on the map to place a future storm system and run live multi-station discharge predictions across all USGS river gauges.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Mode Mode Tabs (Zero Vertical Scroll Switcher) */}
          <div className="inline-flex items-center rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-1 text-xs shadow-sm">
            <button
              type="button"
              onClick={() => setMapViewMode("map")}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                mapViewMode === "map"
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              🛰️ Satellite Radar Map
            </button>
            <button
              type="button"
              onClick={() => setMapViewMode("analytics")}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                mapViewMode === "analytics"
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              📈 Surge &amp; Decay Curves
            </button>
            <button
              type="button"
              onClick={() => setMapViewMode("all")}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                mapViewMode === "all"
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              📋 Full View
            </button>
          </div>

          <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2 text-xs">
            <Compass className="h-4 w-4 text-[var(--accent)]" />
            <span className="text-[var(--text-muted)]">Center:</span>
            <span className="font-mono font-semibold text-[var(--text-primary)]">
              {stormLat.toFixed(2)}°N, {Math.abs(stormLon).toFixed(2)}°W
            </span>
          </div>
        </div>
      </div>

      {/* Regional Storm Presets Bar */}
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Radar className="h-4 w-4 text-[var(--accent)]" />
            <span>Future Storm Corridor Presets (or click anywhere on map)</span>
          </div>
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)]">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)] animate-ping" />
              Running ML model across {stations.length} stations…
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {STORM_PRESETS.map((preset) => {
            const active = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPreset(preset)}
                className={`text-left rounded-xl border p-3 transition-all ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-light)] shadow-sm"
                    : "border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--border-hover)]"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                    {preset.name}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-[var(--accent)]">
                    {preset.peakMm}mm
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-muted)] truncate">
                  {preset.region}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger-light)] px-4 py-3 text-xs text-[var(--danger)]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Top KPI Summary Cards (Shown in Analytics or Full view) */}
      {(mapViewMode === "analytics" || mapViewMode === "all") && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
              <span>P90+ Flood Surge Gauges</span>
              <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
            </div>
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              {floodWatchCount}{" "}
              <span className="text-xs font-normal text-[var(--text-muted)]">
                / {stations.length} stations
              </span>
            </p>
            <p className="mt-1 text-[11px] text-[var(--danger)] font-medium">
              {criticalSurgeCount} in Critical P99+ Surge
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
              <span>Rain-Impacted Basins</span>
              <CloudRain className="h-4 w-4 text-[var(--accent)]" />
            </div>
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              {rainImpactedCount}{" "}
              <span className="text-xs font-normal text-[var(--text-muted)]">
                gauges (≥10 mm)
              </span>
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Radius: {stormRadiusKm} km · Peak: {stormPeakMm} mm
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
              <span>Highest Predicted Discharge</span>
              <Waves className="h-4 w-4 text-[var(--accent)]" />
            </div>
            <p className="text-2xl font-bold font-mono text-[var(--text-primary)]">
              {highestFlowStation
                ? `${highestFlowStation.predictedCfs.toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                  })} cfs`
                : "—"}
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)] truncate">
              {highestFlowStation
                ? `#${highestFlowStation.station.station_id} · ${highestFlowStation.station.station_name}`
                : "Awaiting prediction"}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
              <span>Active Forecast Horizon</span>
              <Droplets className="h-4 w-4 text-[var(--success)]" />
            </div>
            <p className="text-xl font-bold text-[var(--accent)]">
              {activeDayConfig.label}
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)] truncate">
              {modelUsedLabel || selectedModel}
            </p>
          </div>
        </div>
      )}

      {/* Main Grid: Controls (4 cols) + Map (8 cols) (Shown in Map or Full view) */}
      {(mapViewMode === "map" || mapViewMode === "all") && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Control Panel */}
        <div className="lg:col-span-4 space-y-5">
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Spatial Storm &amp; Model Controls
            </h2>

            {/* ML Model Selector */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Trained ML Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              >
                {modelOptions.map((m) => (
                  <option key={m.run_id} value={m.run_id}>
                    {m.run_id} — {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Forecast Horizon Day Tabs */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Future Storm Timeline Day
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {FORECAST_DAYS.map((d) => {
                  const active = selectedDayOffset === d.dayOffset;
                  return (
                    <button
                      key={d.dayOffset}
                      type="button"
                      onClick={() => setSelectedDayOffset(d.dayOffset)}
                      className={`rounded-lg py-2 px-1 text-center text-xs font-semibold transition ${
                        active
                          ? "bg-[var(--accent)] text-white shadow-sm"
                          : "border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      Day +{d.dayOffset}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Storm Start Date */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Storm Event Date
              </label>
              <input
                type="date"
                value={forecastDate}
                onChange={(e) => setForecastDate(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>

            {/* Storm Peak Rainfall Slider */}
            <div>
              <label className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                <span>Epicenter Peak Rainfall</span>
                <span className="font-mono font-bold text-[var(--accent)]">
                  {stormPeakMm} mm
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={stormPeakMm}
                onChange={(e) => setStormPeakMm(Number(e.target.value))}
                className="w-full accent-[var(--accent)] h-2 rounded-full"
              />
              <div className="flex justify-between text-[11px] text-[var(--text-muted)] mt-1">
                <span>0 mm (Dry)</span>
                <span>100 mm (Severe)</span>
                <span>200 mm (Extreme)</span>
              </div>
            </div>

            {/* Storm Radius Slider */}
            <div>
              <label className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                <span>Storm System Radius</span>
                <span className="font-mono font-bold text-[var(--accent)]">
                  {stormRadiusKm} km
                </span>
              </label>
              <input
                type="range"
                min={150}
                max={1200}
                step={10}
                value={stormRadiusKm}
                onChange={(e) => setStormRadiusKm(Number(e.target.value))}
                className="w-full accent-[var(--accent)] h-2 rounded-full"
              />
              <div className="flex justify-between text-[11px] text-[var(--text-muted)] mt-1">
                <span>150 km (Local Cell)</span>
                <span>1,200 km (Synoptic Front)</span>
              </div>
            </div>

            {/* Antecedent Soil Moisture Slider */}
            <div>
              <label className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                <span>Regional Soil Saturation</span>
                <span className="font-mono font-bold text-[var(--accent)]">
                  {initialSoil.toFixed(2)}
                </span>
              </label>
              <input
                type="range"
                min={0.05}
                max={0.9}
                step={0.01}
                value={initialSoil}
                onChange={(e) => setInitialSoil(Number(e.target.value))}
                className="w-full accent-[var(--accent)] h-2 rounded-full"
              />
              <div className="flex justify-between text-[11px] text-[var(--text-muted)] mt-1">
                <span>0.05 (Arid)</span>
                <span>0.90 (Saturated)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={runSpatialPrediction}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {loading
                ? "Running Spatial ML Forecast…"
                : "Predict Storm Impact Now"}
            </button>

            <button
              type="button"
              onClick={handleSaveMapSimulation}
              disabled={savingMapSim || stationForecasts.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent-light)] px-4 py-2.5 text-xs font-semibold text-[var(--accent)] hover:brightness-105 disabled:opacity-50 transition"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              {savingMapSim
                ? "Storing in Vault & FAISS…"
                : "Store Spatial Forecast in Vault & RAG"}
            </button>

            {savedMapNotice && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--success)]/40 bg-[var(--success-light)] px-3 py-2 text-[11px] text-[var(--success)]">
                <span>{savedMapNotice}</span>
                <Link
                  href="/vault"
                  className="inline-flex items-center gap-1 font-bold underline shrink-0"
                >
                  Vault →
                </Link>
              </div>
            )}
          </div>

          {/* Selected Station Inspector Card */}
          {selectedStationForecast && (
            <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-xs font-semibold text-[var(--accent)]">
                    USGS #{selectedStationForecast.station.station_id} ·{" "}
                    {selectedStationForecast.station.state}
                  </span>
                  <h3 className="text-sm font-bold text-[var(--text-primary)] mt-0.5">
                    {selectedStationForecast.station.station_name}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {selectedStationForecast.station.river_name}
                  </p>
                </div>
                {selectedStationForecast.isSevereP99 ? (
                  <span className="rounded-full bg-[var(--danger-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--danger)]">
                    P99+ Critical
                  </span>
                ) : selectedStationForecast.isExtremeP90 ? (
                  <span className="rounded-full bg-[var(--warning-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
                    P90+ Surge
                  </span>
                ) : (
                  <span className="rounded-full bg-[var(--success-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                    Normal Flow
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--bg-secondary)] p-3 text-xs">
                <div>
                  <span className="text-[var(--text-muted)] block">
                    Predicted Discharge
                  </span>
                  <span className="font-mono text-sm font-bold text-[var(--text-primary)]">
                    {selectedStationForecast.predictedCfs.toLocaleString(
                      "en-US",
                      { maximumFractionDigits: 1 }
                    )}{" "}
                    cfs
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block">
                    P90 Flood Threshold
                  </span>
                  <span className="font-mono text-sm font-semibold text-[var(--text-secondary)]">
                    {selectedStationForecast.station.p90_discharge_cfs.toLocaleString(
                      "en-US",
                      { maximumFractionDigits: 0 }
                    )}{" "}
                    cfs
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block">
                    Local Storm Rain
                  </span>
                  <span className="font-mono font-semibold text-[var(--accent)]">
                    {selectedStationForecast.rainMm.toFixed(1)} mm
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block">
                    Distance to Epicenter
                  </span>
                  <span className="font-mono text-[var(--text-secondary)]">
                    {selectedStationForecast.distanceKm.toFixed(0)} km
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <Link
                  href={`/predict?station=${
                    selectedStationForecast.station.station_id
                  }&model=${encodeURIComponent(selectedModel)}`}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition"
                >
                  <span>7-Day Storm Simulator</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href={`/stations/${selectedStationForecast.station.station_id}`}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent)] transition"
                >
                  Station History
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Interactive Map + Ranked Impact Table */}
        <div className="lg:col-span-8 space-y-5">
          <StormForecastMap
            theme={theme}
            stormLat={stormLat}
            stormLon={stormLon}
            stormRadiusKm={stormRadiusKm}
            stormPeakMm={
              Number((stormPeakMm * activeDayConfig.rainFactor).toFixed(1))
            }
            stationForecasts={stationForecasts}
            selectedStationId={selectedStationId}
            selectedModel={selectedModel}
            selectedDayOffset={selectedDayOffset}
            onSelectDayOffset={setSelectedDayOffset}
            onSelectStormCenter={handleMapClickStormCenter}
            onSelectStation={(sid) => setSelectedStationId(sid)}
          />

          {/* Ranked Station Storm Impact Table */}
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-primary)]">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Ranked Station Flood Forecast ({activeDayConfig.label})
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Sorted by predicted surge ratio relative to each basin&apos;s historical P90 flood threshold
                </p>
              </div>
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {stationForecasts.length} gauges
              </span>
            </div>

            <div className="overflow-x-auto max-h-72">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[var(--text-muted)] uppercase">
                  <tr className="border-b border-[var(--border-primary)]">
                    <th className="py-2.5 px-4">Station</th>
                    <th className="py-2.5 px-4">State</th>
                    <th className="py-2.5 px-4 text-right">Distance</th>
                    <th className="py-2.5 px-4 text-right">Storm Rain</th>
                    <th className="py-2.5 px-4 text-right">Predicted (cfs)</th>
                    <th className="py-2.5 px-4 text-right">P90 Stage</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-primary)]">
                  {stationForecasts.map((item) => {
                    const isSelected =
                      item.station.station_id === selectedStationId;
                    return (
                      <tr
                        key={item.station.station_id}
                        onClick={() =>
                          setSelectedStationId(item.station.station_id)
                        }
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-[var(--accent-light)]"
                            : "hover:bg-[var(--bg-card-hover)]"
                        }`}
                      >
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-[var(--text-primary)]">
                            {item.station.station_name}
                          </div>
                          <div className="font-mono text-[11px] text-[var(--accent)]">
                            #{item.station.station_id}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-medium text-[var(--text-secondary)]">
                          {item.station.state}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-[var(--text-muted)]">
                          {item.distanceKm.toFixed(0)} km
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-[var(--accent)]">
                          {item.rainMm.toFixed(1)} mm
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-[var(--text-primary)]">
                          {item.predictedCfs.toLocaleString("en-US", {
                            maximumFractionDigits: 1,
                          })}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-[var(--text-muted)]">
                          {item.station.p90_discharge_cfs.toLocaleString(
                            "en-US",
                            { maximumFractionDigits: 0 }
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {item.isSevereP99 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--danger)]">
                              P99+ Critical
                            </span>
                          ) : item.isExtremeP90 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--warning-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
                              P90+ Surge
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center gap-1 text-[var(--success)] text-[11px] font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Normal
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Spatial Storm Simulation Analytics Graphs */}
      {(mapViewMode === "analytics" || mapViewMode === "all") && stationForecasts.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Graph 1: Top 8 Impacted Basins — Surge Ratio & Predicted vs P90 Threshold */}
          <div className="lg:col-span-6 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-[var(--accent)]" />
                  Top Impacted Basins: Predicted Flow vs. P90 Threshold
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Comparing live ML discharge against historical 90th percentile flood stage
                </p>
              </div>
              <span className="font-mono text-[11px] text-[var(--accent)]">
                Surge Ratio (Q / P90)
              </span>
            </div>

            <div className="space-y-3 pt-1">
              {stationForecasts.slice(0, 7).map((item) => {
                const maxRatio = Math.max(
                  2.0,
                  ...stationForecasts.slice(0, 7).map((s) => s.surgeRatioP90)
                );
                const barPct = Math.min(
                  100,
                  Math.max(6, Math.round((item.surgeRatioP90 / maxRatio) * 100))
                );
                const p90LinePct = Math.min(
                  100,
                  Math.round((1.0 / maxRatio) * 100)
                );
                return (
                  <div key={item.station.station_id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[var(--text-primary)] truncate max-w-[240px]">
                        <span className="font-mono text-[var(--accent)] mr-1.5">
                          #{item.station.station_id}
                        </span>
                        {item.station.station_name}
                      </span>
                      <span className="font-mono text-xs">
                        <strong className="text-[var(--text-primary)]">
                          {item.predictedCfs.toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })}{" "}
                          cfs
                        </strong>{" "}
                        <span
                          className={
                            item.isSevereP99
                              ? "text-[var(--danger)] font-bold"
                              : item.isExtremeP90
                              ? "text-[var(--warning)] font-semibold"
                              : "text-[var(--text-muted)]"
                          }
                        >
                          ({item.surgeRatioP90.toFixed(2)}× P90)
                        </span>
                      </span>
                    </div>

                    <div className="relative h-2.5 w-full rounded-full bg-[var(--bg-secondary)] overflow-hidden border border-[var(--border-primary)]">
                      {/* 1.0x P90 marker line */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-amber-500 z-10"
                        style={{ left: `${p90LinePct}%` }}
                        title="1.0× P90 Flood Threshold"
                      />
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          item.isSevereP99
                            ? "bg-[var(--danger)]"
                            : item.isExtremeP90
                            ? "bg-[var(--warning)]"
                            : "bg-[var(--accent)]"
                        }`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Graph 2: Radial Storm Decay & Basin Surge Scatter / Curve SVG */}
          <div className="lg:col-span-6 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[var(--accent)]" />
                  Radial Storm Decay &amp; Basin Response Curve
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Distance from storm epicenter (km) vs. Gaussian rainfall decay &amp; gauge surge status across all 32 stations
                </p>
              </div>
            </div>

            {(() => {
              const w = 920;
              const h = 320;
              const padL = 54;
              const padR = 24;
              const padT = 24;
              const padB = 38;
              const plotW = w - padL - padR;
              const plotH = h - padT - padB;
              const maxDist = Math.max(stormRadiusKm * 2.2, 1600);
              const effPeak = Math.max(
                10,
                stormPeakMm * activeDayConfig.rainFactor
              );

              const toX = (dist: number) =>
                padL + Math.min(1, Math.max(0, dist / maxDist)) * plotW;
              const toYRain = (rain: number) =>
                padT + plotH - Math.min(1, Math.max(0, rain / effPeak)) * plotH;

              const curvePts: string[] = [];
              for (let i = 0; i <= 50; i++) {
                const d = (i / 50) * maxDist;
                const r =
                  effPeak *
                  Math.exp(-Math.pow(d / Math.max(stormRadiusKm, 50), 2));
                curvePts.push(`${toX(d).toFixed(1)},${toYRain(r).toFixed(1)}`);
              }

              const areaPts = `${toX(0).toFixed(1)},${(padT + plotH).toFixed(
                1
              )} ${curvePts.join(" ")} ${toX(maxDist).toFixed(1)},${(
                padT + plotH
              ).toFixed(1)}`;

              return (
                <div className="w-full overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${w} ${h}`}
                    className="w-full h-80 sm:h-96 select-none"
                  >
                    <defs>
                      <linearGradient id="radialDecayGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0284c7" stopOpacity="0.45" />
                        <stop offset="100%" stopColor="#0284c7" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>

                    {[0.25, 0.5, 0.75, 1.0].map((frac) => {
                      const gy = padT + plotH * (1 - frac);
                      return (
                        <g key={frac}>
                          <line
                            x1={padL}
                            y1={gy}
                            x2={w - padR}
                            y2={gy}
                            stroke="currentColor"
                            className="text-[var(--border-primary)]"
                            strokeDasharray="4 4"
                          />
                          <text
                            x={padL - 8}
                            y={gy + 3.5}
                            textAnchor="end"
                            className="fill-[var(--text-muted)] text-[10px] font-mono"
                          >
                            {(effPeak * frac).toFixed(0)}mm
                          </text>
                        </g>
                      );
                    })}

                    {/* Storm Radius Vertical Line */}
                    <line
                      x1={toX(stormRadiusKm)}
                      y1={padT}
                      x2={toX(stormRadiusKm)}
                      y2={padT + plotH}
                      stroke="#0284c7"
                      strokeWidth="1.8"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={toX(stormRadiusKm) + 6}
                      y={padT + 12}
                      className="fill-[var(--accent)] text-[10px] font-mono font-bold"
                    >
                      R={stormRadiusKm}km (Storm Eye Boundary)
                    </text>

                    {/* Gaussian Rainfall Area Gradient + Line */}
                    <polygon points={areaPts} fill="url(#radialDecayGrad)" />
                    <polyline
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth="3.2"
                      points={curvePts.join(" ")}
                    />

                    {/* 32 USGS Station Dots */}
                    {stationForecasts.map((sf) => {
                      const cx = toX(sf.distanceKm);
                      const cy = toYRain(sf.rainMm);
                      const fill = sf.isSevereP99
                        ? "#ef4444"
                        : sf.isExtremeP90
                        ? "#f59e0b"
                        : "#10b981";
                      return (
                        <circle
                          key={sf.station.station_id}
                          cx={cx}
                          cy={cy}
                          r={sf.isSevereP99 ? 6.5 : sf.isExtremeP90 ? 5.5 : 4.5}
                          fill={fill}
                          stroke="#ffffff"
                          strokeWidth="1.8"
                        >
                          <title>
                            #{sf.station.station_id} {sf.station.station_name}:{" "}
                            {sf.distanceKm.toFixed(0)}km, {sf.rainMm.toFixed(1)}
                            mm, {sf.predictedCfs.toFixed(0)} cfs
                          </title>
                        </circle>
                      );
                    })}

                    {/* X Axis Labels */}
                    {[0, 0.25, 0.5, 0.75, 1.0].map((frac) => {
                      const gx = padL + plotW * frac;
                      return (
                        <text
                          key={frac}
                          x={gx}
                          y={h - 10}
                          textAnchor="middle"
                          className="fill-[var(--text-secondary)] text-[10px] font-mono font-semibold"
                        >
                          {Math.round(maxDist * frac)}km
                        </text>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* In Analytics View Mode, also display the ranked impact table */}
      {mapViewMode === "analytics" && (
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-primary)]">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Ranked Station Flood Forecast ({activeDayConfig.label})
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Sorted by predicted surge ratio relative to each basin&apos;s historical P90 flood threshold
              </p>
            </div>
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {stationForecasts.length} gauges
            </span>
          </div>

          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[var(--text-muted)] uppercase">
                <tr className="border-b border-[var(--border-primary)]">
                  <th className="py-2.5 px-4">Station</th>
                  <th className="py-2.5 px-4">State</th>
                  <th className="py-2.5 px-4 text-right">Distance</th>
                  <th className="py-2.5 px-4 text-right">Storm Rain</th>
                  <th className="py-2.5 px-4 text-right">Predicted (cfs)</th>
                  <th className="py-2.5 px-4 text-right">P90 Stage</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-primary)]">
                {stationForecasts.map((item) => {
                  const surgeRatio =
                    item.predictedCfs /
                    Math.max(1, item.station.p90_discharge_cfs);
                  return (
                    <tr
                      key={item.station.station_id}
                      onClick={() =>
                        setSelectedStationId(item.station.station_id)
                      }
                      className={`cursor-pointer transition-colors ${
                        selectedStationId === item.station.station_id
                          ? "bg-[var(--accent-light)]/60 font-semibold"
                          : "hover:bg-[var(--bg-card-hover)]"
                      }`}
                    >
                      <td className="py-2.5 px-4">
                        <span className="font-semibold text-[var(--text-primary)]">
                          {item.station.station_name}
                        </span>
                        <span className="ml-1.5 font-mono text-[10px] text-[var(--text-muted)]">
                          #{item.station.station_id}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[var(--text-secondary)]">
                        {item.station.state}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-[var(--text-secondary)]">
                        {item.distanceKm.toFixed(0)} km
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-[var(--accent)]">
                        {item.rainMm.toFixed(1)} mm
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-[var(--text-primary)]">
                        {item.predictedCfs.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-[var(--text-muted)]">
                        {item.station.p90_discharge_cfs.toLocaleString(
                          "en-US",
                          { maximumFractionDigits: 0 }
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {item.isSevereP99 ? (
                          <span className="rounded-full bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-500">
                            P99+ Critical
                          </span>
                        ) : item.isExtremeP90 ? (
                          <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                            P90+ Flood ({surgeRatio.toFixed(1)}×)
                          </span>
                        ) : item.rainMm >= 10 ? (
                          <span className="rounded-full bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 text-[10px] font-semibold text-sky-500">
                            Rain ({item.rainMm.toFixed(0)}mm)
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                            Normal Baseflow
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
