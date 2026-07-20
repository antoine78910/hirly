# Job supply production validation — 2026-07-20

This is the authorized, read-only production-state record for the legacy
frontend/FastAPI release and primary-application migrations. It is not a source
activation approval and it does not replace the side-effect-free repository
release manifest.

## Observed release state

| Surface | Read-only evidence | Result |
| --- | --- | --- |
| FastAPI / Railway | Project `ac8510b2-669b-461a-b0cb-ffbc21b5ff5c`, production service `hirly`, deployment `cddef0ef-78d4-4058-8e6e-c412d2cd8218` | `SUCCESS`, one running backend service |
| Backend revision | Railway deployment metadata | `bad5ba6de60bf6844779717369ca9df208914c33` (`fix(admin): use bounded overview snapshot`) |
| Backend health | `GET https://hirly-production.up.railway.app/api/health` | HTTP 200 |
| Frontend / Vercel | Production deployment `dpl_9xvodCo1hPpdXyGKFaWbFmS94pyQ` aliased to `app.tryhirly.com` | `READY` |
| Frontend routes | `GET /`, `GET /swipe`, `GET /admin` | HTTP 200 for each SPA route |
| Primary application migrations | Read-only PostgreSQL catalogue query | All expected RPCs from migrations `01100` through `01600` present; RLS enabled on all three tables covered by `01700` |
| Source/worker database surface | Read-only PostgreSQL catalogue query | `provider_registry`, `worker_schedules`, `career_sources`, `source_policy`, `source_policy_evidence`, and `source_trials` absent |
| Worker deployment | Railway production project service inventory | `apps/worker` was not deployed; only the existing `hirly` backend service was present |

The application RPC proof covered:

- `resolve_auth_session`
- `patch_auth_user`
- `patch_onboarding_profile`
- `patch_user_application_status`
- `mark_all_notifications_read`
- `backfill_auto_apply_queue`
- `apply_gmail_application_outcomes`
- `admin_overview_snapshot`
- `admin_analytics_snapshot`
- `admin_users_page`
- `admin_applications_page`

The RLS proof covered `browser_submission_runs`, `notifications`, and
`creator_applications`.

## Source-safety conclusion

No provider/source activation, canonical-writer transfer, worker deployment,
live source schedule, or application-submission action was performed during
this validation. The source tables were absent from the current primary
application database, so the evidence-only trial and future worker inventory
surface remain local/disposable-database capabilities.

This proves the unsplit primary application database was not accidentally
turned into a live source-worker control plane. If an inventory database is
introduced later, validate it independently before any worker deployment.

## Reproduction

All commands below are read-only:

```bash
railway status --json
railway run --environment production --service hirly -- \
  psql ... # catalogue-only function, RLS and to_regclass queries
vercel inspect https://app.tryhirly.com --json
curl --fail https://hirly-production.up.railway.app/api/health
curl --fail https://app.tryhirly.com/
curl --fail https://app.tryhirly.com/swipe
curl --fail https://app.tryhirly.com/admin
```

Secrets and connection strings were not persisted. Railway MCP authorization
was unavailable during the check, so Railway CLI metadata was used. The Vercel
deployment metadata did not expose a Git SHA; exact frontend revision
provenance therefore remains bounded by Vercel deployment ID and alias rather
than a claimed commit.
