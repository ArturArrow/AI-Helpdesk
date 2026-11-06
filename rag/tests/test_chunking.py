from io import BytesIO

import pytest
from pypdf import PdfWriter
from reportlab.pdfgen.canvas import Canvas

from app.chunking import UnreadableDocument, to_chunks


def pdf(*pages: str) -> bytes:
    buffer = BytesIO()
    canvas = Canvas(buffer)
    for text in pages:
        if text:
            canvas.drawString(72, 720, text)
        canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def test_txt_keeps_polish_characters_and_has_no_page():
    [chunk] = to_chunks("zwroty.txt", "Zwrot pieniędzy w ciągu 30 dni".encode())
    assert chunk.page_content == "Zwrot pieniędzy w ciągu 30 dni"
    assert chunk.metadata == {"page": None}


def test_txt_drops_the_byte_order_mark():
    [chunk] = to_chunks("notes.txt", "hello".encode("utf-8-sig"))
    assert chunk.page_content == "hello"


def test_txt_in_another_encoding_is_rejected():
    with pytest.raises(UnreadableDocument, match="UTF-8"):
        to_chunks("notes.txt", "zażółć".encode("cp1250"))


def test_long_text_is_split_with_chunks_within_the_size():
    chunks = to_chunks("long.txt", ("word " * 1000).encode())
    assert len(chunks) > 1
    assert all(len(chunk.page_content) <= 1000 for chunk in chunks)


def test_nul_is_removed():
    [chunk] = to_chunks("notes.txt", b"he\x00llo")
    assert chunk.page_content == "hello"


def test_pdf_chunks_carry_their_page_number():
    chunks = to_chunks("guide.pdf", pdf("First page", "Second page"))
    assert [(c.page_content, c.metadata["page"]) for c in chunks] == [("First page", 1), ("Second page", 2)]


def test_pdf_extension_is_case_insensitive():
    assert to_chunks("GUIDE.PDF", pdf("Hello"))[0].page_content == "Hello"


def test_blank_pages_are_skipped_but_numbering_is_kept():
    chunks = to_chunks("guide.pdf", pdf("", "Second page"))
    assert [c.metadata["page"] for c in chunks] == [2]


def test_pdf_without_text_is_rejected():
    with pytest.raises(UnreadableDocument, match="No text"):
        to_chunks("scan.pdf", pdf("", ""))


@pytest.mark.parametrize("data", [b"not a pdf", b"", b"%PDF-1.7\n garbage"])
def test_damaged_pdf_is_rejected(data):
    with pytest.raises(UnreadableDocument):
        to_chunks("broken.pdf", data)


@pytest.mark.parametrize("data", [b"", b"   \n\n "])
def test_blank_txt_is_rejected(data):
    with pytest.raises(UnreadableDocument, match="No text"):
        to_chunks("empty.txt", data)


def test_password_protected_pdf_is_rejected():
    writer = PdfWriter(clone_from=BytesIO(pdf("Secret")))
    writer.encrypt("password")
    buffer = BytesIO()
    writer.write(buffer)
    with pytest.raises(UnreadableDocument, match="password-protected"):
        to_chunks("locked.pdf", buffer.getvalue())
