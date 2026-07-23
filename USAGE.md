<!-- contractspec:init:usage:start -->
<!-- This section is managed by `contractspec init` and `contractspec onboard`. Content outside these markers is user-owned and preserved. -->
# ContractSpec Usage Guide

Scope: `monorepo-hirly`

This workspace uses ContractSpec to keep contracts, generated artifacts, and AI guidance aligned.

## Start Here

1. Run `contractspec onboard` to generate a track-aware onboarding guide for this repo.
2. Run `contractspec validate` after changing contracts or generated outputs.
3. Run `contractspec doctor` if local setup or tooling looks unhealthy.

## Recommended Commands

- `contractspec onboard` - generate repo-local onboarding guidance and next steps
- `contractspec create` - scaffold a new contract or package target
- `contractspec generate` - refresh derived docs and artifacts
- `contractspec validate` - validate contracts, package scaffolds, and integrity
- `contractspec connect adoption resolve --family <family> --stdin` - reuse existing ContractSpec or workspace surfaces before building new ones

## Builder / Connect

- Use `contractspec init --preset connect` when you want local Connect artifacts and reuse guidance in the repo.
- Use `contractspec init --preset builder-managed`, `builder-local`, or `builder-hybrid` when you want Builder control-plane defaults.

## Notes

- `AGENTS.md` is for AI-agent operating guidance.
- `USAGE.md` is for human implementation flow and repo-local onboarding notes.
<!-- contractspec:init:usage:end -->
