import { act } from "react";
import { createRoot } from "react-dom/client";
import { api, getDirectApiBase } from "../lib/api";
import AdminTraining from "./AdminTraining";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  getDirectApiBase: jest.fn(),
}));
jest.mock("../lib/adminApi", () => ({
  adminApiErrorMessage: () => "Admin request failed",
}));
jest.mock("../components/ui/button", () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock("../components/admin/AdminShell", () => ({
  __esModule: true,
  default: ({ actions, children }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
  AdminAccessDenied: () => <div>Admin access denied</div>,
}));
jest.mock("../components/admin/AdminDataTable", () => ({
  __esModule: true,
  default: ({ data }) => <div>{data.length} rows</div>,
}));

const videoSlot = {
  module_id: "mod_warm_up",
  section_id: "sec_wu_sop",
  label: "Warm Up — SOP",
  en: { has_video: false },
  fr: { has_video: false },
  de: { has_video: false },
  es: { has_video: false },
  it: { has_video: false },
};

function apiResponse(path) {
  if (path === "/admin/training/videos") return { data: { slots: [videoSlot] } };
  if (path === "/admin/training/invites") return { data: { invites: [] } };
  if (path === "/admin/training/analytics") {
    return { data: { summary: {}, module_stats: [], learners: [] } };
  }
  throw new Error(`Unexpected request: ${path}`);
}

describe("AdminTraining course videos", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.clearAllMocks();
    getDirectApiBase.mockReturnValue("https://api.tryhirly.test/api");
    api.get.mockImplementation((path) => Promise.resolve(apiResponse(path)));
    api.post.mockResolvedValue({ data: { ok: true } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uploads a German video to the selected course slot through the direct API", async () => {
    await act(async () => root.render(<AdminTraining />));

    expect(container.textContent).toContain("Course videos");
    expect(container.textContent).toContain("German");
    expect(container.textContent).toContain("Spanish");
    expect(container.textContent).toContain("Italian");

    const languageSelect = container.querySelectorAll("select")[1];
    await act(async () => {
      languageSelect.value = "de";
      languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const file = new File(["video"], "warm-up-de.mp4", { type: "video/mp4" });
    const fileInput = container.querySelector('input[type="file"]');
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Upload video"))
        .click();
    });

    expect(api.post).toHaveBeenCalledWith(
      "https://api.tryhirly.test/api/admin/training/videos",
      expect.any(FormData),
      { timeout: 600000 },
    );
    const form = api.post.mock.calls[0][1];
    expect(form.get("course_id")).toBe("course_job_search_mastery");
    expect(form.get("module_id")).toBe("mod_warm_up");
    expect(form.get("section_id")).toBe("sec_wu_sop");
    expect(form.get("lang")).toBe("de");
    expect(form.get("file")).toBe(file);
  });
});
