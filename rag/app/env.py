import os


# Read once at import, so the service refuses to start with a missing setting instead of
# running with a blank one.
def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required. Set it in the environment (see rag/.env.example).")
    return value


# A database of its own: Prisma would read these tables in `helpdesk` as drift.
DATABASE_URL = required("DATABASE_URL")
OPENAI_API_KEY = required("OPENAI_API_KEY")

# Callers (the server) send it in X-Rag-Secret.
RAG_SECRET = required("RAG_SECRET")
