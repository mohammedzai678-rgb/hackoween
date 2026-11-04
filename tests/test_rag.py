"""
FLOODCAST — RAG Vector Database, Transformer Embeddings, & Simulation Vault Tests.
Tests:
- Embedder initialization and numpy-accelerated execution
- FAISS IndexFlatIP exact similarity search
- Knowledge base seeding (32 USGS stations + 7 ML models + Guides)
- Simulation Vault CRUD (save, list, query, delete)
- Category-filtered semantic search
- Grounded RAG answer synthesis
"""

import pytest
from backend.app.schemas.api_schemas import (
    RagDocumentIngestRequest,
    RagQueryRequest,
    SimulationSaveRequest,
)
from backend.app.services.rag_service import rag_service


@pytest.fixture(scope="module", autouse=True)
def init_rag():
    rag_service._ensure_initialized()


def test_rag_stats_and_breakdown():
    stats = rag_service.get_stats()
    assert stats.total_vectors >= 30
    assert stats.vector_dimension == 384
    assert "station_hydrology" in stats.categories_breakdown
    assert "ml_model" in stats.categories_breakdown


def test_rag_query_basic():
    req = RagQueryRequest(query="Potomac River flood surge", top_k=5)
    res = rag_service.query_rag(req)
    assert len(res.retrieved_chunks) > 0
    assert res.total_vectors_searched >= 30
    assert "Potomac" in res.answer or "USGS" in res.answer or "cfs" in res.answer.lower()


def test_rag_query_with_category_filter():
    req = RagQueryRequest(query="XGBoost model performance", top_k=3, category_filter="ml_model")
    res = rag_service.query_rag(req)
    assert len(res.retrieved_chunks) > 0
    for chunk in res.retrieved_chunks:
        assert chunk.category == "ml_model"


def test_simulation_vault_lifecycle():
    initial_sims = rag_service.list_simulations()
    initial_count = len(initial_sims)

    req = SimulationSaveRequest(
        title="Automated Test Simulation",
        source="predict",
        run_id="run_final_ensemble",
        station_id="01646500",
        station_name="Potomac River near Washington, DC",
        storm_peak_mm=120.0,
        soil_moisture=0.65,
        notes="Automated lifecycle test",
        predictions=[
            {"station_id": "01646500", "date": "2022-05-01", "discharge_cfs": 8000.0, "is_extreme_p90": False},
            {"station_id": "01646500", "date": "2022-05-02", "discharge_cfs": 25000.0, "is_extreme_p90": True},
        ],
    )
    saved = rag_service.save_simulation(req)
    assert saved.sim_id.startswith("sim_")
    assert saved.peak_discharge_cfs == 25000.0
    assert saved.p90_exceedance_count == 1

    updated_sims = rag_service.list_simulations()
    assert len(updated_sims) == initial_count + 1

    deleted = rag_service.delete_simulation(saved.sim_id)
    assert deleted is True

    final_sims = rag_service.list_simulations()
    assert len(final_sims) == initial_count


def test_custom_document_ingestion():
    req = RagDocumentIngestRequest(
        title="Sensor Recalibration Note",
        category="custom_note",
        station_id="01646500",
        content="Sensor ultrasonic transducer cleaned and zero-level recalibrated on 2022-04-15.",
    )
    chunk = rag_service.ingest_document(req)
    assert chunk.doc_id.startswith("custom_")
    assert chunk.title == "Sensor Recalibration Note"

    # Query should find it
    q_req = RagQueryRequest(query="transducer recalibrated", top_k=3, category_filter="custom_note")
    res = rag_service.query_rag(q_req)
    assert len(res.retrieved_chunks) > 0
    assert any("Sensor Recalibration Note" in c.title for c in res.retrieved_chunks)
