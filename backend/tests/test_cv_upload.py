from server import (
    _detect_cv_format,
    extract_text_from_upload,
)


def test_detect_cv_format_by_extension_and_magic_bytes():
    assert _detect_cv_format("resume.pdf", b"%PDF-1.4") == "pdf"
    assert _detect_cv_format("resume.png", b"\x89PNG\r\n\x1a\n") == "png"
    assert _detect_cv_format("resume", b"%PDF-1.4 fake") == "pdf"
    assert _detect_cv_format("resume", b"\x89PNG\r\n\x1a\n fake") == "png"


def test_extract_text_from_upload_png_returns_empty_without_ocr():
    png_header = b"\x89PNG\r\n\x1a\n" + b"0" * 32
    assert extract_text_from_upload("cv.png", png_header) == ""
