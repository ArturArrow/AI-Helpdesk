from uuid import uuid4

import psycopg
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_postgres import Column, PGEngine, PGVectorStore
from psycopg.rows import dict_row

# The size of text-embedding-3-small's vectors. Changing the model means re-embedding every document.
EMBEDDING_SIZE = 1536
CHUNKS_TABLE = "chunks"

# Named as the API returns them, so a row is the response.
DOCUMENT_COLUMNS = 'id, filename, size, chunk_count AS "chunkCount", created_at AS "createdAt"'


class DuplicateDocument(Exception):
    pass


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

    # The row commits only once the vectors are in, so a failure leaves neither behind.
    def add(self, filename: str, size: int, chunks: list[Document]) -> dict:
        document_id = str(uuid4())
        for chunk in chunks:
            chunk.metadata |= {"document_id": document_id, "filename": filename}
        try:
            with self._connect() as connection:
                document = connection.execute(
                    f"""INSERT INTO documents (id, filename, size, chunk_count) VALUES (%s, %s, %s, %s)
                        RETURNING {DOCUMENT_COLUMNS}""",
                    (document_id, filename, size, len(chunks)),
                ).fetchone()
                self._vectors.add_documents(chunks)
        except psycopg.errors.UniqueViolation as error:
            raise DuplicateDocument from error
        except Exception:
            self._vectors.delete(filter={"document_id": document_id})
            raise
        return document

    def list(self) -> list[dict]:
        with self._connect() as connection:
            return connection.execute(f"SELECT {DOCUMENT_COLUMNS} FROM documents ORDER BY created_at DESC, id").fetchall()

    # False when there's no such document. The row goes only once its vectors are gone, so a
    # failure leaves a document that can be deleted again.
    def delete(self, document_id: str) -> bool:
        with self._connect() as connection:
            deleted = connection.execute("DELETE FROM documents WHERE id = %s RETURNING id", (document_id,)).fetchone()
            if deleted is None:
                return False
            self._vectors.delete(filter={"document_id": document_id})
        return True
