-- These tables are backend/service-role only. With no policies, RLS denies
-- direct anon/authenticated access while table owners and BYPASSRLS service
-- operations retain the existing backend path. Do not FORCE RLS.
SET lock_timeout = '2s';

ALTER TABLE public.browser_submission_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_applications ENABLE ROW LEVEL SECURITY;

RESET lock_timeout;
