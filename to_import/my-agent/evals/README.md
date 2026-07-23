# Evals

Three cases, each a matched synthetic candidate + job posting (see `../build-sheet.json` → `evals`):

| Case | Candidate | Job |
|---|---|---|
| `case-01-lssm-tech-builder` | Alex Mercier (candidate_synthetic_001) | LSSM Architect Network |
| `case-02-grace-head-of-product-design` | Camille Duret (candidate_synthetic_003) | GRACE Head of Product & Design |
| `case-03-brex-enterprise-ae` | Sofia Almeida (candidate_synthetic_002) | Brex Enterprise Account Executive |

Case 1 is the v0 build/launch input. Cases 2-3 are held back and only run once a version has passed on case 1 — `run-evals.sh` fires one session per case against the same pinned agent version and collects verdicts + usage into `results-v<N>.json`.

`case-01-.../expected/` starts empty. There's no prior real Hirly output to use as a golden answer, so per the skill's default: the first verified run's output becomes `expected/` — the regression baseline for every later agent version. Cases 2-3 don't need a hand-written `expected/`; the Outcome rubric grades each run directly.
