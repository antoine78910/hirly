<!-- contractspec:init:agents:start -->
<!-- This section is managed by `contractspec init` and `contractspec onboard`. Content outside these markers is user-owned and preserved. -->
# ContractSpec AI Guide

Scope: `monorepo-hirly`

This project uses ContractSpec for spec-first development. Treat contracts as the source of truth for implementation changes.

## Core Rules

- Update contracts before implementation code.
- Validate contracts after changes with `contractspec validate`.
- Regenerate derived artifacts before considering the work complete.
- Prefer existing package-local guides and READMEs when working in a nested package.

## Monorepo Scope

This guide is scoped to the workspace root.
- Shared contracts may live in multiple packages under `packages/*/src/contracts/`
- Prefer the nearest package guide when working inside a specific package.

## Recommended Workflow

1. Check whether a contract already exists for the change.
2. Update or create the contract first.
3. Run validation and generation commands.
4. Review downstream code and tests affected by the contract update.

## Key Commands

- `contractspec create` - scaffold a new contract
- `contractspec validate` - validate contract integrity
- `contractspec build` - generate implementation artifacts
- `contractspec doctor` - verify workspace configuration

## Working Agreement

- Keep changes spec-first, deterministic, and reviewable.
- Do not change generated outputs without updating their source contract.
- When touching nested packages, prefer the nearest `AGENTS.md` and `README.md` as the local source of truth.
- Reuse existing workspace code before creating new files, packages, or dependencies.
- Prefer ContractSpec OSS packages by family:
  - UI: local reusable UI -> `@lssm-tech/lib.design-system` -> platform ui-kit -> shadcn/web fallback
  - Contracts: existing local spec -> `@lssm-tech/lib.contracts-spec` / `@lssm-tech/lib.schema`
  - Integrations/runtime/shared libs: existing workspace surface -> ContractSpec OSS catalog -> reviewed fallback
- Use `contractspec connect adoption sync` and `contractspec connect adoption resolve --family <family>` when the right reusable surface is unclear.

## Initialization Preset

- This workspace was initialized with the `core` setup preset.
<!-- contractspec:init:agents:end -->
# Hirly Agent Instructions

## Product priority

Hirly is live. Retention, churn, fulfillment reliability, inventory quality, and
production safety take precedence over language migration.

The architecture direction is TypeScript. Migration happens through product
work and must not wait for a future rewrite project.

Read `docs/engineering/stack-migration-policy.md` before changing backend
architecture, job ingestion, fulfillment, shared contracts, or database writers.

## Required change classification

Before implementing a code change, classify it internally as exactly one of:

- `PY_FIX`: a bug, incident, security fix, or small improvement in an existing
  Python-owned capability.
- `TS_NEW`: a new isolated capability that does not need to live in the Python
  runtime.
- `TS_MIGRATION`: substantial work on an existing bounded Python capability
  that can be moved without slowing the product outcome.
- `PY_EXCEPTION`: new Python production surface that cannot safely or
  reasonably be delivered in TypeScript now.

Do not ask the user to choose the classification when repository evidence makes
it clear. State the classification in the final implementation report.

## Stack routing rules

1. Fix existing production behavior in its current language when that is the
   fastest safe path. Do not turn an urgent Python fix into a migration project.
2. Implement new isolated backend capabilities in TypeScript by default.
3. Implement new job scrapers/providers in TypeScript by default.
4. When substantially redesigning a bounded Python capability, migrate it to
   TypeScript if characterization tests, observability, rollout, and rollback
   can be provided without delaying the product outcome.
5. Do not rewrite stable Python merely because it is Python.
6. New frontend files must use TypeScript/TSX unless constrained by the existing
   toolchain or an adjacent JavaScript-only module.
7. A capability has one authoritative production owner and one authoritative
   writer. Shadow implementations may compare outputs, but must not both mutate
   canonical state.
8. Delete the superseded Python path after the TypeScript path is proven and
   rollback risk is acceptable. Do not leave permanent dual implementations.

## New Python exception

Adding a new production `.py` file under `backend/` requires a concrete reason.
Put this comment in the first 10 lines:

```python
# stack-policy: python-exception=<why TypeScript would be slower or less safe>
```

Tests under `backend/tests/` do not require an exception. Editing existing
Python files does not require an exception.

A `PY_EXCEPTION` must be called out in the final report with:

- why an existing Python edit was insufficient;
- why TypeScript would delay or increase risk;
- whether the new surface should later migrate.

## Job ingestion invariants

Scrapers do not write provider-shaped payloads directly into canonical job
tables. Every provider must go through the canonical ingestion contract:

`fetch -> normalize -> validate -> deduplicate -> canonical write`

Preserve these invariants across Python and TypeScript:

- stable `job_id` derived from `provider:external_id`;
- uniqueness by `provider + external_id`;
- canonical indexed columns plus the complete source document;
- consistent fingerprinting, country/location normalization, apply URL
  selection, ATS detection, freshness, and fulfillment eligibility;
- one writer per provider during rollout;
- fixture parity and a provider/country rollback switch before cutover.

## Migration release gates

Migration work must not knowingly regress:

- paid activation, retention, churn, or refunds;
- relevant fresh jobs per active profile;
- invalid, expired, or duplicate inventory rates;
- feed latency and availability;
- fulfillment queue age and verified submission rate;
- duplicate-submission protection.

Prefer provider- or country-level rollout over whole-system cutovers. If a gate
regresses, roll traffic back while fixing the TypeScript implementation.

## Verification

- `PY_FIX`: run the smallest affected Python tests.
- `TS_NEW`: run typecheck, tests, and contract validation for the new surface.
- `TS_MIGRATION`: run old behavior characterization tests, Python/TypeScript
  parity fixtures where applicable, and rollout/rollback validation.
- Job ingestion changes must test stable IDs, duplicate upserts, apply URL
  selection, country normalization, validation tier, and fulfillment readiness.
