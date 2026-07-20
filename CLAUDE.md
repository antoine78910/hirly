@AGENTS.md

# Claude Code project notes

The repository stack policy in `AGENTS.md` is mandatory.

Claude hooks add contextual reminders for backend feature, migration, scraper,
and Python-edit prompts. They do not replace the required change
classification or verification.

When adding a new production Python module, include the explicit
`stack-policy: python-exception=...` comment required by `AGENTS.md`. Do not
bypass the tracked pre-commit guard simply to avoid documenting the decision.

