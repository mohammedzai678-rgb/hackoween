"use client";

import React, { useEffect, useState } from "react";
import ProblemStatementNote from "@/components/ProblemStatementNote";
import {
  fetchDocsList,
  fetchDocContent,
  DocItem,
  DocContentResponse,
} from "@/lib/api";
import {
  BookOpen,
  FileText,
  FolderOpen,
  Clock,
} from "lucide-react";

export default function DocsPage() {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [selectedName, setSelectedName] = useState<string>("README.md");
  const [docContent, setDocContent] = useState<DocContentResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchDocsList()
      .then((list) => {
        if (!mounted) return;
        setDocs(list);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchDocContent(selectedName).then((content) => {
      if (mounted) setDocContent(content);
    });
    return () => {
      mounted = false;
    };
  }, [selectedName]);

  return (
    <div className="space-y-8">
      <ProblemStatementNote
        section="Submission Requirements — Documentation, README.md & model_card.md"
        requirementIds={["SR-3", "SR-5", "RS-1", "RS-5", "Section 9"]}
        summary="Interactive Markdown documentation browser rendering root README.md, model_card.md, and all technical engineering artifacts in docs/ (REQUIREMENTS_CHECKLIST.md, DATA.md, DATA_EXTRACTION.md, FEATURES.md, MODELING.md, EVALUATION.md, TRAINING_LOG.md, DECISIONS.md, OPEN_QUESTIONS.md)."
        clauseQuote="Submission Requirements: README.md with approach summary and how to run; model_card.md with features used, model type, train/val RMSE, and known limitations."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sidebar Document Selector */}
        <aside className="lg:col-span-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-cyan-400" />
              <span>Documentation Index ({docs.length} Files)</span>
            </h1>
          </div>

          <div className="space-y-1.5 font-mono text-xs max-h-[540px] overflow-y-auto pr-1">
            {docs.map((item) => {
              const active = item.name === selectedName;
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setSelectedName(item.name)}
                  className={`w-full text-left rounded-lg border p-3 transition flex items-start justify-between gap-2 ${
                    active
                      ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200"
                      : "border-slate-800/80 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:text-cyan-300"
                  }`}
                >
                  <div>
                    <div className="font-bold flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                      <span>{item.name}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400 font-sans">
                      {item.title}
                    </div>
                  </div>
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400 shrink-0">
                    {item.path}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Markdown Reader View */}
        <section className="lg:col-span-8 rounded-2xl border border-cyan-500/30 bg-slate-900/70 p-6 flex flex-col justify-between">
          {loading || !docContent ? (
            <div className="h-96 animate-pulse rounded-xl bg-slate-800/40" />
          ) : (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800 pb-4 mb-5">
                <div>
                  <span className="rounded bg-cyan-500/20 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-300 border border-cyan-400/30">
                    {docContent.path}
                  </span>
                  <h2 className="mt-2 text-xl font-bold text-white flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-cyan-400" />
                    <span>{docContent.title}</span>
                  </h2>
                </div>
                <span className="font-mono text-xs text-slate-400 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Updated: {docContent.updated_at.slice(0, 10)}
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 overflow-x-auto">
                <pre className="whitespace-pre-wrap font-mono text-xs sm:text-sm text-slate-200 leading-relaxed">
                  {docContent.content}
                </pre>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
