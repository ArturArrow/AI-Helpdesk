# The knowledge-base service (FastAPI). Built from the repository root, like the others.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

COPY rag/pyproject.toml rag/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY rag/app app
# For `python -m app.seed`, run once in the container to load the support FAQ.
COPY rag/knowledge-base knowledge-base

ENV PATH="/app/.venv/bin:$PATH"
# `::` listens on IPv6 and IPv4, so the private network reaches it in older (IPv6-only)
# Railway environments too.
CMD ["sh", "-c", "fastapi run app/main.py --host :: --port ${PORT:-3003}"]
