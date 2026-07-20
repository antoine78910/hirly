# G015 `be218e5` full release-verifier evidence

Classification: `TS_NEW`.

This is an independent local verification of commit
`be218e59e374988f6bafe266a987c61e5d83bc6c`. No deployment, source
activation, canonical-writer transfer, application submission or external
provider fetch was performed.

## Outcome

The committed full verifier ran from a clean detached worktree with:

- Bun 1.3.14 frozen install, typecheck, lint, tests and builds;
- legacy frontend `npm ci --legacy-peer-deps` and production build;
- worker Docker build;
- a fresh PostgreSQL 15 container bound only to loopback, with database
  `hirly_g015_disposable_worker1` and explicit disposable-database opt-in.

The exact-head attestation passed and all checks through the worker Docker build
passed. The combined PostgreSQL release matrix failed:

```text
overallStatus: failed
readinessStatus: FAILED
postgres-release-matrix: 20 pass, 5 fail
```

The preserved verifier manifest is
`artifacts/job-ingestion/release-verification/g015-be218e5-worker1-manifest.json`
with SHA-256
`788f0cb2ad11eb9d5b3215f012037c99bbe847da00739f1d035574d45fdc127e`.
The redacted verifier log and isolated-suite diagnostic log are preserved in
the team artifact directory as `job-supply-release-be218e5.log` and
`postgres-isolated-suites.log`, with SHA-256
`2b1287cd4e41d048829efb733c0611b8a17962e9bfc9518f914f990cccfeba83` and
`0ea7c2fade47b619be6e913a4246f4fdba5df5496b7cc0313a0d125df24b1b22`.

## Root cause and diagnostic proof

The verifier maps all seven integration-suite environment variables to one
database URL, then invokes every file in a single `bun test` command. Earlier
suites leave migration state that later suites independently try to apply.
Later files fail on already-existing constraints and a rollback then fails
because its expected function was never created.

This is a verifier orchestration defect, not a failing migration invariant. A
diagnostic rerun created a new database for each test file and ran the same
seven files individually. All 25 tests passed:

| Suite | Result |
| --- | --- |
| G002 foundation | 11 pass |
| G003 runtime | 7 pass |
| G004 ingestion runtime | 2 pass |
| G010 provider ownership | 1 pass |
| G011 ATS registration | 1 pass |
| ingestion ledger | 1 pass |
| G014 source-trial isolation | 2 pass |

The release verifier must provide an isolated disposable database per suite, or
reset the database between files, before the full profile can be considered a
passing gate. Re-running the unchanged command against another single fresh
database would reproduce the same cross-suite state collision and would not
constitute a materially different recovery attempt.

## Safety and accuracy review

### Confirmed strengths

- Commands stop on the first non-zero stage and the manifest passes only when
  every planned command passes.
- The supplied database URL requires explicit opt-in, a PostgreSQL scheme, a
  loopback host and a database name containing an underscore-delimited
  `test`/`disposable` token.
- Database-matrix output is redacted.
- No deployment or source-activation command exists; both remain typed
  `BLOCKED_EXTERNAL` entries, and safeguard flags remain false.

### Required fixes before treating this as an exact release attestation

1. **Database isolation:** use a fresh database per integration test file.
2. **Expected SHA:** the verifier attests whichever clean HEAD it is run on; it
   does not require an operator-supplied expected commit.
3. **Output integrity:** unrestricted `--output` is written after the final
   repository attestation, so a tracked or outside path can be overwritten
   without changing the pass decision. Restrict the path and write atomically.
4. **Ambient environment:** all commands inherit ambient variables. Unvalidated
   suite-specific database variables could enable integration tests during the
   earlier root test stage. Run with an allowlisted environment.
5. **Docker context/tag:** the empty `.dockerignore` does not exclude ignored
   secrets inside copied directories, and the verifier overwrites the fixed
   local tag `hirly-worker:release-verification`. Sanitize context and use an
   evidence-specific tag/digest.
6. **Static safety coverage:** migration scanning is limited to
   `20260720*.sql` and a narrow enablement regex; Vercel validation compares
   rewrites but not the full frontend deployment contract.
7. **Frontend gate:** `CI=false` converts hook warnings into a successful build,
   and the full profile runs no legacy frontend tests or lint.
8. **Manifest strength:** safeguard values are constants and the manifest lacks
   tool versions, logs, dependency/image digests and a signature.

## External blockers

The failed local gate is `FAILED`, not `BLOCKED_EXTERNAL`. The only valid typed
external blockers remain:

- `DEPLOYMENT_NOT_PERFORMED`
- `SOURCE_ACTIVATION_NOT_PERFORMED`

Those actions were intentionally not attempted.
