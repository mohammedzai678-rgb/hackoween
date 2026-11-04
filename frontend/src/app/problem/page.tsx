"use client";

import React, { useState } from "react";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import Link from "next/link";
import {
  Waves,
  Flame,
  Compass,
  TrendingUp,
  Layers,
  Snowflake,
  CloudRain,
  ArrowRight,
  AlertCircle,
} from "lucide-react";

export default function ProblemPage() {
  const [rainInput, setRainInput] = useState(45);
  const [soilSaturation, setSoilSaturation] = useState(0.72);
  const [basinArea, setBasinArea] = useState(11570);

  // Interactive non-linear SCS Curve Number & antecedent soil simulator
  const storageS = Math.max(5, (1 - soilSaturation) * 140);
  const initialAbstraction = 0.2 * storageS;
  const directRunoffMm =
    rainInput > initialAbstraction
      ? Math.pow(rainInput - initialAbstraction, 2) /
        (rainInput - initialAbstraction + storageS)
      : 0;
  const baseflowCfs = basinArea * (0.45 + soilSaturation * 0.65);
  const surgeCfs = Math.round(
    baseflowCfs + basinArea * directRunoffMm * (0.09 + soilSaturation * 0.12)
  );
  const p90Threshold = Math.round(basinArea * 2.1);
  const isExtremePeak = surgeCfs >= p90Threshold;

  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Problem Statement"
        requirementIds={["PSA-1", "PSA-2", "PSA-3", "PSA-4", "EC-2"]}
        summary="For each (station_id, date) in test.csv, predict continuous non-negative river discharge in cubic feet per second (discharge_cfs). Models are evaluated with a 30% weight on Extreme RMSE (top 10% discharge days per station) and must generalize across diverse geographies and unseen stations."
        clauseQuote="Floods are among the most destructive natural hazards. Predicting river discharge from weather and catchment properties is a classic nonlinear physical-ML challenge."
      />

      {/* Header */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 sm:p-8">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-cyan-400">
          <Waves className="h-4 w-4" />
          <span>Hydrological Forecasting Task Definition</span>
        </div>
        <h1 className="mt-2 text-2xl sm:text-4xl font-extrabold text-white">
          Why Predicting <code className="text-cyan-400 font-mono">discharge_cfs</code> Is
          Nonlinear &amp; Hard
        </h1>
        <p className="mt-3 text-slate-300 text-sm sm:text-base leading-relaxed max-w-4xl">
          River discharge (<code className="font-mono text-cyan-300">discharge_cfs</code>, USGS
          parameter <code className="font-mono text-cyan-300">00060</code>) measures the volume
          of water flowing past a gauge cross-section every second, in{" "}
          <strong>cubic feet per second (ft³/s)</strong>. One cubic foot per second equals{" "}
          <span className="font-mono text-slate-100">28.317 liters/sec</span> or{" "}
          <span className="font-mono text-slate-100">~646,317 gallons/day</span>. Across our 32
          USGS gauges, daily discharge spans{" "}
          <strong className="text-amber-300">five orders of magnitude</strong>—from{" "}
          <span className="font-mono">8 cfs</span> on ephemeral Texas creeks to{" "}
          <span className="font-mono">798,000 cfs</span> on the lower Mississippi River.
        </p>
      </div>

      {/* Interactive Nonlinear Rainfall-Runoff Physics Sandbox */}
      <section className="rounded-xl border border-cyan-500/30 bg-slate-900/80 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-cyan-400" />
              <span>Interactive Nonlinear Runoff Threshold Simulator</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Notice how the exact same 45 mm rainstorm produces minimal runoff on dry soil,
              but triggers a massive flood surge when antecedent soil moisture is saturated.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 font-mono text-xs font-bold border ${
              isExtremePeak
                ? "border-amber-400/50 bg-amber-500/20 text-amber-300"
                : "border-cyan-400/30 bg-cyan-500/10 text-cyan-300"
            }`}
          >
            {isExtremePeak ? "⚠ TOP-10% EXTREME FLOOD PEAK" : "NORMAL / BASEFLOW REGIME"}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div>
              <div className="flex justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-300">Daily Storm Precipitation (precipitation_mm)</span>
                <span className="text-cyan-400 font-bold">{rainInput} mm</span>
              </div>
              <input
                type="range"
                min={0}
                max={120}
                step={1}
                value={rainInput}
                onChange={(e) => setRainInput(Number(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer"
                aria-label="Daily Storm Precipitation in mm"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                <span>0 mm (Dry)</span>
                <span>40 mm (Heavy Rain)</span>
                <span>120 mm (Atmospheric River / Tropical Deluge)</span>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-300">
                  Antecedent Soil Moisture Saturation (soil_moisture)
                </span>
                <span className="text-sky-400 font-bold">
                  {(soilSaturation * 100).toFixed(0)}% ({soilSaturation.toFixed(2)})
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.95}
                step={0.01}
                value={soilSaturation}
                onChange={(e) => setSoilSaturation(Number(e.target.value))}
                className="w-full accent-sky-400 cursor-pointer"
                aria-label="Antecedent Soil Moisture"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                <span>0.10 (Drought / High Infiltration)</span>
                <span>0.50 (Field Capacity)</span>
                <span>0.95 (Saturated / Dunne Overland Flow)</span>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-300">Catchment Drainage Area (drainage_area_sqmi)</span>
                <span className="text-emerald-400 font-bold">
                  {basinArea.toLocaleString("en-US")} sq mi
                </span>
              </div>
              <input
                type="range"
                min={100}
                max={50000}
                step={100}
                value={basinArea}
                onChange={(e) => setBasinArea(Number(e.target.value))}
                className="w-full accent-emerald-400 cursor-pointer"
                aria-label="Catchment Drainage Area in sq mi"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                <span>100 sq mi (Headwater Creek)</span>
                <span>11,570 sq mi (Potomac DC)</span>
                <span>50,000 sq mi (Regional River)</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="text-xs font-mono text-slate-400 uppercase">
                Simulated Basin Response
              </div>
              <div>
                <div className="text-xs text-slate-400">Predicted Discharge</div>
                <div
                  className={`font-mono text-3xl font-extrabold mt-0.5 ${
                    isExtremePeak ? "text-amber-300" : "text-cyan-400"
                  }`}
                >
                  {surgeCfs.toLocaleString("en-US")} <span className="text-sm font-normal">cfs</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 font-mono text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px]">Effective Runoff</span>
                  <span className="text-slate-200">{directRunoffMm.toFixed(1)} mm</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Runoff Ratio (Q/P)</span>
                  <span className="text-slate-200">
                    {rainInput > 0 ? ((directRunoffMm / rainInput) * 100).toFixed(1) : "0.0"}%
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Baseflow Floor</span>
                  <span className="text-slate-200">{Math.round(baseflowCfs).toLocaleString("en-US")} cfs</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Station P90 Peak</span>
                  <span className="text-amber-400">{p90Threshold.toLocaleString("en-US")} cfs</span>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-slate-900/90 border border-slate-800 p-2.5 text-[11px] text-slate-300 font-mono">
              Formula modeled by <code className="text-cyan-300">runoff_proxy</code> &amp;{" "}
              <code className="text-cyan-300">soil_x_rain</code> in{" "}
              <code className="text-sky-300">floodcast/features.py</code>
            </div>
          </div>
        </div>
      </section>

      {/* The 4 Core Physical & Statistical Challenges */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-cyan-400 font-mono text-xs uppercase font-bold">
            <CloudRain className="h-4 w-4" />
            <span>1. Soil Saturation Hysteresis &amp; Antecedent Memory</span>
          </div>
          <h3 className="text-lg font-bold text-slate-100">
            Today&apos;s Discharge Depends on the Last 60 Days of Weather
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            A raw tabular model looking only at day <code className="font-mono text-cyan-300">t</code>{" "}
            fails completely (`RMSE = 26,840 cfs`) because river flow is an integrative storage
            process. Overland quickflow responds in 1–3 days, shallow subsurface interflow in 5–14
            days, and groundwater baseflow decays over 30–60+ days. Our pipeline models these three
            physical reservoirs explicitly via causal infinite-impulse-response (IIR) features{" "}
            <code className="font-mono text-cyan-300">rain_decayed_05</code>,{" "}
            <code className="font-mono text-cyan-300">rain_decayed_08</code>, and{" "}
            <code className="font-mono text-cyan-300">rain_decayed_095</code>.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-amber-400 font-mono text-xs uppercase font-bold">
            <Flame className="h-4 w-4" />
            <span>2. Extreme Events &amp; Heavy-Tailed Skewness (30% Weight)</span>
          </div>
          <h3 className="text-lg font-bold text-slate-100">
            Top-10% Flood Peaks Dominate Life-Safety &amp; Evaluation
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            River discharge exhibits extreme positive skewness: a station&apos;s 99th-percentile flood
            can exceed 15× its median flow. Standard unweighted L2 regression hedges toward the
            conditional mean and systematically under-predicts flood crests. Because{" "}
            <strong className="text-amber-300">
              30% of the FLOODCAST score is Extreme RMSE (top 10% discharge days per station)
            </strong>
            , we combine flood-peak sample weighting (3.2× on p90+ days) with a Log1p + Duan
            smearing model and a raw L2 model.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-sky-400 font-mono text-xs uppercase font-bold">
            <Snowflake className="h-4 w-4" />
            <span>3. Phase Partitioning: Snowpack Storage vs. Rain-on-Snow</span>
          </div>
          <h3 className="text-lg font-bold text-slate-100">
            Precipitation Below 1°C Freezes Instead of Running Off
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            In northern and alpine basins (St. John River ME, Missouri River MT, Weber River UT,
            Clark Fork MT), winter precipitation accumulates as snowpack with zero immediate
            discharge pulse, then releases months later when positive degree-days rise or a warm{" "}
            <code className="font-mono text-sky-300">rain_on_snow</code> storm strikes. Our thermal
            feature family partitions solid vs. liquid precipitation and tracks 7/14/30-day freezing
            and melting degree-days.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-emerald-400 font-mono text-xs uppercase font-bold">
            <Compass className="h-4 w-4" />
            <span>4. Geographic Generalization to Unseen Basins (PSA-4)</span>
          </div>
          <h3 className="text-lg font-bold text-slate-100">
            Zero-Shot Transfer via Catchment Geomorphology
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            The problem statement mandates that the model generalize to{" "}
            <strong>stations not seen during training</strong>. Consequently, the model cannot rely
            on memorized <code className="font-mono text-emerald-300">station_id</code> embeddings.
            Instead, we encode physical scaling laws (<code className="font-mono text-emerald-300">area_x_rain</code>,{" "}
            <code className="font-mono text-emerald-300">log_drainage_area</code>,{" "}
            <code className="font-mono text-emerald-300">slope_x_rain</code>,{" "}
            <code className="font-mono text-emerald-300">time_of_concentration</code>) and validate
            with Leave-One-Station-Out (LOSO) cross-validation across 32 diverse stations.
          </p>
        </div>
      </section>

      {/* Ambiguity Callout: Daily Mean vs Peak (DEC-003 / OQ-001) */}
      <section className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-5 flex flex-col sm:flex-row items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-amber-200 font-mono">
              Documented Specification Note (DEC-003 / OQ-001): USGS 00060 Daily Mean vs. Peak
              Wording
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              While the narrative overview mentions &ldquo;peak daily discharge,&rdquo; Dataset 1
              explicitly specifies USGS NWIS daily values service with{" "}
              <code className="font-mono text-amber-300">parameterCd=00060</code>, which returns{" "}
              <strong>daily mean discharge (00060_Mean)</strong> (instantaneous peak is USGS
              parameter 00061). Per our engineering protocol, we train on the exact{" "}
              <code className="font-mono text-amber-300">00060</code> target returned by the
              official API and log this in <code className="font-mono">docs/DECISIONS.md</code> and{" "}
              <code className="font-mono">docs/OPEN_QUESTIONS.md</code>.
            </p>
          </div>
        </div>
        <Link
          href="/limitations"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3.5 py-2 font-mono text-xs text-amber-200 hover:bg-amber-500/25"
        >
          <span>View Decisions &amp; Limitations</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>
    </div>
  );
}
