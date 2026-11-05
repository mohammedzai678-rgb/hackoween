"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  fetchStationDetail,
  StationDetailResponse,
  StationTimeSeriesPoint,
} from "@/lib/api";
import {
  ArrowLeft,
  MapPin,
  Droplets,
  TrendingUp,
  BarChart3,
  CloudRain,
} from "lucide-react";

export default function StationDetailPage() {
  const params = useParams();
  const stationId = String(params.id);
  const [detail, setDetail] = useState<StationDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchStationDetail(stationId)
      .catch(() => null)
      .then((d) => {
        if (mounted) setDetail(d);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [stationId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 rounded-lg bg-[var(--bg-card)] animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 rounded-xl bg-[var(--bg-card)] animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-[var(--bg-card)] animate-pulse" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="text-center py-20">
        <p className="text-[var(--text-secondary)]">Station not found.</p>
        <Link href="/stations" className="text-[var(--accent)] mt-2 inline-block">
          ← Back to Stations
        </Link>
      </div>
    );
  }

  const { station, sanity_stats, series } = detail;

  // Simple inline bar chart for discharge (actual or predicted)
  const recentWindow = series.slice(-90);
  const maxQ = Math.max(
    1,
    ...recentWindow.map((p) =>
      Math.max(p.discharge_cfs ?? 0, p.predicted_discharge_cfs ?? 0)
    )
  );

  return (
    <div className="space-y-6">
      {/* Back Link + Header */}
      <div>
        <Link
          href="/stations"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>All Stations</span>
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">
              {station.station_name}
            </h1>
            <p className="text-sm text-[var(--text-secondary)] flex items-center gap-2 mt-1">
              <MapPin className="h-4 w-4" />
              <span>{station.river_name} · {station.state}</span>
              <span className="font-mono text-[var(--text-muted)]">#{station.station_id}</span>
            </p>
          </div>
          {station.is_starter && (
            <span className="self-start rounded-full bg-[var(--accent-light)] text-[var(--accent)] px-3 py-1 text-xs font-semibold">
              Starter Station
            </span>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-1">
            <Droplets className="h-3.5 w-3.5" />
            <span>Mean Discharge</span>
          </div>
          <p className="text-xl font-bold text-[var(--text-primary)]">
            {station.mean_discharge_cfs.toLocaleString()} <span className="text-xs font-normal text-[var(--text-muted)]">cfs</span>
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-1">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Peak Discharge</span>
          </div>
          <p className="text-xl font-bold text-[var(--text-primary)]">
            {station.max_discharge_cfs.toLocaleString()} <span className="text-xs font-normal text-[var(--text-muted)]">cfs</span>
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-1">
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Drainage Area</span>
          </div>
          <p className="text-xl font-bold text-[var(--text-primary)]">
            {station.drainage_area_sqmi.toLocaleString()} <span className="text-xs font-normal text-[var(--text-muted)]">sq mi</span>
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-1">
            <CloudRain className="h-3.5 w-3.5" />
            <span>Model R²</span>
          </div>
          <p className="text-xl font-bold text-[var(--accent)]">
            {sanity_stats.val_r2.toFixed(3)}
          </p>
        </div>
      </div>

      {/* Catchment Properties */}
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Catchment Properties</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-[var(--text-muted)]">Elevation</span>
            <p className="font-medium text-[var(--text-primary)]">{station.mean_elevation_ft.toLocaleString()} ft</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Slope</span>
            <p className="font-medium text-[var(--text-primary)]">{station.slope_pct}%</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Forest Cover</span>
            <p className="font-medium text-[var(--text-primary)]">{station.forest_cover_pct}%</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Data Completeness</span>
            <p className="font-medium text-[var(--text-primary)]">{station.completeness_pct}%</p>
          </div>
        </div>
      </div>

      {/* Discharge Hydrograph (simple bar visualization) */}
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Recent Discharge Hydrograph
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {series.length} days
          </span>
        </div>

        {/* Simple bar chart */}
        <div className="flex items-end gap-[1px] h-40 overflow-hidden">
          {recentWindow.map((pt, idx) => {
            const actual = pt.discharge_cfs ?? pt.predicted_discharge_cfs ?? 0;
            const height = Math.max(2, (actual / maxQ) * 100);
            const isExtreme = pt.is_extreme_p90;
            const tooltipParts = [pt.date];
            if (pt.discharge_cfs !== null && pt.discharge_cfs !== undefined) {
              tooltipParts.push(`Actual: ${pt.discharge_cfs.toLocaleString()} cfs`);
            }
            if (pt.predicted_discharge_cfs !== null && pt.predicted_discharge_cfs !== undefined) {
              tooltipParts.push(`Predicted: ${pt.predicted_discharge_cfs.toLocaleString()} cfs`);
            }
            return (
              <div
                key={idx}
                className="flex-1 min-w-[2px] rounded-t-sm transition-all"
                style={{
                  height: `${height}%`,
                  backgroundColor: isExtreme
                    ? "var(--warning)"
                    : "var(--accent)",
                  opacity: 0.75,
                }}
                title={tooltipParts.join(" · ")}
              />
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-[var(--text-muted)]">
          <span>{recentWindow[0]?.date}</span>
          <span>{recentWindow[recentWindow.length - 1]?.date}</span>
        </div>
      </div>

      {/* Validation Metrics */}
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Model Performance at This Station</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-[var(--text-muted)]">RMSE</span>
            <p className="font-mono font-bold text-[var(--text-primary)]">{sanity_stats.val_rmse.toLocaleString()} cfs</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Extreme RMSE</span>
            <p className="font-mono font-bold text-[var(--text-primary)]">{sanity_stats.val_extreme_rmse.toLocaleString()} cfs</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">MAE</span>
            <p className="font-mono font-bold text-[var(--text-primary)]">{sanity_stats.val_mae.toLocaleString()} cfs</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">R²</span>
            <p className="font-mono font-bold text-[var(--accent)]">{sanity_stats.val_r2.toFixed(4)}</p>
          </div>
        </div>
      </div>

      {/* Recent Data Table */}
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border-primary)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Time Series Data</h2>
        </div>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[var(--bg-card)]">
              <tr className="border-b border-[var(--border-primary)] text-xs text-[var(--text-muted)] uppercase">
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-4">Actual (cfs)</th>
                <th className="py-2.5 px-4">Predicted (cfs)</th>
                <th className="py-2.5 px-4">Precip (mm)</th>
                <th className="py-2.5 px-4">Soil Moisture</th>
              </tr>
            </thead>
            <tbody>
              {series.slice(-30).reverse().map((pt, idx) => (
                <tr key={idx} className="border-b border-[var(--border-primary)] hover:bg-[var(--bg-card-hover)] transition-colors">
                  <td className="py-2 px-4 font-mono text-[var(--text-secondary)]">{pt.date}</td>
                  <td className="py-2 px-4 font-mono font-medium text-[var(--text-primary)]">
                    {pt.discharge_cfs?.toLocaleString() ?? "—"}
                  </td>
                  <td className="py-2 px-4 font-mono text-[var(--accent)]">
                    {pt.predicted_discharge_cfs?.toLocaleString() ?? "—"}
                  </td>
                  <td className="py-2 px-4 text-[var(--text-secondary)]">{pt.precipitation_mm}</td>
                  <td className="py-2 px-4 text-[var(--text-secondary)]">{pt.soil_moisture}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
