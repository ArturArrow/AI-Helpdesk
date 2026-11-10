from app.seed import SEED_DIRECTORY, seed


def test_adds_the_pdf_and_txt_files_once(empty_store, tmp_path):
    (tmp_path / "faq.txt").write_text("Refunds within 30 days.")
    (tmp_path / "notes.md").write_text("Not a supported type.")

    assert seed(empty_store, tmp_path) == ["faq.txt"]
    assert seed(empty_store, tmp_path) == []
    assert [document["filename"] for document in empty_store.list_documents()] == ["faq.txt"]


def test_keeps_a_document_already_added_under_the_same_name(empty_store, tmp_path):
    (tmp_path / "faq.txt").write_text("Refunds within 30 days.")
    seed(empty_store, tmp_path)
    (tmp_path / "faq.txt").write_text("Changed text, much longer than before.")

    seed(empty_store, tmp_path)

    [document] = empty_store.list_documents()
    assert document["size"] == len("Refunds within 30 days.")


def test_the_committed_knowledge_base_can_be_seeded(empty_store):
    assert seed(empty_store) == ["support-knowledge-base.txt"]
    assert SEED_DIRECTORY.name == "knowledge-base"
