"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { fetchRuns, RunSummary } from "@/lib/api";
import {
  Cpu,
  Trophy,
  BarChart3,
  CheckCircle2,
  XCircle,
  ArrowUpDown,
  Play,
} from "lucide-react";

type SortKey = "composite" | "rmse" | "extreme_rmse" | "mae" | "r2";

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "composite", label: "Composite Score" },
  { id: "rmse", label: "RMSE" },
  { id: "extreme_rmse", label: "Extreme RMSE" },
  { id: "mae", label: "MAE" },
  { id: "r2", label: "R²" },
];

function sortRuns(runs: RunSummary[], key: SortKey): RunSummary[] {
  return [...runs].sort((a, b) => {
    switch (key) {
      case "composite":
        return b.composite_score - a.composite_score;
      case "r2":
        return b.r2 - a.r2;
      case "rmse":
        return a.rmse - b.rmse;
      case "extreme_rmse":
        return a.extreme_rmse - b.extreme_rmse;
      case "mae":
        return a.mae - b.mae;
    }
  });
}

function getFamilyBadge(run: RunSummary): { label: string; style: string } {
  const fam = (run.model_family || "").toLowerCase();
  const id = (run.run_id || "").toLowerCase();
  const type = (run.model_type || "").toLowerCase();

  if (fam.includes("ensemble") || id.includes("ensemble") || type.includes("ensemble")) {
    return {
      label: "Ensemble",
      style: "bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]/30",
    };
  }
  if (fam.includes("xgb") || id.includes("xgb") || type.includes("xgb")) {
    return {
      label: "XGBoost",
      style: "bg-[var(--warning-light)] text-[var(--warning)] border border-[var(--warning)]/30",
    };
  }
  if (fam.includes("cat") || id.includes("cat") || type.includes("cat")) {
    return {
      label: "CatBoost",
      style: "bg-[var(--success-light)] text-[var(--success)] border border-[var(--success)]/30",
    };
  }
  return {
    label: "LightGBM",
    style: "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-primary)]",
  };
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
        {label}
      </span>
      <span className="text-2xl font-bold text-[var(--text-primary)]">
        {value}
      </span>
      {sub && <span className="text-xs text-[var(--text-muted)]">{sub}</span>}
    </div>
  );
}

export default function ModelsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("composite");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchRuns()
      .catch(() => [] as RunSummary[])
      .then((r) => {
        if (mounted) {
          // Filter out non-ML naive climatology floor so all listed models are working ML models
          const working = r.filter(
            (item) =>
              item.model_family !== "baseline" &&
              !item.run_id.includes("baseline_climatology") &&
              !item.run_id.includes("naive_climatology")
          );
          setRuns(working.length > 0 ? working : r);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const sortedRuns = useMemo(() => sortRuns(runs, sortBy), [runs, sortBy]);
  const bestRun = sortedRuns[0] ?? null;
  const maxComposite = Math.max(1, ...runs.map((r) => r.composite_score));

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--accent-light)]">
            <Cpu className="h-5 w-5 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">
              Model Leaderboard
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Compare Ensemble, XGBoost, CatBoost, and LightGBM models across validation metrics
            </p>
          </div>
        </div>
      </div>

      {/* Best Model Summary Card */}
      {bestRun && !loading && (
        <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-light)] p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--accent)]/20">
                <Trophy className="h-6 w-6 text-[var(--accent)]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                    Top Performing Model
                  </span>
                  {bestRun.submission_passed && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--success)] bg-[var(--success-light)] px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="h-3 w-3" /> Verified
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  {bestRun.model_type}
                </h2>
                <p className="text-xs font-mono text-[var(--text-muted)]">
                  {bestRun.run_id} · {bestRun.target_strategy}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 sm:gap-8">
              <MetricCard
                label="RMSE"
                value={bestRun.rmse.toLocaleString("en-US", {
                  maximumFractionDigits: 1,
                })}
                sub="cfs"
              />
              <MetricCard
                label="Extreme RMSE"
                value={bestRun.extreme_rmse.toLocaleString("en-US", {
                  maximumFractionDigits: 1,
                })}
                sub="cfs"
              />
              <MetricCard
                label="MAE"
                value={bestRun.mae.toLocaleString("en-US", {
                  maximumFractionDigits: 1,
                })}
                sub="cfs"
              />
              <MetricCard label="R²" value={bestRun.r2.toFixed(4)} />
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--accent)] uppercase tracking-wide">
                  Composite
                </span>
                <span className="text-3xl font-extrabold text-[var(--accent)]">
                  {bestRun.composite_score.toFixed(1)}
                </span>
                <span className="text-xs text-[var(--text-muted)]">/ 100</span>
              </div>

              <Link
                href={`/predict?model=${encodeURIComponent(bestRun.run_id)}`}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)] transition"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Try Model
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Sort Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <ArrowUpDown className="h-4 w-4" />
          <span className="font-medium">Sort leaderboard by</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSortBy(s.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                sortBy === s.id
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-12 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[var(--border-primary)] border-t-[var(--accent)]" />
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Loading model runs…
          </p>
        </div>
      )}

      {/* Empty State */}
      {!loading && runs.length === 0 && (
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-12 text-center">
          <BarChart3 className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3" />
          <p className="text-sm text-[var(--text-muted)]">
            No model runs found
          </p>
        </div>
      )}

      {/* Leaderboard Table */}
      {!loading && sortedRuns.length > 0 && (
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    #
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Model &amp; Run ID
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Family
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Target
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] text-right">
                    RMSE
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] text-right">
                    Ext. RMSE
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] text-right">
                    MAE
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] text-right">
                    R²
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--accent)] text-right">
                    Composite
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] text-center">
                    Status
                  </th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-primary)]">
                {sortedRuns.map((run, idx) => {
                  const isFirst = idx === 0;
                  const scorePct = Math.max(
                    4,
                    (run.composite_score / maxComposite) * 100
                  );
                  const badge = getFamilyBadge(run);

                  return (
                    <tr
                      key={run.run_id}
                      className={`transition-colors ${
                        isFirst
                          ? "bg-[var(--accent-light)]"
                          : "hover:bg-[var(--bg-card-hover)]"
                      }`}
                    >
                      {/* Rank */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold ${
                            isFirst
                              ? "bg-[var(--accent)] text-white"
                              : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                          }`}
                        >
                          {idx + 1}
                        </span>
                      </td>

                      {/* Model */}
                      <td className="py-3.5 px-4">
                        <div>
                          <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                            {run.model_type}
                            {isFirst && (
                              <Trophy className="h-3.5 w-3.5 text-[var(--accent)]" />
                            )}
                          </div>
                          <div className="text-xs font-mono text-[var(--text-muted)]">
                            {run.run_id}
                          </div>
                        </div>
                      </td>

                      {/* Family Badge */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.style}`}
                        >
                          {badge.label}
                        </span>
                      </td>

                      {/* Target Strategy */}
                      <td className="py-3.5 px-4">
                        <span className="inline-block text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-md">
                          {run.target_strategy}
                        </span>
                      </td>

                      {/* RMSE */}
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-[var(--text-primary)]">
                        {run.rmse.toLocaleString("en-US", {
                          maximumFractionDigits: 1,
                        })}
                      </td>

                      {/* Extreme RMSE */}
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-[var(--warning)]">
                        {run.extreme_rmse.toLocaleString("en-US", {
                          maximumFractionDigits: 1,
                        })}
                      </td>

                      {/* MAE */}
                      <td className="py-3.5 px-4 text-right font-mono text-[var(--text-secondary)]">
                        {run.mae.toLocaleString("en-US", {
                          maximumFractionDigits: 1,
                        })}
                      </td>

                      {/* R² */}
                      <td className="py-3.5 px-4 text-right font-mono text-[var(--text-secondary)]">
                        {run.r2.toFixed(4)}
                      </td>

                      {/* Composite Score with bar */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono font-bold text-[var(--accent)]">
                            {run.composite_score.toFixed(1)}
                          </span>
                          <div className="w-20 h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--accent)] transition-all"
                              style={{ width: `${scorePct}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        {run.submission_passed ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--success)] bg-[var(--success-light)] px-2.5 py-1 rounded-full">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--danger)] bg-[var(--danger-light)] px-2.5 py-1 rounded-full">
                            <XCircle className="h-3.5 w-3.5" />
                            Failed
                          </span>
                        )}
                      </td>

                      {/* Try Model Action */}
                      <td className="py-3.5 px-4 text-right">
                        <Link
                          href={`/predict?model=${encodeURIComponent(run.run_id)}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          Try Model
                        </Link>
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
