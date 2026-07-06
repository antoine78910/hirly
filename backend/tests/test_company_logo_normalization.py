from job_normalization import normalize_company_logo_url


def test_normalize_company_logo_url_absolute():
    assert normalize_company_logo_url("https://cdn.example.com/logo.png") == "https://cdn.example.com/logo.png"
    assert normalize_company_logo_url("//cdn.example.com/logo.png") == "https://cdn.example.com/logo.png"


def test_normalize_company_logo_url_france_travail_relative():
    assert (
        normalize_company_logo_url("/utile/images/logo.png")
        == "https://www.francetravail.fr/utile/images/logo.png"
    )
    assert (
        normalize_company_logo_url("/logo-employeur/localisation/abc")
        == "https://recrute.francetravail.fr/page-employeur/gw/logo-employeur/localisation/abc"
    )


def test_normalize_company_logo_url_invalid():
    assert normalize_company_logo_url("") is None
    assert normalize_company_logo_url(None) is None
    assert normalize_company_logo_url("not-a-url") is None
