from __future__ import annotations

from io import BytesIO
import re
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .settings import (
    get_max_upload_bytes,
    get_ocr_languages,
    get_ocr_timeout_seconds,
    get_tesseract_cmd,
    get_upload_dir,
    is_ocr_enabled,
)


ALLOWED_EXTENSIONS = {
    ".txt",
    ".md",
    ".pdf",
    ".docx",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
}
MAX_EXTRACTED_CHARS = 120_000


def safe_filename(filename: str | None) -> str:
    raw_name = Path(filename or "upload.txt").name.strip()
    if not raw_name:
        raw_name = "upload.txt"
    stem = Path(raw_name).stem
    suffix = Path(raw_name).suffix.lower()
    clean_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-")
    if not clean_stem:
        clean_stem = "upload"
    return f"{clean_stem[:80]}{suffix}"


def validate_upload_name(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {allowed}")
    return suffix


def decode_text_file(content: bytes) -> tuple[str, str, str | None]:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            text = content.decode(encoding)
            return text[:MAX_EXTRACTED_CHARS], "ready", None
        except UnicodeDecodeError:
            continue
    return "", "failed", "Unable to decode file as text"


def decode_pdf_file(content: bytes) -> tuple[str, str, str | None]:
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(content))
        parts: list[str] = []
        for page in reader.pages:
            parts.append((page.extract_text() or "").strip())
        extracted = "\n\n".join(part for part in parts if part).strip()
        if not extracted:
            return "", "failed", "No extractable text found in PDF"
        return extracted[:MAX_EXTRACTED_CHARS], "ready", None
    except Exception as exc:
        return "", "failed", f"Unable to parse PDF: {exc}"


def decode_docx_file(content: bytes) -> tuple[str, str, str | None]:
    try:
        from docx import Document

        document = Document(BytesIO(content))
        parts: list[str] = []
        parts.extend((p.text or "").strip() for p in document.paragraphs)
        for table in document.tables:
            for row in table.rows:
                row_text = " | ".join((cell.text or "").strip() for cell in row.cells).strip(" |")
                if row_text:
                    parts.append(row_text)
        extracted = "\n".join(part for part in parts if part).strip()
        if not extracted:
            return "", "failed", "No extractable text found in DOCX"
        return extracted[:MAX_EXTRACTED_CHARS], "ready", None
    except Exception as exc:
        return "", "failed", f"Unable to parse DOCX: {exc}"


def decode_image_file(content: bytes, filename: str) -> tuple[str, str, str | None]:
    try:
        from PIL import Image

        image = Image.open(BytesIO(content))
        width, height = image.size
        base_info = f"Image file: {filename}\nFormat: {image.format or 'unknown'}\nSize: {width}x{height}"
        if not is_ocr_enabled():
            return base_info[:MAX_EXTRACTED_CHARS], "ready", "OCR is disabled by server configuration"
        try:
            import pytesseract

            tesseract_cmd = get_tesseract_cmd()
            if tesseract_cmd:
                pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
            ocr_text = (
                pytesseract.image_to_string(
                    image,
                    lang=get_ocr_languages(),
                    timeout=get_ocr_timeout_seconds(),
                )
                or ""
            ).strip()
            if not ocr_text:
                return base_info[:MAX_EXTRACTED_CHARS], "ready", "OCR completed but no text was detected"
            text = f"{base_info}\n\nOCR Text:\n{ocr_text}"
            return text[:MAX_EXTRACTED_CHARS], "ready", None
        except Exception as exc:
            return base_info[:MAX_EXTRACTED_CHARS], "ready", f"OCR unavailable: {exc}"
    except Exception as exc:
        return "", "failed", f"Unable to parse image: {exc}"


def extract_file_text(content: bytes, suffix: str, filename: str) -> tuple[str, str, str | None]:
    if suffix in {".txt", ".md"}:
        return decode_text_file(content)
    if suffix == ".pdf":
        return decode_pdf_file(content)
    if suffix == ".docx":
        return decode_docx_file(content)
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        return decode_image_file(content, filename)
    return "", "failed", "Unsupported file type"


async def prepare_uploaded_file(upload: UploadFile, *, user_id: str, file_id: str) -> dict:
    filename = safe_filename(upload.filename)
    suffix = validate_upload_name(filename)

    content = await upload.read()
    max_upload_bytes = get_max_upload_bytes()
    if len(content) > max_upload_bytes:
        max_mb = max_upload_bytes // (1024 * 1024)
        raise HTTPException(status_code=400, detail=f"File is too large. Max upload size is {max_mb} MB")
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    extracted_text, extraction_status, error_message = extract_file_text(content, suffix, filename)
    user_dir = get_upload_dir() / user_id / file_id
    user_dir.mkdir(parents=True, exist_ok=True)
    storage_path = user_dir / filename
    storage_path.write_bytes(content)

    return {
        "filename": filename,
        "original_filename": upload.filename or filename,
        "mime_type": upload.content_type,
        "file_size": len(content),
        "storage_path": str(storage_path),
        "extracted_text": extracted_text,
        "extraction_status": extraction_status,
        "error_message": error_message,
    }
