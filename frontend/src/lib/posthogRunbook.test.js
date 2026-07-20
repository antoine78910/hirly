import fs from "fs";
import path from "path";

const runbook = fs.readFileSync(
  path.join(process.cwd(), "..", "docs", "operations", "posthog-parallel-rollout.md"),
  "utf8",
);

describe("PostHog production-gate runbook contract", () => {
  it("pins the fail-closed Stripe CLI pagination and evidence manifest", () => {
    expect(runbook).toContain("Stripe CLI **1.42.8**");
    expect(runbook).toContain('-d "created[gte]=$START_EPOCH"');
    expect(runbook).toContain('-d "created[lt]=$END_EPOCH"');
    expect(runbook).toContain('-d "limit=100"');
    expect(runbook).toContain('-d "starting_after=$cursor"');
    expect(runbook).toContain("stripe-shim-argv.txt");
    expect(runbook).toContain("pagination_complete:true");
    expect(runbook).toContain("total_event_count");
    expect(runbook).toContain("final_cursor");
  });

  it("keeps live rollout switches blocked behind fixed evidence thresholds", () => {
    expect(runbook).toContain("Profile A is the only default");
    expect(runbook).toContain("failure rate `>= 5%`");
    expect(runbook).toContain("failure rate `> 0.5%`");
    expect(runbook).toContain("Any semantic ID with `copies > 1`");
    expect(runbook).toContain("median seven-day baseline");
    expect(runbook).toContain("below 80% of its seven-day median");
    expect(runbook).toContain("refund-recognition-ledger.jsonl");
    expect(runbook).toContain("append-only");
    expect(runbook).toContain("growth/analytics cofounder");
    expect(runbook).toContain("export POSTHOG_PAYMENT_REVENUE_ENABLED='false'");
    expect(runbook).toContain("export POSTHOG_REFUND_REVENUE_ENABLED='false'");
  });
});
