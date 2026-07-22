import { api } from "./api";
import {
  backendHasNewerFrontend,
  normalizeBackendVersion,
  versionsDiffer,
} from "./frontendVersion";

jest.mock("./api", () => ({
  api: { get: jest.fn() },
}));

const mockGet = api.get as jest.Mock;

describe("frontend version checks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REACT_APP_GIT_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  });

  afterEach(() => {
    delete process.env.REACT_APP_GIT_SHA;
  });

  it("normalizes valid Git SHAs and rejects unsafe version values", () => {
    expect(normalizeBackendVersion(" ABCDEF1 ")).toBe("abcdef1");
    expect(normalizeBackendVersion("latest")).toBeNull();
    expect(normalizeBackendVersion(null)).toBeNull();
  });

  it("accepts abbreviated SHAs for the same deployment", () => {
    expect(versionsDiffer("abcdef1234567890abcdef1234567890abcdef12", "abcdef1")).toBe(false);
    expect(versionsDiffer("abcdef1", "1234567")).toBe(true);
  });

  it("detects a newer deployed commit through the backend contract", async () => {
    mockGet.mockResolvedValue({
      data: { git_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });

    await expect(backendHasNewerFrontend()).resolves.toBe(true);
    expect(mockGet).toHaveBeenCalledWith(
      "/version",
      expect.objectContaining({
        headers: { "Cache-Control": "no-cache" },
        timeout: 5000,
      }),
    );
  });

  it("fails open when the backend is unavailable or malformed", async () => {
    mockGet.mockRejectedValueOnce(new Error("offline"));
    await expect(backendHasNewerFrontend()).resolves.toBe(false);

    mockGet.mockResolvedValueOnce({ data: { git_sha: "not-a-sha" } });
    await expect(backendHasNewerFrontend()).resolves.toBe(false);
  });
});
