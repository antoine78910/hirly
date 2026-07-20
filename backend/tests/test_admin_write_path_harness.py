from pathlib import Path


HARNESS = Path(__file__).with_name("run_admin_read_model_write_harness.py")


def test_write_path_harness_encodes_every_release_gate_and_disposable_guard():
    source = HARNESS.read_text()
    for token in (
        '"single_row_added_p95_ms": 25',
        '"batch_added_p95_ms": 75',
        'default=10_000',
        '"counter_lock_wait_upper_bound_p95_ms": 10',
        '"deadlock detected"',
        "assert_disposable(args.database_url)",
        '"completed": sum(',
        "counter_ids",
    ):
        assert token in source


def test_write_path_harness_measures_baseline_before_projection_migration():
    source = HARNESS.read_text()
    baseline = source.index("baseline_single = timed_statements")
    migration = source.index("run_file(args.database_url, UP)")
    projected = source.index("projected_single = timed_statements")
    assert baseline < migration < projected
