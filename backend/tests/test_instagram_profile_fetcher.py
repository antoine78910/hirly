from instagram_profile_fetcher import _parse_media_node, fetch_instagram_profile


def test_parse_media_node_maps_reel_views():
    node = {
        "__typename": "GraphVideo",
        "shortcode": "DaWM-M8pHDX",
        "is_video": True,
        "product_type": "clips",
        "taken_at_timestamp": 1710000000,
        "video_view_count": 102734,
        "edge_liked_by": {"count": 2984},
        "edge_media_to_comment": {"count": 12},
        "edge_media_to_caption": {"edges": [{"node": {"text": "Career tips"}}]},
        "thumbnail_src": "https://example.com/cover.jpg",
    }
    parsed = _parse_media_node(node, "mike.jobtips")
    assert parsed["video_id"] == "DaWM-M8pHDX"
    assert parsed["views"] == 102734
    assert parsed["likes"] == 2984
    assert parsed["url"] == "https://www.instagram.com/reel/DaWM-M8pHDX/"


def test_fetch_instagram_profile_parses_user(monkeypatch):
    payload = {
        "data": {
            "user": {
                "username": "mike.jobtips",
                "full_name": "Mike",
                "profile_pic_url_hd": "https://example.com/avatar.jpg",
                "edge_followed_by": {"count": 120},
                "edge_follow": {"count": 40},
                "edge_owner_to_timeline_media": {
                    "count": 1,
                    "edges": [{
                        "node": {
                            "__typename": "GraphVideo",
                            "shortcode": "ABC123",
                            "is_video": True,
                            "product_type": "clips",
                            "taken_at_timestamp": 1710000000,
                            "video_view_count": 500,
                            "edge_liked_by": {"count": 20},
                            "edge_media_to_comment": {"count": 3},
                            "edge_media_to_caption": {"edges": [{"node": {"text": "Hello"}}]},
                            "thumbnail_src": "https://example.com/cover.jpg",
                        },
                    }],
                },
            },
        },
    }

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return payload

        @staticmethod
        def raise_for_status():
            return None

    monkeypatch.setattr("instagram_profile_fetcher.httpx.get", lambda *args, **kwargs: FakeResponse())

    profile = fetch_instagram_profile("mike.jobtips")
    assert profile["handle"] == "mike.jobtips"
    assert profile["followers"] == 120
    assert len(profile["videos"]) == 1
    assert profile["views_total"] == 500
