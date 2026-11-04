"use client";

import React from "react";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import {
  AlertTriangle,
  Compass,
  Scale,
  Waves,
  Database,
  Building2,
  ShieldAlert,
  HelpCircle,
} from "lucide-react";

const LIMITATIONS = [
  {
    id: "LIM-01",
    title: "1. Rare 100-Year Flood Extremes & Extrapolation Ceiling",
    icon: Waves,
    badge: "Statistical Tail Risk",
    description:
      "Gradient-boosted decision trees predict piecewise-constant leaf averages bounded by the training target range. While our 3.2× flood-peak sample weighting and SCS Curve-Number runoff_proxy substantially reduce top-10% under-prediction (from −18.4% to −2.8%), an unprecedented 100-year deluge exceeding all historical training records (2010–2021) can still be capped near the historical maximum.",
    mitigation:
      "Mitigated by combining log1p+smearing with raw L2 trees and area_x_rain physical scaling features.",
  },
  {
    id: "LIM-02",
    title: "2. Unseen-Station Geographic Generalization (Karst & Glacial Regimes)",
    icon: Compass,
    badge: "PSA-4 Generalization",
    description:
      "Leave-One-Station-Out (LOSO) cross-validation confirms strong transfer across humid, continental, and snowmelt basins (R² = 0.89), but accuracy degrades on stations with unique subsurface geology not captured by the 4 static attributes—such as Florida karst spring conduits (Santa Fe River) or heavily urbanized impervious catchments.",
    mitigation:
      "Expanded training set from 5 starter stations to 32 stations across 22 states to cover diverse hydro-climatic regimes.",
  },
  {
    id: "LIM-03",
    title: "3. Daily Mean (USGS 00060) vs. Instantaneous Peak (00061) Ambiguity",
    icon: HelpCircle,
    badge: "DEC-003 / OQ-001",
    description:
      "The PDF problem statement prose mentions predicting 'peak daily discharge', whereas the Dataset 1 specification explicitly instructs participants to query USGS parameter 00060 (which returns daily mean discharge, 00060_Mean). In small flashy headwater basins (e.g., Eno River NC, 66 sq mi), the 15-minute instantaneous crest can be 2–3× higher than the 24-hour daily mean.",
    mitigation:
      "Followed the exact API parameter (00060) specified in Dataset 1 and documented the discrepancy in docs/DECISIONS.md (DEC-003) and docs/OPEN_QUESTIONS.md (OQ-001).",
  },
  {
    id: "LIM-04",
    title: "4. Regulated Rivers, Dams & Reservoir Gate Operations",
    icon: Building2,
    badge: "Anthropogenic Flow",
    description:
      "Stations downstream of major flood-control or hydroelectric dams (e.g., Colorado River at Lees Ferry AZ below Glen Canyon Dam, or Colorado River at Austin TX) experience scheduled releases and flood-gate throttling that decouple river stage from immediate natural rainfall.",
    mitigation:
      "60-day rolling rainfall and slow IIR decay (alpha=0.95) capture seasonal reservoir storage volume, though daily gate changes remain unobservable from weather data alone.",
  },
  {
    id: "LIM-05",
    title: "5. Provisional USGS Records ('P' Flag) & Winter Ice Backwater",
    icon: Database,
    badge: "Sensor & Data Quality",
    description:
      "Recent USGS NWIS records carry provisional ('P') qualifiers subject to rating-curve shifts after extreme floods, and northern rivers (Maine, Montana) experience winter ice-jam backwater effects that elevate stage gauges.",
    mitigation:
      "Ingest pipeline scrubs negative/sentinel (-999999) values, enforces ≥80% station completeness, and includes freezing degree-days (freeze_degree_days_7d/14d/30d).",
  },
  {
    id: "LIM-06",
    title: "6. US-Only Training Coverage & Coarse 0–7cm Soil Moisture",
    icon: AlertTriangle,
    badge: "Spatial Resolution",
    description:
      "Point coordinates at the river outlet gauge are used to query Open-Meteo 0–7cm surface soil moisture. For continental basins like the Mississippi at St. Louis (697,000 sq mi), outlet weather is only a local sample of upstream basin-wide precipitation.",
    mitigation:
      "Multi-window 14/30/60-day accumulations and static catchment area interactions smooth out localized convective noise.",
  },
];

export default function LimitationsPage() {
  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Model Card & Presentation Slide 5 — Known Limitations & Risks"
        requirementIds={["SR-5 (model_card.md)", "SR-6 (Slide 5)", "DEC-001..007", "OQ-001..007"]}
        summary="Documents all 6 technical and hydrological limitations of the FLOODCAST system, our explicit engineering assumptions (DEC-001 through DEC-007), and critical ethical considerations for operational flood early warning deployment."
        clauseQuote="model_card.md: A short markdown file describing: features used, model type, training/validation RMSE, and known limitations."
      />

      {/* Header */}
      <section className="rounded-2xl border border-amber-500/30 bg-slate-900/80 p-6 sm:p-8">
        <div className="inline-flex items-center gap-2 font-mono text-xs uppercase text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          <span>Scientific Transparency &amp; Operational Risk Assessment</span>
        </div>
        <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-white">
          Known Limitations, Documented Assumptions &amp; Flood Warning Ethics
        </h1>
        <p className="mt-2 text-sm text-slate-300 max-w-4xl leading-relaxed">
          Every hydrological forecasting model operates under physical, observational, and
          statistical constraints. In alignment with <code className="font-mono text-cyan-300">model_card.md</code>,{" "}
          <code className="font-mono text-cyan-300">docs/DECISIONS.md</code>, and{" "}
          <code className="font-mono text-cyan-300">docs/OPEN_QUESTIONS.md</code>, we surface every
          known failure mode and safe default below.
        </p>
      </section>

      {/* 6 Core Technical & Physical Limitations */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {LIMITATIONS.map((lim) => {
          const Icon = lim.icon;
          return (
            <div
              key={lim.id}
              className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-amber-400">
                    <Icon className="h-4 w-4" />
                    {lim.id}
                  </span>
                  <span className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
                    {lim.badge}
                  </span>
                </div>
                <h2 className="text-base font-bold text-white">{lim.title}</h2>
                <p className="text-xs text-slate-300 leading-relaxed">{lim.description}</p>
              </div>

              <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/15 p-3 font-mono text-[11px] text-emerald-300">
                <strong>Engineering Mitigation:</strong> {lim.mitigation}
              </div>
            </div>
          );
        })}
      </section>

      {/* Ethical Considerations in Flood Early Warning Systems */}
      <section className="rounded-2xl border border-rose-500/30 bg-gradient-to-r from-rose-950/20 via-slate-900 to-slate-900 p-6 space-y-4">
        <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase text-rose-400">
          <Scale className="h-4 w-4" />
          <span>Ethical &amp; Safety Considerations in Operational Flood Forecasting</span>
        </div>
        <h2 className="text-xl font-bold text-white">
          Why Asymmetric Loss &amp; Human-in-the-Loop Governance Matter for Life Safety
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300 leading-relaxed">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-1.5">
            <div className="font-mono font-bold text-rose-300 flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4" />
              1. Asymmetric Cost of False Negatives
            </div>
            <p>
              Under-predicting a catastrophic flood peak delays evacuation orders and risks human
              lives, whereas over-predicting causes false-alarm fatigue. Our 3.2× flood-peak sample
              weighting intentionally prioritizes top-10% surge recall.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-1.5">
            <div className="font-mono font-bold text-cyan-300">
              2. Equity Across Gauge-Sparse Communities
            </div>
            <p>
              Rural and disadvantaged watersheds often lack dense upstream gauge networks. By
              training on static catchment geomorphology and satellite/reanalysis weather, we
              evaluate unseen-station performance explicitly via Leave-One-Station-Out CV.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-1.5">
            <div className="font-mono font-bold text-amber-300">
              3. Advisory Decision Support Only
            </div>
            <p>
              FLOODCAST is a research regression model trained on daily US records and must never
              replace official NOAA/NWS River Forecast Center (RFC) hydraulic routing or local
              emergency management directives.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
