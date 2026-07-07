from job_providers.base import JobSearchQuery
from job_providers.workday import (
    WorkdayBoardConfig,
    build_workday_search_text,
    parse_workday_board_url,
)
from job_search_routing import resolve_primary_provider, supplemental_sources
from workday_search import configured_workday_boards, should_run_workday_search


def test_parse_workday_board_url():
    board = parse_workday_board_url("https://workday.wd5.myworkdayjobs.com/Workday")
    assert board is not None
    assert board.tenant == "workday"
    assert board.site == "Workday"
    assert board.wd_server == "wd5"


def test_build_workday_search_text_combines_role_and_location():
    query = JobSearchQuery(role="Software Engineer", location="Paris, France", country="fr")
    assert build_workday_search_text(query) == "Software Engineer Paris, France"


def test_resolve_primary_provider_does_not_auto_select_france_travail(monkeypatch):
    # France Travail is a last-resort fallback (handled explicitly in
    # jobs_service.refresh_jobs_for_profile_if_needed when JSearch and the DB
    # both come up empty), not an auto-selected primary for French locations.
    monkeypatch.setenv("JOB_PROVIDER_PRIMARY", "jsearch")
    monkeypatch.setenv("FRANCE_TRAVAIL_CLIENT_ID", "id")
    monkeypatch.setenv("FRANCE_TRAVAIL_CLIENT_SECRET", "secret")
    query = JobSearchQuery(role="developer", location="Paris", country="fr")
    assert resolve_primary_provider(query) == "jsearch"


def test_resolve_primary_provider_respects_explicit_config(monkeypatch):
    monkeypatch.setenv("JOB_PROVIDER_PRIMARY", "france_travail")
    query = JobSearchQuery(role="developer", location="San Francisco", country="us")
    assert resolve_primary_provider(query) == "france_travail"


def test_should_skip_workday_for_french_ft_queries(monkeypatch):
    monkeypatch.delenv("WORKDAY_SEARCH_FRANCE_SUPPLEMENT", raising=False)
    query = JobSearchQuery(role="developer", location="Paris", country="fr")
    assert should_run_workday_search(query, primary_provider="france_travail") is False


def test_should_run_workday_for_us_queries(monkeypatch):
    query = JobSearchQuery(role="engineer", location="San Francisco", country="us")
    assert should_run_workday_search(query, primary_provider="jsearch") is True


def test_default_workday_board_is_configured():
    boards = configured_workday_boards()
    assert any(board.tenant == "workday" and board.site == "Workday" for board in boards)


def test_supplemental_sources_include_workday_for_jsearch():
    query = JobSearchQuery(role="engineer", location="London", country="gb")
    sources = supplemental_sources(query, primary_provider="jsearch")
    assert "workday" in sources
