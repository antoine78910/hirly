from server import (
    _detect_cv_format,
    extract_text_from_upload,
)


def test_detect_cv_format_by_extension_and_magic_bytes():
    assert _detect_cv_format("resume.pdf", b"%PDF-1.4") == "pdf"
    assert _detect_cv_format("resume.png", b"\x89PNG\r\n\x1a\n") == "png"
    assert _detect_cv_format("resume", b"%PDF-1.4 fake") == "pdf"
    assert _detect_cv_format("resume", b"\x89PNG\r\n\x1a\n fake") == "png"


def test_detect_cv_format_jpeg_and_content_type():
    jpeg_header = b"\xff\xd8\xff" + b"0" * 32
    assert _detect_cv_format("blob", jpeg_header) == "jpeg"
    assert _detect_cv_format("cv", b"not-a-real-file", "image/jpeg") == "jpeg"
    assert _detect_cv_format("photo.heic", b"0000ftypheic" + b"0" * 20) == "heic"
    assert _detect_cv_format("scan.webp", b"RIFF" + b"0000" + b"WEBP" + b"0" * 20) == "webp"


def test_extract_text_from_upload_png_returns_empty_without_ocr():
    png_header = b"\x89PNG\r\n\x1a\n" + b"0" * 32
    assert extract_text_from_upload("cv.png", png_header) == ""


def test_extract_text_from_upload_jpeg_returns_empty_without_ocr():
    jpeg_header = b"\xff\xd8\xff" + b"0" * 32
    assert extract_text_from_upload("cv.jpg", jpeg_header) == ""
