"use client";

import React, { useEffect, useState } from "react";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import {
  FALLBACK_STATIONS,
  runPrediction,
  PredictRowInput,
  PredictResponse,
} from "@/lib/api";
import {
  Play,
  Upload,
  Download,
  ShieldCheck,
  CloudRain,
  Flame,
  CheckCircle2,
} from "lucide-react";

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
    station_id: "08082000",
    date: "2022-05-06",
    precipitation_mm: 0.0,
    temp_max_c: 34.5,
    temp_min_c: 19.2,
    soil_moisture: 0.08,
  },
];

export default function PredictPage() {
  const [selectedStation, setSelectedStation] = useState("01646500");
  const [startDate, setStartDate] = useState("2022-05-01");
  const [stormPeakMm, setStormPeakMm] = useState(64);
  const [initialSoil, setInitialSoil] = useState(0.58);
  const [rows, setRows] = useState<PredictRowInput[]>(DEFAULT_STORM_SCENARIO);
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerateScenario = async () => {
    const st =
      FALLBACK_STATIONS.find((s) => s.station_id === selectedStation) ||
      FALLBACK_STATIONS[0];
    const baseDt = new Date(`${startDate}T00:00:00Z`);
    const rainProfile = [0.1, 0.35, 1.0, 0.75, 0.2, 0.0, 0.0];
    let sm = initialSoil;

    const generated: PredictRowInput[] = rainProfile.map((mult, idx) => {
      const dt = new Date(baseDt.getTime() + idx * 86400000)
        .toISOString()
        .slice(0, 10);
      const rain = Number((stormPeakMm * mult).toFixed(1));
      sm = Number(Math.min(0.92, Math.max(0.08, sm * 0.92 + rain * 0.004)).toFixed(3));
      return {
        station_id: st.station_id,
        date: dt,
        precipitation_mm: rain,
        temp_max_c: 19.5,
        temp_min_c: 9.2,
        soil_moisture: sm,
        drainage_area_sqmi: st.drainage_area_sqmi,
        mean_elevation_ft: st.mean_elevation_ft,
        slope_pct: st.slope_pct,
        forest_cover_pct: st.forest_cover_pct,
      };
    });

    setRows(generated);
    setLoading(true);
    const predRes = await runPrediction(generated);
    setResult(predRes);
    setLoading(false);
  };

  useEffect(() => {
    handleGenerateScenario();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation, startDate, stormPeakMm, initialSoil]);

  const handleRunCurrentRows = async () => {
    setLoading(true);
    const predRes = await runPrediction(rows);
    setResult(predRes);
    setLoading(false);
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
      const predRes = await runPrediction(parsed);
      setResult(predRes);
      setLoading(false);
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
    a.download = "predictions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Required Output — predictions.csv"
        requirementIds={["OP-1..9", "DQ-1", "IQ-4"]}
        summary="Generates predictions via POST /api/v1/predict with strict non-negative clipping (discharge_cfs >= 0.0), zero NaNs, and exact 3-column UTF-8 formatting: station_id, date, discharge_cfs."
        clauseQuote="Required Output — predictions.csv: Exactly three columns: station_id, date, discharge_cfs. One row per test record. discharge_cfs must be a non-negative float."
      />

      {/* Interactive Storm Builder & CSV Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <CloudRain className="h-5 w-5 text-cyan-400" />
              <span>Interactive Storm &amp; Batch Predictor</span>
            </h1>
            <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan-300 border border-cyan-400/30">
              POST /api/v1/predict
            </span>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Select USGS Station</label>
              <select
                value={selectedStation}
                onChange={(e) => setSelectedStation(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
              >
                {FALLBACK_STATIONS.map((s) => (
                  <option key={s.station_id} value={s.station_id}>
                    {s.station_id} — {s.station_name} ({s.drainage_area_sqmi.toLocaleString("en-US")}{" "}
                    sq mi)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  Storm Peak Rain ({stormPeakMm} mm)
                </label>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={stormPeakMm}
                  onChange={(e) => setStormPeakMm(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-cyan-300 focus:border-cyan-400 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">
                Initial Soil Moisture ({initialSoil})
              </label>
              <input
                type="range"
                min={0.05}
                max={0.9}
                step={0.01}
                value={initialSoil}
                onChange={(e) => setInitialSoil(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleGenerateScenario}
              disabled={loading}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 font-mono text-xs font-bold text-slate-950 hover:bg-cyan-400 transition"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>{loading ? "Running Inference..." : "Simulate 7-Day Storm"}</span>
            </button>

            <button
              type="button"
              onClick={handleRunCurrentRows}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-slate-950 px-4 py-2.5 font-mono text-xs font-semibold text-cyan-300 hover:bg-cyan-500/15 transition"
            >
              <span>Predict Current Table</span>
            </button>
          </div>

          {/* Upload test.csv */}
          <div className="pt-3 border-t border-slate-800">
            <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-950/70 p-3 font-mono text-xs text-slate-300 hover:border-cyan-400 hover:text-cyan-300 cursor-pointer transition">
              <Upload className="h-4 w-4 text-cyan-400" />
              <span>Or Upload Custom test.csv File for Batch Inference</span>
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Non-Negative Clipping Inspector & Output Table */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  <span>
                    Non-Negative Clipped Predictions (`np.clip(y_pred, 0.0, None)`)
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Guarantees zero negative values (`DQ-1` / `OP-5`) and exact 3-column output
                  contract.
                </p>
              </div>

              <button
                type="button"
                onClick={handleDownloadPredictionsCsv}
                disabled={!result || result.predictions.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 font-mono text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 transition"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download predictions.csv</span>
              </button>
            </div>

            {!result ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-8 text-center space-y-3">
                <p className="font-mono text-sm text-slate-300">
                  Click <strong>&ldquo;Simulate 7-Day Storm&rdquo;</strong> or{" "}
                  <strong>&ldquo;Predict Current Table&rdquo;</strong> to execute model inference
                  via <code className="text-cyan-300">POST /api/v1/predict</code>.
                </p>
                <button
                  type="button"
                  onClick={handleRunCurrentRows}
                  className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 font-mono text-xs font-bold text-slate-950"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Run Default 6-Row Scenario Now</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 font-mono text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <span className="text-slate-400 block text-[10px]">ACTIVE MODEL</span>
                    <span className="text-cyan-300 font-bold">{result.run_id}</span>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <span className="text-slate-400 block text-[10px]">ROWS PREDICTED</span>
                    <span className="text-white font-bold">{result.row_count} rows</span>
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
                    <span className="text-emerald-300 block text-[10px]">
                      NEGATIVES CLIPPED TO 0.0
                    </span>
                    <span className="text-emerald-400 font-bold">
                      {result.clipped_negatives_count} clipped (0 negatives in output)
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-left border-collapse font-mono text-xs">
                    <thead className="sticky top-0 bg-slate-950">
                      <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                        <th className="py-2 px-3">station_id</th>
                        <th className="py-2 px-3">date</th>
                        <th className="py-2 px-3 text-emerald-300">discharge_cfs (Output)</th>
                        <th className="py-2 px-3">Precip / Soil</th>
                        <th className="py-2 px-3">Guard Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {result.predictions.map((p, idx) => (
                        <tr key={`${p.station_id}-${p.date}-${idx}`} className="hover:bg-slate-950/60">
                          <td className="py-2 px-3 font-bold text-cyan-300">{p.station_id}</td>
                          <td className="py-2 px-3 text-slate-200">{p.date}</td>
                          <td className="py-2 px-3 font-extrabold text-emerald-400 text-sm">
                            {Number(p.discharge_cfs).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {p.precipitation_mm ?? rows[idx]?.precipitation_mm ?? 0} mm · SM{" "}
                            {p.soil_moisture ?? rows[idx]?.soil_moisture ?? 0.35}
                          </td>
                          <td className="py-2 px-3">
                            {p.was_clipped ? (
                              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                                CLIPPED TO 0.0
                              </span>
                            ) : p.is_extreme_p90 ? (
                              <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                                <Flame className="h-3 w-3" /> P90+ SURGE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px]">
                                <CheckCircle2 className="h-3 w-3" /> VALID ≥ 0
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
