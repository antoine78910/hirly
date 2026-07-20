import { describe, expect, test } from "bun:test";
import { WorkerRepository } from "../src";

describe("database repository boundary", () => {
  test("exports only named operations, not arbitrary state mutation", () => {
    const methods = Object.getOwnPropertyNames(WorkerRepository.prototype);
    expect(methods).toContain("claim");
    expect(methods).toContain("heartbeat");
    expect(methods).toContain("finish");
    expect(methods).toContain("writeJobAndComplete");
    expect(methods).not.toContain("updateTask");
    expect(methods).not.toContain("query");
  });
});
