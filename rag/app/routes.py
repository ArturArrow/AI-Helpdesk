from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from openai import OpenAIError
from pydantic import BaseModel, Field

from app.chunking import ALLOWED_EXTENSIONS, UnreadableDocument, extension, to_chunks
from app.security import require_secret
from app.store import DuplicateDocument, Store

# Restated in core/constants/rag.ts for the server and the client.
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
MAX_FILENAME_LENGTH = 255


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=8000)
    k: int = Field(default=5, ge=1, le=20)


router = APIRouter(dependencies=[Depends(require_secret)])


def get_store(request: Request) -> Store:
    return request.app.state.store


StoreDependency = Annotated[Store, Depends(get_store)]


@router.get("/documents")
def list_documents(store: StoreDependency) -> dict:
    return {"documents": store.list_documents()}


# Plain `def` routes: FastAPI runs them in a thread pool, so slow parsing and embedding
# don't hold up the event loop.
@router.post("/documents", status_code=201)
def add_document(file: UploadFile, store: StoreDependency) -> dict:
    filename = (file.filename or "").replace("\x00", "").strip()
    if not filename or len(filename) > MAX_FILENAME_LENGTH:
        raise HTTPException(status_code=400, detail="The file needs a name of up to 255 characters.")
    if extension(filename) not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are accepted.")
    data = file.file.read(MAX_DOCUMENT_BYTES + 1)
    if len(data) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 20 MB.")
    try:
        return store.add(filename, data, to_chunks(filename, data))
    except UnreadableDocument as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except DuplicateDocument as error:
        raise HTTPException(status_code=409, detail="A document with this name already exists.") from error
    except OpenAIError as error:
        raise HTTPException(status_code=502, detail="The embeddings couldn't be created.") from error


# The original file. The server sets the download headers; the name goes in X-Filename,
# percent-encoded, since a header can't carry a Polish one as is.
@router.get("/documents/{document_id}/file")
def download_document(document_id: UUID, store: StoreDependency) -> Response:
    found = store.file(str(document_id))
    if found is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    filename, data = found
    return Response(data, media_type="application/octet-stream", headers={"X-Filename": quote(filename)})


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(document_id: UUID, store: StoreDependency) -> None:
    if not store.delete(str(document_id)):
        raise HTTPException(status_code=404, detail="Document not found.")


@router.post("/search")
def search(request: SearchRequest, store: StoreDependency) -> dict:
    try:
        return {"chunks": store.search(request.query, request.k)}
    except OpenAIError as error:
        raise HTTPException(status_code=502, detail="The embeddings couldn't be created.") from error
