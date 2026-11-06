from fastapi import FastAPI

from app import env  # noqa: F401  Imported so a missing setting stops the start.

app = FastAPI(title="Helpdesk RAG")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
