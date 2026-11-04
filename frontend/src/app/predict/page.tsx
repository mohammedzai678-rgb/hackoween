"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import {
  fetchStations,
  fetchRuns,
  runPrediction,
  fetchSimulations,
  saveSimulation,
  StationSummary,
  RunSummary,
  PredictRowInput,
  PredictResponse,
  SimulationRecord,
} from "@/lib/api";
import {
  Play,
  Upload,
  Download,
  CloudRain,
  CheckCircle2,
  Cpu,
  BarChart3,
  Droplets,
  AlertCircle,
  Database,
  BookmarkPlus,
  TrendingUp,
  Layers,
  ArrowRight,
} from "lucide-react";

interface ModelOption {
  run_id: string;
  label: string;
  family: string;
}

const CORE_MODEL_OPTIONS: ModelOption[] = [
  {
    run_id: "run_final_ensemble",
    label: "Multi-Model Ensemble (Default)",
    family: "Ensemble",
  },
  {
    run_id: "run_xgboost",
    label: "XGBoost Regressor",
    family: "XGBoost",
  },
  {
    run_id: "run_catboost",
    label: "CatBoost Regressor",
    family: "CatBoost",
  },
  {
    run_id: "run_flood_peak_weighted",
    label: "LightGBM Flood-Peak Specialist",
    family: "LightGBM",
  },
  {
    run_id: "run_target_scaled",
    label: "LightGBM Station-Scaled",
    family: "LightGBM",
  },
  {
    run_id: "run_target_log1p_smearing",
    label: "LightGBM Log1p + Duan Smearing",
    family: "LightGBM",
  },
  {
    run_id: "run_target_raw",
    label: "LightGBM Raw L2",
    family: "LightGBM",
  },
];

const DEFAULT_STORM_SCENARIO: PredictRowInput[] = [
  {
    station_id: "01646500",
    date: "2022-05-01",
    precipitation_mm: 4.2,
    temp_max_c: 19.5,
    temp_min_c: 8.4,
    soil_moisture: 0.34,
  },
  {
    station_id: "01646500",
    date: "2022-05-02",
    precipitation_mm: 52.8,
    temp_max_c: 17.8,
    temp_min_c: 10.1,
    soil_moisture: 0.64,
  },
  {
    station_id: "01646500",
    date: "2022-05-03",
    precipitation_mm: 68.4,
    temp_max_c: 16.4,
    temp_min_c: 11.2,
    soil_moisture: 0.82,
  },
  {
    station_id: "01646500",
    date: "2022-05-04",
    precipitation_mm: 14.0,
    temp_max_c: 18.9,
    temp_min_c: 9.8,
    soil_moisture: 0.79,
  },
  {
    station_id: "01646500",
    date: "2022-05-05",
    precipitation_mm: 0.0,
    temp_max_c: 22.1,
    temp_min_c: 10.0,
    soil_moisture: 0.68,
  },
  {
    station_id: "01646500",
    date: "2022-05-06",
    precipitation_mm: 0.0,
    temp_max_c: 24.5,
    temp_min_c: 11.2,
    soil_moisture: 0.58,
  },
  {
    station_id: "01646500",
    date: "2022-05-07",
    precipitation_mm: 0.0,
    temp_max_c: 25.0,
    temp_min_c: 12.0,
    soil_moisture: 0.52,
  },
];

export default function PredictPage() {
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [savedSims, setSavedSims] = useState<SimulationRecord[]>([]);
  const [selectedStation, setSelectedStation] = useState("01646500");
  const [selectedModel, setSelectedModel] = useState("run_final_ensemble");
  const [startDate, setStartDate] = useState("2022-05-01");
  const [stormPeakMm, setStormPeakMm] = useState(64);
  const [initialSoil, setInitialSoil] = useState(0.58);
  const [rows, setRows] = useState<PredictRowInput[]>(DEFAULT_STORM_SCENARIO);
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Save Simulation to Vault state
  const [simTitle, setSimTitle] = useState("");
  const [savingSim, setSavingSim] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const modelOptions = useMemo(() => {
    const map = new Map<string, ModelOption>();
    for (const opt of CORE_MODEL_OPTIONS) {
      map.set(opt.run_id, opt);
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
          family: r.model_family,
        });
      }
    }
    return Array.from(map.values());
  }, [runs]);

  useEffect(() => {
    let mounted = true;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const qModel = params.get("model");
      const qStation = params.get("station");
      if (qModel) setSelectedModel(qModel);
      if (qStation) setSelectedStation(qStation);
    }

    Promise.all([
      fetchStations().catch(() => [] as StationSummary[]),
      fetchRuns().catch(() => [] as RunSummary[]),
      fetchSimulations().catch(() => [] as SimulationRecord[]),
    ])
      .then(([sList, rList, simList]) => {
        if (!mounted) return;
        if (sList && sList.length > 0) setStations(sList);
        if (rList && rList.length > 0) setRuns(rList);
        if (simList) setSavedSims(simList);
      })
      .finally(() => {
        if (mounted) setInitialized(true);
      });

    return () => {
      mounted = false;
      abortRef.current?.abort();
    };
  }, []);

  const activeStationObj = useMemo(
    () =>
      stations.find((s) => s.station_id === selectedStation) ||
      stations[0] ||
      null,
    [stations, selectedStation]
  );

  const handleGenerateScenario = async () => {
    const st = activeStationObj;
    const sid = st?.station_id || selectedStation || "01646500";
    const baseDt = new Date(`${startDate}T00:00:00Z`);
    const rainProfile = [0.1, 0.35, 1.0, 0.75, 0.2, 0.0, 0.0];
    let sm = initialSoil;

    const generated: PredictRowInput[] = rainProfile.map((mult, idx) => {
      const dt = new Date(baseDt.getTime() + idx * 86400000)
        .toISOString()
        .slice(0, 10);
      const rain = Number((stormPeakMm * mult).toFixed(1));
      sm = Number(
        Math.min(0.92, Math.max(0.08, sm * 0.92 + rain * 0.004)).toFixed(3)
      );
      return {
        station_id: sid,
        date: dt,
        precipitation_mm: rain,
        temp_max_c: 19.5,
        temp_min_c: 9.2,
        soil_moisture: sm,
        drainage_area_sqmi: st?.drainage_area_sqmi,
        mean_elevation_ft: st?.mean_elevation_ft,
        slope_pct: st?.slope_pct,
        forest_cover_pct: st?.forest_cover_pct,
      };
    });

    setRows(generated);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setErrorMsg(null);
    try {
      const predRes = await runPrediction(
        generated,
        selectedModel,
        controller.signal
      );
      if (!controller.signal.aborted) {
        setResult(predRes);
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
      setErrorMsg(err?.message || "Prediction request failed.");
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!initialized) return;
    const timer = setTimeout(() => {
      handleGenerateScenario();
    }, 180);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialized,
    selectedStation,
    selectedModel,
    startDate,
    stormPeakMm,
    initialSoil,
  ]);

  const handleRunCurrentRows = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setErrorMsg(null);
    try {
      const predRes = await runPrediction(
        rows,
        selectedModel,
        controller.signal
      );
      if (!controller.signal.aborted) {
        setResult(predRes);
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
      setErrorMsg(err?.message || "Prediction request failed.");
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const handleSaveToVault = async () => {
    if (!result || result.predictions.length === 0) return;
    setSavingSim(true);
    setSavedNotice(null);
    try {
      const stName =
        activeStationObj?.station_name || `USGS Station ${selectedStation}`;
      const defaultTitle =
        simTitle.trim() ||
        `${stName.split(" ")[0]} ${stormPeakMm}mm Storm (${selectedModel.replace(
          "run_",
          ""
        )})`;

      const enrichedPreds = result.predictions.map((p, idx) => ({
        station_id: p.station_id,
        date: p.date,
        discharge_cfs: Number(p.discharge_cfs),
        precipitation_mm: Number(
          p.precipitation_mm ?? rows[idx]?.precipitation_mm ?? 0
        ),
        soil_moisture: Number(
          p.soil_moisture ?? rows[idx]?.soil_moisture ?? initialSoil
        ),
        is_extreme_p90: Boolean(p.is_extreme_p90),
      }));

      const saved = await saveSimulation({
        title: defaultTitle,
        source: "predict",
        run_id: result.run_id || selectedModel,
        model_used: result.model_used || selectedModel,
        station_id: selectedStation,
        station_name: stName,
        storm_peak_mm: stormPeakMm,
        soil_moisture: initialSoil,
        notes: `7-day storm forecast starting ${startDate} with ${stormPeakMm}mm peak rain and ${initialSoil.toFixed(
          2
        )} antecedent soil moisture.`,
        predictions: enrichedPreds,
      });

      setSavedSims((prev) => [saved, ...prev]);
      setSimTitle("");
      setSavedNotice(
        `Saved "${saved.title}" to SQLite Vault & indexed in FAISS Vector DB!`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save simulation to Vault.");
    } finally {
      setSavingSim(false);
    }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = String(ev.target?.result || "");
      const lines = text
        .trim()
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      if (lines.length < 2) return;
      const headers = lines[0].split(",").map((h) => h.trim());
      const parsed: PredictRowInput[] = lines.slice(1, 101).map((line) => {
        const vals = line.split(",").map((v) => v.trim());
        const rec: Record<string, string> = {};
        headers.forEach((h, i) => {
          rec[h] = vals[i] || "";
        });
        return {
          station_id: rec.station_id || "01646500",
          date: rec.date || "2022-05-01",
          precipitation_mm: Number(rec.precipitation_mm || 0),
          temp_max_c: Number(rec.temp_max_c || 18),
          temp_min_c: Number(rec.temp_min_c || 8),
          soil_moisture: Number(rec.soil_moisture || 0.35),
          drainage_area_sqmi: rec.drainage_area_sqmi
            ? Number(rec.drainage_area_sqmi)
            : undefined,
        };
      });
      setRows(parsed);
      setLoading(true);
      setErrorMsg(null);
      try {
        const predRes = await runPrediction(parsed, selectedModel);
        setResult(predRes);
      } catch (err: any) {
        setErrorMsg(err?.message || "Batch CSV prediction failed.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadPredictionsCsv = () => {
    const activePreds = result?.predictions || [];
    const csvLines = [
      "station_id,date,discharge_cfs",
      ...activePreds.map(
        (p) => `${p.station_id},${p.date},${Number(p.discharge_cfs).toFixed(2)}`
      ),
    ];
    const blob = new Blob([csvLines.join("\n") + "\n"], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `predictions_${selectedModel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Compute chart points for Visual Forecast Hydrograph & Multi-Graph Analytics
  const chartPoints = useMemo(() => {
    const preds = result?.predictions || [];
    return preds.slice(0, 14).map((p, idx) => {
      const inputRow = rows[idx];
      const rain =
        p.precipitation_mm != null
          ? Number(p.precipitation_mm)
          : inputRow
          ? Number(inputRow.precipitation_mm)
          : 0;
      const soil =
        p.soil_moisture != null
          ? Number(p.soil_moisture)
          : inputRow
          ? Number(inputRow.soil_moisture)
          : initialSoil;
      return {
        date: p.date,
        shortDate: p.date.slice(5),
        discharge_cfs: Number(p.discharge_cfs),
        precipitation_mm: rain,
        soil_moisture: soil,
        is_extreme_p90: Boolean(p.is_extreme_p90),
      };
    });
  }, [result, rows, initialSoil]);

  const maxDischarge = useMemo(
    () => Math.max(100, ...chartPoints.map((pt) => pt.discharge_cfs)),
    [chartPoints]
  );

  const maxRain = useMemo(
    () => Math.max(10, ...chartPoints.map((pt) => pt.precipitation_mm)),
    [chartPoints]
  );

  const stationP90 = activeStationObj?.p90_discharge_cfs || maxDischarge * 0.75;
  const stationP99 = activeStationObj?.p99_discharge_cfs || stationP90 * 1.9;
  const stationMean = activeStationObj?.mean_discharge_cfs || stationP90 * 0.35;

  const curveMaxY = useMemo(
    () => Math.max(maxDischarge * 1.12, stationP99 * 1.08, 500),
    [maxDischarge, stationP99]
  );

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <CloudRain className="h-7 w-7 text-[var(--accent)]" />
            Storm Simulator &amp; Predictor
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Select any of the 32 USGS stations &amp; 7 trained ML models, simulate storms, and store predictions to the Vector Vault.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] px-3.5 py-2 text-xs">
            <Cpu className="h-4 w-4 text-[var(--accent)]" />
            <span className="text-[var(--text-muted)]">Active Model:</span>
            <span className="font-mono font-semibold text-[var(--accent)]">
              {selectedModel}
            </span>
          </div>
          <Link
            href="/vault"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent)] transition"
          >
            <Database className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>Vault &amp; RAG ({savedSims.length})</span>
          </Link>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Panel — Storm Simulator */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-6 space-y-5">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Storm &amp; Model Parameters
            </h2>

            {/* Model Selector */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                Inference Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-3 py-2.5 text-sm font-medium text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] transition"
              >
                {modelOptions.map((m) => (
                  <option key={m.run_id} value={m.run_id}>
                    {m.run_id} — {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Station Selector */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                USGS Station ({stations.length} available)
              </label>
              <select
                value={selectedStation}
                onChange={(e) => setSelectedStation(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] transition"
              >
                {stations.map((s) => (
                  <option key={s.station_id} value={s.station_id}>
                    {s.station_id} — {s.station_name} (
                    {s.drainage_area_sqmi.toLocaleString("en-US")} sq mi)
                  </option>
                ))}
              </select>
            </div>

            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] transition"
              />
            </div>

            {/* Storm Peak Rain Slider */}
            <div>
              <label className="flex items-center justify-between text-sm font-medium text-[var(--text-secondary)] mb-2">
                <span>Storm Peak Rain</span>
                <span className="font-mono text-[var(--accent)] font-semibold">
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
              <div className="flex justify-between text-xs text-[var(--text-muted)] mt-1">
                <span>0 mm (dry)</span>
                <span>200 mm (extreme storm)</span>
              </div>
            </div>

            {/* Soil Moisture Slider */}
            <div>
              <label className="flex items-center justify-between text-sm font-medium text-[var(--text-secondary)] mb-2">
                <span>Initial Soil Moisture</span>
                <span className="font-mono text-[var(--accent)] font-semibold">
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
              <div className="flex justify-between text-xs text-[var(--text-muted)] mt-1">
                <span>0.05 (dry)</span>
                <span>0.90 (saturated)</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                type="button"
                onClick={handleGenerateScenario}
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition"
              >
                <Play className="h-4 w-4 fill-current" />
                {loading ? "Running…" : "Run Prediction"}
              </button>
              <button
                type="button"
                onClick={handleRunCurrentRows}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50 transition"
              >
                Re-Run Table
              </button>
            </div>
          </div>

          {/* Store Simulation in SQLite Vault & FAISS Vector DB Card */}
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Database className="h-4 w-4 text-[var(--accent)]" />
                Store Simulation in Vault &amp; Vector DB
              </h2>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                FAISS + SQLite
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Persist this 7-day forecast to compare multi-model hydrographs and make it searchable via Transformer RAG.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={simTitle}
                onChange={(e) => setSimTitle(e.target.value)}
                placeholder="Optional simulation label (e.g., Potomac 120mm Test)…"
                className="flex-1 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveToVault}
                disabled={savingSim || !result || result.predictions.length === 0}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition shrink-0"
              >
                <BookmarkPlus className="h-4 w-4" />
                {savingSim ? "Storing…" : "Save Simulation"}
              </button>
            </div>
            {savedNotice && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--success)]/40 bg-[var(--success-light)] px-3 py-2 text-xs text-[var(--success)]">
                <span>{savedNotice}</span>
                <Link
                  href="/vault"
                  className="inline-flex items-center gap-1 font-semibold underline shrink-0"
                >
                  Open Vault <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>

          {/* CSV Upload */}
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
              Batch CSV Upload
            </h2>
            <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 cursor-pointer hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition group">
              <Upload className="h-8 w-8 text-[var(--text-muted)] group-hover:text-[var(--accent)] transition" />
              <div className="text-center">
                <p className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--accent)] transition">
                  Upload CSV for batch inference
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Columns: station_id, date, precipitation_mm, temp_max_c, temp_min_c, soil_moisture
                </p>
              </div>
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Right Panel — Results */}
        <div className="lg:col-span-7 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-6 flex flex-col">
          {/* Results Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[var(--border-primary)]">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Prediction Results
              </h2>
              {result?.model_used && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Engine: {result.model_used}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveToVault}
                disabled={savingSim || !result || result.predictions.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--accent)] bg-[var(--accent-light)] px-3.5 py-2 text-xs font-semibold text-[var(--accent)] hover:brightness-105 disabled:opacity-40 transition"
              >
                <BookmarkPlus className="h-4 w-4" />
                {savingSim ? "Saving…" : "Store in Vault"}
              </button>
              <button
                type="button"
                onClick={handleDownloadPredictionsCsv}
                disabled={!result || result.predictions.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--success)] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40 transition"
              >
                <Download className="h-4 w-4" />
                Download CSV
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger-light)] px-4 py-3 text-xs text-[var(--danger)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!result ? (
            <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
              <CloudRain className="h-12 w-12 text-[var(--text-muted)] mb-4" />
              <p className="text-[var(--text-secondary)] text-sm mb-4">
                Configure storm parameters and click{" "}
                <strong>Run Prediction</strong> to generate discharge forecasts.
              </p>
              <button
                type="button"
                onClick={handleRunCurrentRows}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] transition"
              >
                <Play className="h-4 w-4 fill-current" />
                Run Default Scenario
              </button>
            </div>
          ) : (
            <div className="space-y-5 pt-4 flex-1 flex flex-col">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
                  <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                    Selected Model
                  </p>
                  <p className="text-sm font-mono font-semibold text-[var(--accent)] mt-0.5 truncate">
                    {result.run_id}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
                  <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                    Peak Predicted Flow
                  </p>
                  <p className="text-sm font-mono font-bold text-[var(--text-primary)] mt-0.5">
                    {maxDischarge.toLocaleString("en-US", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    cfs
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--success)]/30 bg-[var(--success-light)] p-3">
                  <p className="text-xs font-medium text-[var(--success)] uppercase tracking-wide">
                    Non-Negative Guard
                  </p>
                  <p className="text-sm font-semibold text-[var(--success)] mt-0.5">
                    {result.clipped_negatives_count} clipped (≥ 0 cfs)
                  </p>
                </div>
              </div>

              {/* Graph 1: Visual Forecast Hydrograph & Rainfall Bar Chart */}
              {chartPoints.length > 0 && (
                <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-[var(--accent)]" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        Forecast Hydrograph &amp; Rainfall Impulse
                      </h3>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" />
                        Discharge (cfs)
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-[var(--warning)]" />
                        P90+ Surge
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Droplets className="h-3 w-3 text-[var(--accent)]" />
                        Rain (mm)
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-2 items-end h-40 pt-4 px-1">
                    {chartPoints.slice(0, 7).map((pt, i) => {
                      const heightPct = Math.max(
                        8,
                        Math.round((pt.discharge_cfs / maxDischarge) * 100)
                      );
                      const rainPct = Math.round(
                        (pt.precipitation_mm / maxRain) * 100
                      );
                      return (
                        <div
                          key={`${pt.date}-${i}`}
                          className="flex flex-col items-center h-full justify-end group"
                        >
                          <div className="mb-1 text-[10px] font-mono text-[var(--text-muted)]">
                            {pt.precipitation_mm > 0
                              ? `${pt.precipitation_mm}mm`
                              : "0mm"}
                          </div>
                          <div className="mb-1 text-[11px] font-mono font-semibold text-[var(--text-primary)]">
                            {pt.discharge_cfs >= 1000
                              ? `${(pt.discharge_cfs / 1000).toFixed(1)}k`
                              : pt.discharge_cfs.toFixed(0)}
                          </div>
                          <div className="w-full max-w-[38px] bg-[var(--bg-card)] rounded-t-md h-24 flex items-end overflow-hidden border border-[var(--border-primary)]">
                            <div
                              className={`w-full rounded-t transition-all duration-300 ${
                                pt.is_extreme_p90
                                  ? "bg-[var(--warning)]"
                                  : "bg-[var(--accent)]"
                              }`}
                              style={{
                                height: `${heightPct}%`,
                                opacity: Math.max(0.65, rainPct / 100),
                              }}
                            />
                          </div>
                          <span className="mt-1.5 text-[10px] font-mono text-[var(--text-secondary)]">
                            {pt.shortDate}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Results Table */}
              <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden shadow-sm">
                <div className="overflow-auto flex-1 min-h-[220px]">
                  <table className="w-full text-left text-sm border-collapse min-h-full">
                    <thead className="sticky top-0 z-10 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] shadow-sm">
                      <tr className="text-xs uppercase text-[var(--text-muted)] tracking-wide">
                        <th className="py-3 px-4 font-semibold">station_id</th>
                        <th className="py-3 px-4 font-semibold">date</th>
                        <th className="py-3 px-4 text-right font-semibold">rain (mm)</th>
                        <th className="py-3 px-4 text-right font-semibold">soil</th>
                        <th className="py-3 px-4 text-right font-semibold">discharge_cfs</th>
                        <th className="py-3 px-4 text-center font-semibold">status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-primary)]">
                      {result.predictions.map((p, idx) => {
                        const rainVal =
                          p.precipitation_mm ?? rows[idx]?.precipitation_mm ?? 0;
                        const soilVal =
                          p.soil_moisture ?? rows[idx]?.soil_moisture ?? initialSoil;
                        return (
                          <tr
                            key={`${p.station_id}-${p.date}-${idx}`}
                            className="hover:bg-[var(--bg-card-hover)] transition-colors group"
                          >
                            <td className="py-3.5 px-4 font-mono font-semibold text-[var(--accent)]">
                              {p.station_id}
                            </td>
                            <td className="py-3.5 px-4 text-[var(--text-secondary)] font-mono text-xs">
                              {p.date}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono text-xs text-[var(--text-secondary)]">
                              {Number(rainVal).toFixed(1)}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono text-xs text-[var(--text-muted)]">
                              {Number(soilVal).toFixed(2)}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono font-semibold text-[var(--text-primary)]">
                              {Number(p.discharge_cfs).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              {p.was_clipped ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--warning-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--warning)]">
                                  Clipped
                                </span>
                              ) : p.is_extreme_p90 ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--danger)]">
                                  P90+ Surge
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center gap-1 text-[var(--success)] text-xs">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Valid
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Table Bottom Summary Bar Anchor */}
                <div className="shrink-0 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {result.predictions.length} Timesteps
                    </span>
                    <span className="text-[var(--text-muted)]">•</span>
                    <span>
                      Cumulative Rain:{" "}
                      <strong className="text-[var(--text-primary)]">
                        {result.predictions
                          .reduce(
                            (acc, p, idx) =>
                              acc + (p.precipitation_mm ?? rows[idx]?.precipitation_mm ?? 0),
                            0
                          )
                          .toFixed(1)}{" "}
                        mm
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span>
                      Peak Crest:{" "}
                      <strong className="text-[var(--accent)]">
                        {maxDischarge.toLocaleString("en-US", {
                          maximumFractionDigits: 1,
                        })}{" "}
                        cfs
                      </strong>
                    </span>
                    <span className="text-[var(--text-muted)]">•</span>
                    <span className="text-[var(--success)] font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Physical bounds enforced
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Multi-Graph Simulation Analytics Row */}
      {chartPoints.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Graph 2: Continuous SVG Hydrograph Curve vs. Historical P90 & P99 Thresholds */}
          <div className="lg:col-span-7 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[var(--accent)]" />
                  Continuous Discharge Trajectory vs. Basin Flood Thresholds
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Comparing predicted stream crest against historical Mean, P90 Surge ({stationP90.toLocaleString("en-US", { maximumFractionDigits: 0 })} cfs), and P99 Critical ({stationP99.toLocaleString("en-US", { maximumFractionDigits: 0 })} cfs)
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-medium">
                <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                  Forecast Curve
                </span>
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <span className="h-0.5 w-3 bg-amber-500" />
                  P90 Threshold
                </span>
                <span className="inline-flex items-center gap-1 text-rose-500">
                  <span className="h-0.5 w-3 bg-rose-500" />
                  P99 Critical
                </span>
              </div>
            </div>

            {(() => {
              const pts = chartPoints.slice(0, 7);
              const w = 920;
              const h = 320;
              const padL = 60;
              const padR = 24;
              const padT = 24;
              const padB = 38;
              const plotW = w - padL - padR;
              const plotH = h - padT - padB;

              const toX = (i: number) =>
                padL + (pts.length <= 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
              const toY = (val: number) =>
                padT + plotH - Math.min(1, Math.max(0, val / curveMaxY)) * plotH;

              const polyPoints = pts
                .map((p, i) => `${toX(i).toFixed(1)},${toY(p.discharge_cfs).toFixed(1)}`)
                .join(" ");
              const areaPoints = `${toX(0).toFixed(1)},${(padT + plotH).toFixed(
                1
              )} ${polyPoints} ${toX(pts.length - 1).toFixed(1)},${(
                padT + plotH
              ).toFixed(1)}`;

              const yP90 = toY(stationP90);
              const yP99 = toY(stationP99);
              const yMean = toY(stationMean);

              return (
                <div className="w-full overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${w} ${h}`}
                    className="w-full h-80 sm:h-96 select-none"
                  >
                    <defs>
                      <linearGradient id="hydroAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0284c7" stopOpacity="0.45" />
                        <stop offset="100%" stopColor="#0284c7" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Grid Lines */}
                    {[0.25, 0.5, 0.75, 1.0].map((frac) => {
                      const gy = padT + plotH * (1 - frac);
                      const labelVal = curveMaxY * frac;
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
                            {labelVal >= 1000
                              ? `${(labelVal / 1000).toFixed(0)}k`
                              : labelVal.toFixed(0)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Mean Flow Line */}
                    <line
                      x1={padL}
                      y1={yMean}
                      x2={w - padR}
                      y2={yMean}
                      stroke="#10b981"
                      strokeWidth="1.6"
                      strokeDasharray="4 4"
                    />

                    {/* P90 Flood Surge Threshold Line */}
                    <line
                      x1={padL}
                      y1={yP90}
                      x2={w - padR}
                      y2={yP90}
                      stroke="#f59e0b"
                      strokeWidth="1.8"
                      strokeDasharray="5 4"
                    />

                    {/* P99 Critical Threshold Line */}
                    <line
                      x1={padL}
                      y1={yP99}
                      x2={w - padR}
                      y2={yP99}
                      stroke="#ef4444"
                      strokeWidth="1.8"
                      strokeDasharray="3 3"
                    />

                    {/* Shaded Area & Forecast Polyline */}
                    <polygon points={areaPoints} fill="url(#hydroAreaGrad)" />
                    <polyline
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth="3.2"
                      points={polyPoints}
                    />

                    {/* Data Points & Labels */}
                    {pts.map((pt, i) => {
                      const cx = toX(i);
                      const cy = toY(pt.discharge_cfs);
                      return (
                        <g key={pt.date}>
                          <circle
                            cx={cx}
                            cy={cy}
                            r={5.5}
                            fill={pt.is_extreme_p90 ? "#f59e0b" : "#0284c7"}
                            stroke="#ffffff"
                            strokeWidth="1.8"
                          />
                          <text
                            x={cx}
                            y={cy - 10}
                            textAnchor="middle"
                            className="fill-[var(--text-primary)] text-[10px] font-mono font-bold"
                          >
                            {pt.discharge_cfs >= 1000
                              ? `${(pt.discharge_cfs / 1000).toFixed(1)}k`
                              : pt.discharge_cfs.toFixed(0)}
                          </text>
                          <text
                            x={cx}
                            y={h - 10}
                            textAnchor="middle"
                            className="fill-[var(--text-secondary)] text-[11px] font-mono font-semibold"
                          >
                            {pt.shortDate}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}
          </div>

          {/* Graph 3: Soil Saturation vs. Rainfall & Stored Simulations Comparison */}
          <div className="lg:col-span-5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Layers className="h-4 w-4 text-[var(--accent)]" />
                  Soil Saturation &amp; Stored Runs Comparison
                </h3>
                <Link
                  href="/vault"
                  className="text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  Full Comparison →
                </Link>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Daily antecedent soil moisture trajectory alongside peak discharge across saved simulations
              </p>

              {/* Soil Moisture 7-Day Mini Progress Bars */}
              <div className="space-y-1.5 mb-4">
                {chartPoints.slice(0, 5).map((pt) => {
                  const smPct = Math.round(pt.soil_moisture * 100);
                  return (
                    <div
                      key={pt.date}
                      className="flex items-center gap-2 text-xs font-mono"
                    >
                      <span className="w-12 text-[var(--text-muted)]">
                        {pt.shortDate}
                      </span>
                      <div className="flex-1 h-2.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden border border-[var(--border-primary)]">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${smPct}%` }}
                        />
                      </div>
                      <span className="w-14 text-right text-[var(--text-secondary)]">
                        {(pt.soil_moisture * 100).toFixed(0)}% SM
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Stored Simulations Peak Discharge Comparison Bars */}
            <div className="border-t border-[var(--border-primary)] pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                Recent Vault Simulations (Peak Flow Comparison)
              </p>
              <div className="space-y-2">
                {savedSims.slice(0, 4).map((sim) => {
                  const refMax = Math.max(
                    maxDischarge,
                    ...savedSims.slice(0, 4).map((s) => s.peak_discharge_cfs),
                    1
                  );
                  const wPct = Math.max(
                    8,
                    Math.round((sim.peak_discharge_cfs / refMax) * 100)
                  );
                  return (
                    <div key={sim.sim_id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--text-primary)] truncate max-w-[210px]">
                          {sim.title}
                        </span>
                        <span className="font-mono font-semibold text-[var(--accent)]">
                          {sim.peak_discharge_cfs.toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })}{" "}
                          cfs
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${wPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
