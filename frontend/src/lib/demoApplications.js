import { isFinanceDemoEnabled } from "./demoSettings";
import { isDemoAccountEnabled, mergeApplications } from "./demoAccount";
import { getFinanceDemoApplications, getFinanceDemoSwipeHistory } from "./financeDemoApi";
import { mergeDemoCvIntoProfile } from "./demoCvUpload";
import { FINANCE_DEMO_PROFILE } from "./financeDemoJobs";

function mergeApplicationRows(primary, secondary) {
  const seen = new Set();
  const merged = [];
  for (const row of [...primary, ...secondary]) {
    const id = row?.application_id || row?.job_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }
  return merged.sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
}

/** Tracker / Review — include local demo applies only in demo modes. */
export function getMergedTrackerApplications(apiApplications = []) {
  const apiRows = [...(apiApplications || [])];
  if (!isDemoAccountEnabled() && !isFinanceDemoEnabled()) {
    return apiRows;
  }
  let apps = isDemoAccountEnabled() ? mergeApplications(apiRows) : apiRows;
  if (isFinanceDemoEnabled()) {
    apps = mergeApplicationRows(getFinanceDemoApplications(), apps);
  }
  return apps;
}

export function getLocalDemoProfile() {
  return mergeDemoCvIntoProfile({ ...FINANCE_DEMO_PROFILE });
}

export function isDemoTrackerMode() {
  return isFinanceDemoEnabled() || isDemoAccountEnabled();
}

/** Tracker page data — never throw in demo when backend is offline. */
export async function fetchTrackerPageData(apiClient) {
  if (isDemoTrackerMode()) {
    try {
      const [appsRes, profileRes] = await Promise.all([
        apiClient.get("/applications"),
        apiClient.get("/profile"),
      ]);
      return {
        applications: getMergedTrackerApplications(appsRes.data?.applications || []),
        profile: profileRes.data || getLocalDemoProfile(),
      };
    } catch {
      return {
        applications: getMergedTrackerApplications([]),
        profile: getLocalDemoProfile(),
      };
    }
  }

  const [appsRes, profileRes] = await Promise.all([
    apiClient.get("/applications"),
    apiClient.get("/profile"),
  ]);
  return {
    applications: getMergedTrackerApplications(appsRes.data?.applications || []),
    profile: profileRes.data || null,
  };
}

export async function fetchDemoSwipeHistory(apiClient, direction, { limit = 100 } = {}) {
  const query = `direction=${direction}&limit=${limit}`;
  if (isDemoTrackerMode()) {
    try {
      const { data } = await apiClient.get(`/swipes/history?${query}`);
      return data?.swipes || [];
    } catch {
      if (isFinanceDemoEnabled()) {
        return getFinanceDemoSwipeHistory(direction);
      }
      return [];
    }
  }
  const { data } = await apiClient.get(`/swipes/history?${query}`);
  return data?.swipes || [];
}
