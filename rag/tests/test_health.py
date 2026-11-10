from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_needs_no_secret():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
