# Outcome — Evidence-Backed Application Agent (v0)

A run passes only when **all** of the following are true.

1. Every material application claim in `application-pack.md` and `claim-map.json` has at least one valid `evidence_id` reference from the supplied candidate-evidence file — no claim floats free of evidence.
2. No claim with `support_status` of `unsupported`, `uncertain`, or `conflicted` is presented as settled fact anywhere in `application-pack.md` or `submission-plan.json` — it is flagged as such, not smoothed over.
3. Salary expectations, work authorization, relocation preference, legal attestations, demographic information, and any other personal/legally sensitive answer are left for the candidate (listed as an unresolved question) unless the evidence file explicitly provides them — never inferred or guessed.
4. The application draft is specific to the supplied job posting's actual requirements and language, not a generic template.
5. Every job requirement and every draft claim remains traceable to its source (the job posting text/URL, or a specific `evidence_id`) — a reviewer could follow each claim back to where it came from.
6. The output never states or implies that an application was submitted, or that a callback, interview, offer, or any other job outcome occurred. The agent drafts; it does not submit, and says so explicitly in `submission-plan.json`.

Additionally: if the job page could not be read reliably, the run should show the agent stopping to ask for pasted job text rather than proceeding on inferred content.
