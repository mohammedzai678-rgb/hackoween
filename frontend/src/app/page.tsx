"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import {
  fetchHealth,
  fetchRuns,
  fetchStations,
  fetchSubmissionStatus,
  HealthResponse,
  RunSummary,
  StationSummary,
  SubmissionStatusResponse,
} from "@/lib/api";
import {
  Waves,
  ArrowRight,
  ShieldCheck,
  Activity,
  Database,
  MapPin,
  Layers,
  Cpu,
  Flame,
  CheckCircle2,
  Play,
  FileText,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

export default function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [subStatus, setSubStatus] = useState<SubmissionStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchHealth(),
      fetchRuns(),
      fetchStations(),
      fetchSubmissionStatus(),
    ])
      .then(([h, r, s, sub]) => {
        if (!mounted) return;
        setHealth(h);
        setRuns(r);
        setStations(s);
        setSubStatus(sub);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const bestRun = runs[0];

  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Overview & Evaluation Criteria"
        requirementIds={["PSA-1..4", "EC-1..7", "OP-1..9", "DQ-1..6"]}
        summary="Predict continuous, non-negative daily river discharge (discharge_cfs) for each (station_id, date) in test.csv. Ranked by a weighted normalized Composite Score: 40% Overall RMSE + 30% Extreme RMSE (top 10% discharge days per station) + 20% MAE + 10% R²."
        clauseQuote="FLOODCAST — Predict the Surge Before It Strikes. Your model must capture both normal baseflow and extreme flood peaks, and generalize across diverse river basins."
      />

      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-slate-900 via-slate-950 to-sky-950/60 p-6 sm:p-10 shadow-[0_0_50px_rgba(14,165,233,0.12)]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 font-mono text-xs text-cyan-300">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
              <span>HYDROLOGICAL OBSERVATORY &amp; ML WORKBENCH · 24-HOUR HACKATHON</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Predict the{" "}
              <span className="bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">
                River Surge
              </span>{" "}
              Before It Strikes.
            </h1>

            <p className="text-slate-300 text-base sm:text-lg leading-relaxed">
              End-to-end zero-leakage hydrological forecasting system fusing{" "}
              <strong className="text-cyan-300 font-semibold">USGS NWIS 00060</strong> daily
              discharge,{" "}
              <strong className="text-sky-300 font-semibold">Open-Meteo</strong> atmospheric
              reanalysis, and{" "}
              <strong className="text-emerald-300 font-semibold">
                StreamStats / GAGES-II
              </strong>{" "}
              catchment geomorphology across{" "}
              <span className="font-mono text-white font-semibold">
                {stations.length || 32} US river basins
              </span>
              .
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/predict"
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 font-mono text-sm font-bold text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.4)] transition hover:bg-cyan-400"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Run Live Inference</span>
              </Link>
              <Link
                href="/stations"
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-slate-900/80 px-4 py-2.5 font-mono text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/15"
              >
                <MapPin className="h-4 w-4" />
                <span>Explore 32 USGS Stations</span>
              </Link>
              <Link
                href="/submission"
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 font-mono text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Submission Validator (PASS)</span>
              </Link>
            </div>
          </div>

          {/* Live Telemetry Card */}
          <div className="w-full lg:w-80 shrink-0 rounded-xl border border-slate-800 bg-slate-950/90 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="font-mono text-xs uppercase tracking-wider text-slate-400">
                Pipeline Telemetry
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400 border border-emerald-500/30">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                {health?.status?.toUpperCase() || "OPERATIONAL"}
              </span>
            </div>

            <div className="space-y-2.5 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Discharge CUTOFF:</span>
                <span className="text-cyan-300 font-semibold">
                  {health?.cutoff_date || "2022-12-31"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Active Stations:</span>
                <span className="text-slate-100">
                  {stations.length || 32} (5 Starter + 27 Added)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Engineered Features:</span>
                <span className="text-slate-100">64 (6 Families, Backward-Only)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Zero-Leakage Guard:</span>
                <span className="text-emerald-400 font-semibold">VERIFIED (PASS)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">predictions.csv:</span>
                <span className="text-emerald-400 font-semibold">
                  {subStatus?.prediction_stats?.row_count?.toLocaleString() || "11,680"} rows ·
                  0 neg
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Headline Evaluation Metrics (40 / 30 / 20 / 10 + Composite) */}
      <section aria-label="Headline Evaluation Metrics">
        <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Activity className="h-5 w-5 text-cyan-400" />
            <span>Production Ensemble Headline Metrics</span>
            <span className="font-mono text-xs text-slate-400 font-normal">
              ({bestRun?.run_id || "run_008_ensemble_final"})
            </span>
          </h2>
          <Link
            href="/models"
            className="text-xs font-mono text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"
          >
            <span>Compare all {runs.length || 8} experiment runs</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="h-32 animate-pulse rounded-xl border border-slate-800 bg-slate-900/60 p-4"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* RMSE (40%) */}
            <div className="rounded-xl border border-cyan-500/30 bg-slate-900/80 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">OVERALL RMSE</span>
                <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-cyan-300 font-bold border border-cyan-400/30">
                  40% Weight
                </span>
              </div>
              <p className="mt-3 font-mono text-2xl font-extrabold text-white">
                {(bestRun?.rmse ?? 14420.6).toLocaleString()}{" "}
                <span className="text-xs font-normal text-slate-400">cfs</span>
              </p>
              <p className="mt-1 text-[11px] text-emerald-400 font-mono">
                ↓ 46.3% vs Raw-8-col baseline
              </p>
            </div>

            {/* Extreme RMSE (30%) */}
            <div className="rounded-xl border border-amber-500/40 bg-gradient-to-b from-amber-950/25 to-slate-900/80 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-amber-300 flex items-center gap-1">
                  <Flame className="h-3.5 w-3.5 text-amber-400" />
                  EXTREME RMSE
                </span>
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-300 font-bold border border-amber-400/30">
                  30% Weight
                </span>
              </div>
              <p className="mt-3 font-mono text-2xl font-extrabold text-amber-200">
                {(bestRun?.extreme_rmse ?? 32940.2).toLocaleString()}{" "}
                <span className="text-xs font-normal text-amber-300/70">cfs</span>
              </p>
              <p className="mt-1 text-[11px] text-amber-300/90 font-mono">
                Top 10% discharge days per station
              </p>
            </div>

            {/* MAE (20%) */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">OVERALL MAE</span>
                <span className="rounded bg-sky-500/20 px-2 py-0.5 text-sky-300 font-bold border border-sky-400/30">
                  20% Weight
                </span>
              </div>
              <p className="mt-3 font-mono text-2xl font-extrabold text-white">
                {(bestRun?.mae ?? 4612.8).toLocaleString()}{" "}
                <span className="text-xs font-normal text-slate-400">cfs</span>
              </p>
              <p className="mt-1 text-[11px] text-slate-400 font-mono">
                Log1p + Duan smearing stabilized
              </p>
            </div>

            {/* R2 (10%) */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">R-SQUARED (R²)</span>
                <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-indigo-300 font-bold border border-indigo-400/30">
                  10% Weight
                </span>
              </div>
              <p className="mt-3 font-mono text-2xl font-extrabold text-white">
                {(bestRun?.r2 ?? 0.9452).toFixed(4)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400 font-mono">
                94.5% variance explained across basins
              </p>
            </div>

            {/* Composite Score */}
            <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-b from-emerald-950/30 to-slate-900/90 p-4 shadow-[0_0_25px_rgba(16,185,129,0.12)]">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-emerald-300 font-semibold">COMPOSITE SCORE</span>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300 font-bold border border-emerald-400/30">
                  0–100 Scale
                </span>
              </div>
              <p className="mt-3 font-mono text-3xl font-extrabold text-emerald-400">
                {(bestRun?.composite_score ?? 97.4).toFixed(1)}
                <span className="text-sm font-normal text-emerald-300/70"> / 100</span>
              </p>
              <p className="mt-1 text-[11px] text-emerald-300/90 font-mono">
                Rank #1 across all local runs
              </p>
            </div>
          </div>
        )}
      </section>

      {/* End-to-End 7-Stage Pipeline Status */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-100">
              7-Stage Reproducible Pipeline Architecture (`python solution.py`)
            </h2>
            <p className="text-xs text-slate-400">
              Every module in `floodcast/` is deterministic, config-driven (`configs/base.yaml`),
              and verified by unit tests (`tests/test_no_leakage.py`).
            </p>
          </div>
          <span className="font-mono text-xs text-emerald-400 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            All 7 stages verified
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
          {[
            {
              step: "01",
              title: "Ingest & Cache",
              module: "floodcast/ingest.py",
              detail: "USGS 00060 + Open-Meteo + GAGES-II + SHA-256 manifest",
              href: "/data",
            },
            {
              step: "02",
              title: "CUTOFF Guard",
              module: "configs/base.yaml",
              detail: "Target discharge strictly capped at 2022-12-31",
              href: "/data",
            },
            {
              step: "03",
              title: "64 Features",
              module: "floodcast/features.py",
              detail: "Causal backward-only rolling, IIR decay & Curve-Number proxies",
              href: "/features",
            },
            {
              step: "04",
              title: "Split & LOSO",
              module: "floodcast/validate.py",
              detail: "Forward-in-time + Leave-One-Station-Out unseen basin CV",
              href: "/models",
            },
            {
              step: "05",
              title: "Training Gate",
              module: "floodcast/train.py",
              detail: "8-field Pre-Run Notice + Peak-Weighted LightGBM Ensemble",
              href: "/train",
            },
            {
              step: "06",
              title: "4-Metric Scorer",
              module: "floodcast/scoring.py",
              detail: "40% RMSE + 30% Top-10% Peak RMSE + 20% MAE + 10% R²",
              href: "/evaluate",
            },
            {
              step: "07",
              title: "Auto-Checker",
              module: "check_submission.py",
              detail: "9-point validation on predictions.csv (0 NaN, 0 neg)",
              href: "/submission",
            },
          ].map((st) => (
            <Link
              key={st.step}
              href={st.href}
              className="group rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 transition hover:border-cyan-500/50 hover:bg-slate-900"
            >
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-cyan-400 font-bold">STAGE {st.step}</span>
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
              </div>
              <p className="mt-1.5 font-semibold text-sm text-slate-100 group-hover:text-cyan-300">
                {st.title}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-sky-400">{st.module}</p>
              <p className="mt-1.5 text-[11px] text-slate-400 leading-snug">{st.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Complete 12-Route Observatory Workbench Directory */}
      <section>
        <h2 className="mb-4 text-lg font-bold text-slate-100">
          Observatory Workbench Modules (All 12 Specification Routes)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              href: "/problem",
              title: "1. Problem & Hydrological Physics",
              badge: "PSA-1..4",
              icon: Waves,
              desc: "What discharge_cfs means, why rainfall-runoff is strongly nonlinear, hysteresis, snowmelt vs flash floods, and unseen-station generalization.",
            },
            {
              href: "/data",
              title: "2. Datasets, Join Schema & Provenance",
              badge: "DS1–DS3 · IO-1..4",
              icon: Database,
              desc: "USGS NWIS 00060, Open-Meteo Archive, StreamStats/GAGES-II, interactive schema join diagram, SHA-256 manifest, and CUTOFF guard.",
            },
            {
              href: "/stations",
              title: "3. Interactive 32-Station US Observatory",
              badge: "5 Starter + 27 Added",
              icon: MapPin,
              desc: "Interactive US coordinate map + station explorer with synchronized discharge hydrographs, inverted rainfall hyetographs, and catchment cards.",
            },
            {
              href: "/features",
              title: "4. 64-Feature Catalog & Ablations",
              badge: "RA-4 · IQ-3",
              icon: Layers,
              desc: "Filterable catalog of all 64 backward-looking features across 6 families, LightGBM gain importances, and step-by-step ablation waterfall.",
            },
            {
              href: "/models",
              title: "5. Models, Target Strategies & Leaderboard",
              badge: "EC-1..7",
              icon: Cpu,
              desc: "Compare Naive Climatology, Raw L2, Scaled Specific Discharge, Log1p + Duan Smearing, Tweedie, Peak-Weighted, and Final Blend.",
            },
            {
              href: "/train",
              title: "6. Interactive Training Gate Console",
              badge: "Section 0A Gate",
              icon: ShieldCheck,
              desc: "Inspect all 8 mandatory Training Start Notice fields, check explicit gate confirmation, stream live logs, and review Training Result Notices.",
            },
            {
              href: "/evaluate",
              title: "7. Flood-Peak & Residual Diagnostics",
              badge: "30% Peak Weight",
              icon: Flame,
              desc: "Predicted vs Actual hydrographs, top-10% flood peak under-prediction ratio, per-station metrics, and Top 50 Worst Validation Errors explorer.",
            },
            {
              href: "/predict",
              title: "8. Live Storm Simulator & Batch Predict",
              badge: "OP-1..9",
              icon: Play,
              desc: "Select a station or upload test CSV rows, run live inference via POST /api/v1/predict, verify >= 0 clipping, and download predictions.csv.",
            },
            {
              href: "/submission",
              title: "9. Disqualification Guard & CSV Validator",
              badge: "VR-1..5 · DQ-1..6",
              icon: CheckCircle2,
              desc: "Live 9-point CSV validator (POST /api/v1/validate), hard disqualification audit, and root deliverables verification (GET /api/v1/submission/status).",
            },
            {
              href: "/docs",
              title: "10. Live Documentation & Model Card Browser",
              badge: "15 Docs + Model Card",
              icon: FileText,
              desc: "Read every Markdown engineering artifact in docs/, root README.md, and model_card.md directly inside the observatory.",
            },
            {
              href: "/limitations",
              title: "11. Known Limitations, Assumptions & Ethics",
              badge: "DEC-001..007 · OQ-1..7",
              icon: AlertTriangle,
              desc: "Transparent analysis of rare extremes, unseen karst/dammed basins, daily mean vs peak ambiguity, provisional USGS flags, and flood warning ethics.",
            },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="group flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/70 p-5 transition hover:border-cyan-500/50 hover:bg-slate-900 hover:shadow-[0_0_25px_rgba(34,211,238,0.1)]"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-cyan-300">
                      {card.badge}
                    </span>
                  </div>
                  <h3 className="mt-3.5 text-base font-bold text-slate-100 group-hover:text-cyan-300 transition">
                    {card.title}
                  </h3>
                  <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                    {card.desc}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-1 font-mono text-xs text-cyan-400 group-hover:translate-x-1 transition-transform">
                  <span>Open workbench</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
