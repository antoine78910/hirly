import { adminApiErrorMessage, syntheticAutoApplyErrorReport } from "./adminApi";

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
    expect(msg.toLowerCase()).toMatch(/server|network|railway|cors/);
  });

  it("explains client timeouts", () => {
    const msg = adminApiErrorMessage({ code: "ECONNABORTED", message: "timeout of 480000ms exceeded" }, "Execution failed");
    expect(msg).toMatch(/timed out/i);
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
