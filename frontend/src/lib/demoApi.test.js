import { getDemoResponse } from "./demoApi";

describe("demo admin pagination contracts", () => {
  test("users accepts Axios params and returns cursor metadata", () => {
    const response = getDemoResponse({
      method: "get",
      url: "/admin/users",
      params: { limit: 1, q: "demo" },
    });
    expect(response).toMatchObject({
      contract_version: "admin-users-cursor/v3",
      total: 1,
      has_previous: false,
      has_next: false,
      previous_cursor: null,
      next_cursor: null,
      users: [expect.objectContaining({ user_id: "demo-user" })],
      aggregates: { matching_paying: 1 },
    });
  });

  test("analytics and applications expose server-owned global objects", () => {
    const analytics = getDemoResponse({
      method: "get",
      url: "/admin/user-analytics?page=1&page_size=20",
    });
    expect(analytics).toMatchObject({
      contract_version: "admin-user-analytics-cursor/v2",
      users: [],
      summary: { total_users: 0 },
      answer_distributions: [],
    });

    const applications = getDemoResponse({
      method: "get",
      url: "/admin/applications?filter=manual_blocked&limit=1",
    });
    expect(applications.contract_version).toBe("admin-applications-cursor/v3");
    expect(applications.total).toBe(0);
    expect(applications.has_previous).toBe(false);
    expect(applications.has_next).toBe(false);
    expect(applications.previous_cursor).toBeNull();
    expect(applications.next_cursor).toBeNull();
    expect(applications.applications).toEqual([]);
    expect(applications.queue).toEqual(
      expect.objectContaining({
        active_count: expect.any(Number),
        items: expect.any(Array),
      }),
    );
  });

  test("applications cursor rejects tampering and scope reuse", () => {
    const first = getDemoResponse({
      method: "get",
      url: "/admin/applications?limit=1",
    });
    if (!first.next_cursor) return;

    const second = getDemoResponse({
      method: "get",
      url: `/admin/applications?limit=1&cursor=${encodeURIComponent(first.next_cursor)}`,
    });
    expect(second.applications).toHaveLength(1);
    expect(second.applications[0].application_id).not.toBe(first.applications[0].application_id);

    expect(() =>
      getDemoResponse({
        method: "get",
        url: `/admin/applications?limit=1&cursor=${encodeURIComponent(`${first.next_cursor}x`)}`,
      }),
    ).toThrow("Invalid admin cursor");
    expect(() =>
      getDemoResponse({
        method: "get",
        url: `/admin/applications?filter=prepared&limit=1&cursor=${encodeURIComponent(first.next_cursor)}`,
      }),
    ).toThrow("Invalid admin cursor");
  });
});
