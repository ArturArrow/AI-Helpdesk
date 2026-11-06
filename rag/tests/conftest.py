import os

# Set before any test imports app.env, which reads them at import.
os.environ["RAG_SECRET"] = "test-secret"
