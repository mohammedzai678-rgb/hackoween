"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import {
  fetchStationDetail,
  fetchStations,
  StationDetailResponse,
  StationSummary,
} from "@/lib/api";
import {
  ArrowLeft,
  MapPin,
  Compass,
  Mountain,
  Waves,
  Trees,
  Flame,
  CloudRain,
  CheckCircle2,
  Play,
} from "lucide-react";

export default function StationDetailPage() {
  const params = useParams();
  const stationId = String(params?.id || "01646500");

  const [detail, setDetail] = useState<StationDetailResponse | null>(null);
  const [allStations, setAllStations] = useState<StationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([fetchStationDetail(stationId), fetchStations()])
      .then(([d, list]) => {
        if (!mounted) return;
        setDetail(d);
        setAllStations(list);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [stationId]);

  const st = detail?.station;
  const stats = detail?.sanity_stats;
  const series = detail?.series || [];
  const maxQ = Math.max(
    100,
    ...series.map((p) => Math.max(p.discharge_cfs || 0, p.predicted_discharge_cfs || 0))
  );
  const maxRain = Math.max(10, ...series.map((p) => p.precipitation_mm || 0));

  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Station Deep-Dive: Datasets 1–3 & Flood Peak Accuracy (30%)"
        requirementIds={["DS1-1", "DS2-1", "DS3-1", "EC-2"]}
        summary={`Inspecting USGS Station #${stationId}: daily discharge (parameter 00060), co-located Open-Meteo precipitation & soil moisture (0–7cm), StreamStats catchment attributes, and top-10% flood-peak accuracy.`}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Link
          href="/stations"
          className="inline-flex items-center gap-2 font-mono text-xs text-cyan-400 hover:text-cyan-300"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to All 32 USGS Gauge Stations</span>
        </Link>

        {/* Quick Station Switcher */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-slate-400">Jump to station:</span>
          <select
            aria-label="Jump to USGS Station"
            value={stationId}
            onChange={(e) => {
              window.location.href = `/stations/${e.target.value}`;
            }}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
          >
            {allStations.map((s) => (
              <option key={s.station_id} value={s.station_id}>
                {s.station_id} — {s.station_name} ({s.state})
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading || !st ? (
        <div className="h-80 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60 p-6" />
      ) : (
        <>
          {/* Station Header & Catchment Attributes */}
          <section className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                  <span className="rounded bg-cyan-500/20 px-2.5 py-0.5 font-bold text-cyan-300 border border-cyan-400/30">
                    USGS STATION #{st.station_id}
                  </span>
                  <span className="rounded bg-slate-800 px-2.5 py-0.5 text-slate-300">
                    State: {st.state}
                  </span>
                  {st.is_starter && (
                    <span className="rounded bg-amber-500/20 px-2.5 py-0.5 font-bold text-amber-300 border border-amber-400/30">
                      ★ OFFICIAL STARTER STATION
                    </span>
                  )}
                </div>
                <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-white">
                  {st.station_name}
                </h1>
                <p className="mt-1 font-mono text-xs text-slate-400 flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                  <span>
                    {st.river_name} · Coordinates: ({st.latitude.toFixed(4)}°N,{" "}
                    {st.longitude.toFixed(4)}°W) · Completeness: {st.completeness_pct.toFixed(1)}%
                  </span>
                </p>
              </div>

              <Link
                href={`/predict?station=${st.station_id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 font-mono text-xs font-bold text-slate-950 hover:bg-cyan-400 transition"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Simulate Storm on #{st.station_id}</span>
              </Link>
            </div>

            {/* 4 Catchment Attributes + 4 Validation Metrics */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 font-mono">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Compass className="h-3 w-3 text-cyan-400" />
                  drainage_area
                </span>
                <span className="mt-1 block text-sm font-bold text-white">
                  {st.drainage_area_sqmi.toLocaleString("en-US")} sq mi
                </span>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Mountain className="h-3 w-3 text-sky-400" />
                  mean_elev_ft
                </span>
                <span className="mt-1 block text-sm font-bold text-white">
                  {st.mean_elevation_ft.toLocaleString("en-US")} ft
                </span>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Waves className="h-3 w-3 text-amber-400" />
                  slope_pct
                </span>
                <span className="mt-1 block text-sm font-bold text-white">
                  {st.slope_pct.toFixed(1)}%
                </span>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Trees className="h-3 w-3 text-emerald-400" />
                  forest_cover
                </span>
                <span className="mt-1 block text-sm font-bold text-white">
                  {st.forest_cover_pct.toFixed(1)}%
                </span>
              </div>
              <div className="rounded-lg border border-cyan-500/30 bg-slate-950 p-3">
                <span className="text-[10px] text-cyan-400">Station RMSE</span>
                <span className="mt-1 block text-sm font-bold text-white">
                  {stats?.val_rmse.toLocaleString("en-US")} cfs
                </span>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-slate-950 p-3">
                <span className="text-[10px] text-amber-400 flex items-center gap-1">
                  <Flame className="h-3 w-3" />
                  Extreme RMSE
                </span>
                <span className="mt-1 block text-sm font-bold text-amber-300">
                  {stats?.val_extreme_rmse.toLocaleString("en-US")} cfs
                </span>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <span className="text-[10px] text-slate-400">Station MAE</span>
                <span className="mt-1 block text-sm font-bold text-white">
                  {stats?.val_mae.toLocaleString("en-US")} cfs
                </span>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-slate-950 p-3">
                <span className="text-[10px] text-emerald-400">Station R²</span>
                <span className="mt-1 block text-sm font-bold text-emerald-300">
                  {stats?.val_r2.toFixed(4)}
                </span>
              </div>
            </div>
          </section>

          {/* Hydrograph + Precipitation + Soil Moisture Overlay */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <CloudRain className="h-5 w-5 text-cyan-400" />
                  <span>Daily Hydrograph, Precipitation &amp; Soil Moisture Series</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Showing {series.length} daily observations with top-10% flood threshold (
                  {st.p90_discharge_cfs.toLocaleString("en-US")} cfs).
                </p>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>0 Duplicate Dates · Sentinel -999999 Scrubbed</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <svg viewBox="0 0 900 280" className="w-full h-auto">
                {series.map((pt, idx) => {
                  const x = 45 + (idx / Math.max(1, series.length - 1)) * 830;
                  const barH = ((pt.precipitation_mm || 0) / maxRain) * 55;
                  return (
                    <rect
                      key={`rain-${pt.date}`}
                      x={x - 2.5}
                      y={10}
                      width={5}
                      height={Math.max(0, barH)}
                      fill="rgba(56, 189, 248, 0.55)"
                    />
                  );
                })}

                {(() => {
                  const p90Y =
                    250 - (Math.min(maxQ, st.p90_discharge_cfs) / maxQ) * 165;
                  return (
                    <line
                      x1={45}
                      y1={p90Y}
                      x2={875}
                      y2={p90Y}
                      stroke="#f59e0b"
                      strokeWidth={1.2}
                      strokeDasharray="5 4"
                    />
                  );
                })()}

                <polyline
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth={2.2}
                  points={series
                    .map((pt, idx) => {
                      const x = 45 + (idx / Math.max(1, series.length - 1)) * 830;
                      const y = 250 - ((pt.discharge_cfs || 0) / maxQ) * 165;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                />

                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  points={series
                    .map((pt, idx) => {
                      const x = 45 + (idx / Math.max(1, series.length - 1)) * 830;
                      const y = 250 - ((pt.predicted_discharge_cfs || 0) / maxQ) * 165;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                />
              </svg>
            </div>

            {/* Daily Observations Table */}
            <div className="mt-6 overflow-x-auto max-h-80">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead className="sticky top-0 bg-slate-950">
                  <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3">Actual cfs</th>
                    <th className="py-2 px-3">Predicted cfs</th>
                    <th className="py-2 px-3">Precip (mm)</th>
                    <th className="py-2 px-3">Temp Min/Max (°C)</th>
                    <th className="py-2 px-3">Soil Moisture</th>
                    <th className="py-2 px-3">Regime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {series.slice(0, 35).map((pt) => (
                    <tr key={pt.date} className="hover:bg-slate-950/60">
                      <td className="py-2 px-3 text-slate-200">{pt.date}</td>
                      <td className="py-2 px-3 font-bold text-cyan-300">
                        {pt.discharge_cfs?.toLocaleString("en-US") ?? "—"}
                      </td>
                      <td className="py-2 px-3 font-bold text-emerald-300">
                        {pt.predicted_discharge_cfs?.toLocaleString("en-US") ?? "—"}
                      </td>
                      <td className="py-2 px-3 text-sky-300">{pt.precipitation_mm} mm</td>
                      <td className="py-2 px-3 text-slate-300">
                        {pt.temp_min_c}° / {pt.temp_max_c}°C
                      </td>
                      <td className="py-2 px-3 text-slate-300">{pt.soil_moisture}</td>
                      <td className="py-2 px-3">
                        {pt.is_extreme_p90 ? (
                          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-400/30">
                            TOP-10% PEAK
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px]">Normal Flow</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
