"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import {
  fetchStations,
  fetchStationDetail,
  StationSummary,
  StationDetailResponse,
} from "@/lib/api";
import {
  MapPin,
  Waves,
  Mountain,
  Trees,
  Compass,
  CloudRain,
  ArrowUpRight,
  Flame,
  Filter,
} from "lucide-react";

export default function StationsPage() {
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("01646500");
  const [detail, setDetail] = useState<StationDetailResponse | null>(null);
  const [filterMode, setFilterMode] = useState<"ALL" | "STARTER" | "LARGE" | "SNOW">("ALL");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchStations()
      .then((list) => {
        if (!mounted) return;
        setStations(list);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchStationDetail(selectedId).then((d) => {
      if (mounted) setDetail(d);
    });
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  const filteredStations = stations.filter((s) => {
    if (filterMode === "STARTER") return s.is_starter;
    if (filterMode === "LARGE") return s.drainage_area_sqmi >= 15000;
    if (filterMode === "SNOW")
      return ["ME", "MT", "UT", "ID", "OR"].includes(s.state);
    return true;
  });

  // Coordinate projection into continental US SVG viewport (lon -126..-66, lat 25..49)
  const projectLon = (lon: number) =>
    Math.max(25, Math.min(775, ((lon - -126) / (-66 - -126)) * 740 + 30));
  const projectLat = (lat: number) =>
    Math.max(25, Math.min(395, ((49.5 - lat) / (49.5 - 24.5)) * 360 + 25));

  const activeStation = detail?.station || stations.find((s) => s.station_id === selectedId);
  const series = detail?.series?.slice(-75) || [];
  const maxQ = Math.max(
    100,
    ...series.map((p) => Math.max(p.discharge_cfs || 0, p.predicted_discharge_cfs || 0))
  );
  const maxRain = Math.max(10, ...series.map((p) => p.precipitation_mm || 0));

  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Datasets 1–3 & Geographic Generalization"
        requirementIds={["DS1-2", "DS1-3", "DS2-2", "DS3-1..2", "PSA-4"]}
        summary="Includes all 5 recommended PDF starter stations (01646500 Potomac DC, 07010000 Mississippi St. Louis, 08158000 Colorado Austin TX, 02087500 Neuse Clayton NC, 11447650 Sacramento Freeport CA) plus 27 diverse USGS basins across snowmelt, arid, coastal, and headwater regimes."
        clauseQuote="Teams are free to add more stations from USGS beyond the starter data to improve geographic generalization."
      />

      {/* Interactive US Hydrological Map + Station Selector */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-5 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <MapPin className="h-5 w-5 text-cyan-400" />
                <span>US Continental USGS Gauge Network ({stations.length} Stations)</span>
              </h1>
              <p className="text-xs text-slate-400">
                Click any gauge pin to inspect its daily hydrograph, precipitation hyetograph,
                soil moisture, and StreamStats catchment card.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
              <Filter className="h-3.5 w-3.5 text-slate-400 mr-1" />
              {[
                { id: "ALL", label: "All (32)" },
                { id: "STARTER", label: "5 Starter" },
                { id: "LARGE", label: "Large Basins" },
                { id: "SNOW", label: "Snowmelt" },
              ].map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setFilterMode(btn.id as any)}
                  className={`rounded-md px-2.5 py-1 transition ${
                    filterMode === btn.id
                      ? "bg-cyan-500 text-slate-950 font-bold"
                      : "bg-slate-950 text-slate-300 border border-slate-800 hover:border-cyan-500/40"
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive SVG Coordinate Map */}
          <div className="relative w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            <svg
              viewBox="0 0 800 420"
              className="w-full h-auto select-none"
              role="img"
              aria-label="Interactive Map of USGS River Gauge Stations across the United States"
            >
              {/* Lat/Lon Graticule Grid */}
              {[70, 140, 210, 280, 350].map((y) => (
                <line
                  key={`lat-${y}`}
                  x1={20}
                  y1={y}
                  x2={780}
                  y2={y}
                  stroke="#0f172a"
                  strokeWidth={1}
                />
              ))}
              {[120, 240, 360, 480, 600, 720].map((x) => (
                <line
                  key={`lon-${x}`}
                  x1={x}
                  y1={20}
                  x2={x}
                  y2={400}
                  stroke="#0f172a"
                  strokeWidth={1}
                />
              ))}

              {/* Stylized Continental US Boundary Outline */}
              <path
                d="M 55,60 L 185,55 L 340,55 L 495,62 L 580,92 L 665,85 L 735,48 L 758,88 L 718,145 L 705,205 L 675,265 L 650,330 L 665,382 L 635,388 L 595,335 L 515,338 L 445,385 L 385,388 L 330,335 L 225,325 L 135,295 L 68,235 L 48,145 Z"
                fill="rgba(14, 165, 233, 0.04)"
                stroke="rgba(56, 189, 248, 0.22)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />

              {/* Major River Network Hints */}
              <path
                d="M 240,85 Q 360,150 455,215 T 485,335"
                fill="none"
                stroke="rgba(34, 211, 238, 0.16)"
                strokeWidth={2.5}
              />
              <path
                d="M 580,190 Q 520,215 462,222"
                fill="none"
                stroke="rgba(34, 211, 238, 0.16)"
                strokeWidth={2}
              />

              {/* Station Nodes */}
              {filteredStations.map((st) => {
                const cx = projectLon(st.longitude);
                const cy = projectLat(st.latitude);
                const isSelected = st.station_id === selectedId;
                const radius = isSelected
                  ? 9
                  : st.is_starter
                  ? 7
                  : Math.max(4.5, Math.min(7.5, Math.log10(st.drainage_area_sqmi + 10) * 1.4));

                return (
                  <g
                    key={st.station_id}
                    onClick={() => setSelectedId(st.station_id)}
                    className="cursor-pointer group"
                    tabIndex={0}
                    role="button"
                    aria-label={`Select station ${st.station_id} ${st.station_name}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(st.station_id);
                      }
                    }}
                  >
                    {isSelected && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={16}
                        fill="rgba(34, 211, 238, 0.20)"
                        stroke="#22d3ee"
                        strokeWidth={1.5}
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill={
                        isSelected
                          ? "#22d3ee"
                          : st.is_starter
                          ? "#f59e0b"
                          : "#0ea5e9"
                      }
                      stroke="#020617"
                      strokeWidth={1.5}
                    />
                    {(isSelected || st.is_starter) && (
                      <text
                        x={cx + 10}
                        y={cy + 4}
                        fill={isSelected ? "#67e8f9" : "#fcd34d"}
                        fontSize={10}
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {st.station_id} ({st.state})
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 bg-slate-950/90 px-4 py-2 text-[11px] font-mono text-slate-400">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 inline-block" />
                  5 Official Starter Stations
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-sky-500 inline-block" />
                  27 Added Diversity Stations
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 ring-2 ring-cyan-400/40 inline-block" />
                  Selected Station
                </span>
              </div>
              <span>WGS84 Coordinate Projection (Leaflet &amp; SVG Hybrid)</span>
            </div>
          </div>
        </div>

        {/* Catchment Attributes Card (Dataset 3) */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 flex flex-col justify-between space-y-4">
          {activeStation ? (
            <>
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded border border-cyan-400/30 bg-cyan-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-300">
                    USGS #{activeStation.station_id}
                  </span>
                  {activeStation.is_starter && (
                    <span className="rounded border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-300">
                      ★ PDF STARTER
                    </span>
                  )}
                </div>

                <h2 className="mt-2.5 text-lg font-bold text-white">
                  {activeStation.station_name}
                </h2>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  {activeStation.river_name} · State: {activeStation.state} · (
                  {activeStation.latitude.toFixed(4)}°N, {activeStation.longitude.toFixed(4)}°W)
                </p>

                {/* Dataset 3: 4 Mandatory Catchment Attributes */}
                <div className="mt-4 pt-4 border-t border-slate-800">
                  <div className="text-xs font-mono uppercase tracking-wider text-emerald-400 mb-2.5">
                    Dataset 3: Catchment Attributes (StreamStats / GAGES-II)
                  </div>
                  <div className="grid grid-cols-2 gap-3 font-mono">
                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Compass className="h-3 w-3 text-cyan-400" />
                        drainage_area_sqmi
                      </span>
                      <span className="mt-1 block text-base font-bold text-white">
                        {activeStation.drainage_area_sqmi.toLocaleString()}{" "}
                        <span className="text-[11px] font-normal text-slate-400">sq mi</span>
                      </span>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Mountain className="h-3 w-3 text-sky-400" />
                        mean_elevation_ft
                      </span>
                      <span className="mt-1 block text-base font-bold text-white">
                        {activeStation.mean_elevation_ft.toLocaleString()}{" "}
                        <span className="text-[11px] font-normal text-slate-400">ft</span>
                      </span>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Waves className="h-3 w-3 text-amber-400" />
                        slope_pct
                      </span>
                      <span className="mt-1 block text-base font-bold text-white">
                        {activeStation.slope_pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Trees className="h-3 w-3 text-emerald-400" />
                        forest_cover_pct
                      </span>
                      <span className="mt-1 block text-base font-bold text-white">
                        {activeStation.forest_cover_pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Historical Discharge Quantiles */}
                <div className="mt-4 pt-4 border-t border-slate-800 font-mono text-xs space-y-2">
                  <div className="text-slate-400 uppercase text-[11px]">
                    Discharge Regime &amp; Flood Thresholds
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Mean / Median Flow:</span>
                    <span className="text-slate-100">
                      {activeStation.mean_discharge_cfs.toLocaleString()} /{" "}
                      {activeStation.median_discharge_cfs.toLocaleString()} cfs
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-300 flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5" />
                      Top-10% (P90) Flood Peak:
                    </span>
                    <span className="text-amber-300 font-bold">
                      {activeStation.p90_discharge_cfs.toLocaleString()} cfs
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Historical Peak:</span>
                    <span className="text-rose-300 font-semibold">
                      {activeStation.max_discharge_cfs.toLocaleString()} cfs
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Record Completeness:</span>
                    <span className="text-emerald-400">
                      {activeStation.completeness_pct.toFixed(1)}% (≥80% req)
                    </span>
                  </div>
                </div>
              </div>

              <Link
                href={`/stations/${activeStation.station_id}`}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 font-mono text-xs font-bold text-slate-950 hover:bg-cyan-400 transition"
              >
                <span>Open Full Station Observatory Page</span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </>
          ) : (
            <div className="h-64 animate-pulse rounded-xl bg-slate-800/50" />
          )}
        </div>
      </section>

      {/* Synchronized Hydrograph + Precipitation & Soil Moisture Overlay Chart */}
      {activeStation && series.length > 0 && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CloudRain className="h-5 w-5 text-cyan-400" />
                <span>
                  Hydrograph + Inverted Rainfall Hyetograph &amp; Soil Moisture Overlay (
                  {activeStation.station_name})
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Top bars show daily Open-Meteo precipitation (mm); bottom lines compare actual USGS
                00060 discharge vs. FLOODCAST ensemble prediction alongside the P90 flood threshold.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-mono text-xs">
              <span className="flex items-center gap-1.5 text-cyan-300">
                <span className="h-0.5 w-4 bg-cyan-400 inline-block" /> Actual cfs
              </span>
              <span className="flex items-center gap-1.5 text-emerald-300">
                <span className="h-0.5 w-4 bg-emerald-400 inline-block" /> Predicted cfs
              </span>
              <span className="flex items-center gap-1.5 text-amber-300">
                <span className="h-0.5 w-4 border-b border-dashed border-amber-400 inline-block" />{" "}
                P90 Flood Threshold
              </span>
              <span className="flex items-center gap-1.5 text-sky-400">
                <span className="h-2.5 w-2.5 bg-sky-500/60 inline-block rounded-sm" /> Precip (mm)
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <svg viewBox="0 0 900 280" className="w-full h-auto">
              {/* Inverted Rainfall Bars along top (y: 10..70) */}
              {series.map((pt, idx) => {
                const x = 45 + (idx / Math.max(1, series.length - 1)) * 830;
                const barH = ((pt.precipitation_mm || 0) / maxRain) * 55;
                return (
                  <rect
                    key={`rain-${pt.date}`}
                    x={x - 3}
                    y={10}
                    width={6}
                    height={Math.max(0, barH)}
                    fill="rgba(56, 189, 248, 0.55)"
                    rx={1}
                  />
                );
              })}

              {/* P90 Flood Peak Threshold Line */}
              {(() => {
                const p90Y =
                  250 - (Math.min(maxQ, activeStation.p90_discharge_cfs) / maxQ) * 165;
                return (
                  <>
                    <line
                      x1={45}
                      y1={p90Y}
                      x2={875}
                      y2={p90Y}
                      stroke="#f59e0b"
                      strokeWidth={1.2}
                      strokeDasharray="5 4"
                    />
                    <text
                      x={50}
                      y={p90Y - 5}
                      fill="#fbbf24"
                      fontSize={10}
                      fontFamily="monospace"
                    >
                      Top-10% Extreme Flood Threshold ({activeStation.p90_discharge_cfs.toLocaleString()} cfs)
                    </text>
                  </>
                );
              })()}

              {/* Soil Moisture Ribbon (scaled in background) */}
              <polyline
                fill="none"
                stroke="rgba(168, 85, 247, 0.35)"
                strokeWidth={1.5}
                points={series
                  .map((pt, idx) => {
                    const x = 45 + (idx / Math.max(1, series.length - 1)) * 830;
                    const y = 250 - (pt.soil_moisture || 0.3) * 150;
                    return `${x},${y}`;
                  })
                  .join(" ")}
              />

              {/* Actual Hydrograph Polyline */}
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

              {/* Predicted Hydrograph Polyline */}
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
        </section>
      )}

      {/* Full 32-Station Directory Table */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-lg font-bold text-white mb-4">
          All {filteredStations.length} Gauge Stations Directory
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                <th className="py-2.5 px-3">Station ID</th>
                <th className="py-2.5 px-3">Station Name &amp; River</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3">Drainage Area</th>
                <th className="py-2.5 px-3">Elevation / Slope / Forest</th>
                <th className="py-2.5 px-3">Mean / P90 Peak cfs</th>
                <th className="py-2.5 px-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredStations.map((st) => (
                <tr
                  key={st.station_id}
                  onClick={() => setSelectedId(st.station_id)}
                  className={`cursor-pointer transition ${
                    st.station_id === selectedId
                      ? "bg-cyan-500/10"
                      : "hover:bg-slate-950/60"
                  }`}
                >
                  <td className="py-2.5 px-3 font-bold text-cyan-300">
                    {st.station_id}
                    {st.is_starter && (
                      <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                        STARTER
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-100">{st.station_name}</td>
                  <td className="py-2.5 px-3 text-slate-300">{st.state}</td>
                  <td className="py-2.5 px-3 text-slate-200">
                    {st.drainage_area_sqmi.toLocaleString()} sq mi
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">
                    {st.mean_elevation_ft} ft · {st.slope_pct}% · {st.forest_cover_pct}%
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="text-slate-200">
                      {st.mean_discharge_cfs.toLocaleString()}
                    </span>{" "}
                    /{" "}
                    <span className="text-amber-300 font-semibold">
                      {st.p90_discharge_cfs.toLocaleString()} cfs
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <Link
                      href={`/stations/${st.station_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-cyan-300 hover:bg-cyan-500/20"
                    >
                      <span>Inspect</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
