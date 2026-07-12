from location_search import _city_name_match_score, _merge_scored, _score_item


def test_city_name_match_prefers_exact_pau_over_saint_paul():
    assert _city_name_match_score("pau", "Pau") == 200.0
    assert _city_name_match_score("pau", "Saint-Paul") < 0


def test_score_item_ranks_pau_above_saint_paul():
    pau = {
        "label": "Pau, Pyrénées-Atlantiques, France",
        "country": "France",
        "country_code": "fr",
        "kind": "city",
    }
    saint_paul = {
        "label": "Saint-Paul, La Réunion, France",
        "country": "France",
        "country_code": "fr",
        "kind": "city",
    }
    assert _score_item("pau", pau) > _score_item("pau", saint_paul)


def test_merge_scored_orders_best_city_first():
    rows = _merge_scored(
        "pau",
        [
            {
                "label": "Saint-Paul, La Réunion, France",
                "country": "France",
                "country_code": "fr",
                "kind": "city",
            },
            {
                "label": "Pau, Pyrénées-Atlantiques, France",
                "country": "France",
                "country_code": "fr",
                "kind": "city",
            },
        ],
    )
    assert rows[0]["label"].startswith("Pau,")
