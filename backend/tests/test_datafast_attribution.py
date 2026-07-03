from datafast_attribution import datafast_stripe_metadata, merge_stripe_metadata


def test_datafast_stripe_metadata_from_cookies():
    metadata = datafast_stripe_metadata(
        cookies={
            "datafast_visitor_id": "visitor_abc",
            "datafast_session_id": "session_xyz",
        }
    )
    assert metadata == {
        "datafast_visitor_id": "visitor_abc",
        "datafast_session_id": "session_xyz",
    }


def test_datafast_stripe_metadata_body_fallback_when_cookies_missing():
    metadata = datafast_stripe_metadata(
        cookies={},
        body={
            "datafast_visitor_id": "visitor_body",
            "datafast_session_id": "session_body",
        },
    )
    assert metadata == {
        "datafast_visitor_id": "visitor_body",
        "datafast_session_id": "session_body",
    }


def test_datafast_stripe_metadata_prefers_cookies_over_body():
    metadata = datafast_stripe_metadata(
        cookies={"datafast_visitor_id": "from_cookie"},
        body={"datafast_visitor_id": "from_body"},
    )
    assert metadata == {"datafast_visitor_id": "from_cookie"}


def test_merge_stripe_metadata():
    merged = merge_stripe_metadata(
        {"user_id": "u1", "plan": "pro"},
        {"datafast_visitor_id": "v1"},
    )
    assert merged == {"user_id": "u1", "plan": "pro", "datafast_visitor_id": "v1"}
