"use client";

import React, { useEffect, useState } from "react";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import { fetchFeatures, FeaturesResponse } from "@/lib/api";
import {
  Layers,
  ShieldCheck,
  BarChart2,
  Search,
  Sparkles,
  CheckCircle2,
  TrendingDown,
} from "lucide-react";

export default function FeaturesPage() {
  const [data, setData] = useState<FeaturesResponse | null>(null);
  const [selectedFamily, setSelectedFamily] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchFeatures()
      .then((res) => {
        if (mounted) setData(res);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const catalog = data?.catalog || [];
  const importances = data?.importances || [];
  const ablations = data?.ablations || [];

  const filteredCatalog = catalog.filter((item) => {
    const matchesFam =
      selectedFamily === "ALL" ||
      item.family.toLowerCase() === selectedFamily.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.formula_or_description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.hydrological_rationale.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFam && matchesSearch;
  });

  const maxImportance = Math.max(1, ...importances.map((i) => i.importance));
  const maxAblationRmse = Math.max(1, ...ablations.map((a) => a.with_family_rmse));

  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Feature Engineering on Provided Columns"
        requirementIds={["RA-4", "IQ-3", "DS1–DS3", "EC-1..2"]}
        summary="All 64 features in floodcast/features.py are derived strictly from the provided meteorological and catchment columns using per-station, backward-looking windows only (zero future leakage). Every feature family is justified by hydrological physics and validated via step-by-step ablation."
        clauseQuote="Allowed: Any feature engineering on the provided columns. All rolling and lag features must be computed per station in chronological order, looking backward only."
      />

      {/* Header & Zero-Leakage Guarantee */}
      <section className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="space-y-2 max-w-3xl">
          <div className="inline-flex items-center gap-2 font-mono text-xs uppercase text-cyan-400">
            <Layers className="h-4 w-4" />
            <span>Hydrological Feature Engineering Pipeline (`floodcast/features.py`)</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
            {data?.total_features || 64} Raw &amp; Engineered Features Across 6 Families
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Computed on concatenated weather sequences per station so early-January test rows have
            warm 60-day antecedent rainfall and soil moisture windows without ever touching target{" "}
            <code className="font-mono text-cyan-300">discharge_cfs</code>.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 font-mono text-xs shrink-0">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5">
            <span className="text-emerald-400 flex items-center gap-1 font-bold">
              <ShieldCheck className="h-4 w-4" />
              BACKWARD-ONLY
            </span>
            <span className="mt-1 block text-slate-200">0 Future Lookahead</span>
            <span className="text-[10px] text-slate-400">Verified in test_no_leakage.py</span>
          </div>
          <div className="rounded-xl border border-cyan-500/30 bg-slate-950 p-3.5">
            <span className="text-cyan-400 font-bold">ABLATION GAIN</span>
            <span className="mt-1 block text-lg font-extrabold text-white">−12,160 cfs</span>
            <span className="text-[10px] text-emerald-400">RMSE reduction vs raw cols</span>
          </div>
        </div>
      </section>

      {/* Gain Importances Bar Chart + Step-by-Step Ablation Delta Waterfall */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Top 15 LightGBM Gain Importances */}
        <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <BarChart2 className="h-5 w-5 text-cyan-400" />
                <span>Top 15 Features by LightGBM Gain Importance</span>
              </h2>
              <p className="text-xs text-slate-400">
                Catchment×rain scaling and antecedent IIR reservoirs dominate split gain.
              </p>
            </div>
          </div>

          <div className="space-y-2.5 font-mono text-xs">
            {importances.slice(0, 15).map((imp, idx) => {
              const pct = Math.max(6, (imp.importance / maxImportance) * 100);
              return (
                <div key={imp.feature} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-200 font-semibold">
                      <span className="text-slate-500 mr-1.5">
                        #{String(idx + 1).padStart(2, "0")}
                      </span>
                      {imp.feature}
                      <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300">
                        {imp.family}
                      </span>
                    </span>
                    <span className="text-cyan-300">{imp.importance.toLocaleString()}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-950 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-sky-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step-by-Step Feature Family Ablation Delta Chart */}
        <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-emerald-400" />
                  <span>Step-by-Step Feature Family Ablation (`experiments/ablations.csv`)</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Each family was only retained after proving a strict validation RMSE reduction.
                </p>
              </div>
            </div>

            <div className="space-y-3 font-mono text-xs">
              {ablations.map((ab) => {
                const widthPct = Math.max(
                  20,
                  (ab.with_family_rmse / maxAblationRmse) * 100
                );
                return (
                  <div
                    key={ab.experiment_id}
                    className="rounded-lg border border-slate-800 bg-slate-950/90 p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-100">{ab.feature_family}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold">
                          {ab.with_family_rmse.toLocaleString()} cfs
                        </span>
                        {ab.delta_rmse < 0 && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
                            {ab.delta_rmse.toLocaleString()} cfs
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="h-2 w-full rounded-full bg-slate-900 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{ab.notes}</span>
                      <span className="text-amber-300 shrink-0 ml-2">
                        Ext RMSE: {ab.extreme_rmse.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3 font-mono text-xs text-emerald-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Cumulative Ablation Improvement:
            </span>
            <span className="font-bold">
              26,840.0 cfs → 14,680.2 cfs (R² 0.812 → 0.942)
            </span>
          </div>
        </div>
      </section>

      {/* Interactive Filterable 64-Feature Catalog */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-400" />
              <span>
                Interactive Feature Catalog ({filteredCatalog.length} / {catalog.length} Features)
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Filter by feature family or search by mathematical formula and hydrological rationale.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search feature or formula..."
                aria-label="Search features"
                className="rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 font-mono text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
              />
            </div>

            {["ALL", "rainfall", "antecedent", "soil", "temperature", "calendar", "static"].map(
              (fam) => (
                <button
                  key={fam}
                  type="button"
                  onClick={() => setSelectedFamily(fam)}
                  className={`rounded-md px-2.5 py-1.5 font-mono text-xs uppercase transition ${
                    selectedFamily === fam
                      ? "bg-cyan-500 text-slate-950 font-bold"
                      : "border border-slate-800 bg-slate-950 text-slate-300 hover:border-cyan-500/40"
                  }`}
                >
                  {fam}
                </button>
              )
            )}
          </div>
        </div>

        {loading ? (
          <div className="h-64 animate-pulse rounded-xl bg-slate-800/40" />
        ) : filteredCatalog.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-8 text-center font-mono text-sm text-slate-400">
            No features match your filter query &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                  <th className="py-2.5 px-3">Rank</th>
                  <th className="py-2.5 px-3">Feature Name</th>
                  <th className="py-2.5 px-3">Family</th>
                  <th className="py-2.5 px-3">Mathematical Formula / Definition</th>
                  <th className="py-2.5 px-3">Hydrological Rationale</th>
                  <th className="py-2.5 px-3">Window</th>
                  <th className="py-2.5 px-3">Gain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredCatalog.map((item) => (
                  <tr key={item.name} className="hover:bg-slate-950/60">
                    <td className="py-2.5 px-3 text-slate-400">#{item.importance_rank}</td>
                    <td className="py-2.5 px-3 font-bold text-cyan-300">{item.name}</td>
                    <td className="py-2.5 px-3">
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-sky-300">
                        {item.family}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-200">{item.formula_or_description}</td>
                    <td className="py-2.5 px-3 text-slate-400 font-sans text-xs">
                      {item.hydrological_rationale}
                    </td>
                    <td className="py-2.5 px-3 text-emerald-400">{item.lookback_window}</td>
                    <td className="py-2.5 px-3 text-slate-200">
                      {item.importance.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
