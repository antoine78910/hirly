import {
  adminApiErrorMessage,
  autoApplyApiUrl,
  isRequestTimeoutError,
  isTransientNetworkError,
  syntheticAutoApplyErrorReport,
  withNetworkRetries,
} from "./adminApi";

describe("autoApplyApiUrl", () => {
  it("keeps relative paths when direct base is same-origin /api", () => {
    expect(autoApplyApiUrl("/admin/auto-apply/execute")).toBe("/admin/auto-apply/execute");
  });
});

describe("isTransientNetworkError", () => {
  it("detects axios network failures but not timeouts", () => {
    expect(isTransientNetworkError({ code: "ERR_NETWORK", message: "Network Error" })).toBe(true);
    expect(isTransientNetworkError({ code: "ECONNABORTED", message: "timeout of 15000ms exceeded" })).toBe(false);
    expect(isTransientNetworkError({ response: { status: 500 } })).toBe(false);
  });
});

describe("isRequestTimeoutError", () => {
  it("detects axios timeouts", () => {
    expect(isRequestTimeoutError({ code: "ECONNABORTED", message: "timeout of 15000ms exceeded" })).toBe(true);
    expect(isRequestTimeoutError({ code: "ERR_NETWORK", message: "Network Error" })).toBe(false);
  });
});

describe("withNetworkRetries", () => {
  it("retries transient network errors then succeeds", async () => {
    let calls = 0;
    const result = await withNetworkRetries(async () => {
      calls += 1;
      if (calls < 2) {
        const err = new Error("Network Error");
        err.code = "ERR_NETWORK";
        throw err;
      }
      return "ok";
    }, { attempts: 3, delayMs: 1 });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry HTTP responses", async () => {
    let calls = 0;
    await expect(withNetworkRetries(async () => {
      calls += 1;
      const err = new Error("boom");
      err.response = { status: 500 };
      throw err;
    }, { attempts: 3, delayMs: 1 })).rejects.toMatchObject({ response: { status: 500 } });
    expect(calls).toBe(1);
  });
});

describe("adminApiErrorMessage", () => {
  it("explains gateway timeouts", () => {
    const msg = adminApiErrorMessage({ response: { status: 504, data: "timeout" } }, "Execution failed");
    expect(msg).toMatch(/Gateway timeout \(504\)/);
  });

  it("prefers structured detail.message", () => {
    const msg = adminApiErrorMessage({
      response: { status: 500, data: { detail: { message: "Proxy could not reach target host (HTTP 572)." } } },
    }, "Execution failed");
    expect(msg).toContain("HTTP 572");
  });

  it("does not collapse network failures to Execution failed", () => {
    const msg = adminApiErrorMessage({ message: "Network Error", code: "ERR_NETWORK" }, "Execution failed");
    expect(msg).not.toBe("Execution failed");
    expect(msg.toLowerCase()).toMatch(/api|network|railway|retry/);
  });

  it("explains client timeouts", () => {
    const msg = adminApiErrorMessage({ code: "ECONNABORTED", message: "timeout of 480000ms exceeded" }, "Execution failed");
    expect(msg).toContain("Execution failed timed out");
    expect(msg.toLowerCase()).toMatch(/railway|supabase/);
  });

  it("does not retry timeouts in withNetworkRetries", async () => {
    let calls = 0;
    await expect(withNetworkRetries(async () => {
      calls += 1;
      const err = new Error("timeout of 15000ms exceeded");
      err.code = "ECONNABORTED";
      throw err;
    }, { attempts: 3, delayMs: 1 })).rejects.toMatchObject({ code: "ECONNABORTED" });
    expect(calls).toBe(1);
  });

  it("rewrites opaque Internal Server Error detail", () => {
    const msg = adminApiErrorMessage({
      response: { status: 500, data: { detail: "Internal Server Error" } },
    }, "Execution failed");
    expect(msg).toMatch(/500/);
    expect(msg.toLowerCase()).toMatch(/retry|railway|oversized/);
  });
});

describe("syntheticAutoApplyErrorReport", () => {
  it("keeps nested result payloads", () => {
    const report = syntheticAutoApplyErrorReport({
      response: {
        status: 200,
        data: {
          result: {
            status: "error",
            reason: "Job not found",
            error: { message: "Job not found", phase: "prepare", http_status: 404 },
          },
        },
      },
    }, "Execution failed");
    expect(report.reason).toBe("Job not found");
    expect(report.error.http_status).toBe(404);
  });

  it("builds a useful report for opaque 502s", () => {
    const report = syntheticAutoApplyErrorReport({
      response: { status: 502, data: "<html>Bad Gateway</html>" },
    }, "Execution failed");
    expect(report.status).toBe("error");
    expect(report.error.http_status).toBe(502);
    expect(report.reason).toMatch(/502/);
    expect(report.debug.timeline[0].detail).toMatch(/502/);
  });
});
