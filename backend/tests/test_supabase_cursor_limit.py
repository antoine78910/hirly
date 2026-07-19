from db.supabase_adapter import SupabaseCollectionAdapter, SupabaseCursorAdapter


def test_cursor_postgrest_order_keeps_limit_for_jobs_sort():
    collection = SupabaseCollectionAdapter("jobs", supabase_url="https://example.supabase.co", secret_key="secret")
    cursor = SupabaseCursorAdapter(collection, {})
    cursor.sort("imported_at", -1).limit(25)
    assert cursor._postgrest_order() == "imported_at.desc.nullslast"
    # to_list would pass pushed_limit=25 (not None) — verified via order helper + limit fields
    assert cursor._limit == 25


def test_cursor_default_jobs_order_without_sort_spec():
    collection = SupabaseCollectionAdapter("jobs", supabase_url="https://example.supabase.co", secret_key="secret")
    cursor = SupabaseCursorAdapter(collection, {})
    assert cursor._postgrest_order() == "imported_at.desc.nullslast"
