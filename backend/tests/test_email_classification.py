import gmail_sync as g


def test_generic_application_acknowledgment_is_confirmation_not_interview():
    """Regression test: these acknowledgment emails were being misclassified
    as 'interview' because their body boilerplate mentions a future/
    hypothetical interview step, which shadowed the far more reliable
    subject-line acknowledgment signal -- and since the Inbox tab's default
    filter tab only shows 'primary' (which is where 'confirmation' maps),
    the misclassification made these emails invisible by default."""
    cases = [
        "Merci pour votre Candidature au poste de Employé polyvalent H/F -Paris Charolais - 7h/s chez Accor",
        "Merci pour votre Candidature au poste de Réceptionniste night H/F - CDI chez Accor",
        "Accusé de réception de votre candidature chez Ingérop",
        "Nous avons bien reçu votre candidature pour le poste de Chargé assurances junior - Alternance - Paris - H/F",
    ]
    for subject in cases:
        assert g._classify_email(subject, "") == "confirmation", subject


def test_generic_application_acknowledgment_with_emoji_is_confirmation():
    assert g._classify_email("Nous avons bien reçu votre candidature ! \U0001F389", "") == "confirmation"


def test_genuine_interview_invite_still_classifies_as_interview():
    assert g._classify_email("Cause à effet vous a invité(e) à un entretien vidéo", "") == "interview"


def test_confirmation_boilerplate_in_body_does_not_override_genuine_interview_subject():
    # An interview-invite subject with generic "thank you for applying"
    # boilerplate later in the body should still classify as interview --
    # the subject-priority check only fires when the SUBJECT itself matches.
    subject = "Let's schedule your interview"
    snippet = "Thank you for applying. We would like to schedule an interview with you."
    assert g._classify_email(subject, snippet) == "interview"


def test_confirmation_only_in_body_still_detected_as_fallback():
    assert g._classify_email("Update on your application", "Thank you for applying to our company.") == "confirmation"


def test_offer_still_takes_priority_over_confirmation_subject():
    assert g._classify_email("Merci pour votre candidature - offre d'embauche", "") == "offer"
