import pytest

from apply_agent.blockers import detect_bot_wall


class _FakePage:
    def __init__(self, text):
        self._text = text

    def locator(self, selector):
        return self

    async def inner_text(self, timeout=0):
        return self._text


def test_detect_bot_wall_from_http_status():
    page = _FakePage("")
    import asyncio
    assert asyncio.run(detect_bot_wall(page, http_status=403)) is True


def test_detect_bot_wall_from_page_copy():
    page = _FakePage("Access is temporarily restricted due to unusual activity")
    import asyncio
    assert asyncio.run(detect_bot_wall(page)) is True
