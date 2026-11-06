import psycopg
import pytest
from openai import OpenAIError

from app import routes
from tests.conftest import TEST_DATABASE_URL


def upload(client, filename="refunds.txt", content=b"Refunds within 30 days."):
    return client.post("/documents", files={"file": (filename, content)})


def count(table: str) -> int:
    with psycopg.connect(TEST_DATABASE_URL) as connection:
        return connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def test_stores_the_document_and_its_chunks(client):
    response = upload(client)
    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "refunds.txt"
    assert body["size"] == 23
    assert body["chunkCount"] == 1
    assert body["id"] and body["createdAt"]
    assert count("documents") == 1
    assert count("chunks") == 1


def test_chunk_is_linked_to_its_document(client):
    document = upload(client).json()
    with psycopg.connect(TEST_DATABASE_URL) as connection:
        row = connection.execute("SELECT document_id, content, langchain_metadata FROM chunks").fetchone()
    assert row[0] == document["id"]
    assert row[1] == "Refunds within 30 days."
    assert row[2] == {"filename": "refunds.txt", "page": None}


def test_keeps_a_polish_filename(client):
    assert upload(client, filename="regulamin zwrotów.txt").json()["filename"] == "regulamin zwrotów.txt"


def test_needs_the_secret(client):
    response = client.post(
        "/documents", files={"file": ("a.txt", b"text")}, headers={"X-Rag-Secret": "wrong"}
    )
    assert response.status_code == 401
    assert count("documents") == 0


def test_rejects_another_file_type(client):
    response = upload(client, filename="notes.docx")
    assert response.status_code == 400
    assert response.json() == {"detail": "Only PDF and TXT files are accepted."}


def test_rejects_a_filename_that_is_too_long(client):
    assert upload(client, filename="a" * 252 + ".txt").status_code == 400


def test_rejects_a_file_over_the_limit(client, monkeypatch):
    monkeypatch.setattr(routes, "MAX_DOCUMENT_BYTES", 10)
    assert upload(client, content=b"x" * 11).status_code == 413
    assert count("documents") == 0


def test_accepts_a_file_exactly_at_the_limit(client, monkeypatch):
    monkeypatch.setattr(routes, "MAX_DOCUMENT_BYTES", 10)
    assert upload(client, content=b"x" * 10).status_code == 201


def test_rejects_a_file_with_no_text(client):
    response = upload(client, content=b"  \n ")
    assert response.status_code == 400
    assert "No text" in response.json()["detail"]


def test_rejects_a_name_already_in_use_and_keeps_the_first(client):
    upload(client)
    response = upload(client, content=b"Different text.")
    assert response.status_code == 409
    assert count("documents") == 1
    assert count("chunks") == 1


def test_failed_embedding_leaves_nothing_and_answers_502(client, empty_store, monkeypatch):
    def fail(chunks):
        raise OpenAIError("down")

    monkeypatch.setattr(empty_store._vectors, "add_documents", fail)
    assert upload(client).status_code == 502
    assert count("documents") == 0


def test_failure_after_some_vectors_were_written_removes_them(client, empty_store, monkeypatch):
    real_add = empty_store._vectors.add_documents

    def add_then_fail(chunks):
        real_add(chunks)
        raise RuntimeError("connection lost")

    monkeypatch.setattr(empty_store._vectors, "add_documents", add_then_fail)
    with pytest.raises(RuntimeError):
        upload(client)
    assert count("documents") == 0
    assert count("chunks") == 0
