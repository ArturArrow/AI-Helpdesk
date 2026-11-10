from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from langchain_openai import OpenAIEmbeddings

from app.env import DATABASE_URL, OPENAI_API_KEY
from app.routes import router
from app.store import Store


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
