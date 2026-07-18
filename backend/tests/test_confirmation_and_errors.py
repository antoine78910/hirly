from apply_agent.blockers import (
    collect_post_submit_errors,
    confirmation_text_found,
)
from apply_agent.guardrails import canonical
from auto_apply.models import SubmissionEvidence
from auto_apply.verification import verify


def test_french_sr_confirmation_phrases():
    text = canonical("Merci ! Nous avons bien reçu votre candidature pour ce poste.")
    assert confirmation_text_found(text) is not None


def test_privacy_please_is_not_a_validation_error():
    page = (
        "Please enable cookies to continue.\n"
        "Privacy policy: if an error occurs contact support.\n"
        "Prénom\nNom\n"
    )
    assert collect_post_submit_errors(page) == []


def test_real_required_field_message_is_detected():
    page = "Ce champ est obligatoire\nEmail\n"
    assert collect_post_submit_errors(page)


def test_submit_gone_plus_network_is_not_enough_without_third_signal():
    # Regression guard: still need corroboration; submit_gone alone is weak.
    ev = SubmissionEvidence(
        submit_performed=True,
        submit_control_gone=True,
        network_ok=True,
    )
    assert verify(ev).status == "unverified"


def test_confirmation_and_submit_gone_is_verified():
    ev = SubmissionEvidence(
        submit_performed=True,
        confirmation_text="merci pour votre candidature",
        submit_control_gone=True,
        network_ok=True,
    )
    assert verify(ev).status == "verified_success"


def test_form_still_open_is_not_success_even_if_envoyer_locator_misses():
    """Accor debug case: shadow Envoyer not found but form still visible."""
    ev = SubmissionEvidence(
        submit_performed=True,
        submit_control_gone=True,
        network_ok=True,
        url_changed=False,
        confirmation_text=None,
        raw={
            "form_still_open": True,
            "post_submit_body_preview": "Postulez facilement Informations personnelles",
        },
    )
    v = verify(ev)
    assert v.status == "unverified"
    assert v.reason == "form_still_open_after_submit"


def test_form_cleared_without_url_change_can_verify():
    ev = SubmissionEvidence(
        submit_performed=True,
        submit_control_gone=True,
        network_ok=True,
        url_changed=False,
        raw={"form_still_open": False},
    )
    assert verify(ev).status == "verified_success"
    assert verify(ev).reason == "form_cleared"
