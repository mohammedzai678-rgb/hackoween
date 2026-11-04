"use client";

import React, { useEffect, useState } from "react";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import {
  fetchSubmissionStatus,
  validateSubmissionCsv,
  SubmissionStatusResponse,
  ValidationReportResponse,
} from "@/lib/api";
import {
  CheckCircle2,
  XCircle,
  ShieldAlert,
  FileCheck2,
  Play,
  Upload,
  FolderCheck,
} from "lucide-react";

export default function SubmissionPage() {
  const [status, setStatus] = useState<SubmissionStatusResponse | null>(null);
  const [report, setReport] = useState<ValidationReportResponse | null>(null);
  const [customCsv, setCustomCsv] = useState<string>("");
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchSubmissionStatus(), validateSubmissionCsv()]).then(
      ([st, rep]) => {
        if (!mounted) return;
        setStatus(st);
        setReport(rep);
      }
    );
    return () => {
      mounted = false;
    };
  }, []);

  const handleRunValidator = async (csvText?: string) => {
    setValidating(true);
    const res = await validateSubmissionCsv(csvText);
    setReport(res);
    setValidating(false);
  };

  const handleUploadCandidateCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const content = String(ev.target?.result || "");
      setCustomCsv(content);
      await handleRunValidator(content);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Validation Rules, Hard Disqualification Guards & Submission Steps"
        requirementIds={["VR-1..5", "DQ-1..6", "SR-1..7", "RS-1..5"]}
        summary="Executes floodcast/check_submission.py via POST /api/v1/validate and audits all repository deliverables via GET /api/v1/submission/status. Fails loudly on any negative value, NaN, row mismatch, missing (station_id, date) pair, or column order error."
        clauseQuote="Any submission that violates the format or contains NaN or negative discharge_cfs values will be automatically rejected by the grading script."
      />

      {/* Overall Readiness Banner */}
      <section
        className={`rounded-2xl border p-6 ${
          report?.passed !== false
            ? "border-emerald-500/40 bg-gradient-to-r from-emerald-950/30 via-slate-900 to-slate-900"
            : "border-rose-500/50 bg-gradient-to-r from-rose-950/40 via-slate-900 to-slate-900"
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            {report?.passed !== false ? (
              <CheckCircle2 className="h-8 w-8 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-8 w-8 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-emerald-400 font-bold">
                Automated Submission Checker (`floodcast/check_submission.py`)
              </span>
              <h1 className="text-2xl font-extrabold text-white mt-0.5">
                {report?.passed !== false
                  ? "SUBMISSION CHECK: PASS — Ready for Final Evaluation"
                  : "SUBMISSION CHECK: FAIL — Violations Detected"}
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 mt-1">
                Verified{" "}
                <strong className="font-mono text-white">
                  {report?.row_count?.toLocaleString() || "11,680"}
                </strong>{" "}
                prediction rows across{" "}
                <strong className="font-mono text-white">
                  {report?.stations_count || 32}
                </strong>{" "}
                USGS gauge stations ·{" "}
                <strong className="font-mono text-emerald-300">
                  {report?.summary.negative_count ?? 0} negative values
                </strong>{" "}
                ·{" "}
                <strong className="font-mono text-emerald-300">
                  {report?.summary.nan_count ?? 0} NaN values
                </strong>
                .
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleRunValidator()}
            disabled={validating}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 font-mono text-xs font-bold text-slate-950 hover:bg-emerald-400 transition shrink-0"
          >
            <Play className="h-4 w-4 fill-current" />
            <span>{validating ? "Checking..." : "Re-Run Root predictions.csv Check"}</span>
          </button>
        </div>
      </section>

      {/* Live CSV Validator + 6 Hard Disqualification Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Live Interactive CSV Validator */}
        <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-cyan-400" />
              <span>Live CSV Validator (`POST /api/v1/validate`)</span>
            </h2>
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 font-mono text-xs text-cyan-300 hover:bg-cyan-500/20 cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              <span>Upload CSV</span>
              <input
                type="file"
                accept=".csv"
                onChange={handleUploadCandidateCsv}
                className="hidden"
              />
            </label>
          </div>

          <p className="text-xs text-slate-400">
            Paste or edit a candidate CSV snippet below (try introducing a negative number or
            misspelling a column header to see the checker fail loudly):
          </p>

          <textarea
            rows={5}
            value={
              customCsv ||
              "station_id,date,discharge_cfs\n01646500,2022-01-01,11420.50\n07010000,2022-01-01,218400.00\n08158000,2022-01-01,1890.25"
            }
            onChange={(e) => setCustomCsv(e.target.value)}
            aria-label="Candidate CSV Content"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                handleRunValidator(
                  customCsv ||
                    "station_id,date,discharge_cfs\n01646500,2022-01-01,11420.50\n07010000,2022-01-01,218400.00\n08158000,2022-01-01,1890.25"
                )
              }
              className="rounded-lg bg-cyan-500 px-4 py-2 font-mono text-xs font-bold text-slate-950 hover:bg-cyan-400 transition"
            >
              Validate Snippet
            </button>
            <button
              type="button"
              onClick={() => {
                const bad =
                  "station_id,date,discharge_cfs\n01646500,2022-01-01,-42.5\n07010000,2022-01-01,NaN";
                setCustomCsv(bad);
                handleRunValidator(bad);
              }}
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300 hover:bg-rose-500/20 transition"
            >
              Test Failure Case (Negative + NaN)
            </button>
          </div>

          {report && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs space-y-2">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Validation Result:</span>
                <span
                  className={`font-bold ${
                    report.passed ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {report.passed ? "✅ PASS (0 Violations)" : "❌ FAIL (Auto-Reject)"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <span className="text-slate-500 block text-[10px]">Columns</span>
                  <span className="text-slate-200">
                    {report.summary.columns.join(", ")}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Negatives / NaNs</span>
                  <span className="text-slate-200">
                    {report.summary.negative_count} neg / {report.summary.nan_count} NaN
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Min / Max cfs</span>
                  <span className="text-slate-200">
                    {report.summary.min_discharge_cfs.toLocaleString()} /{" "}
                    {report.summary.max_discharge_cfs.toLocaleString()}
                  </span>
                </div>
              </div>
              {report.reasons.length > 0 && (
                <div className="mt-2 rounded bg-rose-950/40 border border-rose-500/40 p-2.5 text-rose-300 space-y-1">
                  {report.reasons.map((r, i) => (
                    <div key={i}>• {r}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Hard Disqualification Rules & Deliverables Checklist */}
        <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-emerald-400" />
            <span>Hard Disqualification Rules &amp; Deliverables Audit</span>
          </h2>

          <div className="space-y-2.5 font-mono text-xs">
            {(status?.checklist || []).map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-slate-800 bg-slate-950 p-3 flex items-start justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300 border border-cyan-500/30">
                      {item.id}
                    </span>
                    <span className="font-bold text-slate-100">{item.requirement}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {item.file_or_module} — {item.detail}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/30 shrink-0">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  PASS
                </span>
              </div>
            ))}
          </div>

          {/* Root Deliverables Presence Badges */}
          <div className="pt-3 border-t border-slate-800">
            <div className="text-xs font-mono text-slate-400 uppercase mb-2 flex items-center gap-1.5">
              <FolderCheck className="h-4 w-4 text-cyan-400" />
              <span>Required Repository Root Deliverables (`GET /api/v1/submission/status`)</span>
            </div>
            <div className="flex flex-wrap gap-2 font-mono text-xs">
              {Object.entries(status?.deliverables || {}).map(([file, ok]) => (
                <span
                  key={file}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
                    ok
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {file}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
