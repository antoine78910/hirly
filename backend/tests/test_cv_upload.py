from server import (
    CV_UPLOAD_ACCEPTED_FORMATS,
    MAX_PROFILE_DOCUMENT_BYTES,
    _cv_text_looks_usable,
    _dedupe_image_candidates,
    _detect_cv_format,
    _extract_rtf_text,
    _guess_image_mime,
    _pdf_ocr_image_candidates,
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


def test_detect_cv_format_pdf_from_content_type_without_extension():
    assert _detect_cv_format("blob", b"%PDF-1.7", "application/pdf") == "pdf"
    assert _detect_cv_format("cv", b"%PDF-1.7", "application/pdf") == "pdf"


def test_cv_text_looks_usable():
    assert _cv_text_looks_usable("John Doe\nSoftware Engineer\nExperience at Acme Corp for five years")
    assert not _cv_text_looks_usable("   ")
    assert not _cv_text_looks_usable("abc")
    assert _cv_text_looks_usable("one two three four five six seven eight")


def test_guess_image_mime():
    assert _guess_image_mime(b"\x89PNG\r\n\x1a\n" + b"0" * 8) == "image/png"
    assert _guess_image_mime(b"\xff\xd8\xff" + b"0" * 8) == "image/jpeg"


def test_dedupe_image_candidates():
    a = b"\x89PNG\r\n\x1a\n" + b"A" * 40
    b = b"\x89PNG\r\n\x1a\n" + b"B" * 40
    assert len(_dedupe_image_candidates([a, a, b])) == 2


def test_pdf_ocr_image_candidates_prefers_rendered_pages(monkeypatch):
    rendered = [b"\x89PNG\r\n\x1a\nrendered"]
    embedded = [b"\xff\xd8\xffembedded"]

    monkeypatch.setattr("server._rasterize_pdf_pages", lambda content, max_pages=4, dpi=200: rendered)
    monkeypatch.setattr("server._extract_pdf_image_bytes", lambda content: embedded)

    result = _pdf_ocr_image_candidates(b"%PDF-fake")
    assert result[0] == rendered[0]
    assert embedded[0] in result


def test_extract_text_from_upload_png_returns_empty_without_ocr():
    png_header = b"\x89PNG\r\n\x1a\n" + b"0" * 32
    assert extract_text_from_upload("cv.png", png_header) == ""


def test_extract_text_from_upload_jpeg_returns_empty_without_ocr():
    jpeg_header = b"\xff\xd8\xff" + b"0" * 32
    assert extract_text_from_upload("cv.jpg", jpeg_header) == ""


def test_detect_cv_format_rtf_and_legacy_doc():
    rtf_bytes = b"{\\rtf1\\ansi Hello World}"
    assert _detect_cv_format("resume.rtf", rtf_bytes) == "rtf"
    assert _detect_cv_format("resume", rtf_bytes) == "rtf"
    ole2_header = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 32
    assert _detect_cv_format("resume.doc", ole2_header) == "doc"
    assert _detect_cv_format("resume", ole2_header) == "doc"
    assert _detect_cv_format("resume", b"anything", "application/msword") == "doc"
    assert _detect_cv_format("resume", b"anything", "application/rtf") == "rtf"


def test_extract_rtf_text_strips_control_words():
    rtf_bytes = b"{\\rtf1\\ansi\\deff0 {\\fonttbl}\\f0\\fs24 John Doe\\par Software Engineer}"
    text = _extract_rtf_text(rtf_bytes)
    assert "John Doe" in text
    assert "Software Engineer" in text
    assert "\\rtf1" not in text


def test_extract_text_from_upload_rtf_uses_rtf_extractor():
    rtf_bytes = b"{\\rtf1\\ansi Jane Smith\\par Product Manager}"
    text = extract_text_from_upload("cover_letter.rtf", rtf_bytes)
    assert "Jane Smith" in text
    assert "Product Manager" in text


def test_extract_text_from_upload_legacy_doc_returns_empty():
    ole2_header = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 32
    assert extract_text_from_upload("resume.doc", ole2_header) == ""


def test_cv_upload_accepted_formats_include_rtf_but_not_legacy_doc():
    assert "rtf" in CV_UPLOAD_ACCEPTED_FORMATS
    assert "doc" not in CV_UPLOAD_ACCEPTED_FORMATS


def test_max_profile_document_bytes_is_20mb():
    assert MAX_PROFILE_DOCUMENT_BYTES == 20 * 1024 * 1024
