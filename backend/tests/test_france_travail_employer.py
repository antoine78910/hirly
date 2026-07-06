from france_travail_employer import (
    employer_logo_url,
    employer_page_url,
    enrich_france_travail_job,
    extract_emails_from_text,
    slug_from_employer_url,
)


def test_slug_from_employer_url():
    assert slug_from_employer_url("l-odysee-380") == "l-odysee-380"
    assert slug_from_employer_url("https://recrute.francetravail.fr/page-employeur/l-odysee-380") == "l-odysee-380"


def test_extract_emails_from_text_ignores_ft_domains():
    emails = extract_emails_from_text(
        "Merci d'envoyer votre CV à recrutement@acme.fr ou contact@francetravail.fr"
    )
    assert emails == ["recrutement@acme.fr"]


def test_enrich_france_travail_job_uses_employer_page(monkeypatch):
    class FakeResponse:
        def __init__(self, payload):
            self.status_code = 200
            self._payload = payload

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.calls = []

        def get(self, url, headers=None):
            self.calls.append(url)
            if url.endswith("/url/l-odysee-380"):
                return FakeResponse({"sirenOrSiret": "494460769"})
            if url.endswith("/page-employeur/494460769"):
                return FakeResponse({
                    "employeur": {
                        "idRCE": "rce-main",
                        "etablissements": [],
                    },
                    "urls": [{"urlPath": "l-odysee-380", "actif": True}],
                    "page": {
                        "entete": {"logoUpdated": True},
                        "contenu": {
                            "tabs": [{
                                "areas": [{
                                    "widgets": [{
                                        "data": {"text": "Contact: jobs@odysee.fr"},
                                    }],
                                }],
                            }],
                        },
                    },
                })
            raise AssertionError(url)

        def close(self):
            return None

    monkeypatch.setattr("france_travail_employer.httpx.Client", FakeClient)

    job = enrich_france_travail_job(
        {"title": "Commercial", "company": "L'Odyssee"},
        {
            "entreprise": {"nom": "L'Odyssee", "url": "l-odysee-380"},
            "contact": {"commentaire": "Postulez vite"},
            "description": "Rejoignez notre équipe",
        },
    )

    assert job["ft_employer_page_url"] == employer_page_url("l-odysee-380")
    assert job["company_logo"] == employer_logo_url("rce-main")
    assert job["contact_email"] == "jobs@odysee.fr"
