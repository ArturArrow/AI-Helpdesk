from openai import OpenAIError
from pytest import approx

from tests.test_add_document import upload


def test_finds_the_matching_chunk_first(client):
    upload(client, filename="refunds.txt", content=b"Refunds within 30 days.")
    upload(client, filename="videos.txt", content=b"Videos need a stable connection.")

    # The fake embeddings give equal text equal vectors, and other text an unrelated one.
    response = client.post("/search", json={"query": "Videos need a stable connection."})

    assert response.status_code == 200
    best = response.json()["chunks"][0]
    assert best["text"] == "Videos need a stable connection."
    assert best["filename"] == "videos.txt"
    assert best["page"] is None
    assert best["score"] == approx(1)


def test_returns_at_most_k_chunks(client):
    for number in range(3):
        upload(client, filename=f"{number}.txt", content=f"Text {number}".encode())
    assert len(client.post("/search", json={"query": "Text", "k": 2}).json()["chunks"]) == 2


def test_finds_nothing_in_an_empty_store(client):
    assert client.post("/search", json={"query": "Anything"}).json() == {"chunks": []}


def test_does_not_find_a_deleted_document(client):
    document = upload(client, content=b"Removed text.").json()
    client.delete(f"/documents/{document['id']}")
    assert client.post("/search", json={"query": "Removed text."}).json() == {"chunks": []}


def test_rejects_a_blank_query_and_a_bad_k(client):
    assert client.post("/search", json={"query": ""}).status_code == 422
    assert client.post("/search", json={"query": "a", "k": 0}).status_code == 422
    assert client.post("/search", json={"query": "a", "k": 21}).status_code == 422


def test_needs_the_secret(client):
    response = client.post("/search", json={"query": "a"}, headers={"X-Rag-Secret": "wrong"})
    assert response.status_code == 401


def test_answers_502_when_the_query_cannot_be_embedded(client, empty_store, monkeypatch):
    def fail(query, k):
        raise OpenAIError("down")

    monkeypatch.setattr(empty_store._vectors, "similarity_search_with_score", fail)
    assert client.post("/search", json={"query": "a"}).status_code == 502
