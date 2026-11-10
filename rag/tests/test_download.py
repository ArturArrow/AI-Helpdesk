from urllib.parse import unquote
from uuid import uuid4

import psycopg

from tests.conftest import TEST_DATABASE_URL
from tests.test_add_document import upload
from tests.test_chunking import pdf


def test_returns_the_original_txt_byte_for_byte(client):
    content = "Zwroty w ciągu 30 dni.\r\n".encode()
    document = upload(client, filename="zwroty.txt", content=content).json()

    response = client.get(f"/documents/{document['id']}/file")

    assert response.status_code == 200
    assert response.content == content
    assert response.headers["content-type"] == "application/octet-stream"


def test_returns_the_original_pdf(client):
    content = pdf("Refund policy")
    document = upload(client, filename="policy.pdf", content=content).json()

    assert client.get(f"/documents/{document['id']}/file").content == content


def test_sends_a_polish_name_percent_encoded(client):
    document = upload(client, filename="regulamin zwrotów.txt").json()

    header = client.get(f"/documents/{document['id']}/file").headers["x-filename"]

    assert header == "regulamin%20zwrot%C3%B3w.txt"
    assert unquote(header) == "regulamin zwrotów.txt"


def test_lists_whether_there_is_an_original_but_never_its_bytes(client):
    upload(client)
    [document] = client.get("/documents").json()["documents"]
    assert document["hasFile"] is True
    assert "data" not in document


def test_answers_404_for_a_document_without_an_original(client):
    document = upload(client).json()
    with psycopg.connect(TEST_DATABASE_URL) as connection:
        connection.execute("UPDATE documents SET data = NULL WHERE id = %s", (document["id"],))

    assert client.get("/documents").json()["documents"][0]["hasFile"] is False
    assert client.get(f"/documents/{document['id']}/file").status_code == 404


def test_answers_404_for_an_unknown_document(client):
    assert client.get(f"/documents/{uuid4()}/file").status_code == 404


def test_answers_404_for_a_deleted_document(client):
    document = upload(client).json()
    client.delete(f"/documents/{document['id']}")
    assert client.get(f"/documents/{document['id']}/file").status_code == 404


def test_rejects_a_malformed_id(client):
    assert client.get("/documents/not-a-uuid/file").status_code == 422


def test_needs_the_secret(client):
    document = upload(client).json()
    response = client.get(f"/documents/{document['id']}/file", headers={"X-Rag-Secret": "wrong"})
    assert response.status_code == 401
