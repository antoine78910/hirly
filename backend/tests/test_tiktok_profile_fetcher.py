from tiktok_profile_fetcher import _parse_tikwm_video, _parse_video, fetch_tiktok_profile


def test_parse_video_reads_user_info_stats():
    item = {
        "id": "123",
        "desc": "Hello world",
        "createTime": 1710000000,
        "author": {"uniqueId": "hirlyjob"},
        "stats": {
            "playCount": 1495,
            "diggCount": 36,
            "commentCount": 2,
            "shareCount": 1,
        },
        "video": {"cover": "https://example.com/cover.jpg"},
    }
    parsed = _parse_video(item, default_handle="hirlyjob")
    assert parsed["video_id"] == "123"
    assert parsed["views"] == 1495
    assert parsed["likes"] == 36
    assert parsed["cover_url"] == "https://example.com/cover.jpg"
    assert parsed["url"].endswith("/video/123")


def test_parse_tikwm_video_maps_play_count():
    item = {
        "video_id": "7659115983663058209",
        "title": "Career tips",
        "play_count": 1495,
        "digg_count": 36,
        "comment_count": 2,
        "share_count": 0,
        "create_time": 1710000000,
        "cover": "https://example.com/cover.jpg",
    }
    parsed = _parse_tikwm_video(item, "hirlyjob")
    assert parsed["views"] == 1495
    assert parsed["likes"] == 36
    assert parsed["description"] == "Career tips"


def test_fetch_tiktok_profile_uses_tikwm_fallback(monkeypatch):
    html = """
    <html><body>
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
    {"__DEFAULT_SCOPE__":{"webapp.user-detail":{"userInfo":{"user":{"uniqueId":"hirlyjob","nickname":"Eva","secUid":"sec"},"stats":{"followerCount":2,"videoCount":2,"heartCount":132},"itemList":[]}}}}
    </script></body></html>
    """

    class FakeResponse:
        def __init__(self, text: str, *, status_code: int = 200):
            self.text = text
            self.status_code = status_code

        def raise_for_status(self):
            return None

    class FakeClient:
        cookies = {}

        def get(self, url, **kwargs):
            if "tiktok.com/@" in url:
                return FakeResponse(html)
            return FakeResponse("")

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_tikwm(handle: str):
        from tiktok_profile_fetcher import _parse_tikwm_video

        return [_parse_tikwm_video({
            "video_id": "7659115983663058209",
            "title": "Career tips",
            "play_count": 1495,
            "digg_count": 36,
            "comment_count": 2,
            "share_count": 0,
            "create_time": 1710000000,
            "cover": "https://example.com/cover.jpg",
        }, handle)]

    monkeypatch.setattr("tiktok_profile_fetcher.httpx.Client", lambda **kwargs: FakeClient())
    monkeypatch.setattr("tiktok_profile_fetcher._fetch_videos_from_tikwm", fake_tikwm)

    profile = fetch_tiktok_profile("hirlyjob")
    assert profile["followers"] == 2
    assert len(profile["videos"]) == 1
    assert profile["videos"][0]["views"] == 1495
    assert profile["views_total"] == 1495
