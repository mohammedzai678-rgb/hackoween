"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { fetchStations, StationSummary } from "@/lib/api";
import { MapPin, Droplets, ArrowRight, Search, CloudRain } from "lucide-react";

type StationFilter = "all" | "starter" | "large" | "headwater";

const FILTER_OPTIONS: { id: StationFilter; label: string }[] = [
  { id: "all", label: "All Stations" },
  { id: "starter", label: "Starter" },
  { id: "large", label: "Large Basins (>10k mi²)" },
  { id: "headwater", label: "Headwaters (<1k mi²)" },
];

export default function StationsPage() {
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<StationFilter>("all");

  useEffect(() => {
    let mounted = true;
    fetchStations()
      .catch(() => [] as StationSummary[])
      .then((list) => {
        if (mounted) setStations(list);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    return stations.filter((s) => {
      // Category filter
      if (activeFilter === "starter" && !s.is_starter) return false;
      if (activeFilter === "large" && s.drainage_area_sqmi <= 10000) return false;
      if (activeFilter === "headwater" && s.drainage_area_sqmi >= 1000) return false;

      // Text search
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        s.station_name.toLowerCase().includes(q) ||
        s.station_id.includes(q) ||
        s.state.toLowerCase().includes(q) ||
        s.river_name.toLowerCase().includes(q)
      );
    });
  }, [stations, search, activeFilter]);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-light)]">
            <MapPin className="h-5 w-5 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">
              Monitoring Stations
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              USGS river gauge network overview &amp; catchment characteristics
            </p>
          </div>
          <span className="ml-2 rounded-full bg-[var(--accent-light)] px-3 py-0.5 text-sm font-semibold text-[var(--accent)]">
            {filtered.length} / {stations.length}
          </span>
        </div>
      </div>

      {/* Search Bar + Filter Pills */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by station name, ID, state, or river..."
            className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTER_OPTIONS.map((opt) => {
            const active = activeFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setActiveFilter(opt.id)}
                className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                  active
                    ? "bg-[var(--accent)] text-white shadow-sm"
                    : "border border-[var(--border-primary)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-56 animate-pulse rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)]"
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] py-16 text-center">
          <Search className="mb-3 h-8 w-8 text-[var(--text-muted)]" />
          <p className="text-lg font-medium text-[var(--text-secondary)]">
            No stations match your filters
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Try clearing your search or switching to All Stations
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setActiveFilter("all");
            }}
            className="mt-4 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition"
          >
            Reset Filters
          </button>
        </div>
      )}

      {/* Station Cards Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((station) => (
            <div
              key={station.station_id}
              className="group flex flex-col rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5 transition hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-hover)]"
            >
              {/* Top row: name + starter badge */}
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/stations/${station.station_id}`}
                    className="text-base font-semibold text-[var(--text-primary)] leading-snug hover:text-[var(--accent)] transition-colors block"
                  >
                    {station.station_name}
                  </Link>
                  <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
                    USGS #{station.station_id}
                  </p>
                </div>
                {station.is_starter && (
                  <span className="shrink-0 rounded-full bg-[var(--warning-light)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warning)]">
                    Starter
                  </span>
                )}
              </div>

              {/* River + State */}
              <div className="mb-4 flex items-center gap-2 text-sm">
                <span className="flex items-center gap-1 text-[var(--text-secondary)]">
                  <Droplets className="h-3.5 w-3.5 text-[var(--accent)]" />
                  {station.river_name}
                </span>
                <span className="rounded bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                  {station.state}
                </span>
              </div>

              {/* Stats */}
              <div className="mt-auto grid grid-cols-3 gap-3 rounded-lg bg-[var(--bg-secondary)] p-3">
                <div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Drainage Area
                  </p>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {station.drainage_area_sqmi.toLocaleString()}
                    <span className="ml-0.5 text-[11px] font-normal text-[var(--text-muted)]">
                      mi²
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Mean Flow
                  </p>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {station.mean_discharge_cfs.toLocaleString()}
                    <span className="ml-0.5 text-[11px] font-normal text-[var(--text-muted)]">
                      cfs
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Peak Flow
                  </p>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {station.max_discharge_cfs.toLocaleString()}
                    <span className="ml-0.5 text-[11px] font-normal text-[var(--text-muted)]">
                      cfs
                    </span>
                  </p>
                </div>
              </div>

              {/* Action Footer */}
              <div className="mt-4 pt-3 border-t border-[var(--border-primary)] flex items-center justify-between gap-2">
                <Link
                  href={`/stations/${station.station_id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  View Hydrograph
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>

                <Link
                  href={`/predict?station=${station.station_id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
                >
                  <CloudRain className="h-3.5 w-3.5" />
                  Simulate Storm
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
