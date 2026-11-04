# FLOODCAST Changelog

All notable changes to the FLOODCAST project are documented here in chronological order.

---

## 2026-11-04 — Phase D & E: Complete Documentation, API/Frontend Architecture & 5-Slide Deck

### Added
- [`docs/API.md`](API.md) — Complete specification of all 12 `/api/v1` FastAPI endpoints (`GET /health`, `GET /api/v1/stations`, `GET /api/v1/stations/{id}`, `GET /api/v1/features`, `GET /api/v1/runs`, `GET /api/v1/runs/{id}`, `POST /api/v1/train`, `GET /api/v1/train/{id}/logs`, `POST /api/v1/predict`, `POST /api/v1/validate`, `GET /api/v1/submission/status`, `GET /api/v1/docs-index`) with Mermaid sequence diagram, `curl` examples, and JSON request/response payloads.
- [`docs/FRONTEND.md`](FRONTEND.md) — Architecture of the 12 Next.js 14 App Router pages (`/`, `/stations`, `/stations/[id]`, `/data`, `/features`, `/experiments`, `/train`, `/evaluate`, `/predict`, `/submission`, `/docs`, `/slides`), Hydrological Dark Mode design system, color/typography tokens, WCAG AA accessibility, and PDF requirement mapping.
- [`slides/slides.md`](../slides/slides.md) — 5-slide Marp/Reveal.js presentation deck covering Problem & 40/30/20/10 Scoring, 32-Station Data & Zero-Leakage Provenance, 62 Physics-Informed Features & Multi-Objective Ensemble, Results & Flood-Peak Hydrograph Analysis, and Operational Limitations & Ethics.
- [`docs/DATA_EXTRACTION.md`](DATA_EXTRACTION.md) & [`docs/REQUIREMENTS_CHECKLIST.md`](REQUIREMENTS_CHECKLIST.md) — Updated with exact SHA-256 checksums (`140,256` train rows, `11,680` test rows, `32` stations) and verified requirement checkboxes.

---

## 2026-11-04 — Phase B & C: Dataset Generation, Feature Engineering & Multi-Objective Modeling

### Added
- Generated 32-station daily hydrological dataset (`140,256` training rows `2010–2021`, `11,680` test rows `2022`, strict `CUTOFF = 2022-12-31`).
- Engineered 60+ backward-looking hydrological features across 6 families (`rainfall`, `antecedent`, `soil`, `temperature`, `calendar`, `static`) in `floodcast/features.py`.
- Implemented multi-objective ensemble training (`raw` L2 + `log1p` with Duan's smearing + flood-peak upweighting on top 10% station days) and 9-point automated submission verification (`floodcast/check_submission.py`).

---

## 2026-11-04 — Phase A: Project Initialization

### Added
- Repository scaffold with complete directory structure
- `docs/REQUIREMENTS_CHECKLIST.md` — all PDF requirements extracted
- `docs/DECISIONS.md` — initial assumptions documented (`DEC-001` through `DEC-007`)
- `docs/OPEN_QUESTIONS.md` — 7 items for organizer confirmation (`OQ-001` through `OQ-007`)
- `configs/base.yaml` — full configuration with 32 stations, feature toggles, model params
- Core Python package scaffold (`floodcast/`)

---

*Last updated: 2026-11-04*
