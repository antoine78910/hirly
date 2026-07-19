import server


def test_requested_admin_email_is_allowed():
    assert server._is_admin_email("odaissa75@gmail.com") is True
    assert server._is_admin_email("  ODAISSA75@GMAIL.COM  ") is True