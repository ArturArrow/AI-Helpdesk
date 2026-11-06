import psycopg
from langchain_core.embeddings import Embeddings
from langchain_postgres import Column, PGEngine, PGVectorStore
from psycopg.rows import dict_row

# The size of text-embedding-3-small's vectors. Changing the model means re-embedding every document.
EMBEDDING_SIZE = 1536
CHUNKS_TABLE = "chunks"


# The documents and their chunks. Filenames are unique, so the row doubles as the check for a
# file that's already there; the chunks live in a table LangChain manages.
class Store:
    def __init__(self, database_url: str, embeddings: Embeddings):
        self._database_url = database_url
        engine = PGEngine.from_connection_string(database_url.replace("postgresql://", "postgresql+psycopg://", 1))
        with self._connect() as connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id uuid PRIMARY KEY,
                    filename text NOT NULL UNIQUE,
                    size integer NOT NULL,
                    chunk_count integer NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now()
                )
            """)
            exists = connection.execute("SELECT to_regclass(%s) AS name", (CHUNKS_TABLE,)).fetchone()["name"]
        # init_vectorstore_table has no IF NOT EXISTS: it fails on an existing table.
        if exists is None:
            # A column, not the JSON metadata: LangChain's filters only work on columns.
            engine.init_vectorstore_table(
                CHUNKS_TABLE, EMBEDDING_SIZE, metadata_columns=[Column("document_id", "TEXT", nullable=False)]
            )
        self._vectors = PGVectorStore.create_sync(
            engine, embedding_service=embeddings, table_name=CHUNKS_TABLE, metadata_columns=["document_id"]
        )

    def _connect(self) -> psycopg.Connection:
        return psycopg.connect(self._database_url, row_factory=dict_row)
