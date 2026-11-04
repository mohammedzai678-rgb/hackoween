# FLOODCAST Documentation Index

> Complete project documentation for the **FLOODCAST — Predict the Surge Before It Strikes** hackathon submission.

---

## Documentation Catalog (`docs/`)

| Document | Description | Status |
|----------|-------------|--------|
| [REQUIREMENTS_CHECKLIST.md](REQUIREMENTS_CHECKLIST.md) | Every PDF requirement (`PSA`, `DS`, `IO`, `OP`, `VR`, `EC`, `DQ`, `SR`, `RS`, `IQ`) mapped to code | ✅ Complete |
| [DATA.md](DATA.md) | Data card: 32 USGS stations, `140,256` train rows, `11,680` test rows, schema & `CUTOFF` rules | ✅ Complete |
| [DATA_EXTRACTION.md](DATA_EXTRACTION.md) | Exact provenance, SHA-256 manifest checksums, and reproducible ingestion commands | ✅ Complete |
| [FEATURES.md](FEATURES.md) | 62-feature catalog across 6 hydrological families, mathematical formulas, and ablations | ✅ Complete |
| [MODELING.md](MODELING.md) | Data sanity checks, target strategies (`raw`, `log1p`, `scaled`, `tweedie`), and ensemble architecture | ✅ Complete |
| [TRAINING_LOG.md](TRAINING_LOG.md) | Chronological Training Start Notices and Training Result Notices (Training Gate protocol) | ✅ Complete |
| [EXPERIMENTS.md](EXPERIMENTS.md) | Multi-run progression table, flood-peak error diagnostics, and hydrological lessons learned | ✅ Complete |
| [EVALUATION.md](EVALUATION.md) | Mathematical specification of the 40/30/20/10 metrics and 0–100 composite normalization | ✅ Complete |
| [ARCHITECTURE.md](ARCHITECTURE.md) | End-to-end system diagram, 7 pipeline stages, and repository structure | ✅ Complete |
| [API.md](API.md) | Complete `/api/v1` FastAPI reference (12 endpoints) with `curl` examples and JSON schemas | ✅ Complete |
| [FRONTEND.md](FRONTEND.md) | Next.js 14 App Router architecture (12 pages), Hydrological Dark Mode design system, & PDF mapping | ✅ Complete |
| [RUNBOOK.md](RUNBOOK.md) | Environment setup, one-command `python solution.py` execution, Makefile targets, & troubleshooting | ✅ Complete |
| [DECISIONS.md](DECISIONS.md) | Architectural Decision Records (`DEC-001` through `DEC-007`) | ✅ Complete |
| [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) | Items documented for organizer confirmation (`OQ-001` through `OQ-007`) with safe defaults | ✅ Complete |
| [CHANGELOG.md](CHANGELOG.md) | Dated chronological log of all engineering phases and milestones | ✅ Complete |

---

## Root & Presentation Deliverables

| File | Description | Status |
|------|-------------|--------|
| [`README.md`](../README.md) | Team overview, 5-sentence approach summary, quick start, and architecture | ✅ Complete |
| [`model_card.md`](../model_card.md) | Model architecture, 62 features, validation metrics, pre-trained declaration (`None`), & limitations | ✅ Complete |
| [`solution.py`](../solution.py) | One-command reproducible pipeline (`ingest → features → train → predict → check`) | ✅ Complete |
| [`requirements.txt`](../requirements.txt) | Pinned Python dependencies (`lightgbm`, `xgboost`, `catboost`, `fastapi`, `pandas`, etc.) | ✅ Complete |
| [`predictions.csv`](../predictions.csv) | Validated test-set discharge predictions (`11,680` rows, `station_id,date,discharge_cfs`) | ✅ Complete |
| [`slides/slides.md`](../slides/slides.md) | 5-slide Marp/Reveal.js presentation deck (Problem → Data → Model → Results → Limitations) | ✅ Complete |
| [`Makefile`](../Makefile) | Automated build, test, validation, and full-stack orchestration targets | ✅ Complete |

---

*Last updated: 2026-11-04 — FLOODCAST Documentation & Slides Lead*
