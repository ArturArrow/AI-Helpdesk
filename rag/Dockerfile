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
# An empty host binds both IPv4 and IPv6: Railway's healthcheck comes over IPv4, and older
# Railway environments reach services privately over IPv6 only. `::` alone is IPv6-only here,
# since asyncio sets IPV6_V6ONLY on it, and the healthcheck never got through.
CMD ["sh", "-c", "fastapi run app/main.py --host '' --port ${PORT:-3003}"]
