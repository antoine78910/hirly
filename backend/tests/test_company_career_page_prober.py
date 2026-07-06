import asyncio

import httpx
import pytest

from company_career_page_prober import probe_career_page_friendliness


class _FakeResponse:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=None, response=self)


class _FakeClient:
    def __init__(self, response=None, exc=None):
        self._response = response
        self._exc = exc

    async def get(self, url):
        if self._exc:
            raise self._exc
        return self._response

    async def aclose(self):
        pass


def _probe(html):
    client = _FakeClient(response=_FakeResponse(html))
    return asyncio.run(probe_career_page_friendliness("https://careers.acme.example/apply", client=client))


def test_friendly_page_no_login_no_captcha_with_upload():
    html = """
    <form enctype="multipart/form-data">
      <label>Name</label><input name="name">
      <label>Resume</label><input type="file" name="resume">
      <button>Submit application</button>
    </form>
    """
    result = _probe(html)
    assert result["is_friendly"] is True
    assert result["requires_login"] is False
    assert result["captcha_detected"] is False
    assert result["has_file_upload"] is True
    assert result["fetch_error"] is None


def test_page_with_password_field_is_not_friendly():
    html = """
    <form>
      <label>Email</label><input name="email">
      <label>Password</label><input type="password" name="password">
      <button>Log in to apply</button>
    </form>
    """
    result = _probe(html)
    assert result["is_friendly"] is False
    assert result["requires_login"] is True


def test_page_with_recaptcha_is_not_friendly():
    html = """
    <script src="https://www.google.com/recaptcha/api.js"></script>
    <div class="g-recaptcha" data-sitekey="abc"></div>
    <form><input type="file" name="resume"></form>
    """
    result = _probe(html)
    assert result["is_friendly"] is False
    assert result["captcha_detected"] is True


def test_fetch_error_is_not_friendly():
    client = _FakeClient(exc=httpx.ConnectTimeout("timed out"))
    result = asyncio.run(probe_career_page_friendliness("https://unreachable.example/apply", client=client))
    assert result["is_friendly"] is False
    assert result["fetch_error"] is not None
