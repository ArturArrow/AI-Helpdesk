from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.security import require_secret

app = FastAPI(dependencies=[Depends(require_secret)])


@app.get("/guarded")
def guarded() -> dict[str, bool]:
    return {"ok": True}


client = TestClient(app)


def test_accepts_the_right_secret():
    response = client.get("/guarded", headers={"X-Rag-Secret": "test-secret"})
    assert response.status_code == 200


def test_rejects_a_missing_secret():
    response = client.get("/guarded")
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_rejects_a_wrong_secret():
    assert client.get("/guarded", headers={"X-Rag-Secret": "wrong"}).status_code == 401


def test_rejects_a_non_ascii_secret_without_crashing():
    headers = {"X-Rag-Secret": "zażółć".encode()}
    assert client.get("/guarded", headers=headers).status_code == 401
