import psycopg

from langchain_core.embeddings import DeterministicFakeEmbedding

from app.store import EMBEDDING_SIZE, Store
from tests.conftest import TEST_DATABASE_URL


def columns(table: str) -> set[str]:
    with psycopg.connect(TEST_DATABASE_URL) as connection:
        rows = connection.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,)
        ).fetchall()
    return {row[0] for row in rows}


def test_creates_both_tables(store):
    assert columns("documents") == {"id", "filename", "size", "chunk_count", "created_at", "data"}
    assert {"content", "embedding", "document_id"} <= columns("chunks")


def test_starting_again_keeps_the_existing_tables(store):
    Store(TEST_DATABASE_URL, DeterministicFakeEmbedding(size=EMBEDDING_SIZE))
