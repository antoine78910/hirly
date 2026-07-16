import asyncio

from apply_agent.blockers import detect_offer_expired
from application_failure import text_indicates_offer_expired


class _FakeLocator:
    def __init__(self, text="", count=0):
        self._text = text
        self._count = count
        self.first = self

    async def count(self):
        return self._count

    async def inner_text(self, timeout=0):
        return self._text


class _FakePage:
    def __init__(self, body="", *, apply_text=None):
        self._body = body
        self._apply_text = apply_text

    def locator(self, selector):
        if selector == "body":
            return _FakeLocator(self._body, count=1)
        if selector in ("#st-apply", 'a[data-sr-track="apply"]', 'a.js-oneclick[href*="oneclick-ui"]'):
            if self._apply_text is None:
                return _FakeLocator(count=0)
            return _FakeLocator(self._apply_text, count=1)
        return _FakeLocator(count=0)


def test_french_expired_button_text_is_detected():
    assert text_indicates_offer_expired("Cette offre a expiré")
    assert text_indicates_offer_expired("L'offre a expiré")


def test_detect_offer_expired_from_apply_cta():
    page = _FakePage(body="Job details", apply_text="Cette offre a expiré")
    assert asyncio.run(detect_offer_expired(page)) is True


def test_detect_offer_expired_from_body_when_apply_missing():
    page = _FakePage(body="Désolé, cette offre n'est plus disponible.")
    assert asyncio.run(detect_offer_expired(page)) is True


def test_active_apply_cta_is_not_expired():
    page = _FakePage(body="Postulez maintenant", apply_text="Je suis intéressé(e)")
    assert asyncio.run(detect_offer_expired(page)) is False
