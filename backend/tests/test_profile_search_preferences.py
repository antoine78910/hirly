from profile_search_preferences import (
    resolve_profile_target_location_data,
    resolve_profile_target_location_label,
    resolve_profile_target_role,
)


def test_resolve_role_from_onboarding_selected_roles():
    profile = {
        "extras": {
            "onboarding": {
                "selected_roles": ["Product Manager", "Project Manager"],
            },
        },
    }
    assert resolve_profile_target_role(profile) == "Product Manager"


def test_resolve_location_from_onboarding_extras():
    profile = {
        "extras": {
            "onboarding": {
                "onboarding_location": "Lyon, France",
                "onboarding_location_data": {
                    "location_label": "Lyon, France",
                    "country_code": "fr",
                },
            },
        },
    }
    assert resolve_profile_target_location_label(profile) == "Lyon, France"
    assert resolve_profile_target_location_data(profile)["country_code"] == "fr"


def test_profile_target_fields_take_priority_over_onboarding():
    profile = {
        "target_role": "Data Analyst",
        "target_location": "Paris, France",
        "target_location_data": {"location_label": "Paris, France", "country_code": "fr"},
        "extras": {
            "onboarding": {
                "selected_roles": ["Chef de projet"],
                "onboarding_location": "Marseille, France",
            },
        },
    }
    assert resolve_profile_target_role(profile) == "Data Analyst"
    assert resolve_profile_target_location_label(profile) == "Paris, France"
