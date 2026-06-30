# Job Cache Environment Variables

These variables control the DB-first job cache, validation gates, maintenance endpoints, and direct ATS refresh. Values are intentionally conservative for staging and production.

| Variable | Default in code | Staging | Production | Risk if misconfigured |
| --- | --- | --- | --- | --- |
| `JOBS_DB_FIRST_ENABLED` | `true` | `true` | `true` | If false, feed can fall back to request-time provider work more often. |
| `JOBS_DB_MIN_GOOD_RESULTS_BEFORE_JSEARCH` | `30` | `30` | `30` | Too high can call JSearch too often; too low can underfill feeds. |
| `JOBS_DB_WEAK_RESULTS_THRESHOLD` | `10` | `10` | `10` | Too high increases JSearch usage; too low can show thin feeds. |
| `JOBS_ALLOW_UNKNOWN_TIER_IN_FEED` | `false` | `false` | `false` | If true, C-tier uncertain jobs may appear in feed. |
| `JOBS_ALLOW_UNKNOWN_TIER_APPLICATION` | `false` | `false` | `false` | If true, C-tier jobs can be applied only when manual fulfillment ready; still riskier than A/B. |
| `JOBS_MAINTENANCE_ENABLED` | `true` | `true` | `true` | If false, admin refresh/revalidate/maintenance endpoints are disabled. |
| `JOBS_MAINTENANCE_DEFAULT_COUNTRY` | `FR` | `FR` | `FR` | Wrong country can refresh irrelevant markets. |
| `JOBS_MAINTENANCE_REVALIDATE_LIMIT` | `100` | `100` | `100` | Too high can create slow admin requests; too low slows cleanup. |
| `JOBS_MAINTENANCE_REFRESH_LIMIT` | `100` | `100` | `100` | Too high can increase JSearch cost; too low slows backfill. |
| `JOBS_STALE_AFTER_DAYS` | `30` | `30` | `30` | Too low may reject still-open jobs; too high keeps stale jobs around. |
| `JOBS_REVALIDATE_AFTER_HOURS` | `24` | `24` | `24` | Too low causes unnecessary revalidation; too high leaves unknown jobs stale longer. |
| `JOBS_POPULAR_REFRESH_ENABLED` | `false` | `false` | `false` initially | If true without careful query/location limits, JSearch costs can spike. |
| `JOBS_POPULAR_REFRESH_QUERIES` | built-in list if enabled | empty | empty initially | Broad lists multiply provider calls. |
| `JOBS_POPULAR_REFRESH_LOCATIONS` | built-in France cities if enabled | empty | empty initially | Broad location lists multiply provider calls. |
| `JOBS_ATS_DIRECT_ENABLED` | `true` | `true` | `true` | If false, direct ATS source discovery/refresh endpoints are disabled. |
| `JOBS_ATS_REFRESH_LIMIT` | `25` | `10` | `25` | Too high can create long admin requests and many ATS calls. |
| `JOBS_ATS_REFRESH_OLDER_THAN_HOURS` | `12` | `12` | `12` | Too low refreshes sources too often; too high allows direct ATS cache to age. |
| `JOBS_ATS_DISCOVER_FROM_CACHE_ENABLED` | `true` | `true` | `true` | If false, JSearch-discovered direct ATS companies are not materialized as reusable sources. |
| `JOBS_ATS_REFRESH_JOB_LIMIT` | `200` | `100` | `200` | Too high imports large boards in one request; too low can miss openings on large companies. |

## Recommended Staging Block

```env
JOBS_DB_FIRST_ENABLED=true
JOBS_DB_MIN_GOOD_RESULTS_BEFORE_JSEARCH=30
JOBS_DB_WEAK_RESULTS_THRESHOLD=10
JOBS_ALLOW_UNKNOWN_TIER_IN_FEED=false
JOBS_ALLOW_UNKNOWN_TIER_APPLICATION=false

JOBS_MAINTENANCE_ENABLED=true
JOBS_MAINTENANCE_DEFAULT_COUNTRY=FR
JOBS_MAINTENANCE_REVALIDATE_LIMIT=100
JOBS_MAINTENANCE_REFRESH_LIMIT=100
JOBS_STALE_AFTER_DAYS=30
JOBS_REVALIDATE_AFTER_HOURS=24

JOBS_POPULAR_REFRESH_ENABLED=false
JOBS_POPULAR_REFRESH_QUERIES=
JOBS_POPULAR_REFRESH_LOCATIONS=

JOBS_ATS_DIRECT_ENABLED=true
JOBS_ATS_REFRESH_LIMIT=10
JOBS_ATS_REFRESH_OLDER_THAN_HOURS=12
JOBS_ATS_DISCOVER_FROM_CACHE_ENABLED=true
JOBS_ATS_REFRESH_JOB_LIMIT=100
```

## Recommended Production Start

Use the same values as staging except:

```env
JOBS_ATS_REFRESH_LIMIT=25
JOBS_ATS_REFRESH_JOB_LIMIT=200
```

Keep `JOBS_POPULAR_REFRESH_ENABLED=false` until provider cost and result quality are observed in staging.
