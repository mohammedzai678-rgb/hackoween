"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  deleteSimulation,
  fetchRagStats,
  fetchSimulations,
  fetchStations,
  ingestRagDocument,
  queryRag,
  RagQueryResponse,
  RagStatsResponse,
  SimulationRecord,
  StationSummary,
} from "@/lib/api";
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  FilePlus2,
  Layers,
  Play,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";

const OVERLAY_COLORS = [
  "#0284c7", // Sky Blue
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#8b5cf6", // Violet
  "#ef4444", // Rose
];

const SUGGESTED_RAG_QUERIES = [
  "Compare Potomac River 01646500 simulations across Ensemble, XGBoost, and Flood-Peak Specialist",
  "What are the P90 and P99 flood thresholds for Ohio River at Metropolis 03612500 and Mississippi River?",
  "Compare validation RMSE, Extreme RMSE, and R2 across XGBoost, CatBoost, and LightGBM Ensemble",
  "Show stored storm simulations with the highest peak discharge and P90+ surge exceedance",
  "How does the Spatial Storm Forecast Map calculate radial rainfall decay across the 32 USGS gauges?",
];

export default function VaultAndRagPage() {
  const [simulations, setSimulations] = useState<SimulationRecord[]>([]);
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [stats, setStats] = useState<RagStatsResponse | null>(null);
  const [selectedSimIds, setSelectedSimIds] = useState<string[]>([]);

  // RAG Query State
  const [ragQueryText, setRagQueryText] = useState(SUGGESTED_RAG_QUERIES[0]);
  const [ragCategory, setRagCategory] = useState("all");
  const [ragTopK, setRagTopK] = useState(5);
  const [ragResult, setRagResult] = useState<RagQueryResponse | null>(null);
  const [ragLoading, setRagLoading] = useState(false);

  // Custom Knowledge / Data Ingestion State
  const [docTitle, setDocTitle] = useState("");
  const [docCategory, setDocCategory] = useState("custom_note");
  const [docStationId, setDocStationId] = useState("");
  const [docContent, setDocContent] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestSuccess, setIngestSuccess] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [simList, ragStats, stList] = await Promise.all([
        fetchSimulations().catch((err) => {
          console.error("fetchSimulations error:", err);
          return [] as SimulationRecord[];
        }),
        fetchRagStats().catch((err) => {
          console.error("fetchRagStats error:", err);
          return null;
        }),
        fetchStations().catch(() => [] as StationSummary[]),
      ]);
      setSimulations(simList);
      if (ragStats) setStats(ragStats);
      if (stList.length > 0) setStations(stList);
      if (simList.length > 0 && selectedSimIds.length === 0) {
        setSelectedSimIds(simList.slice(0, 4).map((s) => s.sim_id));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load Simulation Vault & Vector DB.");
    }
  };

  useEffect(() => {
    const init = async () => {
      await loadAll();
      await handleRunRagQuery(SUGGESTED_RAG_QUERIES[0], "all", 5);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunRagQuery = async (
    qOverride?: string,
    catOverride?: string,
    kOverride?: number
  ) => {
    const q = qOverride !== undefined ? qOverride : ragQueryText;
    const cat = catOverride !== undefined ? catOverride : ragCategory;
    const k = kOverride !== undefined ? kOverride : ragTopK;

    setRagLoading(true);
    setErrorMsg(null);
    try {
      const res = await queryRag({
        query: q,
        top_k: k,
        category_filter: cat === "all" ? undefined : cat,
      });
      setRagResult(res);
    } catch (err: any) {
      setErrorMsg(err?.message || "FAISS RAG query failed.");
    } finally {
      setRagLoading(false);
    }
  };

  const handleIngestCustomDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docTitle.trim() || !docContent.trim()) return;
    setIngesting(true);
    setIngestSuccess(null);
    setErrorMsg(null);
    try {
      const chunk = await ingestRagDocument({
        title: docTitle.trim(),
        category: docCategory,
        station_id: docStationId || undefined,
        content: docContent.trim(),
      });
      setDocTitle("");
      setDocContent("");
      setIngestSuccess(
        `Embedded & indexed "${chunk.title}" (${chunk.doc_id}) into FAISS IndexFlatIP!`
      );
      const updatedStats = await fetchRagStats();
      setStats(updatedStats);
      await handleRunRagQuery(chunk.title, "all", ragTopK);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to ingest custom document into FAISS.");
    } finally {
      setIngesting(false);
    }
  };

  const handleDeleteSim = async (simId: string) => {
    try {
      await deleteSimulation(simId);
      setSimulations((prev) => prev.filter((s) => s.sim_id !== simId));
      setSelectedSimIds((prev) => prev.filter((id) => id !== simId));
      const updatedStats = await fetchRagStats();
      setStats(updatedStats);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to delete simulation.");
    }
  };

  const handleToggleSimOverlay = (simId: string) => {
    setSelectedSimIds((prev) => {
      if (prev.includes(simId)) {
        return prev.filter((id) => id !== simId);
      }
      if (prev.length >= 5) {
        return [...prev.slice(1), simId];
      }
      return [...prev, simId];
    });
  };

  const handleDownloadSimCsv = (sim: SimulationRecord) => {
    const lines = [
      "station_id,date,precipitation_mm,soil_moisture,discharge_cfs,is_extreme_p90",
      ...sim.predictions.map(
        (p) =>
          `${p.station_id},${p.date},${Number(p.precipitation_mm ?? 0).toFixed(
            1
          )},${Number(p.soil_moisture ?? sim.soil_moisture).toFixed(3)},${Number(
            p.discharge_cfs
          ).toFixed(2)},${Boolean(p.is_extreme_p90)}`
      ),
    ];
    const blob = new Blob([lines.join("\n") + "\n"], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sim.sim_id}_${sim.station_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const comparedSimulations = useMemo(() => {
    const selected = simulations.filter((s) =>
      selectedSimIds.includes(s.sim_id)
    );
    return selected.length > 0 ? selected : simulations.slice(0, 3);
  }, [simulations, selectedSimIds]);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <Database className="h-7 w-7 text-[var(--accent)]" />
            Simulation Data Vault &amp; Vector DB RAG
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Persistent SQLite Simulation Vault, multi-simulation comparative hydrographs, and PyTorch Transformer + FAISS Vector Search across all 32 USGS stations &amp; 7 ML models.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/predict"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Run New Storm Simulation</span>
          </Link>
          <Link
            href="/map"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent)] transition"
          >
            <span>Open 32-Station Storm Map</span>
          </Link>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger-light)] px-4 py-3 text-xs text-[var(--danger)]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Top Vector DB & Vault Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
            <span>Vector Index Engine</span>
            <Database className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <p className="text-lg font-bold font-mono text-[var(--text-primary)]">
            FAISS IndexFlatIP
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)] truncate">
            {stats?.index_path || "artifacts/vector_store/faiss_floodcast.index"}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
            <span>Transformer Embedder</span>
            <Cpu className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <p className="text-lg font-bold font-mono text-[var(--accent)]">
            PyTorch BertModel ({stats?.vector_dimension || 384}-d)
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)] truncate">
            4-Layer Self-Attention + Hydro Semantic Projection
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
            <span>Total Indexed Vectors</span>
            <Sparkles className="h-4 w-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold font-mono text-[var(--text-primary)]">
            {stats?.total_vectors ?? "—"}{" "}
            <span className="text-xs font-normal text-[var(--text-muted)]">
              embeddings
            </span>
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            32 USGS Stations · 7 ML Models · Stored Runs
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
            <span>Stored Simulations Vault</span>
            <Layers className="h-4 w-4 text-[var(--success)]" />
          </div>
          <p className="text-2xl font-bold font-mono text-[var(--text-primary)]">
            {simulations.length}{" "}
            <span className="text-xs font-normal text-[var(--text-muted)]">
              saved runs
            </span>
          </p>
          <p className="mt-1 text-[11px] text-[var(--success)] font-medium">
            SQLite Vault + Auto-Indexed in FAISS
          </p>
        </div>
      </div>

      {/* SECTION 1: Multi-Simulation Analytics Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Graph 1: Multi-Simulation Hydrograph Overlay (SVG Line Chart) */}
        <div className="lg:col-span-7 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[var(--accent)]" />
                Multi-Simulation Hydrograph Overlay
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Comparing daily discharge trajectories (cfs) across stored simulations (toggle runs in table below)
              </p>
            </div>
            <span className="font-mono text-xs text-[var(--accent)]">
              {comparedSimulations.length} active curves
            </span>
          </div>

          {comparedSimulations.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--text-muted)]">
              No stored simulations yet. Run a prediction on{" "}
              <Link href="/predict" className="text-[var(--accent)] underline">
                /predict
              </Link>{" "}
              and click &ldquo;Save Simulation&rdquo;.
            </div>
          ) : (
            (() => {
              const w = 920;
              const h = 340;
              const padL = 60;
              const padR = 24;
              const padT = 24;
              const padB = 38;
              const plotW = w - padL - padR;
              const plotH = h - padT - padB;

              const maxSteps = Math.max(
                2,
                ...comparedSimulations.map((s) =>
                  Math.min(10, s.predictions.length)
                )
              );
              const maxFlow = Math.max(
                500,
                ...comparedSimulations.map((s) => s.peak_discharge_cfs)
              ) * 1.1;

              const toX = (idx: number, count: number) =>
                padL +
                (count <= 1 ? plotW / 2 : (idx / (count - 1)) * plotW);
              const toY = (val: number) =>
                padT + plotH - Math.min(1, Math.max(0, val / maxFlow)) * plotH;

              return (
                <div className="space-y-4">
                  <div className="w-full overflow-x-auto">
                    <svg
                      viewBox={`0 0 ${w} ${h}`}
                      className="w-full h-80 sm:h-96 select-none"
                    >
                      {[0.25, 0.5, 0.75, 1.0].map((frac) => {
                        const gy = padT + plotH * (1 - frac);
                        const labelVal = maxFlow * frac;
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

                      {/* Step Labels */}
                      {Array.from({ length: maxSteps }).map((_, idx) => {
                        const gx = toX(idx, maxSteps);
                        return (
                          <text
                            key={idx}
                            x={gx}
                            y={h - 10}
                            textAnchor="middle"
                            className="fill-[var(--text-secondary)] text-[11px] font-mono font-medium"
                          >
                            Step {idx + 1}
                          </text>
                        );
                      })}

                      {/* Simulation Lines */}
                      {comparedSimulations.map((sim, sIdx) => {
                        const color =
                          OVERLAY_COLORS[sIdx % OVERLAY_COLORS.length];
                        const pts = sim.predictions.slice(0, 10);
                        if (pts.length === 0) return null;
                        const poly = pts
                          .map(
                            (p, i) =>
                              `${toX(i, pts.length).toFixed(1)},${toY(
                                Number(p.discharge_cfs)
                              ).toFixed(1)}`
                          )
                          .join(" ");

                        return (
                          <g key={sim.sim_id}>
                            <polyline
                              fill="none"
                              stroke={color}
                              strokeWidth="3.2"
                              points={poly}
                            />
                            {pts.map((p, i) => (
                              <circle
                                key={`${sim.sim_id}-${i}`}
                                cx={toX(i, pts.length)}
                                cy={toY(Number(p.discharge_cfs))}
                                r={5.5}
                                fill={color}
                                stroke="#ffffff"
                                strokeWidth="1.8"
                              >
                                <title>
                                  {sim.title} ({p.date}):{" "}
                                  {Number(p.discharge_cfs).toLocaleString()} cfs
                                </title>
                              </circle>
                            ))}
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {comparedSimulations.map((sim, sIdx) => {
                      const color =
                        OVERLAY_COLORS[sIdx % OVERLAY_COLORS.length];
                      return (
                        <div
                          key={sim.sim_id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs"
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-medium text-[var(--text-primary)] truncate max-w-[180px]">
                            {sim.title}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--text-muted)]">
                            ({sim.run_id.replace("run_", "")})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          )}
        </div>

        {/* Graph 2 & 3: Peak vs Mean Discharge & Storm Rain vs Surge Days */}
        <div className="lg:col-span-5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-5 flex flex-col justify-between space-y-5">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-[var(--accent)]" />
              Peak vs. Mean Flow &amp; Storm Intensity Breakdown
            </h2>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Comparative crest discharge (cfs), mean basin flow, and P90+ flood exceedance across stored simulations
            </p>

            <div className="space-y-3.5">
              {simulations.slice(0, 5).map((sim, idx) => {
                const maxPeak = Math.max(
                  1000,
                  ...simulations.slice(0, 5).map((s) => s.peak_discharge_cfs)
                );
                const peakPct = Math.max(
                  8,
                  Math.round((sim.peak_discharge_cfs / maxPeak) * 100)
                );
                const meanPct = Math.max(
                  5,
                  Math.round((sim.mean_discharge_cfs / maxPeak) * 100)
                );
                const color = OVERLAY_COLORS[idx % OVERLAY_COLORS.length];

                return (
                  <div
                    key={sim.sim_id}
                    className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[var(--text-primary)] truncate">
                        {sim.title}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--accent)] shrink-0">
                        {sim.storm_peak_mm}mm · SM {sim.soil_moisture.toFixed(2)}
                      </span>
                    </div>

                    {/* Peak Flow Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono">
                        <span className="text-[var(--text-muted)]">
                          Peak Crest ({sim.run_id.replace("run_", "")})
                        </span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {sim.peak_discharge_cfs.toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })}{" "}
                          cfs
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[var(--bg-card)] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${peakPct}%`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                    </div>

                    {/* Mean Flow Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono">
                        <span className="text-[var(--text-muted)]">
                          Mean Flow ({sim.p90_exceedance_count} P90+ days)
                        </span>
                        <span className="text-[var(--text-secondary)]">
                          {sim.mean_discharge_cfs.toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })}{" "}
                          cfs
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[var(--bg-card)] overflow-hidden">
                        <div
                          className="h-full rounded-full opacity-60"
                          style={{
                            width: `${meanPct}%`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: FAISS Vector Database + PyTorch Transformer RAG Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 8 Cols: RAG Semantic Search & Grounded Answer */}
        <div className="lg:col-span-8 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[var(--accent)]" />
                Transformer + FAISS Vector RAG Intelligence
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Encodes your query into a 384-d vector with PyTorch <code className="font-mono">BertModel</code>, searches <code className="font-mono">faiss.IndexFlatIP</code>, and synthesizes a grounded hydrological response.
              </p>
            </div>
            <span className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-light)] px-2.5 py-1 font-mono text-xs font-semibold text-[var(--accent)]">
              {ragResult?.total_vectors_searched ?? stats?.total_vectors ?? 46}{" "}
              vectors indexed
            </span>
          </div>

          {/* Search Input & Filters */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="h-4 w-4 text-[var(--text-muted)] absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={ragQueryText}
                  onChange={(e) => setRagQueryText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRunRagQuery();
                  }}
                  placeholder="Ask about any of the 32 USGS stations, 7 ML models, P90 flood thresholds, or stored simulations…"
                  className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] pl-10 pr-4 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
              <select
                value={ragCategory}
                onChange={(e) => {
                  setRagCategory(e.target.value);
                  handleRunRagQuery(ragQueryText, e.target.value, ragTopK);
                }}
                className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-3 py-2.5 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="all">All Vector Categories</option>
                <option value="saved_simulation">Saved Simulations</option>
                <option value="station_hydrology">32 USGS Stations</option>
                <option value="ml_model">7 Trained ML Models</option>
                <option value="hydrology_guide">Hydrology Guides</option>
                <option value="custom_note">Custom Ingested Notes</option>
              </select>
              <button
                type="button"
                onClick={() => handleRunRagQuery()}
                disabled={ragLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition shrink-0"
              >
                <Search className="h-4 w-4" />
                {ragLoading ? "Searching FAISS…" : "Search Vector DB"}
              </button>
            </div>

            {/* Suggested Queries */}
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_RAG_QUERIES.map((sq) => (
                <button
                  key={sq}
                  type="button"
                  onClick={() => {
                    setRagQueryText(sq);
                    handleRunRagQuery(sq, ragCategory, ragTopK);
                  }}
                  className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition text-left"
                >
                  {sq}
                </button>
              ))}
            </div>
          </div>

          {/* Grounded RAG Synthesized Response */}
          {ragResult && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-light)]/40 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    Grounded RAG Synthesis
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    {ragResult.embedding_engine}
                  </span>
                </div>
                <div className="text-xs sm:text-sm text-[var(--text-primary)] whitespace-pre-line leading-relaxed">
                  {ragResult.answer}
                </div>
              </div>

              {/* Retrieved FAISS Chunks */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2.5">
                  Top Retrieved FAISS Vector Chunks ({ragResult.retrieved_chunks.length})
                </h3>
                <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                  {ragResult.retrieved_chunks.map((chunk) => {
                    const simPct = Math.min(
                      100,
                      Math.max(10, Math.round(chunk.similarity_score * 100))
                    );
                    return (
                      <div
                        key={chunk.doc_id}
                        className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3.5 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="rounded-md bg-[var(--bg-card)] border border-[var(--border-primary)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent)] uppercase">
                              {chunk.category}
                            </span>
                            <h4 className="text-xs font-bold text-[var(--text-primary)]">
                              {chunk.title}
                            </h4>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 rounded-full bg-[var(--bg-card)] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[var(--accent)]"
                                style={{ width: `${simPct}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs font-semibold text-[var(--accent)]">
                              {chunk.similarity_score.toFixed(4)}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                          {chunk.content}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right 4 Cols: Store Custom Data / Observation into Vector DB */}
        <div className="lg:col-span-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-6 flex flex-col justify-between space-y-5">
          <form onSubmit={handleIngestCustomDoc} className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <FilePlus2 className="h-4 w-4 text-[var(--accent)]" />
                Ingest Custom Data into Vector DB
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Store custom hydrological field notes, flood stage observations, or model findings directly into SQLite &amp; FAISS <code className="font-mono">IndexFlatIP</code>.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Document / Observation Title
              </label>
              <input
                type="text"
                required
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="e.g., Potomac Levee Inspection Note (May 2022)"
                className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Category
                </label>
                <select
                  value={docCategory}
                  onChange={(e) => setDocCategory(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-2.5 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value="custom_note">Custom Note</option>
                  <option value="station_hydrology">Station Hydrology</option>
                  <option value="saved_simulation">Simulation Report</option>
                  <option value="hydrology_guide">Hydrology Guide</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  USGS Station (Optional)
                </label>
                <select
                  value={docStationId}
                  onChange={(e) => setDocStationId(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] px-2.5 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value="">Global / All Basins</option>
                  {stations.map((s) => (
                    <option key={s.station_id} value={s.station_id}>
                      #{s.station_id} — {s.state}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Hydrological Content / Data Payload
              </label>
              <textarea
                rows={5}
                required
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                placeholder="Enter flood observations, sensor calibration data, crest discharge measurements, or simulation findings to embed with the PyTorch Transformer…"
                className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-input)] p-3 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={ingesting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition"
            >
              <FilePlus2 className="h-4 w-4" />
              {ingesting
                ? "Embedding with Transformer & Indexing…"
                : "Embed & Store in FAISS Vector DB"}
            </button>

            {ingestSuccess && (
              <div className="rounded-lg border border-[var(--success)]/40 bg-[var(--success-light)] px-3 py-2 text-xs text-[var(--success)]">
                {ingestSuccess}
              </div>
            )}
          </form>

          {/* Category Breakdown Mini Table */}
          {stats && (
            <div className="border-t border-[var(--border-primary)] pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5 text-[var(--accent)]" />
                FAISS Vector Store Breakdown
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(stats.categories_breakdown).map(
                  ([cat, count]) => (
                    <div
                      key={cat}
                      className="flex items-center justify-between rounded-lg bg-[var(--bg-secondary)] px-3 py-1.5"
                    >
                      <span className="font-mono text-[11px] text-[var(--text-secondary)] truncate">
                        {cat}
                      </span>
                      <span className="font-mono font-bold text-[var(--accent)]">
                        {count}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 3: Stored Simulations Vault Table */}
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-b border-[var(--border-primary)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Stored Simulations &amp; Predictions Registry (SQLite Vault)
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Check up to 5 simulations to overlay them on the Multi-Simulation Hydrograph above, or download CSV predictions.
            </p>
          </div>
          <span className="font-mono text-xs text-[var(--text-muted)]">
            {simulations.length} simulations stored
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] uppercase">
              <tr className="border-b border-[var(--border-primary)]">
                <th className="py-3 px-4 text-center">Overlay</th>
                <th className="py-3 px-4">Simulation Title</th>
                <th className="py-3 px-4">Station</th>
                <th className="py-3 px-4">ML Model</th>
                <th className="py-3 px-4 text-right">Storm Rain</th>
                <th className="py-3 px-4 text-right">Peak Flow (cfs)</th>
                <th className="py-3 px-4 text-right">Mean Flow (cfs)</th>
                <th className="py-3 px-4 text-center">P90+ Surge</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              {simulations.map((sim) => {
                const isChecked = selectedSimIds.includes(sim.sim_id);
                return (
                  <tr
                    key={sim.sim_id}
                    className={`transition-colors ${
                      isChecked
                        ? "bg-[var(--accent-light)]/40"
                        : "hover:bg-[var(--bg-card-hover)]"
                    }`}
                  >
                    <td className="py-3 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleSimOverlay(sim.sim_id)}
                        className="h-4 w-4 rounded accent-[var(--accent)] cursor-pointer"
                        aria-label={`Overlay ${sim.title}`}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[var(--text-primary)]">
                        {sim.title}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--text-muted)]">
                        {sim.sim_id} · source: {sim.source}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono font-semibold text-[var(--accent)]">
                        #{sim.station_id}
                      </span>
                      <div className="text-[11px] text-[var(--text-secondary)] truncate max-w-[180px]">
                        {sim.station_name}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[var(--text-primary)]">
                      {sim.run_id}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[var(--accent)] font-semibold">
                      {sim.storm_peak_mm.toFixed(1)} mm
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-[var(--text-primary)]">
                      {sim.peak_discharge_cfs.toLocaleString("en-US", {
                        maximumFractionDigits: 1,
                      })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[var(--text-secondary)]">
                      {sim.mean_discharge_cfs.toLocaleString("en-US", {
                        maximumFractionDigits: 1,
                      })}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {sim.p90_exceedance_count > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--warning-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
                          {sim.p90_exceedance_count} days
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[var(--success)] text-[11px]">
                          <CheckCircle2 className="h-3.5 w-3.5" />0 days
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDownloadSimCsv(sim)}
                          title="Download simulation predictions CSV"
                          className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-1.5 text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSim(sim.sim_id)}
                          title="Delete simulation from Vault & FAISS"
                          className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-1.5 text-[var(--text-secondary)] hover:border-[var(--danger)] hover:text-[var(--danger)] transition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
