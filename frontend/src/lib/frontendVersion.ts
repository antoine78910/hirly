import { api } from "./api";

declare const __HIRLY_FRONTEND_VERSION__: string | undefined;

const GIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

export interface BackendVersionResponse {
  git_sha?: unknown;
}

export function getCurrentFrontendVersion(): string | null {
  const buildVersion =
    typeof __HIRLY_FRONTEND_VERSION__ === "string"
      ? __HIRLY_FRONTEND_VERSION__.trim()
      : "";
  if (GIT_SHA_PATTERN.test(buildVersion)) return buildVersion.toLowerCase();

  const environmentVersion = process.env.REACT_APP_GIT_SHA?.trim() || "";
  return GIT_SHA_PATTERN.test(environmentVersion)
    ? environmentVersion.toLowerCase()
    : null;
}

export function normalizeBackendVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return GIT_SHA_PATTERN.test(normalized) ? normalized : null;
}

export function versionsDiffer(
  currentVersion: string | null,
  backendVersion: string | null,
): boolean {
  if (!currentVersion || !backendVersion) return false;
  return !(
    currentVersion.startsWith(backendVersion)
    || backendVersion.startsWith(currentVersion)
  );
}

export async function backendHasNewerFrontend(): Promise<boolean> {
  const currentVersion = getCurrentFrontendVersion();
  if (!currentVersion) return false;

  try {
    const response = await api.get<BackendVersionResponse>("/version", {
      headers: { "Cache-Control": "no-cache" },
      params: { _: Date.now() },
      timeout: 5000,
    });
    return versionsDiffer(
      currentVersion,
      normalizeBackendVersion(response.data?.git_sha),
    );
  } catch {
    // Version checks must never make an otherwise healthy app unusable.
    return false;
  }
}
