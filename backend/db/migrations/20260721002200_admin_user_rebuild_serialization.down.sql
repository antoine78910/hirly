BEGIN;

DROP FUNCTION public.admin_rebuild_users(text[]);
ALTER FUNCTION public.admin_rebuild_users_unlocked(text[])
  RENAME TO admin_rebuild_users;

COMMIT;
