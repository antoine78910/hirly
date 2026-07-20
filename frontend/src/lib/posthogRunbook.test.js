import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const runbook = fs.readFileSync(
  path.join(process.cwd(), "..", "docs", "operations", "posthog-parallel-rollout.md"),
  "utf8",
);
const exporterFunctions = runbook.match(
  /```sh\n(run_stripe_page\(\) \{[\s\S]*?\n\}\n\nexport_stripe_events\(\) \{[\s\S]*?\n\})\n```/,
)?.[1];

const runExporterScenario = (stripeShim, scenario) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "posthog-runbook-test-"));
  const binDir = path.join(tempDir, "bin");
  const scratchDir = path.join(tempDir, "scratch");
  fs.mkdirSync(binDir);
  fs.mkdirSync(scratchDir);
  fs.writeFileSync(path.join(binDir, "stripe"), `#!/bin/zsh\n${stripeShim}\n`, { mode: 0o755 });
  const script = path.join(tempDir, "scenario.zsh");
  fs.writeFileSync(
    script,
    `set -u\n${exporterFunctions}\nexport TEST_ROOT=${JSON.stringify(tempDir)}\n${scenario}\n`,
  );
  const startedAt = Date.now();
  const result = spawnSync("zsh", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      TMPDIR: scratchDir,
      STRIPE_PAGE_TIMEOUT_SECONDS: "1",
      STRIPE_PAGE_KILL_GRACE_SECONDS: "1",
    },
    timeout: 7000,
  });
  const elapsedMs = Date.now() - startedAt;
  const scratchEntries = fs.readdirSync(scratchDir);
  fs.rmSync(tempDir, { recursive: true, force: true });
  return { ...result, elapsedMs, scratchEntries };
};

describe("PostHog production-gate runbook contract", () => {
  it("keeps every fenced procedure structurally closed", () => {
    let openFence = null;
    for (const match of runbook.matchAll(/^```([^\n]*)$/gm)) {
      const language = match[1];
      if (openFence === null) {
        openFence = language;
      } else {
        expect(language).toBe("");
        openFence = null;
      }
    }
    expect(openFence).toBeNull();
  });

  it("pins the fail-closed Stripe CLI pagination and evidence manifest", () => {
    expect(exporterFunctions).toBeTruthy();
    expect(runbook).toContain("Stripe CLI **1.42.8**");
    expect(runbook).toContain('-d "created[gte]=$START_EPOCH"');
    expect(runbook).toContain('-d "created[lt]=$END_EPOCH"');
    expect(runbook).toContain('-d "limit=100"');
    expect(runbook).toContain('-d "starting_after=$cursor"');
    expect(runbook).toContain("stripe-shim-argv.txt");
    expect(runbook).toContain("pagination_complete:true");
    expect(runbook).toContain("total_event_count");
    expect(runbook).toContain("final_cursor");
    expect(runbook).toContain('response="$(run_stripe_page "${args[@]}")" || return $?');
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

  it("terminates a hung Stripe page with its own deadline and cleans temporary state", () => {
    const result = runExporterScenario(
      'print -r -- "$$" > "$TEST_ROOT/stripe.pid"\nsleep 60',
      `
run_stripe_page events list
exit_code=$?
[[ "$exit_code" -eq 124 ]] || exit 90
pid="$(cat "$TEST_ROOT/stripe.pid")"
kill -0 "$pid" 2>/dev/null && exit 91
exit 0`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.elapsedMs).toBeLessThan(5000);
    expect(result.stderr).toContain("stripe page timed out after 1s");
    expect(result.scratchEntries).toEqual([]);
  });

  it("rejects misleading success output when Stripe exits nonzero", () => {
    const result = runExporterScenario(
      'print -r -- \'{"object":"list","data":[],"has_more":false}\'\nexit 9',
      `
response="$(run_stripe_page events list)"
exit_code=$?
[[ "$exit_code" -eq 9 ]] || exit 92
[[ -z "$response" ]] || exit 93
exit 0`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.scratchEntries).toEqual([]);
  });

  it("exports a normal two-page cursor and writes only a complete manifest", () => {
    const result = runExporterScenario(
      `
print -r -- "$*" >> "$TEST_ROOT/argv"
if [[ "$*" == *"starting_after=evt_fixture_first"* ]]; then
  print -r -- '{"object":"list","data":[{"id":"evt_fixture_second"}],"has_more":false}'
else
  print -r -- '{"object":"list","data":[{"id":"evt_fixture_first"}],"has_more":true}'
fi`,
      `
export START_EPOCH=100
export END_EPOCH=200
output="$TEST_ROOT/refund.updated.jsonl"
export_stripe_events refund.updated "$output" || exit 94
jq -e '.pagination_complete == true
       and .page_count == 2
       and .total_event_count == 2
       and .final_cursor == "evt_fixture_first"' "$output.manifest.json" >/dev/null || exit 95
grep -F -- '-d starting_after=evt_fixture_first' "$TEST_ROOT/argv" >/dev/null || exit 96
[[ "$(wc -l < "$output" | tr -d ' ')" == 2 ]] || exit 97
exit 0`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.scratchEntries).toEqual([]);
  });
});
