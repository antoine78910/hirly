# Launch — Evidence-Backed Application Agent

Everything below is staged and doesn't need a key to prepare. `launch.sh` is resumable: each step reads `IDS.env` first and skips anything already created, so re-running after a partial failure never duplicates objects.

## What it does, in order

1. **Confirm model** — lists available models (`GET /v1/models`); `agent.json` already pins `claude-opus-4-8`, the newest Opus-class.
2. **📦 Environment** — cloud, unrestricted networking (`environment.json`).
3. **🤖 Agent** — creates the agent from `agent.json` (job + never-dos system prompt, full toolset). Saves `AGENT_ID` + `AGENT_VERSION`.
4. **📄 Candidate-evidence file** — uploads `synthetic-candidate-001-evidence.json` via the Files API.
5. **▶️ Session** — creates a session in the environment, attaching the uploaded file as a resource.
6. **🎯 Kickoff** — sends the `user.define_outcome` event: task from `first_prompt.txt` (LSSM Architect Network job, `max_iterations: 3`), rubric from `outcome.md`.

All IDs land in `IDS.env` (gitignored) as they're created.

## Before running

The only thing this needs that isn't already staged: `ANTHROPIC_API_KEY` in `.env` (chmod 600, gitignored). Check your shell first — if `ANTHROPIC_API_KEY` is already exported, that's used automatically and nothing needs pasting.

| Step | Where | What to do |
|---|---|---|
| Create a key | platform.claude.com → API keys | Note **which workspace** it belongs to — the Console only shows that workspace's agents/sessions/deployments |
| Land it | `./my-agent/.env` (absolute path shown when you run this) | Paste `ANTHROPIC_API_KEY=sk-ant-...` — never into chat |

## Run it

```bash
./launch.sh
```

Then poll (the script prints the exact command), or watch it stream/poll live in the Console at your workspace's Sessions view.

## Re-running for a new case or a new agent version

- **New eval case, same agent version:** see `evals/run-evals.sh` (handles case-02 and case-03 — different candidate file + job URL, same pinned agent version).
- **New agent version:** update `agent.json`, `curl -X PATCH .../agents/$AGENT_ID` with the current `AGENT_VERSION` as the concurrency guard (see `references/cma-api.md` in the skill for the exact call), bump `AGENT_VERSION` in `IDS.env`, then re-run the evals before trusting the new version.
