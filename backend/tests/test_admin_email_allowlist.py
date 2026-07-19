import server


def test_requested_admin_email_is_allowed():
    assert server._is_admin_email("tboutron@lssm.co") is True
    assert server._is_admin_email("  TBOUTRON@LSSM.CO  ") is True