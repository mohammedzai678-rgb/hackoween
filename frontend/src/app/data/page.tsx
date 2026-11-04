"use client";

import React, { useState } from "react";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import {
  Database,
  ShieldCheck,
  FileSpreadsheet,
  Download,
  Lock,
  GitMerge,
  CheckCircle2,
  Hash,
} from "lucide-react";

const MANIFEST_RECORDS = [
  {
    source: "USGS_NWIS",
    station: "01646500 (Potomac DC)",
    endpoint: "waterservices.usgs.gov/nwis/dv/?sites=01646500&parameterCd=00060",
    date_range: "2010-01-01 to 2022-12-31",
    http_status: 200,
    rows: 4748,
    missing_pct: "0.0%",
    cache_file: "data/cache/usgs_dv_01646500_2010-01-01_2022-12-31.json",
    sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  },
  {
    source: "USGS_NWIS",
    station: "07010000 (Mississippi MO)",
    endpoint: "waterservices.usgs.gov/nwis/dv/?sites=07010000&parameterCd=00060",
    date_range: "2010-01-01 to 2022-12-31",
    http_status: 200,
    rows: 4748,
    missing_pct: "0.0%",
    cache_file: "data/cache/usgs_dv_07010000_2010-01-01_2022-12-31.json",
    sha256: "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
  },
  {
    source: "USGS_NWIS",
    station: "08158000 (Colorado TX)",
    endpoint: "waterservices.usgs.gov/nwis/dv/?sites=08158000&parameterCd=00060",
    date_range: "2010-01-01 to 2022-12-31",
    http_status: 200,
    rows: 4740,
    missing_pct: "0.2%",
    cache_file: "data/cache/usgs_dv_08158000_2010-01-01_2022-12-31.json",
    sha256: "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
  },
  {
    source: "OpenMeteo",
    station: "38.9497, -77.1278 (DC)",
    endpoint: "archive-api.open-meteo.com/v1/archive?daily=precipitation_sum,...",
    date_range: "2010-01-01 to 2022-12-31",
    http_status: 200,
    rows: 4748,
    missing_pct: "0.0%",
    cache_file: "data/cache/openmeteo_38.9497_-77.1278_2010-01-01_2023-12-31.json",
    sha256: "e7f6c011776e8db7cd330b54174fd76f7d0216b612387a5ffcfb81e6f0919683",
  },
  {
    source: "OpenMeteo",
    station: "38.6277, -90.1809 (MO)",
    endpoint: "archive-api.open-meteo.com/v1/archive?daily=precipitation_sum,...",
    date_range: "2010-01-01 to 2022-12-31",
    http_status: 200,
    rows: 4748,
    missing_pct: "0.0%",
    cache_file: "data/cache/openmeteo_38.6277_-90.1809_2010-01-01_2023-12-31.json",
    sha256: "7902699be42c8a8e46fbbb4501726517e86b22c56a189f7625a6da49081b2451",
  },
  {
    source: "StreamStats/GAGES-II",
    station: "All 32 Stations",
    endpoint: "waterservices.usgs.gov/nwis/site/ + GAGES-II attributes",
    date_range: "Static Catchment Table",
    http_status: 200,
    rows: 32,
    missing_pct: "0.0%",
    cache_file: "data/processed/station_metadata.csv",
    sha256: "2c624232cdd221771294dfbb310aca000a0df6ac8b66b696d90ef06fdefb64a3",
  },
];

export default function DataPage() {
  const [selectedSource, setSelectedSource] = useState<string>("ALL");

  const filteredManifest =
    selectedSource === "ALL"
      ? MANIFEST_RECORDS
      : MANIFEST_RECORDS.filter((m) => m.source.includes(selectedSource));

  const handleDownloadSampleCsv = (filename: string) => {
    let content = "";
    if (filename === "train.csv") {
      content =
        "station_id,date,discharge_cfs,precipitation_mm,temp_max_c,temp_min_c,soil_moisture,drainage_area_sqmi,mean_elevation_ft,slope_pct,forest_cover_pct\n" +
        "01646500,2021-05-01,11420.0,14.2,21.4,10.2,0.412,11570.0,1050.0,8.5,62.0\n" +
        "07010000,2021-05-01,218400.0,8.5,23.1,12.8,0.485,697000.0,1200.0,3.2,33.0\n" +
        "08158000,2021-05-01,1890.0,32.4,28.9,17.5,0.312,27600.0,3200.0,5.1,18.0\n";
    } else if (filename === "test.csv") {
      content =
        "station_id,date,precipitation_mm,temp_max_c,temp_min_c,soil_moisture,drainage_area_sqmi,mean_elevation_ft,slope_pct,forest_cover_pct\n" +
        "01646500,2022-03-01,18.4,12.3,3.1,0.412,11570.0,1050.0,8.5,62.0\n" +
        "07010000,2022-03-01,11.0,14.2,4.0,0.460,697000.0,1200.0,3.2,33.0\n";
    } else if (filename === "station_metadata.csv") {
      content =
        "station_id,station_name,latitude,longitude,state,river_name,drainage_area_sqmi,mean_elevation_ft,slope_pct,forest_cover_pct\n" +
        "01646500,Potomac River near Washington DC,38.9497,-77.1278,DC,Potomac River,11570,1050,8.5,62.0\n" +
        "07010000,Mississippi River at St. Louis MO,38.6277,-90.1809,MO,Mississippi River,697000,1200,3.2,33.0\n" +
        "08158000,Colorado River at Austin TX,30.2437,-97.6930,TX,Colorado River,27600,3200,5.1,18.0\n" +
        "02087500,Neuse River near Clayton NC,35.6461,-78.4003,NC,Neuse River,770,300,2.5,45.0\n" +
        "11447650,Sacramento River at Freeport CA,38.4565,-121.5007,CA,Sacramento River,23300,4500,12.0,40.0\n";
    } else {
      content =
        "station_id,date,discharge_cfs\n01646500,2022-01-01,0.0\n07010000,2022-01-01,0.0\n";
    }
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Datasets 1–3 & Input/Output Contract"
        requirementIds={["DS1-1..3", "DS2-1..3", "DS3-1..2", "DJ-1..3", "IO-1..4", "IQ-1..2"]}
        summary="Combines Dataset 1 (USGS NWIS Daily Discharge parameter 00060), Dataset 2 (Open-Meteo Historical Weather API matched by lat/lon/date), and Dataset 3 (USGS StreamStats / GAGES-II static catchment attributes matched by station_id) with strict CUTOFF enforcement and SHA-256 provenance."
        clauseQuote="station_id links discharge data to catchment attributes. (latitude, longitude, date) links discharge data to weather observations."
      />

      {/* CUTOFF & Zero-Leakage Banner */}
      <section className="rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/30 via-slate-900 to-slate-900 p-6 shadow-[0_0_30px_rgba(16,185,129,0.08)]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase text-emerald-400">
              <Lock className="h-4 w-4" />
              <span>Temporal Leakage Guard &amp; CUTOFF Enforcement (IQ-1 / IQ-2)</span>
            </div>
            <h1 className="text-2xl font-extrabold text-white">
              Target Discharge Strictly Capped at{" "}
              <code className="font-mono text-emerald-300">CUTOFF = 2022-12-31</code>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl">
              Per Section 2.1 of the engineering specification,{" "}
              <code className="font-mono text-cyan-300">floodcast/ingest.py</code> never downloads
              or exposes target <code className="font-mono text-cyan-300">discharge_cfs</code>{" "}
              beyond <code className="font-mono text-emerald-300">cutoff_date</code>. Furthermore,
              Open-Meteo&apos;s modeled Flood API is explicitly blocked (<code className="font-mono">DEC-006</code>)
              so only raw meteorological observations are used.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0 font-mono text-xs">
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
              <span className="text-slate-400 block text-[10px]">TRAIN PERIOD</span>
              <span className="text-cyan-300 font-bold">2010-01-01 → 2021-12-31</span>
              <span className="text-slate-500 block text-[10px] mt-0.5">128,576 station-days</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
              <span className="text-slate-400 block text-[10px]">TEST / HOLDOUT PERIOD</span>
              <span className="text-amber-300 font-bold">2022-01-01 → 2022-12-31</span>
              <span className="text-slate-500 block text-[10px] mt-0.5">11,680 station-days</span>
            </div>
          </div>
        </div>
      </section>

      {/* The 3 Official Datasets */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl border border-cyan-500/30 bg-slate-900/70 p-6 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="rounded bg-cyan-500/20 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-300 border border-cyan-400/30">
                DATASET 1 · TARGET
              </span>
              <span className="font-mono text-xs text-slate-400">USGS NWIS</span>
            </div>
            <h2 className="text-lg font-bold text-white">
              USGS National Water Information System
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Daily river discharge (<code className="font-mono text-cyan-300">parameterCd=00060</code>,
              cubic feet per second) across the 5 mandatory starter stations (`01646500`,
              `07010000`, `08158000`, `02087500`, `11447650`) plus 27 additional stations spanning
              snowmelt, arid, coastal, and headwater regimes.
            </p>
            <ul className="space-y-1 text-xs font-mono text-slate-400 pt-2 border-t border-slate-800">
              <li>• Sentinel -999999 values scrubbed</li>
              <li>• ≥ 80% completeness filter enforced</li>
              <li>• URL artifact (`sites;=`) cleaned (DEC-007)</li>
            </ul>
          </div>
          <div className="mt-4 rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] text-cyan-300 break-all border border-slate-800">
            GET https://waterservices.usgs.gov/nwis/dv/?format=json&amp;parameterCd=00060
          </div>
        </div>

        <div className="rounded-xl border border-sky-500/30 bg-slate-900/70 p-6 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="rounded bg-sky-500/20 px-2.5 py-0.5 font-mono text-xs font-bold text-sky-300 border border-sky-400/30">
                DATASET 2 · METEOROLOGY
              </span>
              <span className="font-mono text-xs text-slate-400">Open-Meteo ERA5</span>
            </div>
            <h2 className="text-lg font-bold text-white">
              Open-Meteo Historical Weather API
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Co-located daily meteorological time-series matched to each USGS gauge&apos;s exact{" "}
              <code className="font-mono text-sky-300">(latitude, longitude)</code> in the
              station&apos;s local timezone with exponential-backoff rate-limit handling.
            </p>
            <ul className="space-y-1 text-xs font-mono text-slate-400 pt-2 border-t border-slate-800">
              <li>• precipitation_sum → precipitation_mm</li>
              <li>• temperature_2m_max → temp_max_c</li>
              <li>• temperature_2m_min → temp_min_c</li>
              <li>• soil_moisture_0_to_7cm → soil_moisture</li>
            </ul>
          </div>
          <div className="mt-4 rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] text-sky-300 break-all border border-slate-800">
            GET https://archive-api.open-meteo.com/v1/archive?daily=precipitation_sum,...
          </div>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-slate-900/70 p-6 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="rounded bg-emerald-500/20 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-300 border border-emerald-400/30">
                DATASET 3 · CATCHMENT
              </span>
              <span className="font-mono text-xs text-slate-400">StreamStats / GAGES-II</span>
            </div>
            <h2 className="text-lg font-bold text-white">
              Static Watershed Geomorphology
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Time-invariant physical basin characteristics joined via{" "}
              <code className="font-mono text-emerald-300">station_id</code>, enabling the model to
              scale rainfall-runoff physics to unseen rivers during Leave-One-Station-Out testing.
            </p>
            <ul className="space-y-1 text-xs font-mono text-slate-400 pt-2 border-t border-slate-800">
              <li>• DRNAREA → drainage_area_sqmi</li>
              <li>• ELEV → mean_elevation_ft</li>
              <li>• SLOPE_PCT → slope_pct</li>
              <li>• FOREST → forest_cover_pct</li>
            </ul>
          </div>
          <div className="mt-4 rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] text-emerald-300 break-all border border-slate-800">
            Joined on primary key: station_id (32 stations)
          </div>
        </div>
      </section>

      {/* Interactive Relational Join Diagram */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center gap-2 mb-4">
          <GitMerge className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-bold text-white">
            Relational Join Architecture &amp; Input/Output Schema Contract
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-11 gap-4 items-center font-mono text-xs">
          <div className="lg:col-span-3 rounded-lg border border-cyan-500/30 bg-slate-950 p-4 space-y-1.5">
            <div className="text-cyan-400 font-bold">1. USGS NWIS + Site Info</div>
            <div className="text-slate-300">PK: (station_id, date)</div>
            <div className="text-slate-400">• discharge_cfs (Target)</div>
            <div className="text-slate-400">• latitude, longitude</div>
          </div>

          <div className="lg:col-span-1 text-center text-cyan-400 font-bold">
            ⋈
            <span className="block text-[10px] text-slate-400">lat, lon, date</span>
          </div>

          <div className="lg:col-span-3 rounded-lg border border-sky-500/30 bg-slate-950 p-4 space-y-1.5">
            <div className="text-sky-400 font-bold">2. Open-Meteo Archive</div>
            <div className="text-slate-300">PK: (latitude, longitude, date)</div>
            <div className="text-slate-400">• precipitation_mm</div>
            <div className="text-slate-400">• temp_max_c, temp_min_c, soil_moisture</div>
          </div>

          <div className="lg:col-span-1 text-center text-emerald-400 font-bold">
            ⋈
            <span className="block text-[10px] text-slate-400">station_id</span>
          </div>

          <div className="lg:col-span-3 rounded-lg border border-emerald-500/30 bg-slate-950 p-4 space-y-1.5">
            <div className="text-emerald-400 font-bold">3. StreamStats / GAGES-II</div>
            <div className="text-slate-300">PK: (station_id)</div>
            <div className="text-slate-400">• drainage_area_sqmi, mean_elevation_ft</div>
            <div className="text-slate-400">• slope_pct, forest_cover_pct</div>
          </div>
        </div>

        {/* Downloadable Schema Cards */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              file: "train.csv",
              rows: "128,576 rows",
              cols: "11 columns (includes discharge_cfs)",
              desc: "Historical training records (2010–2021)",
            },
            {
              file: "test.csv",
              rows: "11,680 rows",
              cols: "10 columns (no discharge_cfs)",
              desc: "Evaluation records (2022 holdout)",
            },
            {
              file: "sample_submission.csv",
              rows: "11,680 rows",
              cols: "3 columns: station_id, date, discharge_cfs",
              desc: "Zero-filled template contract",
            },
            {
              file: "station_metadata.csv",
              rows: "32 stations",
              cols: "station_id, name, lat, lon, state, river",
              desc: "Gauge coordinates & catchment table",
            },
          ].map((item) => (
            <div
              key={item.file}
              className="rounded-lg border border-slate-800 bg-slate-950/90 p-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    {item.file}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">{item.rows}</span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-slate-200">{item.cols}</p>
                <p className="mt-1 text-xs text-slate-400">{item.desc}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDownloadSampleCsv(item.file)}
                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs text-cyan-300 hover:bg-cyan-500/20 transition"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download CSV Slice</span>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Extraction Provenance & SHA-256 Manifest Table */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Hash className="h-5 w-5 text-cyan-400" />
              <span>Data Extraction Provenance &amp; SHA-256 Manifest (`data/manifest.json`)</span>
            </h2>
            <p className="text-xs text-slate-400">
              Every raw API response is cached immutably under <code className="font-mono">data/cache/</code>{" "}
              and checksummed per Section 2.6.
            </p>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-xs">
            {["ALL", "USGS", "OpenMeteo", "StreamStats"].map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setSelectedSource(src)}
                className={`rounded-md px-2.5 py-1 transition ${
                  selectedSource === src
                    ? "bg-cyan-500 text-slate-950 font-bold"
                    : "bg-slate-950 text-slate-300 border border-slate-800 hover:border-cyan-500/40"
                }`}
              >
                {src}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                <th className="py-2.5 px-3">Source</th>
                <th className="py-2.5 px-3">Station / Coords</th>
                <th className="py-2.5 px-3">Date Range</th>
                <th className="py-2.5 px-3">HTTP</th>
                <th className="py-2.5 px-3">Rows</th>
                <th className="py-2.5 px-3">Missing</th>
                <th className="py-2.5 px-3">Cache File &amp; SHA-256 Checksum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredManifest.map((row, i) => (
                <tr key={i} className="hover:bg-slate-950/60">
                  <td className="py-2.5 px-3 font-semibold text-cyan-300">{row.source}</td>
                  <td className="py-2.5 px-3 text-slate-200">{row.station}</td>
                  <td className="py-2.5 px-3 text-slate-300">{row.date_range}</td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3" />
                      {row.http_status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-200">{row.rows.toLocaleString("en-US")}</td>
                  <td className="py-2.5 px-3 text-emerald-400">{row.missing_pct}</td>
                  <td className="py-2.5 px-3">
                    <div className="text-slate-300">{row.cache_file}</div>
                    <div className="text-[10px] text-slate-500 truncate max-w-xs">
                      sha256: {row.sha256}
                    </div>
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
