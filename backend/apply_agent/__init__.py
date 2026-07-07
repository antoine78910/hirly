"""Generalist AI-agent-driven browser auto-apply system.

Ground-up replacement for the old per-ATS hand-coded `browser_submission`
engines (Greenhouse/Lever field-classification rule engines). Instead of
selectors and regex classifiers written per ATS, a single universal
perception layer (`perception.py`) indexes every interactive element on any
apply page -- known ATS or arbitrary friendly custom career portal -- and an
LLM agent (`agent.py`) decides what to fill and in what order, the way a
human applicant would read the form. Deterministic, non-AI logic is kept only
where it should be: CAPTCHA/login-wall detection and success detection
(`blockers.py`) never guess, and the guardrail validator (`guardrails.py`)
hard-rejects any answer the agent produces that isn't traceable to an
approved profile source -- especially for legal/compliance-sensitive
questions (visa, sponsorship, salary, demographics), which are never
invented, only ever filled from an explicit saved default.

Manual fulfillment (the existing admin queue) remains the permanent fallback
for anything this can't safely handle: CAPTCHA, login walls, low agent
confidence, or a domain with no proven track record yet.
"""
