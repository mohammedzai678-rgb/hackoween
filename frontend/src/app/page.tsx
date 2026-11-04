"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchHealth,
  fetchRuns,
  fetchStations,
  HealthResponse,
  RunSummary,
  StationSummary,
} from "@/lib/api";
import {
  useRole,
  ROLE_CONFIG,
  UserRole,
} from "@/components/RoleProvider";
import {
  Waves,
  Activity,
  MapPin,
  Globe,
  Database,
  Cpu,
  Play,
  ArrowRight,
  CheckCircle2,
  TrendingDown,
  BarChart3,
  Zap,
  Terminal,
  Shield,
  Droplets,
  Clock,
} from "lucide-react";

const ROLE_ORDER: UserRole[] = ["admin", "forecaster", "ml_engineer"];

export default function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const { role, setRole, roleInfo, canAccess } = useRole();

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchHealth().catch(() => null),
      fetchRuns().catch(() => [] as RunSummary[]),
      fetchStations().catch(() => [] as StationSummary[]),
    ])
      .then(([h, r, s]) => {
        if (!mounted) return;
        setHealth(h);
        setRuns(r);
        setStations(s);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const bestRun = runs.length > 0 ? runs[0] : null;
  const isOnline = health?.status === "ok" || health?.status === "healthy";
  const topStations = stations.slice(0, 4);

  const allQuickActions = [
    {
      href: "/today",
      icon: <Clock className="h-5 w-5" />,
      title: "Today's Forecast",
      description:
        "Real-time current day discharge predictions, basin flood stages, and surge risks across all 32 USGS gauges.",
    },
    {
      href: "/map",
      icon: <Globe className="h-5 w-5" />,
      title: "Storm Map",
      description:
        "Interactive spatial map to place future storms and predict flood surges across all USGS gauges.",
    },
    {
      href: "/predict",
      icon: <Play className="h-5 w-5" />,
      title: "Predict",
      description:
        "Simulate multi-day storm events or upload batch CSV rows with selectable ML models.",
    },
    {
      href: "/vault",
      icon: <Database className="h-5 w-5" />,
      title: "Vault & RAG",
      description:
        "Store predictions, compare multi-simulation hydrographs, and query the FAISS + Transformer Vector DB.",
    },
    {
      href: "/stations",
      icon: <MapPin className="h-5 w-5" />,
      title: "Stations",
      description:
        "Browse 32 monitored USGS river gauge basins with live hydrographs and flow statistics.",
    },
    {
      href: "/models",
      icon: <Cpu className="h-5 w-5" />,
      title: "Models",
      description:
        "Compare Ensemble, XGBoost, CatBoost, and LightGBM models across evaluation metrics.",
    },
    {
      href: "/train",
      icon: <Terminal className="h-5 w-5" />,
      title: "Train",
      description:
        "Configure hyperparameters and launch gated training runs with live log streaming.",
    },
  ];

  const visibleActions = allQuickActions.filter((card) => canAccess(card.href));

  return (
    <div className="space-y-8">
      {/* ── Hero Section ── */}
      <section className="relative overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-gradient-to-br from-[var(--bg-card)] via-[var(--bg-card)] to-[var(--accent-light)] px-6 py-10 sm:px-10 sm:py-12">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/30 bg-[var(--accent-light)] px-3.5 py-1 text-xs font-semibold text-[var(--accent)]">
              <Waves className="h-3.5 w-3.5" />
              Hydrological Forecasting &amp; Flood Intelligence
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--text-primary)]">
              FLOODCAST
            </h1>

            <p className="text-base text-[var(--text-secondary)] leading-relaxed">
              Predict daily river discharge across 32 diverse USGS watersheds before the surge strikes. Powered by multi-objective gradient boosting and physical catchment features.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/map"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--accent-hover)]"
            >
              <Globe className="h-4 w-4" />
              Open Storm Map
            </Link>
            <Link
              href="/predict"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-hover)]"
            >
              <Play className="h-4 w-4 text-[var(--accent)] fill-current" />
              Run Prediction
            </Link>
            {canAccess("/stations") && (
              <Link
                href="/stations"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-hover)]"
              >
                <MapPin className="h-4 w-4 text-[var(--accent)]" />
                Explore Stations
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ── Role Workspace Switcher Banner ── */}
      <section className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-light)] text-[var(--accent)]">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Active Workspace
                </span>
                <span className="rounded-full bg-[var(--accent-light)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent)]">
                  {roleInfo.label}
                </span>
                <span className="rounded-md bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                  {roleInfo.badge}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {roleInfo.description}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {ROLE_ORDER.map((rKey) => {
              const cfg = ROLE_CONFIG[rKey];
              const isSelected = role === rKey;
              return (
                <button
                  key={rKey}
                  type="button"
                  onClick={() => setRole(rKey)}
                  className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-all ${
                    isSelected
                      ? "bg-[var(--accent)] text-white shadow-sm"
                      : "border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Key Metrics Row ── */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-[var(--accent)]" />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              Best Model Performance
            </h2>
            {bestRun && (
              <span className="ml-1 rounded-md bg-[var(--bg-secondary)] px-2.5 py-0.5 font-mono text-xs text-[var(--text-secondary)]">
                {bestRun.run_id}
              </span>
            )}
          </div>

          {bestRun && (
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/40 bg-[var(--accent-light)] px-3.5 py-1 text-xs font-semibold text-[var(--accent)]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Composite Score: {bestRun.composite_score.toFixed(1)} / 100</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-28 animate-pulse rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)]"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Overall RMSE"
              value={formatNumber(bestRun?.rmse)}
              unit="cfs"
              icon={<TrendingDown className="h-4 w-4" />}
              color="accent"
            />
            <MetricCard
              label="Extreme RMSE (Top 10%)"
              value={formatNumber(bestRun?.extreme_rmse)}
              unit="cfs"
              icon={<Zap className="h-4 w-4" />}
              color="warning"
            />
            <MetricCard
              label="MAE"
              value={formatNumber(bestRun?.mae)}
              unit="cfs"
              icon={<BarChart3 className="h-4 w-4" />}
              color="accent"
            />
            <MetricCard
              label="R² Score"
              value={bestRun?.r2 != null ? bestRun.r2.toFixed(4) : "—"}
              icon={<Activity className="h-4 w-4" />}
              color="success"
              highlight
            />
          </div>
        )}
      </section>

      {/* ── System Status ── */}
      <section className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          System Status
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
          <StatusItem
            label="API Service"
            value={isOnline ? "Online" : "Checking…"}
            ok={isOnline}
          />
          <StatusItem
            label="Active Stations"
            value={stations.length > 0 ? `${stations.length} Gauges` : "—"}
            ok={stations.length > 0}
          />
          <StatusItem
            label="Trained Models"
            value={runs.length > 0 ? `${runs.length} Available` : "—"}
            ok={runs.length > 0}
          />
          <StatusItem
            label="Predictions Pipeline"
            value={health?.predictions_ready ? "Ready" : "Standby"}
            ok={!!health?.predictions_ready}
          />
        </div>
      </section>

      {/* ── Quick Actions Grid ── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            Quick Actions ({roleInfo.label})
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {visibleActions.length} tools enabled for current role
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {visibleActions.map((card) => (
            <ActionCard
              key={card.href}
              href={card.href}
              icon={card.icon}
              title={card.title}
              description={card.description}
            />
          ))}
        </div>
      </section>

      {/* ── Top Monitored Stations Preview ── */}
      {topStations.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-[var(--accent)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                Top Monitored Stations
              </h2>
            </div>
            <Link
              href="/stations"
              className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] hover:underline"
            >
              View all {stations.length} stations
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {topStations.map((st) => (
              <Link
                key={st.station_id}
                href={`/stations/${st.station_id}`}
                className="group flex flex-col justify-between rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 transition hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-hover)]"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-mono text-xs font-semibold text-[var(--accent)]">
                      #{st.station_id}
                    </span>
                    <span className="rounded bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                      {st.state}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1 group-hover:text-[var(--accent)] transition-colors">
                    {st.station_name}
                  </h3>
                  <p className="mt-1 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <Droplets className="h-3 w-3 text-[var(--accent)]" />
                    {st.river_name}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-[var(--border-primary)] flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[var(--text-muted)]">Mean Flow: </span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {st.mean_discharge_cfs.toLocaleString("en-US")} cfs
                    </span>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)] group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Helper Components ── */

function MetricCard({
  label,
  value,
  unit,
  icon,
  color,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
  color: "accent" | "success" | "warning" | "danger";
  highlight?: boolean;
}) {
  const colorVar = `var(--${color})`;
  const lightVar = `var(--${color}-light)`;

  return (
    <div
      className={`rounded-xl border p-5 transition ${
        highlight
          ? "border-[var(--accent)] bg-[var(--accent-light)]"
          : "border-[var(--border-primary)] bg-[var(--bg-card)]"
      }`}
    >
      <div className="flex items-center gap-2 text-[var(--text-muted)] mb-3">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: lightVar, color: colorVar }}
        >
          {icon}
        </span>
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)]">
        {value}
        {unit && (
          <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

function StatusItem({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          ok ? "bg-[var(--success)]" : "bg-[var(--text-muted)]"
        }`}
      />
      <div>
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {value}
        </p>
      </div>
    </div>
  );
}

function ActionCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5 transition hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-hover)] hover:shadow-sm"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-light)] text-[var(--accent)] mb-3.5">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">
        {title}
      </h3>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed flex-1">
        {description}
      </p>
      <div className="mt-4 flex items-center gap-1 text-sm font-medium text-[var(--accent)] group-hover:translate-x-1 transition-transform">
        Open
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  );
}

function formatNumber(val?: number): string {
  if (val == null) return "—";
  return val.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
