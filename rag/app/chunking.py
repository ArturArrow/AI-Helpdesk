from io import BytesIO
from pathlib import PurePath

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader
from pypdf.errors import PyPdfError

ALLOWED_EXTENSIONS = {".pdf", ".txt"}

_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)


# The file can't be turned into text. The message is shown to the admin who uploaded it.
class UnreadableDocument(Exception):
    pass


def extension(filename: str) -> str:
    return PurePath(filename).suffix.lower()


def _pdf_pages(data: bytes) -> list[Document]:
    try:
        pages = PdfReader(BytesIO(data)).pages
        return [Document(page.extract_text(), metadata={"page": number}) for number, page in enumerate(pages, 1)]
    except PyPdfError as error:
        raise UnreadableDocument("The PDF can't be read. It may be damaged or password-protected.") from error


def _txt_pages(data: bytes) -> list[Document]:
    try:
        # utf-8-sig also drops the byte order mark that Windows editors add.
        return [Document(data.decode("utf-8-sig"), metadata={"page": None})]
    except UnicodeDecodeError as error:
        raise UnreadableDocument("The text file must be saved as UTF-8.") from error


# Splits a file into the chunks to embed, each with the page it came from (None for a text file).
def to_chunks(filename: str, data: bytes) -> list[Document]:
    pages = _pdf_pages(data) if extension(filename) == ".pdf" else _txt_pages(data)
    for page in pages:
        # Postgres text can't hold NUL, and some PDFs extract with it.
        page.page_content = page.page_content.replace("\x00", "")
    chunks = _splitter.split_documents([page for page in pages if page.page_content.strip()])
    if not chunks:
        raise UnreadableDocument("No text found in the file. A scanned PDF has to go through OCR first.")
    return chunks
