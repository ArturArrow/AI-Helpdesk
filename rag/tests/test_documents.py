from uuid import uuid4

from tests.test_add_document import count, upload


def test_lists_nothing_at_first(client):
    response = client.get("/documents")
    assert response.status_code == 200
    assert response.json() == {"documents": []}


def test_lists_newest_first(client):
    first = upload(client, filename="first.txt").json()
    second = upload(client, filename="second.txt").json()
    assert client.get("/documents").json() == {"documents": [second, first]}


def test_list_needs_the_secret(client):
    assert client.get("/documents", headers={"X-Rag-Secret": "wrong"}).status_code == 401


def test_delete_removes_only_that_document_and_its_chunks(client):
    kept = upload(client, filename="kept.txt", content=b"Kept text.").json()
    deleted = upload(client, filename="gone.txt", content=b"Gone text.").json()

    response = client.delete(f"/documents/{deleted['id']}")

    assert response.status_code == 204
    assert client.get("/documents").json() == {"documents": [kept]}
    assert count("chunks") == 1


def test_a_deleted_name_can_be_used_again(client):
    document = upload(client).json()
    client.delete(f"/documents/{document['id']}")
    assert upload(client).status_code == 201


def test_delete_answers_404_for_an_unknown_id(client):
    assert client.delete(f"/documents/{uuid4()}").status_code == 404


def test_delete_rejects_a_malformed_id(client):
    assert client.delete("/documents/not-a-uuid").status_code == 422


def test_delete_needs_the_secret(client):
    document = upload(client).json()
    response = client.delete(f"/documents/{document['id']}", headers={"X-Rag-Secret": "wrong"})
    assert response.status_code == 401
    assert count("documents") == 1
