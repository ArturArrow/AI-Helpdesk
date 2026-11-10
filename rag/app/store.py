from uuid import uuid4

import psycopg
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_postgres import Column, PGEngine, PGVectorStore
from psycopg.rows import dict_row

# The size of text-embedding-3-small's vectors. Changing the model means re-embedding every document.
EMBEDDING_SIZE = 1536
CHUNKS_TABLE = "chunks"

# Named as the API returns them, so a row is the response. Never the original's bytes: hasFile reads
# only whether there are any, which Postgres answers without loading them.
DOCUMENT_COLUMNS = (
    'id, filename, size, chunk_count AS "chunkCount", created_at AS "createdAt", data IS NOT NULL AS "hasFile"'
)


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
            # The original file, for downloading it. Null for documents added before it was kept.
            connection.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS data bytea")
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
    def add(self, filename: str, data: bytes, chunks: list[Document]) -> dict:
        document_id = str(uuid4())
        for chunk in chunks:
            chunk.metadata |= {"document_id": document_id, "filename": filename}
        try:
            with self._connect() as connection:
                document = connection.execute(
                    f"""INSERT INTO documents (id, filename, size, chunk_count, data) VALUES (%s, %s, %s, %s, %s)
                        RETURNING {DOCUMENT_COLUMNS}""",
                    (document_id, filename, len(data), len(chunks), data),
                ).fetchone()
                self._vectors.add_documents(chunks)
        except psycopg.errors.UniqueViolation as error:
            raise DuplicateDocument from error
        except Exception:
            self._vectors.delete(filter={"document_id": document_id})
            raise
        return document

    def list_documents(self) -> list[dict]:
        with self._connect() as connection:
            return connection.execute(f"SELECT {DOCUMENT_COLUMNS} FROM documents ORDER BY created_at DESC, id").fetchall()

    # The original file's name and bytes, or None when there's no such document or it has no original.
    def file(self, document_id: str) -> tuple[str, bytes] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT filename, data FROM documents WHERE id = %s", (document_id,)).fetchone()
        if row is None or row["data"] is None:
            return None
        return row["filename"], bytes(row["data"])

    # False when there's no such document. The row goes only once its vectors are gone, so a
    # failure leaves a document that can be deleted again.
    def delete(self, document_id: str) -> bool:
        with self._connect() as connection:
            deleted = connection.execute("DELETE FROM documents WHERE id = %s RETURNING id", (document_id,)).fetchone()
            if deleted is None:
                return False
            self._vectors.delete(filter={"document_id": document_id})
        return True

    # The closest chunks, best first. The score is cosine similarity: LangChain returns the distance.
    def search(self, query: str, k: int) -> list[dict]:
        results = self._vectors.similarity_search_with_score(query, k=k)
        return [
            {
                "text": chunk.page_content,
                "filename": chunk.metadata["filename"],
                "page": chunk.metadata["page"],
                "score": 1 - distance,
            }
            for chunk, distance in results
        ]
