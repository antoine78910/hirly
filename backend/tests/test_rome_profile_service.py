import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rome_profile_service import (
    build_public_rome_profile,
    normalize_rome_code,
)


def test_normalize_rome_code():
    assert normalize_rome_code("m1607") == "M1607"
    assert normalize_rome_code(" D1102 ") == "D1102"
    assert normalize_rome_code("invalid") is None
    assert normalize_rome_code("") is None


def test_build_public_rome_profile_merges_sources():
    profile = build_public_rome_profile(
        "M1607",
        metier={
            "libelle": "Secretariat",
            "definition": "Handles administrative support.",
            "accesEmploi": "Bac pro or equivalent experience.",
            "appellations": [{"libelle": "Assistant administratif"}],
            "competencesMobiliseesPrincipales": [{"libelle": "Organiser le travail"}],
            "competencesMobiliseesEmergentes": [{"libelle": "Utiliser des outils numériques"}],
            "secteursActivites": [{"libelle": "Services aux entreprises"}],
            "contextesMobilises": [{
                "typeContexte": {"libelle": "Horaires"},
                "contextes": [{"libelle": "Travail en journée"}],
            }],
        },
        fiche={
            "metier": {"libelle": "Secretariat"},
            "groupesCompetencesMobilisees": [{
                "enjeu": {"libelle": "Communication"},
                "competences": [{"libelle": "Rédiger des courriers"}],
            }],
            "groupesSavoirs": [{
                "categorieSavoirs": {"libelle": "Techniques professionnelles"},
                "savoirs": [{"libelle": "Bureautique"}],
            }],
        },
        competences={"domaines": [{"libelle": "Organisation", "competences": [{"libelle": "Planifier"}]}]},
        contextes=None,
    )
    assert profile["rome_code"] == "M1607"
    assert profile["definition"] == "Handles administrative support."
    assert profile["core_skills"] == ["Organiser le travail"]
    assert profile["emerging_skills"] == ["Utiliser des outils numériques"]
    assert profile["skill_groups"][0]["title"] == "Communication"
    assert profile["knowledge_groups"][0]["items"] == ["Bureautique"]
    assert profile["context_groups"][0]["title"] == "Horaires"
    assert profile["sources"]["metiers"] is True
    assert profile["sources"]["fiches"] is True


def test_build_public_rome_profile_uses_fiche_skills_when_metier_missing():
    profile = build_public_rome_profile(
        "D1102",
        fiche={
            "groupesCompetencesMobilisees": [{
                "enjeu": {"libelle": "Production"},
                "competences": [{"libelle": "Pétrir la pâte"}],
            }],
        },
    )
    assert profile["core_skills"] == ["Pétrir la pâte"]
