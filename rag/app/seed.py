from pathlib import Path

from app.chunking import ALLOWED_EXTENSIONS, to_chunks
from app.store import DuplicateDocument, Store

# The documents a fresh knowledge base starts with.
SEED_DIRECTORY = Path(__file__).parent.parent / "knowledge-base"


# Adds every PDF and TXT file in the directory that isn't in the store yet, by filename, so it's
# safe to run again. A changed file isn't replaced: delete it on /rag first. Returns the names added.
def seed(store: Store, directory: Path = SEED_DIRECTORY) -> list[str]:
    added = []
    for path in sorted(directory.iterdir()):
        if path.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue
        data = path.read_bytes()
        try:
            store.add(path.name, len(data), to_chunks(path.name, data))
        except DuplicateDocument:
            continue
        added.append(path.name)
    return added


if __name__ == "__main__":
    from langchain_openai import OpenAIEmbeddings

    from app.env import DATABASE_URL, OPENAI_API_KEY

    store = Store(DATABASE_URL, OpenAIEmbeddings(model="text-embedding-3-small", api_key=OPENAI_API_KEY))
    added = seed(store)
    print(f"Added {', '.join(added)}." if added else "Nothing to add: every seed document is already there.")
