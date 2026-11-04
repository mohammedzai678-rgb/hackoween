import React from "react";
import { FileCheck2, Sparkles } from "lucide-react";

interface ProblemStatementNoteProps {
  section: string;
  requirementIds?: string[];
  summary: string;
  clauseQuote?: string;
}

export default function ProblemStatementNote({
  section,
  requirementIds = [],
  summary,
  clauseQuote,
}: ProblemStatementNoteProps) {
  return (
    <aside
      aria-label="Problem Statement Provenance Banner"
      className="mb-6 rounded-xl border border-cyan-500/30 bg-gradient-to-r from-slate-900/95 via-cyan-950/30 to-slate-900/95 p-4 shadow-[0_0_25px_rgba(14,165,233,0.08)]"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-cyan-400">
          <FileCheck2 className="h-4 w-4 shrink-0 text-cyan-400" />
          <span>Where this comes from in the problem statement:</span>
          <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-semibold text-cyan-200 border border-cyan-400/30">
            {section}
          </span>
        </div>

        {requirementIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {requirementIds.map((req) => (
              <span
                key={req}
                className="rounded border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-sky-300"
              >
                {req}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-200 leading-relaxed">{summary}</p>

      {clauseQuote && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-400 font-mono">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
          <span>&ldquo;{clauseQuote}&rdquo;</span>
        </div>
      )}
    </aside>
  );
}
