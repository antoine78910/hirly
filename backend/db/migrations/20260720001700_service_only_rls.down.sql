SET lock_timeout = '2s';

ALTER TABLE public.creator_applications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.browser_submission_runs DISABLE ROW LEVEL SECURITY;

RESET lock_timeout;
