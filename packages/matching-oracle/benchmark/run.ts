import { MatchingOracle } from "../src";
import type { CandidateSearchProfile, JobSearchDocument } from "../src";

const cardinality = Number(process.env.MATCHING_BENCH_CARDINALITY ?? 300_000);
const iterations = Number(process.env.MATCHING_BENCH_ITERATIONS ?? 200);
const concurrency = Number(process.env.MATCHING_BENCH_CONCURRENCY ?? 32);
const now = new Date("2026-07-21T00:00:00Z");

const profile: CandidateSearchProfile = {
  candidateId: "benchmark-candidate",
  version: 1,
  roleFamilyIds: ["software-engineering"],
  skillIds: ["typescript", "react", "node"],
  countryCodes: ["FR"],
  originLatitude: 48.8566,
  originLongitude: 2.3522,
  radiusKm: 52,
  contractTypes: ["permanent"],
  workModes: ["hybrid", "remote"],
  salaryFloor: 50_000,
  freshnessWindowDays: 30,
};

const jobs: JobSearchDocument[] = Array.from({ length: cardinality }, (_, index) => ({
  canonicalGroupId: `group-${String(index).padStart(8, "0")}`,
  preferredJobId: `job-${index}`,
  jobVersion: "v1",
  active: index % 97 !== 0,
  validationStatus: index % 89 === 0 ? "invalid" : "valid",
  roleFamilyIds: [index % 300 === 0 ? "software-engineering" : `role-${index % 200}`],
  skillIds: [index % 2 === 0 ? "typescript" : "python", index % 3 === 0 ? "react" : "sql"],
  countryCode: index % 5 === 0 ? "FR" : "DE",
  latitude: index % 5 === 0 ? 48.8566 + (index % 20) / 1_000 : 52.52,
  longitude: index % 5 === 0 ? 2.3522 + (index % 20) / 1_000 : 13.405,
  contractType: index % 7 === 0 ? "contract" : "permanent",
  workMode: index % 2 === 0 ? "hybrid" : "remote",
  salaryFloor: 45_000 + (index % 30_000),
  publishedAt: new Date(now.getTime() - (index % 40) * 86_400_000).toISOString(),
  fulfillmentRoute: index % 4 === 0 ? "manual" : "auto",
  qualityScore: 50 + (index % 50),
}));

const buildStarted = performance.now();
const oracle = new MatchingOracle(jobs);
const buildMs = performance.now() - buildStarted;
const durations: number[] = [];

for (let offset = 0; offset < iterations; offset += concurrency) {
  const batchSize = Math.min(concurrency, iterations - offset);
  await Promise.all(Array.from({ length: batchSize }, async () => {
    const started = performance.now();
    const result = oracle.match(profile, [], { now });
    if (result.coarseCandidateCount > 1_000 || result.results.length > 200) {
      throw new Error("benchmark observed an unbounded match result");
    }
    durations.push(performance.now() - started);
  }));
}

durations.sort((a, b) => a - b);
const percentile = (fraction: number): number => durations[Math.ceil(fraction * durations.length) - 1] ?? 0;
const report = {
  schemaVersion: 1,
  status: "LOCAL_CPU_ONLY",
  cardinality,
  iterations,
  concurrency,
  coarseLimit: 1_000,
  resultLimit: 200,
  buildMs: Number(buildMs.toFixed(3)),
  p95Ms: Number(percentile(0.95).toFixed(3)),
  p99Ms: Number(percentile(0.99).toFixed(3)),
  databaseCpuPercent: null,
  databaseSaturation: null,
  gaps: [
    "In-memory oracle timing is not API-boundary latency.",
    "Representative PostgreSQL CPU, buffers, locks, saturation, and EXPLAIN evidence require a staged 300k-group inventory snapshot.",
  ],
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
