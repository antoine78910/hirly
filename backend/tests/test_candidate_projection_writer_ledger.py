import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / "docs" / "engineering" / "candidate-projection-writer-ledger.md"
PRODUCTION_BACKEND = ROOT / "backend"
AUTHORITATIVE_COLLECTIONS = {"profiles", "swipes", "applications", "users"}
WRITE_METHODS = {
    "insert_one",
    "insert_many",
    "update_one",
    "update_many",
    "delete_one",
    "delete_many",
    "replace_one",
}


def _direct_primary_writer_owners() -> set[str]:
    owners: set[str] = set()
    for path in PRODUCTION_BACKEND.rglob("*.py"):
        if "tests" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        parents = {
            child: parent
            for parent in ast.walk(tree)
            for child in ast.iter_child_nodes(parent)
        }
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr not in WRITE_METHODS:
                continue
            collection = node.func.value
            if not (
                isinstance(collection, ast.Attribute)
                and isinstance(collection.value, ast.Name)
                and collection.value.id == "db"
                and collection.attr in AUTHORITATIVE_COLLECTIONS
            ):
                continue
            owner = parents.get(node)
            while owner is not None and not isinstance(owner, (ast.FunctionDef, ast.AsyncFunctionDef)):
                owner = parents.get(owner)
            assert owner is not None, f"module-level primary writer in {path}:{node.lineno}"
            owners.add(owner.name)
    return owners


def test_candidate_projection_writer_ledger_covers_every_direct_primary_writer():
    ledger = LEDGER.read_text(encoding="utf-8")
    missing = sorted(
        owner
        for owner in _direct_primary_writer_owners()
        if f"`{owner}`" not in ledger
    )

    assert missing == [], f"primary writer owners missing from PR0 ledger: {missing}"


def test_candidate_projection_writer_ledger_keeps_producers_fail_closed():
    ledger = LEDGER.read_text(encoding="utf-8")

    assert "BLOCKED_TRIGGER_NOT_IMPLEMENTED" in ledger
    assert "BLOCKED_DELETION_RPC_NOT_IMPLEMENTED" in ledger
    boundary = ledger.lower()
    assert "no trigger" in boundary
    assert "outbox table" in boundary
    assert "relay" in boundary
