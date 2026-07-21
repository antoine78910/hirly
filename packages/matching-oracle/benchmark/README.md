# PR0 matching oracle benchmark

Run `bun run --cwd packages/matching-oracle benchmark` to exercise the deterministic
oracle at the PRD's representative 300,000 canonical-group cardinality. The harness
uses a fixed clock and generated deterministic documents, builds the coarse role
index once, then records p95/p99 matcher latency in logical peak×2 batches (32
by default). It refuses results above the 1,000-job coarse bound or 200-card
output bound. Bun executes the matcher synchronously in one process, so this is
not a substitute for multi-process API load testing.

This is deliberately not production or database evidence. The report marks DB CPU
and saturation unavailable. Before signing `ONLINE_FIRST`, load a representative
staged inventory snapshot, create the indexes named by `queryPlanEvidence()`, run
`ONLINE_MATCH_EXPLAIN_SQL`, and capture API-boundary p95/p99 plus inventory DB CPU,
buffer, lock, and saturation metrics at peak×2. The matcher remains an oracle only;
it does not write jobs, projections, actions, matches, or task state.
