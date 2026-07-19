from role_query_terms import ACADEMIC_LEVEL_STOPWORDS, resolve_role_match_tokens


def test_academic_level_stopwords_cover_common_french_degree_shorthand():
    for token in ("bac", "bts", "dut", "licence", "master", "l3", "m2"):
        assert token in ACADEMIC_LEVEL_STOPWORDS


def test_academic_level_stopwords_do_not_include_real_job_words():
    for token in ("juriste", "droit", "avocat", "developpeur"):
        assert token not in ACADEMIC_LEVEL_STOPWORDS


def test_cook_chef_override_unaffected_by_academic_stopwords():
    assert resolve_role_match_tokens("Chef") == ["cuisinier", "cuisine", "cook", "kitchen"]
    assert resolve_role_match_tokens("Bac+5 droit") is None
