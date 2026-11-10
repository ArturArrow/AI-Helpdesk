import hmac
from typing import Annotated

from fastapi import Header, HTTPException

from app.env import RAG_SECRET


# Compared as bytes: compare_digest raises TypeError on a str with non-ASCII characters,
# which a caller could send to get a 500 instead of a 401.
def require_secret(x_rag_secret: Annotated[str | None, Header()] = None) -> None:
    sent = (x_rag_secret or "").encode()
    if not hmac.compare_digest(sent, RAG_SECRET.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")
