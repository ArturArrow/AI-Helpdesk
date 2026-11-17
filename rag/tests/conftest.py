import os

import psycopg
import pytest
from fastapi.testclient import TestClient
from langchain_core.embeddings import DeterministicFakeEmbedding

# Set before any test imports app.env, which reads them at import. No test reaches OpenAI.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL or "unset"
os.environ["OPENAI_API_KEY"] = "test-key"
os.environ["RAG_SECRET"] = "test-secret"
# .env holds the real DSN; an empty one disables Sentry, so a failing test reports nothing.
os.environ["SENTRY_DSN"] = ""


@pytest.fixture(scope="session")
def store():
    from app.store import EMBEDDING_SIZE, Store

    # The tests empty these tables.
    if not TEST_DATABASE_URL.rsplit("/", 1)[-1].endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must point at a *_test database (uv run --env-file .env pytest).")
    return Store(TEST_DATABASE_URL, DeterministicFakeEmbedding(size=EMBEDDING_SIZE))


@pytest.fixture
def empty_store(store):
    with psycopg.connect(TEST_DATABASE_URL) as connection:
        connection.execute("TRUNCATE documents, chunks")
    return store


# Without `with`, so the app's lifespan (the real store and OpenAI) doesn't run.
@pytest.fixture
def client(empty_store):
    from app.main import app
    from app.routes import get_store

    app.dependency_overrides[get_store] = lambda: empty_store
    yield TestClient(app, headers={"X-Rag-Secret": "test-secret"})
    app.dependency_overrides.clear()
