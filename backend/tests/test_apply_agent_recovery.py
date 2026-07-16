"""Unit tests for stuck-page recovery helpers (no live browser)."""

import asyncio

from apply_agent import recovery as recovery_mod


def test_click_by_visible_text_blocks_submit_labels():
    class _Page:
        pass

    async def run():
        assert await recovery_mod._click_by_visible_text(_Page(), "Envoyer") is False
        assert await recovery_mod._click_by_visible_text(_Page(), "Submit application") is False
        assert await recovery_mod._click_by_visible_text(_Page(), "") is False

    asyncio.run(run())


def test_close_button_texts_include_french_close():
    assert "Fermer" in recovery_mod._CLOSE_BUTTON_TEXTS
    assert "Continuer sans accepter" in recovery_mod._CLOSE_BUTTON_TEXTS
