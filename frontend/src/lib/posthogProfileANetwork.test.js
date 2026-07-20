describe("PostHog Profile A real SDK network seam", () => {
  const originalFetch = global.fetch;
  const originalSendBeacon = navigator.sendBeacon;

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: originalSendBeacon,
    });
    delete process.env.REACT_APP_POSTHOG_REPLAY_ENABLED;
    delete process.env.REACT_APP_POSTHOG_REPLAY_HOSTILE_QA_APPROVED;
    delete process.env.REACT_APP_POSTHOG_HOST;
    jest.resetModules();
  });

  it("emits only an explicit allowlisted event and never requests flags or snapshots", async () => {
    const requests = [];
    global.fetch = jest.fn((url, options = {}) => {
      requests.push({ transport: "fetch", url: String(url), body: options.body });
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve("{}"),
        json: () => Promise.resolve({}),
        headers: new Headers(),
      });
    });
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: jest.fn((url, body) => {
        requests.push({ transport: "beacon", url: String(url), body });
        return true;
      }),
    });

    process.env.REACT_APP_POSTHOG_HOST = "https://posthog-profile-a.invalid";
    process.env.REACT_APP_POSTHOG_REPLAY_ENABLED = "false";
    process.env.REACT_APP_POSTHOG_REPLAY_HOSTILE_QA_APPROVED = "false";

    let posthog;
    let buildPostHogConfig;
    jest.isolateModules(() => {
      posthog = require("posthog-js").default;
      ({ buildPostHogConfig } = require("./posthogClient"));
    });

    const client = posthog.init(
      "phc_profile_a_network_test",
      {
        ...buildPostHogConfig(),
        persistence: "memory",
        request_batching: false,
        disable_compression: true,
      },
      "profile-a-network-test",
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([]);

    client.capture("checkout_started", { plan: "pro" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/e\/?\?/);
    expect(requests.some(({ url }) => /\/flags\/?/i.test(url))).toBe(false);
    expect(requests.some(({ body }) => String(body).includes("$snapshot"))).toBe(false);
    expect(requests.some(({ body }) => String(body).includes("checkout_started"))).toBe(true);

    client.stopSessionRecording();
    client.opt_out_capturing({ clear_persistence: true });
  });
});
