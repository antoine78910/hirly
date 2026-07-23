# Next directions — Evidence-Backed Application Agent

Everything below is deferred deliberately, not cut. Each item is slotted into the version it ships in.

## v1 — Sandbox / multi-adapter submission tool — LIVE AND VERIFIED

**Deployed:** `https://v1-submission-tool-production.up.railway.app/mcp`, attached to `agent_01UCbqpvwhktEKwcZrmHr7ZJ` v2 (Console: platform.claude.com/workspaces/default/agents/agent_01UCbqpvwhktEKwcZrmHr7ZJ). `hirlyApplication_submit` is gated `always_ask` at the platform tool-config level, on top of the server's own approval-receipt gate — two independent layers.

**Verified live, against the real hosted agent** (not just local tests): a real CMA session called `hirlyApplication.verify` → `hirlyApplication.freeze` → `hirlyApplication.submit` over the deployed MCP server, and the missing-receipt case came back as a clean, structured `403 APPROVAL_REQUIRED` denial — not a crash, not a fabricated success.

**A fourth adapter shipped and deployed after the initial live-verification pass:** `browserFormAdapter.ts` — real Chromium automation (Playwright) for JavaScript-rendered forms (the SPA-style UI most real ATS platforms actually use), which `genericWebFormAdapter.ts` cannot fill. Proven against a local JS-rendered test target (`jsFormTarget.ts`) both directly and through the full submit pipeline (22/22 e2e tests), and confirmed launching correctly in the deployed Railway container (`postinstall: playwright install --with-deps chromium`).

**Three real bugs found and fixed during live verification** (all three would have shipped broken without this pass — this is the value of testing against the real hosted agent, not just local scripts):
1. A shared `McpServer`+`StreamableHTTPServerTransport` instance reused across all HTTP requests broke permanently after a second `initialize` call — not just that call, *every subsequent call* on the same deployment, until restart. Fixed by constructing a fresh server+transport per request in `http-server.ts` (stateless mode is only actually stateless if you don't share protocol-level state across requests).
2. The `submit` handler threw raw `Error`s for anticipated denials (missing/expired/tampered receipt, `BLOCKED` plan, no adapter). Over MCP, a thrown handler exception surfaced to the agent as "Tool execution was interrupted by a crash" instead of a clean result — confirmed live, then fixed by returning a `blocked`-status receipt for every anticipated denial path instead of throwing.
3. The `submit` handler independently called `ctx.approvalPort.authorize()` a second time — the MCP runtime (`registerMcpTools`) already runs that exact check, including nonce consumption, using the same `approvalPort`/`approvalReceipt` on `ctx`, before ever invoking the bound handler. The result: every real first-use submission was denied as `replayed_receipt`, because the handler's own redundant check burned the nonce a second time. Fixed by removing the handler's `authorize()` call entirely, keeping only its own non-consuming digest-match check as defense-in-depth. Confirmed live: a fresh nonce now succeeds (or fails for an unrelated, expected reason — e.g. the `sandbox` target being unreachable from the deployed container) on the very first attempt.

All 22 e2e tests pass with these fixes; the tests were themselves restructured to accurately reflect the split between what the MCP runtime enforces automatically and what the handler is actually responsible for.

Below is the original build-time assessment, kept for the parts still genuinely open:

### BUILT AND TESTED

**What's real** (in `v1-submission-tool/`, built on `@lssm-tech/lib.contracts-spec` + `lib.schema` + `lib.companyos-spec`, pulled from the private GitHub Packages registry):
- 5 ContractSpec operations (`hirlyJob.analyze` → `prepare` → `verify` → `freeze` → `submit`), schema-validated, with `submit` the only one carrying a real external effect.
- A real approval gate on `submit`: a receipt must be cryptographically bound (SHA-256 canonical digest) to the *exact* frozen plan, checked for expiry/subject/effects, with atomic nonce-based replay prevention. Proven with 22 passing tests: replay, tampering, missing receipt, expired receipt, and a `BLOCKED` plan are all correctly refused even with an otherwise-valid receipt.
- A real, minimal human-approval mechanism (`approve-cli.ts`): shows the exact plan, requires a typed "yes", only then issues a receipt. Smoke-tested end to end — a real CLI approval → real receipt → real submit → real independent confirmation.
- **Four adapters**, each independently proven against a safe local target (never a real company):
  1. `sandboxAtsAdapter.ts` — fake ATS with separate dispatch/confirm calls and nonce-based idempotency.
  2. `genericWebFormAdapter.ts` — parses and submits standard server-rendered HTML `<form>`s. Tested against a local test form.
  3. `browserFormAdapter.ts` — real Chromium automation (Playwright) for JavaScript-rendered forms, the class of UI most real ATS platforms (Greenhouse, Lever, Workday) actually use. Generic field discovery by `<label for>` + input name/id, not hand-coded per site. Tested against a local JS-rendered test target and confirmed running in the deployed container.
  4. `emailAdapter.ts` — writes a real `.eml` draft to disk; deliberately never sends (no real mailbox credential exists this session, and this project's rule is no speculative credential handling).
- Selecting `applicationTarget.kind: 'ats-adapter'` (a specific real ATS integration, e.g. Greenhouse's API) fails honestly with `no_adapter` — it is not silently routed to another adapter.

**What's still missing before this is genuinely "apply to any job listing live":**
1. **No specific ATS API integrations.** Greenhouse/Lever/etc. each have their own application APIs with their own auth; none are wired up. `ats-adapter` is a placeholder that fails closed. The generic browser-form adapter covers a lot of this gap already (most ATS application pages are just JS-rendered forms), but a real ATS's own API is more robust than DOM-scraping when credentials are available.
2. **No real email sending.** The email adapter is drafts-only by design; wiring `nodemailer` + a real vault SMTP credential is needed once Hirly has an actual mailbox to send from.
3. **No real candidate-approval surface.** `approve-cli.ts` is an honest stand-in for "a human types yes," not Hirly's actual host-app UI. The receipt-issuance contract (exact plan digest → receipt) is what the real UI needs to implement; the CLI proves the contract works, not that the real UX exists.
4. **In-memory receipt/nonce stores don't survive a restart.** Fine for a single deployment's uptime; if Hirly needs receipts to survive a redeploy, swap `receiptStore`/`ApprovalNonceStore` for a real datastore (Redis, Postgres) — flagged, not built, since no such datastore exists in this session either.

Deployment (`http-server.ts` live on Railway, attached to agent v2's `mcp_servers[]`) and real receipt lookup (`toolApprovalReceipt` backed by `/approvals`, not a stub) are both done — see the live-verification summary above.

**Known upstream defect, worked around, not fixed:** `@lssm-tech/lib.contracts-runtime-core`'s published `node`/`bun`/`default` ESM bundles throw `SyntaxError: Export '...' is not defined in module` — a real build defect in that package, not in this code. `local-approval-runtime.ts` reimplements the same documented contract (`createMemoryApprovalNonceStore`, `createOperationApprovalPort`, `operationApprovalInputDigest`) as a stopgap. Swap back to the real package once its build is fixed upstream.

## v1+ — ContractSpec / CompanyOS as the enforcement boundary — DONE (in v1-submission-tool)

**What:** Front the submission tool with a ContractSpec contract (the submission precondition: candidate approval + evidence completeness) and CompanyOS-shaped receipts as the enforcement/observability layer.

**Status:** Done as part of v1, ahead of the original schedule — `execution.approval` on the `hirlyApplication.submit` `OperationSpec` is exactly this contract, and `SubmissionReceiptZ` mirrors `CompanyOsExecutionReceiptSchema`'s load-bearing fields (kept as a local schema rather than a direct re-export, so this tool's receipt shape doesn't silently drift if that package's schema changes).

## Not planned near-term — multiagent, memory, scheduling

**What:** Multiagent orchestration, a memory store, and a scheduled deployment.

**Why deferred:** Explicitly out of scope for this workshop iteration — one agent, one candidate, one job per run, on-demand only. Not a capability gap; a scoping choice.

**How, if it ever becomes relevant:** A per-candidate memory store if Hirly's host app needs cross-run context (e.g. "don't re-ask a question this candidate already answered"); a scheduled deployment only if a genuinely recurring, non-candidate-specific job appears (this feature itself is triggered per candidate/job pair, not on a clock).

## v2 — Lock environment networking to job-board domains

**What:** Switch `environment.networking` from `unrestricted` to `limited` with the relevant job-board/ATS hosts in `allowed_hosts`.

**Why deferred:** Hardening, not urgency — unrestricted is acceptable while the agent is read-only (web_fetch only) and no credentials are in play.

**How:** Once the target job sources/ATS domains are known in production, set `networking: {"type":"limited","allowed_hosts":[...]}` on the environment.

## Always — re-run evals before promoting a new agent version

**What:** Run `evals/run-evals.sh` against any new agent version before it's promoted anywhere production-facing.

**Why:** Process habit, not a build task — the point of the held-back cases (case-02 Grace, case-03 Brex) is to catch regressions across best/partial/poor fit before trusting a change.

**How:** `evals/run-evals.sh <version>`, then compare verdicts against the prior version's `results-v<N>.json`; only promote when verdicts hold.
