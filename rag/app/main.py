import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI
from langchain_openai import OpenAIEmbeddings

from app.env import DATABASE_URL, OPENAI_API_KEY
from app.routes import router
from app.store import Store


def _drop_request_body(event, _hint):
    # Search queries are ticket text and uploads are admins' documents: neither leaves the service.
    event.get("request", {}).pop("data", None)
    return event


# Error reporting; FastAPI's integration is enabled automatically and reports 5xx errors.
# Optional: without SENTRY_DSN the SDK is disabled and sends nothing (dev, tests).
sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    # Without it the SDK's default would be production.
    environment=os.environ.get("SENTRY_ENVIRONMENT") or "development",
    before_send=_drop_request_body,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    embeddings = OpenAIEmbeddings(model="text-embedding-3-small", api_key=OPENAI_API_KEY)
    app.state.store = Store(DATABASE_URL, embeddings)
    yield


app = FastAPI(title="Helpdesk RAG", lifespan=lifespan)
app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
