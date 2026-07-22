BEGIN;
REVOKE ALL ON FUNCTION worker_private.compare_and_swap_sprout_auth_session(bigint, text) FROM hirly_inventory_worker;
REVOKE ALL ON FUNCTION worker_private.get_sprout_auth_session() FROM hirly_inventory_worker;
DROP FUNCTION IF EXISTS worker_private.compare_and_swap_sprout_auth_session(bigint, text);
DROP FUNCTION IF EXISTS worker_private.get_sprout_auth_session();
DROP TABLE IF EXISTS worker_private.sprout_auth_sessions;
COMMIT;
